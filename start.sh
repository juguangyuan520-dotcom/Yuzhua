#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="${PROJECT_DIR}/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"

log() {
  echo "[Yuzhua] $*"
}

if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  log "未找到 ${PYTHON_BIN}，请先安装 Python 3。"
  exit 1
fi

if [ ! -d "${VENV_DIR}" ]; then
  log "创建虚拟环境: ${VENV_DIR}"
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

log "安装/更新 Python 依赖..."
if ! "${VENV_DIR}/bin/python" -m pip install --upgrade pip setuptools wheel; then
  log "pip/setuptools/wheel 升级失败，继续使用当前版本。"
fi
"${VENV_DIR}/bin/pip" install -r "${PROJECT_DIR}/requirements.txt"

if [ ! -f "${PROJECT_DIR}/.env" ]; then
  cp "${PROJECT_DIR}/.env.example" "${PROJECT_DIR}/.env"
  log "已生成 .env，请至少配置 OPENCLAW_TOKEN（若本机未自动发现）。"
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    log "未检测到 ffmpeg，尝试通过 Homebrew 安装..."
    brew install ffmpeg
  else
    log "未检测到 ffmpeg，请先安装 ffmpeg 后重试。"
    exit 1
  fi
fi

MODEL_SIZE="${WHISPER_MODEL_SIZE:-}"
if [ -n "${MODEL_SIZE}" ]; then
  log "执行启动前检查（模型: ${MODEL_SIZE}）..."
  "${VENV_DIR}/bin/python" "${PROJECT_DIR}/scripts/bootstrap.py" --model "${MODEL_SIZE}"
else
  log "执行启动前检查..."
  "${VENV_DIR}/bin/python" "${PROJECT_DIR}/scripts/bootstrap.py"
fi

log "启动 Yuzhua 服务: http://localhost:8080"
exec "${VENV_DIR}/bin/python" -u "${PROJECT_DIR}/web_server/api_server.py"
