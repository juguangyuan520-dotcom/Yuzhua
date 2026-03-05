#!/usr/bin/env python3
"""
Runtime configuration helpers for Yuzhua.
"""

from __future__ import annotations

import json
import os
import re
import socket
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

PROJECT_DIR = Path(__file__).resolve().parent
ENV_FILE = PROJECT_DIR / ".env"
RUNTIME_DIR = PROJECT_DIR / ".runtime"
SESSION_KEY_FILE = RUNTIME_DIR / "session_key"

_TOKEN_ENV_KEYS = ("OPENCLAW_TOKEN", "OPENCLAW_API_TOKEN", "OPENCLAW_WS_TOKEN")
_TOKEN_JSON_KEYS = ("openclaw_token", "token", "api_token", "ws_token")
_TOKEN_LINE_PATTERN = re.compile(
    r"^\s*(OPENCLAW_TOKEN|OPENCLAW_API_TOKEN|OPENCLAW_WS_TOKEN|TOKEN)\s*=\s*['\"]?([^'\"#\n]+)",
    re.MULTILINE,
)


def load_project_env() -> None:
    """Load .env once and keep process env as source of truth."""
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE, override=False)


def _clean_token(value: Optional[str]) -> str:
    return (value or "").strip()


def _looks_like_token(value: str) -> bool:
    return len(value) >= 16 and " " not in value


def _extract_token_from_env_text(text: str) -> Optional[str]:
    for match in _TOKEN_LINE_PATTERN.finditer(text):
        candidate = _clean_token(match.group(2))
        if _looks_like_token(candidate):
            return candidate
    return None


def _extract_token_from_json(data: Any) -> Optional[str]:
    if isinstance(data, dict):
        for key, value in data.items():
            key_lc = str(key).lower()
            if key_lc in _TOKEN_JSON_KEYS and isinstance(value, str):
                candidate = _clean_token(value)
                if _looks_like_token(candidate):
                    return candidate
            nested = _extract_token_from_json(value)
            if nested:
                return nested
    if isinstance(data, list):
        for item in data:
            nested = _extract_token_from_json(item)
            if nested:
                return nested
    return None


def _discover_token_from_local_files() -> Optional[str]:
    candidate_files = (
        PROJECT_DIR / ".env",
        Path.home() / ".openclaw" / ".env",
        Path.home() / ".openclaw" / "config.json",
        Path.home() / ".config" / "openclaw" / ".env",
        Path.home() / ".config" / "openclaw" / "config.json",
    )

    for path in candidate_files:
        if not path.exists() or not path.is_file():
            continue
        try:
            raw = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        if path.suffix.lower() == ".json":
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                continue
            token = _extract_token_from_json(parsed)
        else:
            token = _extract_token_from_env_text(raw)

        if token:
            return token
    return None


def get_openclaw_token(required: bool = True) -> Optional[str]:
    """
    Resolve OpenClaw token from env first, then local config auto-discovery.
    """
    load_project_env()

    for key in _TOKEN_ENV_KEYS:
        token = _clean_token(os.getenv(key))
        if _looks_like_token(token):
            return token

    token = _discover_token_from_local_files()
    if token:
        os.environ.setdefault("OPENCLAW_TOKEN", token)
        return token

    if required:
        raise RuntimeError(
            "缺少 OpenClaw Token。请在 .env 中设置 OPENCLAW_TOKEN，"
            "或确保本机 OpenClaw 配置文件可被自动识别。"
        )
    return None


def get_gateway_url() -> str:
    load_project_env()
    url = _clean_token(os.getenv("OPENCLAW_GATEWAY_URL")) or "ws://127.0.0.1:18789"
    return url.rstrip("/")


def _sanitize_session_suffix(value: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-").lower()
    return safe or "local"


def get_session_key() -> str:
    """
    Resolve session key from env, or persist a generated key to .runtime/session_key.
    """
    load_project_env()

    env_key = _clean_token(os.getenv("OPENCLAW_SESSION_KEY"))
    if env_key:
        return env_key

    if SESSION_KEY_FILE.exists():
        existing = _clean_token(SESSION_KEY_FILE.read_text(encoding="utf-8", errors="ignore"))
        if existing:
            return existing

    token = get_openclaw_token(required=False) or ""
    hint_source = token[:8] if token else socket.gethostname()
    session_key = f"agent:yuzhua:{_sanitize_session_suffix(hint_source)}"

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    SESSION_KEY_FILE.write_text(session_key, encoding="utf-8")
    return session_key


def get_whisper_model_size() -> str:
    load_project_env()
    model_size = _clean_token(os.getenv("WHISPER_MODEL_SIZE")) or "small"
    return model_size


def get_hf_endpoint() -> Optional[str]:
    load_project_env()
    endpoint = _clean_token(os.getenv("HF_ENDPOINT"))
    return endpoint or None
