#!/usr/bin/env python3

from __future__ import annotations

import io
import os
import subprocess
import time
import wave
from typing import Any

import numpy as np
import torch
import whisper
from silero_vad import get_speech_timestamps, load_silero_vad

from config import get_hf_endpoint

hf_endpoint = get_hf_endpoint()
if hf_endpoint:
    os.environ.setdefault("HF_ENDPOINT", hf_endpoint)


class Transcriber:
    def __init__(self, model_size: str = "small") -> None:
        print(f"正在加载 Whisper 模型 ({model_size})...")
        self.model = whisper.load_model(model_size)
        print("Whisper 模型加载完成")

        print("正在加载 Silero VAD 模型...")
        self.vad_model = load_silero_vad()
        print("Silero VAD 模型加载完成")

    def _load_audio_via_ffmpeg(self, audio_path: str) -> torch.Tensor:
        result = subprocess.run(
            [
                "ffmpeg",
                "-i",
                audio_path,
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "wav",
                "-",
            ],
            capture_output=True,
            timeout=60,
            check=False,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="ignore")
            raise RuntimeError(f"ffmpeg 转换失败: {stderr}")

        wav_data = io.BytesIO(result.stdout)
        with wave.open(wav_data, "rb") as wav_file:
            frames = wav_file.readframes(wav_file.getnframes())
            audio_np = np.frombuffer(frames, dtype=np.int16).astype(np.float32)
        return torch.tensor(audio_np) / 32768.0

    def has_speech(self, audio_path: str, min_speech_duration: float = 0.3) -> int:
        """
        Returns:
            1  -> speech detected
            0  -> no speech detected
            -1 -> VAD failed, caller decides fallback behavior
        """
        audio = None
        try:
            from silero_vad import read_audio

            audio = read_audio(audio_path, sampling_rate=16000)
            print(f"[VAD] read_audio 读取成功, shape={tuple(audio.shape)}")
        except Exception:
            audio = None

        if audio is None:
            try:
                audio = self._load_audio_via_ffmpeg(audio_path)
                print(f"[VAD] ffmpeg 读取成功, shape={tuple(audio.shape)}")
            except Exception as exc:
                print(f"[VAD] 读取失败: {exc}")
                return -1

        speech_timestamps = get_speech_timestamps(
            audio,
            self.vad_model,
            sampling_rate=16000,
        )
        total_samples = sum(chunk["end"] - chunk["start"] for chunk in speech_timestamps)
        total_speech_duration = total_samples / 16000.0
        print(
            f"[VAD] 片段数={len(speech_timestamps)}, "
            f"人声时长={total_speech_duration:.2f}s, 阈值={min_speech_duration:.2f}s"
        )
        return 1 if total_speech_duration >= min_speech_duration else 0

    def transcribe(self, audio_path: str) -> dict[str, Any]:
        if not os.path.exists(audio_path):
            return {"text": "", "vad": False, "error": "音频文件不存在"}

        print("正在转录音频...")
        start_time = time.time()

        vad_state = self.has_speech(audio_path)
        if vad_state == 0:
            print("[VAD] 未检测到说话，跳过 Whisper 转写")
            return {"text": "", "vad": False}
        if vad_state == -1:
            print("[VAD] 检测失败，继续执行 Whisper 转写")

        try:
            result = self.model.transcribe(
                audio_path,
                language="zh",
                temperature=0.0,
            )
            clean_text = (result.get("text") or "").strip()
            duration = time.time() - start_time
            print(f"转录完成 (耗时: {duration:.2f}s)")
            return {"text": clean_text, "vad": vad_state != 0}
        except Exception as exc:
            print(f"转录失败: {exc}")
            return {"text": "", "vad": vad_state != 0, "error": str(exc)}


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("用法: python3 transcriber.py <音频文件>")
        sys.exit(1)

    transcriber = Transcriber()
    print(f"结果: {transcriber.transcribe(sys.argv[1])}")
