# Yuzhua

English | [中文](README-zh.md)

Yuzhua is a lightweight gesture-driven AI assistant web app.  
Open your palm to start recording, close your palm to stop, then talk with AI through OpenClaw.

![Yuzhua Cover](docs/assets/demo-use.png)

## Demo

![Yuzhua UI](docs/assets/demo-ui.png)

## OpenClaw Setup (Recommended First)

Before running Yuzhua, make sure OpenClaw is installed and its gateway is running.

1. Install and start OpenClaw on your machine.
2. Ensure OpenClaw Gateway is reachable (default: `ws://127.0.0.1:18789`).
3. Get your OpenClaw operator token from your OpenClaw side.
4. Create local config:

```bash
cp .env.example .env
```

5. Fill `.env`:

```env
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_TOKEN=your_openclaw_token
OPENCLAW_SESSION_KEY=
```

`OPENCLAW_SESSION_KEY` can be left empty; Yuzhua will auto-generate one.

## Features

- 🤚 Gesture control: open palm to start recording, close palm to stop
- 🎙️ Speech-to-text: local Whisper + local Silero VAD
- 💬 AI conversation: OpenClaw Gateway integration
- 🔊 Voice reply: Edge TTS playback
- ✨ Visual feedback: Three.js particle effects
- 🔐 Session isolation: independent `sessionKey`, no runtime modification to OpenClaw

## Particle States

- Recording: particles rapidly expand from a sphere into a horizontal audio spectrum band; the center reacts strongly to input volume while both sides attenuate.
- Thinking: particles contract into a structured grid-like sphere with slow rotation, pulse diffusion, and multi-color cycling to convey ongoing reasoning.
- AI Replying: particles switch to a dual-ring form (stable inner ring + active outer ring), pulsing with speech energy and blue-purple gradients to indicate AI voice output.

## Tech Stack

| Layer | Technology |
|------|------|
| Frontend | HTML + JavaScript + Three.js |
| Gesture Recognition | MediaPipe Hands (browser-side) |
| Speech Recognition | Whisper (`small` by default, local) |
| VAD | Silero VAD (local) |
| AI Gateway | OpenClaw Gateway (WebSocket) |
| TTS | Edge TTS |
| Backend | FastAPI (Python) |

## Project Structure

```text
Yuzhua/
├── web_frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── main.js
│       └── handTracker.js
├── web_server/
│   └── api_server.py
├── transcriber.py
├── gateway_sender.py
├── config.py
├── scripts/bootstrap.py
├── start.sh
└── requirements.txt
```

## Quick Start

```bash
chmod +x start.sh
./start.sh
```

Then open: `http://localhost:8080`

## Usage

1. Open the web page and allow camera + microphone permissions
2. Show an open palm (🖐️) to start recording
3. Close your palm (✊/✋) to stop and send
4. Wait for AI text + voice reply

## Environment

Create local config from template:

```bash
cp .env.example .env
```

Important vars:

- `OPENCLAW_GATEWAY_URL` (default `ws://127.0.0.1:18789`)
- `OPENCLAW_TOKEN` (required unless auto-discovered locally)
- `OPENCLAW_SESSION_KEY` (optional; auto-generated if empty)
- `WHISPER_MODEL_SIZE` (default `small`)

## Dependencies

- Python 3.10+
- ffmpeg
- Packages in `requirements.txt`

## Notes

- First run will auto-install dependencies and warm up/download models.
- Gesture and ASR pipelines run locally.
- Current TTS uses Edge TTS (not a local TTS model).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=juguangyuan520-dotcom/Yuzhua&type=Date)](https://star-history.com/#juguangyuan520-dotcom/Yuzhua&Date)

## License

[MIT](LICENSE)
