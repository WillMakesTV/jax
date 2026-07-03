"""Local microphone transcriber for Jax — resident sidecar.

Ported from twitch-chatter-bot's pipeline (audio/ingest.py + audio/vad.py +
transcribe/whisper_local.py), with the audio source swapped from a Twitch
stream to a local capture device: ffmpeg (dshow) -> 16 kHz mono s16le PCM ->
VAD gate (silero if installed, adaptive energy otherwise) -> faster-whisper.

The process stays resident with the model loaded so starting capture is
near-instant. stdin carries one JSON command per line:
  {"cmd": "start", "device": "<name>"}   begin capture ("" = first device)
  {"cmd": "stop"}                        end capture, keep the model warm
stdin EOF exits the process.

Emits one JSON object per line on stdout:
  {"status": "loading"|"ready"|"listening"|"stopped", ...}  lifecycle
  {"text": "...", "start": <unix s>, "end": <unix s>}  a transcribed utterance
  {"error": "..."}                                     a problem
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from glob import glob


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


try:
    import numpy as np
    from faster_whisper import WhisperModel
except ImportError as exc:
    emit({
        "error": f"Python package missing ({exc.name}). "
                 "Run: py -3.11 -m pip install --user faster-whisper numpy"
    })
    sys.exit(2)

SAMPLE_RATE = 16_000
BYTES_PER_SAMPLE = 2
CHUNK_SECONDS = 0.5
CHUNK_BYTES = int(SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_SECONDS)

FRAME_SAMPLES = 512  # silero's required window @16kHz (32ms)
FRAME_BYTES = FRAME_SAMPLES * 2
FRAME_SECONDS = FRAME_SAMPLES / SAMPLE_RATE
SILENCE_END_MS = 700
PREROLL_FRAMES = 5  # ~160ms of audio kept before speech onset
MAX_UTTERANCE_SECONDS = 20.0
MIN_UTTERANCE_SECONDS = 0.3  # skip blips too short to contain a word


def find_ffmpeg() -> str:
    """Locate ffmpeg: PATH first, then the winget install location."""
    path = shutil.which("ffmpeg")
    if path:
        return path
    local = os.environ.get("LOCALAPPDATA")
    if local:
        hits = glob(os.path.join(local, "Microsoft", "WinGet", "Packages",
                                 "Gyan.FFmpeg*", "*", "bin", "ffmpeg.exe"))
        if hits:
            return hits[0]
    raise FileNotFoundError(
        "ffmpeg not found. Install it (e.g. 'winget install Gyan.FFmpeg')."
    )


def list_dshow_audio_devices() -> list[str]:
    """Names of DirectShow audio capture devices, for defaults and errors."""
    proc = subprocess.run(
        [find_ffmpeg(), "-hide_banner", "-list_devices", "true",
         "-f", "dshow", "-i", "dummy"],
        capture_output=True, text=True, errors="replace",
    )
    devices = []
    for line in proc.stderr.splitlines():
        match = re.search(r'"([^"]+)"\s*\(audio\)', line)
        if match:
            devices.append(match.group(1))
    return devices


def ffmpeg_cmd(device: str) -> list[str]:
    return [
        find_ffmpeg(),
        "-loglevel", "error",
        "-f", "dshow",
        "-audio_buffer_size", "50",
        "-i", f"audio={device}",
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-ar", str(SAMPLE_RATE),
        "-ac", "1",
        "pipe:1",
    ]


class SileroVad:
    def __init__(self) -> None:
        from silero_vad import VADIterator, load_silero_vad  # noqa: PLC0415

        self._torch = __import__("torch")
        self._iterator = VADIterator(
            load_silero_vad(),
            threshold=0.5,
            sampling_rate=SAMPLE_RATE,
            min_silence_duration_ms=SILENCE_END_MS,
        )

    def process(self, frame_f32: "np.ndarray") -> str | None:
        result = self._iterator(self._torch.from_numpy(frame_f32))
        if result is None:
            return None
        if "start" in result:
            return "start"
        if "end" in result:
            return "end"
        return None


class EnergyVad:
    """Fallback gate: adaptive noise floor + hangover. Crude but serviceable."""

    def __init__(self) -> None:
        self._noise_floor = 0.01
        self._speaking = False
        self._silence_frames = 0
        self._end_after = int((SILENCE_END_MS / 1000) / FRAME_SECONDS)

    def process(self, frame_f32: "np.ndarray") -> str | None:
        rms = float(np.sqrt(np.mean(frame_f32 ** 2)))
        if not self._speaking:
            self._noise_floor = 0.95 * self._noise_floor + 0.05 * rms
        threshold = max(self._noise_floor * 3.0, 0.015)

        if rms > threshold:
            self._silence_frames = 0
            if not self._speaking:
                self._speaking = True
                return "start"
            return None
        if self._speaking:
            self._silence_frames += 1
            if self._silence_frames >= self._end_after:
                self._speaking = False
                self._silence_frames = 0
                return "end"
        return None


class Capture:
    """One capture run: ffmpeg -> VAD -> whisper, on a worker thread."""

    def __init__(self, model: "WhisperModel", device: str, language: str | None) -> None:
        self._model = model
        self._language = language
        self._device = device
        self._proc: subprocess.Popen | None = None
        self._stopped = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stopped.set()
        proc = self._proc
        if proc and proc.poll() is None:
            proc.kill()

    def _transcribe(self, pcm: bytes) -> str:
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _info = self._model.transcribe(
            audio, beam_size=1, vad_filter=False, language=self._language
        )
        return " ".join(s.text.strip() for s in segments).strip()

    def _run(self) -> None:
        device = self._device
        if not device:
            devices = list_dshow_audio_devices()
            if not devices:
                emit({"error": "No audio capture devices found via ffmpeg/dshow."})
                return
            device = devices[0]

        try:
            self._proc = subprocess.Popen(
                ffmpeg_cmd(device),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except Exception as exc:
            emit({"error": f"Could not start audio capture: {exc}"})
            return
        emit({"status": "listening", "device": device})

        try:
            vad = SileroVad()
        except Exception:
            vad = EnergyVad()

        residual = bytearray()
        preroll: deque[bytes] = deque(maxlen=PREROLL_FRAMES)
        utterance = bytearray()
        in_speech = False
        utterance_started_at = 0.0

        while not self._stopped.is_set():
            chunk = self._proc.stdout.read(CHUNK_BYTES)
            if not chunk:
                if not self._stopped.is_set():
                    err = ""
                    try:
                        err = self._proc.stderr.read().decode(errors="replace")[-400:].strip()
                    except Exception:
                        pass
                    available = ", ".join(list_dshow_audio_devices()) or "none found"
                    emit({
                        "error": f"Audio capture ended ({err or 'device stream closed'}). "
                                 f"Available devices: {available}",
                    })
                break

            residual.extend(chunk)
            while len(residual) >= FRAME_BYTES:
                frame = bytes(residual[:FRAME_BYTES])
                del residual[:FRAME_BYTES]
                now = time.time()

                frame_f32 = (
                    np.frombuffer(frame, dtype=np.int16).astype(np.float32) / 32768.0
                )
                event = vad.process(frame_f32)

                if event == "start" and not in_speech:
                    in_speech = True
                    utterance_started_at = now
                    utterance.clear()
                    for pre in preroll:
                        utterance.extend(pre)
                    utterance.extend(frame)
                elif in_speech:
                    utterance.extend(frame)
                    too_long = now - utterance_started_at > MAX_UTTERANCE_SECONDS
                    if event == "end" or too_long:
                        in_speech = False
                        pcm = bytes(utterance)
                        utterance.clear()
                        if len(pcm) >= int(SAMPLE_RATE * 2 * MIN_UTTERANCE_SECONDS):
                            try:
                                text = self._transcribe(pcm)
                            except Exception as exc:  # keep listening
                                emit({"error": f"Transcription failed: {exc}"})
                                text = ""
                            if text:
                                emit({
                                    "text": text,
                                    "start": utterance_started_at,
                                    "end": now,
                                })
                else:
                    preroll.append(frame)

        if self._proc.poll() is None:
            self._proc.kill()
        emit({"status": "stopped"})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="en", help="'auto' to detect")
    args = parser.parse_args()

    emit({"status": "loading", "model": args.model})
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    emit({"status": "ready", "model": args.model})

    language = None if args.language == "auto" else args.language
    capture: Capture | None = None

    # Command loop; stdin EOF (the app quit) ends the process.
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            command = json.loads(raw)
        except json.JSONDecodeError:
            continue
        cmd = command.get("cmd")
        if cmd == "start":
            if capture is not None:
                capture.stop()
            capture = Capture(model, command.get("device", ""), language)
            capture.start()
        elif cmd == "stop":
            if capture is not None:
                capture.stop()
                capture = None
        elif cmd == "exit":
            break

    if capture is not None:
        capture.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
