"""Past-stream video downloader for Jax.

Downloads one or more VOD URLs (all from a single platform, ordered by
broadcast time) with yt-dlp, then — when a stream spans multiple videos —
stitches them into one file with ffmpeg so the full broadcast plays in order.

Emits one JSON object per line on stdout:
  {"status": "start", "total": N}
  {"status": "downloading", "part": i, "total": N, "percent": p}
  {"status": "stitching"}
  {"status": "done", "file": "<path>"}
  {"error": "..."}
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from glob import glob


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


def write_manifest(target_dir: str, manifest_path: str, video_file: str) -> None:
    """Write manifest.json (the caller's metadata + local file info) into the
    download folder so the app can track and play the downloaded video."""
    if not manifest_path:
        return
    data: dict = {}
    try:
        with open(manifest_path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:  # noqa: BLE001 — a missing/invalid manifest is non-fatal
        data = {}
    data["videoFile"] = os.path.basename(video_file)
    data["subfolder"] = os.path.basename(os.path.normpath(target_dir))
    data["downloadedAt"] = datetime.now(timezone.utc).isoformat()
    try:
        with open(os.path.join(target_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except OSError:
        pass


try:
    import yt_dlp
except ImportError:
    emit({
        "error": "yt-dlp is not installed. Run: py -3.11 -m pip install --user yt-dlp"
    })
    sys.exit(2)


def find_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path:
        return path
    local = os.environ.get("LOCALAPPDATA")
    if local:
        hits = glob(os.path.join(local, "Microsoft", "WinGet", "Packages",
                                 "Gyan.FFmpeg*", "*", "bin", "ffmpeg.exe"))
        if hits:
            return hits[0]
    raise FileNotFoundError("ffmpeg not found. Install it (e.g. 'winget install Gyan.FFmpeg').")


def safe_name(name: str) -> str:
    """A filename-safe version of the stream title."""
    cleaned = re.sub(r'[\\/:*?"<>|]+', " ", name).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:120] or "stream"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    parser.add_argument("--subdir", default="")
    parser.add_argument("--name", required=True)
    parser.add_argument("--manifest", default="")
    parser.add_argument("urls", nargs="+")
    args = parser.parse_args()

    # Downloads land in a per-stream subfolder (timestamp + channel name).
    target_dir = args.dir
    if args.subdir.strip():
        target_dir = os.path.join(args.dir, safe_name(args.subdir))
    os.makedirs(target_dir, exist_ok=True)
    args.dir = target_dir
    name = safe_name(args.name)
    total = len(args.urls)
    emit({"status": "start", "total": total})

    try:
        ffmpeg = find_ffmpeg()
    except FileNotFoundError as exc:
        emit({"error": str(exc)})
        return 1
    ffmpeg_dir = os.path.dirname(ffmpeg)

    parts: list[str] = []
    for i, url in enumerate(args.urls, 1):
        suffix = f" - part {i}" if total > 1 else ""
        outtmpl = os.path.join(args.dir, f"{name}{suffix}.%(ext)s")

        def hook(d: dict, i: int = i) -> None:
            if d.get("status") == "downloading":
                total_bytes = d.get("total_bytes") or d.get("total_bytes_estimate")
                pct = 0.0
                if total_bytes:
                    pct = d.get("downloaded_bytes", 0) / total_bytes * 100
                emit({"status": "downloading", "part": i, "total": total, "percent": round(pct, 1)})
            elif d.get("status") == "finished":
                emit({"status": "downloading", "part": i, "total": total, "percent": 100})

        opts = {
            "outtmpl": outtmpl,
            "progress_hooks": [hook],
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "no_color": True,
            "merge_output_format": "mp4",
            "ffmpeg_location": ffmpeg_dir,
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
                filename = ydl.prepare_filename(info)
            if not os.path.exists(filename):
                base = os.path.splitext(filename)[0]
                matches = glob(base + ".*")
                if matches:
                    filename = matches[0]
            parts.append(filename)
        except Exception as exc:  # noqa: BLE001 — surface any yt-dlp failure
            msg = re.sub(r"\x1b\[[0-9;]*m", "", str(exc)).strip()
            emit({"error": f"Download failed for video {i}: {msg}"})
            return 1

    if total == 1:
        write_manifest(args.dir, args.manifest, parts[0])
        emit({"status": "done", "file": parts[0]})
        return 0

    # Stitch the parts, in order, into one file.
    emit({"status": "stitching"})
    out = os.path.join(args.dir, f"{name}.mp4")
    listfile = os.path.join(args.dir, ".jax_concat.txt")
    with open(listfile, "w", encoding="utf-8") as f:
        for p in parts:
            escaped = p.replace("'", "'\\''")
            f.write(f"file '{escaped}'\n")

    def concat(reencode: bool) -> subprocess.CompletedProcess:
        codec = ["-c:v", "libx264", "-c:a", "aac"] if reencode else ["-c", "copy"]
        return subprocess.run(
            [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", listfile, *codec, out],
            capture_output=True, text=True,
        )

    result = concat(reencode=False)
    if result.returncode != 0:
        # Stream-copy fails when the parts differ in codec/params; re-encode.
        result = concat(reencode=True)
    os.remove(listfile)
    if result.returncode != 0:
        emit({"error": "Stitching failed: " + (result.stderr or "")[-300:].strip()})
        return 1

    # Keep only the stitched file.
    for p in parts:
        try:
            os.remove(p)
        except OSError:
            pass

    write_manifest(args.dir, args.manifest, out)
    emit({"status": "done", "file": out})
    return 0


if __name__ == "__main__":
    sys.exit(main())
