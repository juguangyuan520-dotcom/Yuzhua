# Yuzhua（驭爪）

[中文](README.zh-CN.md) | [English](README.en.md)

轻量的手势语音交互项目：打开手掌开始说话，合上手掌结束录音，自动转写并通过 OpenClaw 完成 AI 对话。

## 项目亮点

- 浏览器端本地手势识别（MediaPipe Hands）
- 本地语音识别链路（Whisper + Silero VAD）
- 与 OpenClaw 会话隔离（不修改 OpenClaw 运行状态）
- AI 回复语音播放（Edge TTS）
- 一条命令完成依赖检查与模型预热

## Demo

视频链接即将补充，先展示界面截图占位：

![Yuzhua 界面](docs/assets/demo-ui.png)

## Star 趋势

[![Star History Chart](https://api.star-history.com/svg?repos=juguangyuan520-dotcom/Yuzhua&type=Date)](https://star-history.com/#juguangyuan520-dotcom/Yuzhua&Date)

## 快速启动

```bash
chmod +x start.sh
./start.sh
```

`start.sh` 会自动执行：

1. 创建 `.venv`（若不存在）
2. 安装 `requirements.txt` 依赖
3. 检查 `ffmpeg`（缺失时尝试通过 Homebrew 安装）
4. 首次预热并下载 Whisper/Silero 模型
5. 启动服务 `http://localhost:8080`

## OpenClaw 配置

项目优先按以下顺序识别 OpenClaw Token：

1. `.env` 中的 `OPENCLAW_TOKEN`
2. 系统环境变量 `OPENCLAW_TOKEN`
3. 本机常见 OpenClaw 配置文件（自动发现）

若 `OPENCLAW_SESSION_KEY` 未配置，Yuzhua 会自动生成并持久化到 `.runtime/session_key`。

## 环境变量（`.env`）

参考模板：`.env.example`

- `OPENCLAW_GATEWAY_URL`：默认 `ws://127.0.0.1:18789`
- `OPENCLAW_TOKEN`：OpenClaw operator token（推荐显式配置）
- `OPENCLAW_SESSION_KEY`：可选，留空则自动生成
- `WHISPER_MODEL_SIZE`：默认 `small`
- `HF_ENDPOINT`：可选，镜像地址

## 技术说明

- 手势识别与语音识别在本地执行。
- 当前 TTS 使用 `edge-tts`（非本地模型）。
- 与 OpenClaw 的交互通过 WebSocket `connect/chat.send` 完成，使用独立 `sessionKey`。

## 项目结构

```text
Yuzhua/
├── start.sh
├── requirements.txt
├── config.py
├── transcriber.py
├── gateway_sender.py
├── scripts/
│   └── bootstrap.py
├── web_server/
│   └── api_server.py
└── web_frontend/
    ├── index.html
    ├── css/style.css
    └── js/
```

## 安全说明

- 项目源码不存储任何密钥，统一通过环境变量注入（参考 `.env.example`）。
- `.env`、`.runtime`、虚拟环境均已加入 `.gitignore`。
- 请勿提交任何真实密钥到仓库。

## 常见问题

- `pip` SSL 证书错误：可先配置镜像或证书后再执行 `./start.sh`。
- 未识别 OpenClaw：确认网关已运行，并检查 `.env` 中 `OPENCLAW_GATEWAY_URL` 与 `OPENCLAW_TOKEN`。
