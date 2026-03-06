---
name: yuzhua-openclaw
description: Install, start, stop, and health-check Yuzhua (gesture + voice + OpenClaw gateway) with minimal manual setup.
---

# Yuzhua OpenClaw Skill

## Purpose

Use this skill when the user wants to:
- install Yuzhua quickly
- start Yuzhua locally
- check whether Yuzhua and OpenClaw gateway are connected
- stop a running Yuzhua process

This skill is designed for local machines and keeps secrets in `.env`.

## Quick Commands

Run from this skill directory:

```bash
./scripts/install.sh
./scripts/start.sh
./scripts/health_check.sh
./scripts/stop.sh
```

## Paths And Environment

- `YUZHUA_HOME`: local Yuzhua project path (optional)
- `YUZHUA_REPO_URL`: repo to clone when missing (optional)

Defaults:
- `YUZHUA_HOME=~/.openclaw/workspace/apps/Yuzhua`
- `YUZHUA_REPO_URL=https://github.com/juguangyuan520-dotcom/Yuzhua.git`

## What The Scripts Do

1. `install.sh`
- clone or update Yuzhua source
- ensure `start.sh` exists and is executable
- create `.env` from `.env.example` when needed

2. `start.sh`
- run Yuzhua's own `start.sh`
- print resolved project path

3. `health_check.sh`
- query `http://127.0.0.1:8080/api/status`
- show transcriber/gateway/token/session status

4. `stop.sh`
- stop local process on port `8080`

## Notes

- Never commit `.env` or any real keys.
- For first run, users may still need to fill token values in `.env`.
- If Python dependency download fails, it is usually network/SSL/mirror related.
