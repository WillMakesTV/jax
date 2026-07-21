"""Inspiration indexer for Jax.

Two modes, both driven by yt-dlp:

  --url <video>            fetch one video's metadata and download it into
                           <dir>/<channel-slug>/<video-id>/, writing video.json
                           alongside the media file.
  --url <video> --meta     read one video's metadata only, downloading nothing.
  --url <channel> --index  resolve a channel and list its recent uploads —
                           videos, then shorts, then past live streams
                           (metadata only, nothing downloaded).
  --url <channel> --channel
                           resolve a channel only: its branding, metrics, and
                           the links it publishes.

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
        "subscribers": int(info.get("channel_follower_count") or 0),
    }


LINK_RE = re.compile(r'https?://[^\s<>"\')\]]+')

# Hosts worth naming when a channel links to them.
SOCIAL_NAMES = {
    "twitter.com": "X",
    "x.com": "X",
    "instagram.com": "Instagram",
    "tiktok.com": "TikTok",
    "twitch.tv": "Twitch",
    "discord.gg": "Discord",
    "discord.com": "Discord",
    "facebook.com": "Facebook",
    "patreon.com": "Patreon",
    "github.com": "GitHub",
    "linkedin.com": "LinkedIn",
    "reddit.com": "Reddit",
    "threads.net": "Threads",
    "bsky.app": "Bluesky",
    "youtube.com": "YouTube",
    "kick.com": "Kick",
}


def link_label(url: str) -> str:
    """A readable name for a link, from its host."""
    host = re.sub(r"^https?://", "", url).split("/")[0].lower()
    if host.startswith("www."):
        host = host[4:]
    return SOCIAL_NAMES.get(host, host)


def channel_links(info: dict) -> list:
    """The links a channel publishes: its About-page entries when yt-dlp
    exposes them, otherwise whatever its description points at."""
    found, seen = [], set()

    def add(url: str, label: str = "") -> None:
        url = (url or "").strip().rstrip(".,)")
        if not url or url in seen:
            return
        seen.add(url)
        found.append({"label": label or link_label(url), "url": url})

    for entry in info.get("channel_urls") or []:
        if isinstance(entry, dict):
            add(entry.get("url") or "", entry.get("title") or "")
        elif isinstance(entry, str):
            add(entry)
    for url in LINK_RE.findall(info.get("description") or ""):
        add(url)
    return found[:20]


def pick_thumb(info: dict, *wanted: str) -> str:
    """The largest channel image whose id names one of the wanted kinds."""
    best, best_area = "", -1
    for t in info.get("thumbnails") or []:
        tid = str(t.get("id") or "").lower()
        if not any(w in tid for w in wanted):
            continue
        area = int(t.get("width") or 0) * int(t.get("height") or 0)
        if area > best_area:
            best, best_area = t.get("url") or "", area
    return best


def channel_full(top: dict, tab: dict, fallback_url: str = "") -> dict:
    """Everything Jax stores about a channel. A channel URL resolves to the
    channel itself (which carries the branding) wrapping the tab that holds
    its videos (which carries the video count), so both are read."""

    def pick(key: str, default=""):
        return top.get(key) or tab.get(key) or default

    return {
        "id": pick("channel_id") or pick("id"),
        "name": pick("channel") or pick("uploader") or pick("title"),
        "handle": pick("uploader_id"),
        "url": pick("channel_url") or pick("webpage_url") or fallback_url,
        "description": pick("description"),
        "subscribers": int(pick("channel_follower_count", 0) or 0),
        "videoCount": int(tab.get("playlist_count") or 0),
        "avatarUrl": pick_thumb(top, "avatar") or pick_thumb(tab, "avatar"),
        "bannerUrl": pick_thumb(top, "banner") or pick_thumb(tab, "banner"),
        "tags": [t for t in (top.get("tags") or tab.get("tags") or []) if t][:20],
        "links": channel_links(top) or channel_links(tab),
    }


def resolve_channel(url: str, limit: int = 1) -> tuple:
    """Extract a channel URL, drilling into the tab that holds its videos.
    Returns (the channel's own info, the tab's info, the tab's entries)."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "playlistend": limit,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        top = ydl.extract_info(url, download=False)

    tab, entries = top, top.get("entries") or []
    while entries and (entries[0].get("_type") == "playlist"):
        tab = entries[0]
        entries = tab.get("entries") or []
    return top, tab, entries


def index_channel_only(url: str) -> None:
    """Resolve a channel's branding and metrics, nothing else."""
    top, tab, _ = resolve_channel(url)
    channel = channel_full(top, tab, url)
    if not channel["id"] and not channel["name"]:
        emit({"error": "that URL did not resolve to a channel"})
        sys.exit(1)
    emit({"status": "channel", "channel": channel})


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
        "kind": video_kind(info),
        "channel": channel_of(info),
    }


def video_kind(info: dict) -> str:
    """Full video, short, or past live stream."""
    if info.get("was_live") or info.get("is_live") or info.get("live_status") in (
            "is_live", "was_live", "post_live"):
        return "live"
    duration = int(info.get("duration") or 0)
    url = (info.get("webpage_url") or "") + (info.get("original_url") or "")
    if "/shorts/" in url or (0 < duration <= 60):
        return "short"
    return "video"


# A channel publishes three kinds of content, and they are worth studying
# differently: full videos first, then shorts, then past live streams.
CHANNEL_TABS = (("video", "videos"), ("short", "shorts"), ("live", "streams"))


def tab_url(base: str, tab: str) -> str:
    """The channel's <tab> page, from whatever channel URL we were given."""
    base = base.rstrip("/")
    for suffix in ("/videos", "/shorts", "/streams", "/featured", "/about"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    return f"{base}/{tab}"


def entry_video(entry: dict, channel: dict, kind: str) -> dict:
    """One listed video, in the shape Jax stores."""
    return {
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
        "kind": kind,
        "channel": channel,
    }


def index_channel(url: str, limit: int, kinds: str = "all") -> None:
    """List a channel's recent uploads without downloading anything.

    kinds: "all" walks videos, then shorts, then past live streams; otherwise
    a comma-separated subset of video/short/live."""
    wanted = (
        [k for k, _ in CHANNEL_TABS]
        if kinds in ("", "all")
        else [k.strip() for k in kinds.split(",") if k.strip()]
    )

    channel = None
    seen = set()
    for kind, tab in CHANNEL_TABS:
        if kind not in wanted:
            continue
        try:
            top, tab_info, entries = resolve_channel(tab_url(url, tab), limit)
        except Exception:
            # A channel with no shorts (or no streams) has no such tab.
            continue
        if channel is None:
            channel = channel_full(top, tab_info, url)
            emit({"status": "channel", "channel": channel})
        for entry in entries[:limit]:
            if not entry or not entry.get("id") or entry["id"] in seen:
                continue
            seen.add(entry["id"])
            emit({"status": "video", "video": entry_video(entry, channel, kind)})

    if channel is None:
        # Nothing resolved through the tabs; fall back to the URL as given.
        top, tab_info, entries = resolve_channel(url, limit)
        channel = channel_full(top, tab_info, url)
        emit({"status": "channel", "channel": channel})
        for entry in entries[:limit]:
            if entry and entry.get("id"):
                emit({"status": "video",
                      "video": entry_video(entry, channel, "video")})


def read_video(url: str) -> None:
    """Read one video's metadata without downloading it."""
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
        info = ydl.extract_info(url, download=False)
    video = video_of(info)
    if not video["id"]:
        emit({"error": "yt-dlp returned no video id for that URL"})
        sys.exit(1)
    emit({"status": "meta", "video": video})


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
    parser.add_argument("--channel", action="store_true",
                        help="resolve the channel only (branding and metrics)")
    parser.add_argument("--meta", action="store_true",
                        help="read one video's metadata without downloading it")
    parser.add_argument("--limit", type=int, default=30,
                        help="how many videos to list per tab in index mode")
    parser.add_argument("--kinds", default="all",
                        help="which tabs to list: all, or video/short/live")
    args = parser.parse_args()

    try:
        if args.meta:
            read_video(args.url)
        elif args.channel:
            index_channel_only(args.url)
        elif args.index:
            index_channel(args.url, max(1, args.limit), args.kinds)
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
