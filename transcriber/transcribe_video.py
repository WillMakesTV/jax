"""Transcribe a downloaded video's audio for Jax — one-shot sidecar.

The microphone pipeline (transcribe_mic.py) with the audio source swapped
from a capture device to a local video file: ffmpeg decodes the file's audio
track to 16 kHz mono s16le PCM -> VAD gate (silero if installed, adaptive
energy otherwise) -> faster-whisper per utterance. Utterance timestamps are
positions in the video (seconds from its start) so the caller can anchor them
to the broadcast's wall-clock start.

--start <seconds> begins mid-video (ffmpeg seeks before decoding); positions
in the output stay absolute, so a caller can checkpoint progress and resume a
killed run where it left off.

Emits one JSON object per line on stdout:
  {"status": "loading"|"ready"|"transcribing"|"done", ...}       lifecycle
  {"status": "transcribing", "pos": <s>, "safe": <s>, ...}       a heartbeat;
      "safe" is the resume-safe checkpoint (never inside an utterance)
  {"text": "...", "start": <s>, "end": <s>, "percent": <0-100>}  an utterance
  {"error": "..."}                                               a problem
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
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

PROGRESS_INTERVAL = 1.0  # min wall-clock seconds between progress heartbeats


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


def ffmpeg_cmd(path: str, start: float) -> list[str]:
    cmd = [find_ffmpeg(), "-loglevel", "error"]
    if start > 0:
        cmd += ["-ss", f"{start:.2f}"]
    cmd += [
        "-i", path,
        "-vn",
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-ar", str(SAMPLE_RATE),
        "-ac", "1",
        "pipe:1",
    ]
    return cmd


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


class FileTranscriber:
    """One pass over the file: ffmpeg decode -> VAD -> whisper per utterance."""

    def __init__(self, model: "WhisperModel", path: str,
                 language: str | None, duration: float, start: float) -> None:
        self._model = model
        self._path = path
        self._language = language
        self._duration = duration
        self._start = start
        self.lines = 0

    def _percent(self, pos: float) -> int | None:
        if self._duration <= 0:
            return None
        return min(100, int(round(pos / self._duration * 100)))

    def _transcribe(self, pcm: bytes) -> str:
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _info = self._model.transcribe(
            audio, beam_size=1, vad_filter=False, language=self._language
        )
        return " ".join(s.text.strip() for s in segments).strip()

    def _emit_utterance(self, pcm: bytes, start: float, end: float) -> None:
        if len(pcm) < int(SAMPLE_RATE * BYTES_PER_SAMPLE * MIN_UTTERANCE_SECONDS):
            return
        try:
            text = self._transcribe(pcm)
        except Exception as exc:  # keep going; one bad segment isn't fatal
            emit({"error": f"Transcription failed at {start:.0f}s: {exc}"})
            return
        if text:
            line = {"text": text, "start": round(start, 2), "end": round(end, 2)}
            percent = self._percent(end)
            if percent is not None:
                line["percent"] = percent
            emit(line)
            self.lines += 1

    def run(self) -> None:
        proc = subprocess.Popen(
            ffmpeg_cmd(self._path, self._start),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        beat = {"status": "transcribing"}
        percent = self._percent(self._start)
        if percent is not None:
            beat["percent"] = percent
        emit(beat)

        try:
            vad = SileroVad()
        except Exception:
            vad = EnergyVad()

        residual = bytearray()
        preroll: deque[bytes] = deque(maxlen=PREROLL_FRAMES)
        utterance = bytearray()
        in_speech = False
        utterance_start = 0.0
        frames = 0  # decoded frames consumed; frames * FRAME_SECONDS = offset
        last_beat = time.monotonic()

        while True:
            chunk = proc.stdout.read(CHUNK_BYTES)
            if not chunk:
                break
            residual.extend(chunk)
            while len(residual) >= FRAME_BYTES:
                frame = bytes(residual[:FRAME_BYTES])
                del residual[:FRAME_BYTES]
                frames += 1
                pos = self._start + frames * FRAME_SECONDS

                frame_f32 = (
                    np.frombuffer(frame, dtype=np.int16).astype(np.float32) / 32768.0
                )
                event = vad.process(frame_f32)

                if event == "start" and not in_speech:
                    in_speech = True
                    utterance_start = max(
                        0.0, pos - (len(preroll) + 1) * FRAME_SECONDS
                    )
                    utterance.clear()
                    for pre in preroll:
                        utterance.extend(pre)
                    utterance.extend(frame)
                elif in_speech:
                    utterance.extend(frame)
                    too_long = pos - utterance_start > MAX_UTTERANCE_SECONDS
                    if event == "end" or too_long:
                        in_speech = False
                        self._emit_utterance(bytes(utterance), utterance_start, pos)
                        utterance.clear()
                else:
                    preroll.append(frame)

                now = time.monotonic()
                if now - last_beat >= PROGRESS_INTERVAL:
                    last_beat = now
                    # "safe" is where a killed run may resume without cutting
                    # an utterance in half: mid-speech it rewinds to the
                    # utterance's start so those words are heard again.
                    safe = utterance_start if in_speech else pos
                    beat = {
                        "status": "transcribing",
                        "pos": round(pos, 1),
                        "safe": round(safe, 2),
                    }
                    percent = self._percent(pos)
                    if percent is not None:
                        beat["percent"] = percent
                    emit(beat)

        # Flush a trailing utterance the VAD never closed (speech up to EOF).
        if in_speech:
            self._emit_utterance(
                bytes(utterance),
                utterance_start,
                self._start + frames * FRAME_SECONDS,
            )

        code = proc.wait()
        if code != 0 and frames == 0:
            err = ""
            try:
                err = proc.stderr.read().decode(errors="replace")[-400:].strip()
            except Exception:
                pass
            raise RuntimeError(
                f"ffmpeg could not decode the video's audio "
                f"({err or f'exit code {code}'})"
            )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="video file to transcribe")
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="en", help="'auto' to detect")
    parser.add_argument("--duration", type=float, default=0.0,
                        help="video duration in seconds, for progress percent")
    parser.add_argument("--start", type=float, default=0.0,
                        help="seconds into the video to resume from")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        emit({"error": f"Video file not found: {args.input}"})
        return 1

    emit({"status": "loading", "model": args.model})
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    emit({"status": "ready", "model": args.model})

    language = None if args.language == "auto" else args.language
    job = FileTranscriber(
        model, args.input, language, args.duration, max(0.0, args.start)
    )
    try:
        job.run()
    except Exception as exc:
        emit({"error": str(exc)})
        return 1

    emit({"status": "done", "lines": job.lines})
    return 0


if __name__ == "__main__":
    sys.exit(main())
