#!/usr/bin/env python3
"""
Gateway sender for OpenClaw websocket integration.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Callable, Optional

import websocket

from config import get_gateway_url, get_openclaw_token, get_session_key


class GatewaySender:
    def __init__(
        self,
        gateway_url: Optional[str] = None,
        token: Optional[str] = None,
        session_key: Optional[str] = None,
    ) -> None:
        self.gateway_url = (gateway_url or get_gateway_url()).rstrip("/")
        self.token = (token or get_openclaw_token(required=False) or "").strip()
        self.session_key = (session_key or get_session_key()).strip()

        self.ws: Optional[websocket.WebSocketApp] = None
        self.ws_thread: Optional[threading.Thread] = None
        self.connected = False
        self.authenticated = False
        self.pending_requests: dict[str, Callable[[dict], None]] = {}
        self.last_error: Optional[str] = None
        self.last_pushed_content = ""
        self.disabled_reason: Optional[str] = None

        self.on_message: Optional[Callable[[str], None]] = None
        self.on_connect: Optional[Callable[[], None]] = None
        self.on_error: Optional[Callable[[str], None]] = None

        if not self.token:
            self.disabled_reason = "missing_token"
            self.last_error = "未找到 OpenClaw token，网关功能已禁用。"

    def _notify_error(self, message: str) -> None:
        self.last_error = message
        if self.on_error:
            self.on_error(message)

    def connect(self) -> None:
        if self.disabled_reason:
            self._notify_error(self.last_error or "网关不可用")
            print("[网关] 未配置 token，跳过 OpenClaw 连接。")
            return

        ws_url = f"{self.gateway_url}/?token={self.token}"
        print(f"[网关] 连接到 {self.gateway_url}")

        self.ws = websocket.WebSocketApp(
            ws_url,
            on_open=self._on_open,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
        )

        self.ws_thread = threading.Thread(target=self.ws.run_forever, daemon=True)
        self.ws_thread.start()

    def _on_open(self, ws: websocket.WebSocketApp) -> None:
        print("[网关] WebSocket 已连接，等待认证...")
        self.connected = True

    def _on_message(self, ws: websocket.WebSocketApp, message: str) -> None:
        try:
            payload = json.loads(message)
            self._handle_message(payload)
        except Exception as exc:
            print(f"[网关] 解析消息失败: {exc}")

    def _handle_message(self, msg: dict) -> None:
        msg_type = msg.get("type")

        if msg_type == "event" and msg.get("event") == "connect.challenge":
            print("[网关] 收到认证挑战，发送握手...")
            self._send_connect()
            return

        if msg_type == "res" and str(msg.get("id", "")).startswith("connect-"):
            if msg.get("ok"):
                print("[网关] 认证成功")
                self.authenticated = True
                if self.on_connect:
                    self.on_connect()
            else:
                error = msg.get("error", {}).get("message", "Unknown")
                self._notify_error(f"网关认证失败: {error}")
            return

        if msg_type == "res" and str(msg.get("id", "")).startswith("chat-send-"):
            req_id = msg.get("id")
            if req_id in self.pending_requests:
                callback = self.pending_requests.pop(req_id)
                if msg.get("ok"):
                    print("[网关] 消息已发送，等待回复...")
                else:
                    error = msg.get("error", {}).get("message", "Unknown")
                    self._notify_error(f"网关发送失败: {error}")
                callback(msg)
            return

        if msg_type != "event":
            return

        event = msg.get("event")
        payload = msg.get("payload", {})
        if event != "chat":
            return

        state = payload.get("state")
        message = payload.get("message", {})
        content = self._extract_content(message)
        print(f"[网关] chat 事件: state={state}, has_content={bool(content)}")

        if state == "final" and content and content != self.last_pushed_content:
            self.last_pushed_content = content
            if self.on_message:
                self.on_message(content)

        if state == "error":
            error = payload.get("errorMessage", "Unknown error")
            self._notify_error(f"AI 回复异常: {error}")

    def _extract_content(self, message: object) -> Optional[str]:
        if not message:
            return None
        if isinstance(message, str):
            return message
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, list):
                texts = []
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        texts.append(item.get("text", ""))
                return "".join(texts)
            text = message.get("text")
            if isinstance(text, str):
                return text
        return str(message)

    def _on_error(self, ws: websocket.WebSocketApp, error: object) -> None:
        message = f"WebSocket 错误: {error}"
        print(f"[网关] {message}")
        self._notify_error(message)

    def _on_close(
        self,
        ws: websocket.WebSocketApp,
        close_status_code: Optional[int],
        close_msg: Optional[str],
    ) -> None:
        print(f"[网关] 连接关闭: {close_status_code} - {close_msg}")
        self.connected = False
        self.authenticated = False

    def _send_connect(self) -> None:
        if not self.ws:
            return
        req = {
            "type": "req",
            "id": f"connect-{uuid.uuid4()}",
            "method": "connect",
            "params": {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": "yuzhua-web",
                    "version": "1.0.0",
                    "platform": "web",
                    "mode": "webchat",
                },
                "role": "operator",
                "scopes": ["operator.read", "operator.write", "operator.admin"],
                "auth": {"token": self.token},
            },
        }
        self.ws.send(json.dumps(req))

    def send_message(
        self,
        text: str,
        callback: Optional[Callable[[dict], None]] = None,
    ) -> bool:
        if not self.authenticated or not self.ws:
            print("[网关] 未认证，无法发送消息")
            return False

        self.last_pushed_content = ""
        req_id = f"chat-send-{uuid.uuid4()}"
        if callback:
            self.pending_requests[req_id] = callback

        req = {
            "type": "req",
            "id": req_id,
            "method": "chat.send",
            "params": {
                "sessionKey": self.session_key,
                "idempotencyKey": f"msg-{uuid.uuid4()}",
                "message": text,
                "deliver": False,
            },
        }
        self.ws.send(json.dumps(req))
        return True

    def close(self) -> None:
        if self.ws:
            self.ws.close()
            self.ws = None

    def is_connected(self) -> bool:
        return self.connected and self.authenticated


if __name__ == "__main__":
    sender = GatewaySender()
    sender.on_message = lambda text: print(f"\n>>> AI 回复: {text}\n")
    sender.on_connect = lambda: print(">>> 已连接，可发送消息")
    sender.on_error = lambda err: print(f">>> 错误: {err}")

    sender.connect()
    time.sleep(2)

    if sender.is_connected():
        sender.send_message("你好")

    input("按回车退出...")
