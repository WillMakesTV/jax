"""Inspiration indexer for Jax.

Two modes, both driven by yt-dlp:

  --url <video>            fetch one video's metadata and download it into
                           <dir>/<channel-slug>/<video-id>/, writing video.json
                           alongside the media file.
  --url <channel> --index  resolve a channel and list its recent videos
                           (metadata only, nothing downloaded).

Emits one JSON object per line on stdout:
  {"status": "channel", "channel": {...}}          the source channel
  {"status": "video", "video": {...}}              one indexed video (index mode)
  {"status": "meta", "video": {...}}               the video being downloaded
  {"status": "downloading", "percent": p}          download progress
  {"status": "done", "dir": "...", "file": "..."}  the finished download
  {"error": "..."}
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


try:
    import yt_dlp
except ImportError:
    emit({
        "error": "yt-dlp is not installed. Run: py -3.11 -m pip install --user yt-dlp"
    })
    sys.exit(2)


def slug(value: str, fallback: str) -> str:
    """Filesystem-safe folder name."""
    cleaned = re.sub(r"[^A-Za-z0-9 ._-]+", "", (value or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned[:60] or fallback


def iso_date(compact: str) -> str:
    """yt-dlp's YYYYMMDD upload_date as an RFC3339 date, or ''."""
    if not compact or len(compact) != 8 or not compact.isdigit():
        return ""
    return f"{compact[0:4]}-{compact[4:6]}-{compact[6:8]}T00:00:00Z"


def channel_of(info: dict) -> dict:
    """The channel fields Jax stores, from a video or playlist info dict."""
    return {
        "id": info.get("channel_id") or info.get("uploader_id") or "",
        "name": info.get("channel") or info.get("uploader") or "",
        "handle": info.get("uploader_id") or "",
        "url": info.get("channel_url") or info.get("uploader_url") or "",
        "description": (info.get("description") or "") if info.get("_type") else "",
    }


def video_of(info: dict) -> dict:
    """The video fields Jax stores."""
    chapters = []
    for ch in info.get("chapters") or []:
        chapters.append({
            "title": ch.get("title") or "",
            "startSecs": int(ch.get("start_time") or 0),
        })
    return {
        "id": info.get("id") or "",
        "title": info.get("title") or "",
        "url": info.get("webpage_url") or info.get("original_url") or "",
        "description": info.get("description") or "",
        "publishedAt": iso_date(info.get("upload_date") or ""),
        "durationSecs": int(info.get("duration") or 0),
        "views": int(info.get("view_count") or 0),
        "likes": int(info.get("like_count") or 0),
        "comments": int(info.get("comment_count") or 0),
        "tags": [t for t in (info.get("tags") or []) if t][:40],
        "categories": [c for c in (info.get("categories") or []) if c],
        "thumbnailUrl": info.get("thumbnail") or "",
        "chapters": chapters,
        "channel": channel_of(info),
    }


def index_channel(url: str, limit: int) -> None:
    """List a channel's recent videos without downloading anything."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "playlistend": limit,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    entries = info.get("entries") or []
    # A channel URL resolves to a set of tabs; drill into the first playlist.
    while entries and (entries[0].get("_type") == "playlist"):
        info = entries[0]
        entries = info.get("entries") or []

    channel = {
        "id": info.get("channel_id") or info.get("id") or "",
        "name": info.get("channel") or info.get("uploader") or info.get("title") or "",
        "handle": info.get("uploader_id") or "",
        "url": info.get("channel_url") or info.get("webpage_url") or url,
        "description": info.get("description") or "",
    }
    emit({"status": "channel", "channel": channel})

    for entry in entries[:limit]:
        if not entry or not entry.get("id"):
            continue
        emit({"status": "video", "video": {
            "id": entry.get("id"),
            "title": entry.get("title") or "",
            "url": entry.get("url") or f"https://www.youtube.com/watch?v={entry['id']}",
            "description": entry.get("description") or "",
            "publishedAt": iso_date(entry.get("upload_date") or ""),
            "durationSecs": int(entry.get("duration") or 0),
            "views": int(entry.get("view_count") or 0),
            "likes": 0,
            "comments": 0,
            "tags": [],
            "categories": [],
            "thumbnailUrl": (entry.get("thumbnails") or [{}])[-1].get("url", ""),
            "chapters": [],
            "channel": channel,
        }})


def download_video(url: str, root: str) -> None:
    """Download one video into <root>/<channel>/<video-id>/ with video.json."""
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
        info = ydl.extract_info(url, download=False)

    video = video_of(info)
    if not video["id"]:
        emit({"error": "yt-dlp returned no video id for that URL"})
        sys.exit(1)
    emit({"status": "meta", "video": video})

    channel_dir = slug(video["channel"]["name"], video["channel"]["id"] or "channel")
    target = os.path.join(root, channel_dir, slug(video["id"], "video"))
    os.makedirs(target, exist_ok=True)

    last = {"pct": -1}

    def hook(d: dict) -> None:
        if d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        done = d.get("downloaded_bytes") or 0
        pct = int(done * 100 / total) if total else 0
        if pct != last["pct"]:
            last["pct"] = pct
            emit({"status": "downloading", "percent": pct})

    opts = {
        "quiet": True,
        "no_warnings": True,
        # yt-dlp's own progress bar would land on stdout among the JSON lines.
        "noprogress": True,
        "outtmpl": os.path.join(target, "%(id)s.%(ext)s"),
        "format": "bv*[height<=1080]+ba/b[height<=1080]/b",
        "merge_output_format": "mp4",
        "progress_hooks": [hook],
        "writethumbnail": True,
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([video["url"] or url])

    media = ""
    for name in sorted(os.listdir(target)):
        if name.lower().endswith((".mp4", ".mkv", ".webm", ".mov", ".m4v")):
            media = name
            break
    if not media:
        emit({"error": "the download produced no video file"})
        sys.exit(1)

    thumb = ""
    for name in sorted(os.listdir(target)):
        if name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            thumb = name
            break

    video["videoFile"] = media
    video["thumbnailFile"] = thumb
    video["downloadedAt"] = datetime.now(timezone.utc).isoformat()
    try:
        with open(os.path.join(target, "video.json"), "w", encoding="utf-8") as f:
            json.dump(video, f, indent=2)
    except OSError:
        pass

    emit({
        "status": "done",
        "dir": target,
        # The app stores the library-relative folder; hand it over already
        # normalised so a mixed-separator path never has to be re-derived.
        "rel": os.path.relpath(target, root).replace(os.sep, "/"),
        "file": media,
        "thumbnail": thumb,
    })


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="video or channel URL")
    parser.add_argument("--dir", default="", help="inspiration root (download mode)")
    parser.add_argument("--index", action="store_true",
                        help="list a channel's videos instead of downloading")
    parser.add_argument("--limit", type=int, default=30,
                        help="how many videos to list in index mode")
    args = parser.parse_args()

    try:
        if args.index:
            index_channel(args.url, max(1, args.limit))
        else:
            if not args.dir:
                emit({"error": "no download directory given"})
                sys.exit(2)
            download_video(args.url, args.dir)
    except Exception as exc:  # noqa: BLE001 — report anything to the app
        emit({"error": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
