#!/usr/bin/env python3
"""
Gateway sender for OpenClaw websocket integration.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Any, Callable, Optional

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
        self.last_send_ts_ms: Optional[int] = None
        self.final_fetch_attempted: set[str] = set()

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

        req_id = str(msg.get("id", ""))
        callback = self.pending_requests.pop(req_id, None)
        if callback:
            try:
                callback(msg)
            except Exception as exc:
                print(f"[网关] 处理回查响应失败: {exc}")
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
        content = self._extract_content_from_payload(payload)
        if not content:
            # Some OpenClaw builds place final text under payload.output / payload.data.
            content = self._extract_content(payload.get("output"))
        if not content:
            content = self._extract_content(payload.get("data"))
        if not content:
            content = self._extract_content(payload.get("result"))
        print(f"[网关] chat 事件: state={state}, has_content={bool(content)}")

        if state == "final" and not content:
            keys = list(payload.keys()) if isinstance(payload, dict) else []
            print(f"[网关] final 事件未提取到文本，payload keys={keys}")
            run_id = payload.get("runId") if isinstance(payload, dict) else None
            session_key = payload.get("sessionKey") if isinstance(payload, dict) else self.session_key
            if run_id:
                self._fetch_final_content(run_id, session_key)

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
            clean = message.strip()
            return clean or None
        if isinstance(message, list):
            parts = []
            for item in message:
                text = self._extract_content(item)
                if text:
                    parts.append(text)
            merged = "".join(parts).strip()
            return merged or None
        if isinstance(message, dict):
            # 1) Direct text field
            text = message.get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()

            # 2) Content field (string/list/dict)
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                return content.strip()
            if isinstance(content, list):
                parts = []
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        item_text = item.get("text")
                        if isinstance(item_text, str) and item_text.strip():
                            parts.append(item_text.strip())
                    else:
                        item_text = self._extract_content(item)
                        if item_text:
                            parts.append(item_text)
                merged = "".join(parts).strip()
                if merged:
                    return merged
            if isinstance(content, dict):
                nested = self._extract_content(content)
                if nested:
                    return nested

            # 3) Nested message/output style fields
            for key in ("message", "output_text", "reply", "answer", "output", "result", "data"):
                nested = self._extract_content(message.get(key))
                if nested:
                    return nested

            # 4) OpenAI-like choices format
            choices = message.get("choices")
            if isinstance(choices, list):
                parts = []
                for choice in choices:
                    if not isinstance(choice, dict):
                        continue
                    candidate = (
                        self._extract_content(choice.get("message"))
                        or self._extract_content(choice.get("delta"))
                        or self._extract_content(choice.get("content"))
                    )
                    if candidate:
                        parts.append(candidate)
                merged = "".join(parts).strip()
                if merged:
                    return merged
        return None

    def _extract_text_recursive(self, node: object) -> Optional[str]:
        if node is None:
            return None
        if isinstance(node, str):
            text = node.strip()
            return text or None
        if isinstance(node, dict):
            for key in ("text", "content", "output_text", "delta", "value"):
                val = node.get(key)
                if isinstance(val, str) and val.strip():
                    return val.strip()
            for val in node.values():
                found = self._extract_text_recursive(val)
                if found:
                    return found
            return None
        if isinstance(node, list):
            parts = []
            for item in node:
                found = self._extract_text_recursive(item)
                if found:
                    parts.append(found)
            return "".join(parts).strip() or None
        return None

    def _extract_content_from_payload(self, payload: object) -> Optional[str]:
        if not isinstance(payload, dict):
            return None

        message = payload.get("message")
        content = self._extract_content(message)
        if content:
            return content

        for key in ("content", "text", "output_text", "delta", "reply", "response"):
            val = payload.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()

        messages = payload.get("messages")
        if isinstance(messages, list) and messages:
            for msg in reversed(messages):
                if not isinstance(msg, dict):
                    continue
                role = msg.get("role")
                if role in (None, "assistant", "model", "bot"):
                    content = self._extract_content(msg)
                    if content:
                        return content

        for key in ("output", "result", "data", "response", "assistant", "final"):
            node = payload.get(key)
            content = self._extract_text_recursive(node)
            if content:
                return content

        return None

    def _extract_latest_assistant_from_history(
        self,
        payload: object,
        min_ts: Optional[int] = None,
    ) -> Optional[str]:
        if not isinstance(payload, dict):
            return None
        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            return None

        candidates: list[tuple[str, Optional[int]]] = []
        for msg in reversed(messages):
            if not isinstance(msg, dict):
                continue
            role = msg.get("role")
            if role not in ("assistant", "model", "bot"):
                continue
            ts = msg.get("timestamp")
            content = self._extract_content(msg)
            if content:
                candidates.append((content, ts if isinstance(ts, (int, float)) else None))

        if not candidates:
            return None

        if min_ts is not None:
            for content, ts in candidates:
                if ts is not None and ts >= min_ts:
                    return content
        return candidates[0][0]

    def _fetch_final_content(self, run_id: str, session_key: Optional[str] = None) -> None:
        if not run_id:
            return
        if run_id in self.final_fetch_attempted:
            return
        if not self.ws:
            return

        self.final_fetch_attempted.add(run_id)
        sk = session_key or self.session_key
        min_ts = self.last_send_ts_ms
        methods = [
            ("chat.history", {"sessionKey": sk, "limit": 30}),
            ("chat.get", {"sessionKey": sk, "runId": run_id}),
            ("chat.result", {"sessionKey": sk, "runId": run_id}),
            ("chat.getRun", {"sessionKey": sk, "runId": run_id}),
            ("run.get", {"sessionKey": sk, "runId": run_id}),
            ("chat.read", {"sessionKey": sk, "runId": run_id}),
        ]

        def try_method(index: int) -> None:
            if index >= len(methods):
                print(f"[网关] runId={run_id} 回查失败：未提取到可用文本")
                return

            method, params = methods[index]
            req_id = f"chat-fetch-{uuid.uuid4()}"

            def on_response(resp: dict) -> None:
                if not resp.get("ok"):
                    try_method(index + 1)
                    return

                payload = resp.get("payload") or resp.get("result") or resp.get("data") or {}
                if method == "chat.history":
                    content = self._extract_latest_assistant_from_history(payload, min_ts=min_ts)
                else:
                    content = self._extract_content_from_payload(payload) or self._extract_text_recursive(payload)

                if content and content != self.last_pushed_content:
                    self.last_pushed_content = content
                    print(f"[网关] 回查推送: {content[:30]}...")
                    if self.on_message:
                        self.on_message(content)
                    return
                try_method(index + 1)

            self.pending_requests[req_id] = on_response
            req = {"type": "req", "id": req_id, "method": method, "params": params}
            self.ws.send(json.dumps(req))

        try_method(0)

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
                    "id": "webchat",
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
        self.last_send_ts_ms = int(time.time() * 1000)
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
