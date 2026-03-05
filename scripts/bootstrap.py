#!/usr/bin/env python3
"""
Startup checks for Yuzhua:
1. runtime prerequisites
2. OpenClaw config auto-detection
3. first-run model warmup (Whisper + Silero VAD)
"""

from __future__ import annotations

import argparse
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))

from config import (  # noqa: E402
    RUNTIME_DIR,
    get_gateway_url,
    get_openclaw_token,
    get_session_key,
    get_whisper_model_size,
)

BOOTSTRAP_STATE_FILE = RUNTIME_DIR / "bootstrap_state.json"


def log(message: str) -> None:
    print(f"[bootstrap] {message}")


def _mask_token(token: str) -> str:
    if len(token) <= 8:
        return "*" * len(token)
    return f"{token[:4]}...{token[-4:]}"


def check_python_version() -> None:
    major, minor = sys.version_info[:2]
    if (major, minor) < (3, 10):
        raise RuntimeError(f"Python 版本过低: {major}.{minor}，需要 >= 3.10")
    log(f"Python 版本: {platform.python_version()}")


def check_ffmpeg() -> None:
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise RuntimeError("未检测到 ffmpeg，请先安装。")
    result = subprocess.run(
        [ffmpeg_bin, "-version"],
        capture_output=True,
        text=True,
        timeout=8,
        check=False,
    )
    first_line = result.stdout.splitlines()[0] if result.stdout else "unknown"
    log(f"ffmpeg: {first_line}")


def has_whisper_cache(model_size: str) -> bool:
    cache_dir = Path.home() / ".cache" / "whisper"
    candidates = [cache_dir / f"{model_size}.pt", cache_dir / f"{model_size}.en.pt"]
    return any(path.exists() for path in candidates)


def has_silero_cache() -> bool:
    torch_cache = Path.home() / ".cache" / "torch" / "hub"
    if not torch_cache.exists():
        return False
    return any("silero" in path.name.lower() for path in torch_cache.glob("*"))


def read_bootstrap_state() -> dict:
    if not BOOTSTRAP_STATE_FILE.exists():
        return {}
    try:
        return json.loads(BOOTSTRAP_STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_bootstrap_state(model_size: str) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    BOOTSTRAP_STATE_FILE.write_text(
        json.dumps({"model_size": model_size, "python": platform.python_version()}, ensure_ascii=True),
        encoding="utf-8",
    )


def should_warmup(model_size: str, force: bool) -> bool:
    if force:
        return True
    state = read_bootstrap_state()
    if state.get("model_size") != model_size:
        return True
    if not has_whisper_cache(model_size):
        return True
    if not has_silero_cache():
        return True
    return False


def warmup_models(model_size: str, force: bool = False) -> None:
    if not should_warmup(model_size, force):
        log("模型缓存已就绪，跳过预热。")
        return

    log(f"开始模型预热（首次运行会自动下载）: Whisper={model_size}, Silero VAD")
    from transcriber import Transcriber  # 延迟导入，避免不必要的启动开销

    _ = Transcriber(model_size=model_size)
    write_bootstrap_state(model_size)
    log("模型预热完成。")


def show_openclaw_status() -> None:
    gateway_url = get_gateway_url()
    token = get_openclaw_token(required=False)
    session_key = get_session_key()

    log(f"OpenClaw 网关: {gateway_url}")
    if token:
        log(f"OpenClaw Token: {_mask_token(token)} (已自动识别)")
    else:
        log("OpenClaw Token: 未找到（可在 .env 中设置 OPENCLAW_TOKEN）")
    log(f"Session Key: {session_key}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Yuzhua startup bootstrap")
    parser.add_argument(
        "--model",
        default=get_whisper_model_size(),
        help="Whisper model size, default from WHISPER_MODEL_SIZE or small",
    )
    parser.add_argument("--force", action="store_true", help="force model warmup")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    check_python_version()
    check_ffmpeg()
    show_openclaw_status()
    warmup_models(args.model, force=args.force)
    log("启动前检查完成。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log(f"失败: {exc}")
        raise SystemExit(1)
