# Yuzhua

[中文](README.zh-CN.md) | [English](README.en.md)

A lightweight gesture-driven voice interaction project: open your palm to start speaking, close your palm to stop recording, transcribe speech, and talk to AI through OpenClaw.

## Highlights

- Local gesture inference in browser (MediaPipe Hands)
- Local ASR pipeline (Whisper + Silero VAD)
- Session-isolated OpenClaw integration (does not modify OpenClaw runtime state)
- Edge TTS playback for AI replies
- One-command bootstrap with dependency/model warmup

## Demo

Video link will be added later. For now, keep a UI screenshot placeholder:

![Yuzhua UI](docs/assets/demo-ui.png)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=juguangyuan520-dotcom/Yuzhua&type=Date)](https://star-history.com/#juguangyuan520-dotcom/Yuzhua&Date)

## Quick Start

```bash
chmod +x start.sh
./start.sh
```

`start.sh` will automatically:

1. Create `.venv` if missing
2. Install dependencies from `requirements.txt`
3. Check `ffmpeg` (installs via Homebrew if available)
4. Warm up and download Whisper/Silero models on first run
5. Start service at `http://localhost:8080`

## OpenClaw Integration

OpenClaw token resolution order:

1. `OPENCLAW_TOKEN` in `.env`
2. System environment variable `OPENCLAW_TOKEN`
3. Common local OpenClaw config files (auto-discovery)

If `OPENCLAW_SESSION_KEY` is not set, Yuzhua auto-generates and persists one at `.runtime/session_key`.

## Environment Variables (`.env`)

See `.env.example`:

- `OPENCLAW_GATEWAY_URL`: default `ws://127.0.0.1:18789`
- `OPENCLAW_TOKEN`: OpenClaw operator token
- `OPENCLAW_SESSION_KEY`: optional, auto-generated if empty
- `WHISPER_MODEL_SIZE`: default `small`
- `HF_ENDPOINT`: optional HuggingFace mirror

## Technical Notes

- Gesture inference and ASR are local.
- Current TTS uses `edge-tts` (not a local model).
- OpenClaw communication is done through WebSocket `connect/chat.send` with an isolated `sessionKey`.

## Project Structure

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

## Security

- No secrets are stored in source code; use environment variables (`.env.example`).
- `.env`, `.runtime`, and virtualenv folders are ignored by `.gitignore`.
- Never commit real keys/tokens.

## FAQ

- `pip` SSL certificate errors: configure your mirror/certs first, then run `./start.sh`.
- OpenClaw not detected: ensure gateway is running and verify `OPENCLAW_GATEWAY_URL` / `OPENCLAW_TOKEN`.
