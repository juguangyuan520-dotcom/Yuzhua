#!/usr/bin/env python3
"""
Yuzhua FastAPI backend.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, File, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR))

from config import (  # noqa: E402
    get_gateway_url,
    get_hf_endpoint,
    get_openclaw_token,
    get_session_key,
    get_whisper_model_size,
)
from gateway_sender import GatewaySender  # noqa: E402
from transcriber import Transcriber  # noqa: E402

hf_endpoint = get_hf_endpoint()
if hf_endpoint:
    os.environ.setdefault("HF_ENDPOINT", hf_endpoint)

app = FastAPI(title="Yuzhua")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = PROJECT_DIR / "web_frontend"
app.mount("/css", StaticFiles(directory=str(FRONTEND_DIR / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")

transcriber: Transcriber | None = None
gateway: GatewaySender | None = None


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"[WebSocket] 当前连接数: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        disconnected: list[WebSocket] = []
        for conn in self.active_connections:
            try:
                await conn.send_json(message)
            except Exception as exc:
                print(f"[WebSocket] 推送失败: {exc}")
                disconnected.append(conn)
        for conn in disconnected:
            self.disconnect(conn)


manager = ConnectionManager()


def _broadcast_from_thread(message: dict[str, Any]) -> None:
    def run() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(manager.broadcast(message))
        finally:
            loop.close()

    threading.Thread(target=run, daemon=True).start()


def on_ai_reply(text: str) -> None:
    print(f"[AI] {text}")
    _broadcast_from_thread({"type": "ai_reply", "text": text})


def init_components() -> None:
    global transcriber, gateway

    print("[启动] 初始化转录器...")
    transcriber = Transcriber(model_size=get_whisper_model_size())

    print("[启动] 初始化 OpenClaw 网关...")
    gateway = GatewaySender(
        gateway_url=get_gateway_url(),
        token=get_openclaw_token(required=False),
        session_key=get_session_key(),
    )
    gateway.on_message = on_ai_reply
    gateway.on_connect = lambda: print("[网关] 已连接")
    gateway.on_error = lambda err: print(f"[网关] {err}")
    gateway.connect()

    print("[启动] 初始化完成")


@app.get("/")
async def get_index() -> HTMLResponse:
    index_file = FRONTEND_DIR / "index.html"
    if not index_file.exists():
        return HTMLResponse("<h1>前端文件未找到</h1>", status_code=404)
    return HTMLResponse(index_file.read_text(encoding="utf-8"))


def convert_webm_to_wav(webm_path: str) -> str | None:
    wav_path = webm_path.replace(".webm", ".wav")
    try:
        result = subprocess.run(
            ["ffmpeg", "-i", webm_path, "-ar", "16000", "-ac", "1", "-y", wav_path],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if result.returncode != 0:
            print(f"[ffmpeg] 转换失败: {result.stderr}")
            return None
        return wav_path
    except Exception as exc:
        print(f"[ffmpeg] 转换异常: {exc}")
        return None


@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)) -> dict[str, Any]:
    if not transcriber:
        return {"error": "转录器未初始化"}

    suffix = ".webm" if file.content_type == "audio/webm" else ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    audio_to_transcribe = tmp_path
    if tmp_path.endswith(".webm"):
        wav_path = convert_webm_to_wav(tmp_path)
        if wav_path and os.path.exists(wav_path):
            audio_to_transcribe = wav_path

    try:
        result = transcriber.transcribe(audio_to_transcribe)
        text = str(result.get("text", "")).strip()
        vad_passed = bool(result.get("vad", False))
        print(f"[转录] text='{text}' vad={vad_passed}")

        await manager.broadcast({"type": "transcribed", "text": text, "vad": vad_passed})
        if gateway and gateway.is_connected() and text:
            gateway.send_message(text)
        return {"text": text, "vad": vad_passed, "error": result.get("error")}
    except Exception as exc:
        return {"error": str(exc), "text": "", "vad": False}
    finally:
        for path in (tmp_path, audio_to_transcribe):
            try:
                if path and os.path.exists(path):
                    os.unlink(path)
            except OSError:
                pass


@app.post("/api/tts")
async def text_to_speech(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
        text = str(data.get("text", "")).strip()
        voice = data.get("voice", "zh-CN-XiaoxiaoNeural")
        rate = data.get("rate", "+10%")
        if not text:
            return {"error": "文本不能为空"}

        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp_file:
            tmp_path = tmp_file.name

        cmd = [
            sys.executable,
            "-m",
            "edge_tts",
            "--text",
            text,
            "--voice",
            str(voice),
            "--rate",
            str(rate),
            "--write-media",
            tmp_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=40, check=False)
        if result.returncode != 0:
            return {"error": f"TTS 失败: {result.stderr.strip()}"}

        with open(tmp_path, "rb") as handle:
            audio_base64 = base64.b64encode(handle.read()).decode("utf-8")
        os.unlink(tmp_path)
        return {"audio": audio_base64, "format": "mp3", "voice": voice}
    except Exception as exc:
        return {"error": str(exc)}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                message = json.loads(raw_data)
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict) and message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.get("/api/status")
async def get_status() -> dict[str, Any]:
    has_token = bool(get_openclaw_token(required=False))
    return {
        "transcriber": "ready" if transcriber else "not_ready",
        "gateway": "connected" if gateway and gateway.is_connected() else "disconnected",
        "gateway_url": get_gateway_url(),
        "has_openclaw_token": has_token,
        "session_key": get_session_key(),
        "gateway_error": gateway.last_error if gateway else None,
    }


if __name__ == "__main__":
    init_components()
    uvicorn.run(app, host="0.0.0.0", port=8080, log_level="info")
