#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="${PROJECT_DIR}/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"

log() {
  echo "[Yuzhua] $*"
}

install_with_fallback() {
  local req_file="$1"
  if "${VENV_DIR}/bin/pip" install -r "${req_file}"; then
    return 0
  fi

  # If user already provided index-url, do not override their choice.
  if [ -n "${PIP_INDEX_URL:-}" ]; then
    return 1
  fi

  local mirrors=(
    "https://pypi.tuna.tsinghua.edu.cn/simple"
    "https://pypi.mirrors.ustc.edu.cn/simple"
    "https://mirrors.aliyun.com/pypi/simple"
  )

  for mirror in "${mirrors[@]}"; do
    log "默认源安装失败，尝试镜像源: ${mirror}"
    if "${VENV_DIR}/bin/pip" install -i "${mirror}" -r "${req_file}"; then
      return 0
    fi
  done

  return 1
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
if ! install_with_fallback "${PROJECT_DIR}/requirements.txt"; then
  log "依赖安装失败：当前更可能是网络/镜像问题，而不是 Python 版本问题。"
  log "你可以重试，或先手动设置镜像："
  log "  export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple"
  exit 1
fi

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
