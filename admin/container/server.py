#!/usr/bin/env python3
"""yt-dlp helper service for the DeenSubs Scribe pipeline.

Runs inside a Cloudflare Container, reached only through the Worker's
Durable Object binding (never exposed publicly). yt-dlp (android_vr client)
extracts direct URLs from the datacenter IP; the bytes are pulled by a fast
parallel-range downloader (~250-290 MB/s) and muxed with ffmpeg. Extraction
falls back to the configured proxies only if the direct IP can't extract.
yt-dlp self-updates to the latest release on boot and every 12h.

Endpoints (all require Authorization: Bearer $TOKEN):
  POST   /download   {"url": "..."}     -> {"id": "..."}
  GET    /jobs/<id>                     -> {"status": "queued|running|done|error", ...}
  GET    /files/<id>                    -> audio bytes (opus)
  DELETE /files/<id>                    -> {"ok": true}
  GET    /health                        -> {"ok": true}   (no auth)

Config via environment (see /etc/ytdlp-svc/env):
  YTDLP_TOKEN    bearer token
  YTDLP_PROXIES  comma-separated SOCKS proxies, tried in order after direct
  YTDLP_PORT     listen port (default 8199)
  YTDLP_DIR      download dir (default /var/lib/ytdlp-svc)
"""

import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("YTDLP_TOKEN", "")
PROXIES = [p.strip() for p in os.environ.get("YTDLP_PROXIES", "").split(",") if p.strip()]
PORT = int(os.environ.get("YTDLP_PORT", "8199"))
DIR = os.environ.get("YTDLP_DIR", "/data")
MAX_AGE_SEC = 6 * 3600  # clean files older than 6h

os.makedirs(DIR, exist_ok=True)

jobs = {}  # id -> {status, error, file, title, duration, ext, attempts}
jobs_lock = threading.Lock()


UPDATE_MARKER = os.path.join(DIR, ".last-yt-dlp-update")
UPDATE_INTERVAL = 12 * 3600


def maybe_self_update() -> None:
    """Keep yt-dlp on the latest release (throttled to once per 12h)."""
    try:
        if os.path.exists(UPDATE_MARKER) and time.time() - os.path.getmtime(UPDATE_MARKER) < UPDATE_INTERVAL:
            return
        r = subprocess.run(["yt-dlp", "-U"], capture_output=True, text=True, timeout=120)
        if "pip" in (r.stdout + r.stderr).lower():
            subprocess.run(
                ["python3", "-m", "pip", "install", "-U", "yt-dlp", "--break-system-packages"],
                capture_output=True, text=True, timeout=180,
            )
        with open(UPDATE_MARKER, "w") as fh:
            fh.write(str(time.time()))
    except Exception:  # noqa: BLE001
        pass  # never block downloads on update failures


# ---- fast parallel-range downloader --------------------------------------
# googlevideo throttles each connection after an initial burst, so a single
# GET crawls (~1 MB/s). Many SMALL concurrent byte-ranges each finish inside
# the burst window -> ~250-290 MB/s on a standard-2 instance (measured).
# chunk=4MB, concurrency=48 is the sweet spot; higher concurrency trips
# googlevideo's 401 abuse response.
VR_UA = "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12; Quest 3)"
DL_CONCURRENCY = 48
DL_CHUNK = 4 << 20


def _opener(proxy):
    if proxy:
        return urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    return urllib.request.build_opener()


def _content_length(url, proxy):
    req = urllib.request.Request(url, headers={"Range": "bytes=0-1", "User-Agent": VR_UA})
    with _opener(proxy).open(req, timeout=20) as r:
        cr = r.headers.get("Content-Range", "")
        return int(cr.split("/")[-1]) if "/" in cr else 0


def _fetch_range(opener, url, start, end):
    # retry with backoff; back off harder on 401/403/429 (googlevideo rate/abuse)
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}", "User-Agent": VR_UA})
            with opener.open(req, timeout=60) as r:
                buf = bytearray()
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    buf += b
                return bytes(buf)
        except Exception as exc:  # noqa: BLE001
            if attempt == 5:
                raise
            code = getattr(exc, "code", None)
            base = 0.6 if code in (401, 403, 429) else 0.3
            time.sleep(base * (2 ** attempt))
    raise RuntimeError("unreachable")


def parallel_download(url, dest, clen, proxy, on_pct=None):
    """Download `url` into `dest` via concurrent byte-ranges (thread-safe
    positional writes). Raises if any range can't be fetched."""
    if clen <= 0:
        clen = _content_length(url, proxy)
    if clen <= 0:
        raise RuntimeError("unknown content length")
    opener = _opener(proxy)
    ranges = []
    off = 0
    while off < clen:
        end = min(off + DL_CHUNK - 1, clen - 1)
        ranges.append((off, end))
        off = end + 1
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    try:
        os.ftruncate(fd, clen)
        done = 0
        lock = threading.Lock()

        def work(rng):
            nonlocal done
            data = _fetch_range(opener, url, rng[0], rng[1])
            os.pwrite(fd, data, rng[0])
            if on_pct:
                with lock:
                    done += len(data)
                    on_pct(done / clen * 100.0)

        with concurrent.futures.ThreadPoolExecutor(max_workers=DL_CONCURRENCY) as ex:
            for fut in concurrent.futures.as_completed([ex.submit(work, r) for r in ranges]):
                fut.result()
    finally:
        os.close(fd)


def _fmt_clen(f):
    return int(f.get("filesize") or f.get("filesize_approx") or 0)


def _pick_formats(info, video):
    """Choose formats from an android_vr -J info dict, matching the old yt-dlp
    selection: h264 <=1080p video + m4a audio, or best m4a audio."""
    fmts = [f for f in info.get("formats", []) if f.get("url")]
    audio = [f for f in fmts if f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none")]
    m4a = [f for f in audio if f.get("ext") == "m4a" or "mp4a" in str(f.get("acodec", ""))]
    best_audio = max(m4a or audio, key=lambda f: f.get("abr") or f.get("tbr") or 0, default=None)
    if not video:
        return {"audio": best_audio}
    vids = [f for f in fmts if f.get("vcodec") not in (None, "none") and f.get("acodec") in (None, "none")]
    avc = [f for f in vids if str(f.get("vcodec", "")).startswith("avc1") and (f.get("height") or 0) <= 1080]
    best_video = max(avc, key=lambda f: ((f.get("height") or 0), (f.get("tbr") or 0)), default=None)
    if best_video and best_audio:
        return {"video": best_video, "audio": best_audio}
    prog = [f for f in fmts if f.get("vcodec") not in (None, "none") and f.get("acodec") not in (None, "none")]
    return {"progressive": max(prog, key=lambda f: (f.get("height") or 0), default=None)}


def _ffmpeg(args):
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg: " + (r.stderr or "").strip()[-300:])


def run_download(job_id: str, url: str, cookies: str | None = None, video: bool = False, pinned_proxy: str | None = None, use_aria2: bool = True, player_client: str | None = None) -> None:
    """Extract the direct android_vr URL with yt-dlp, then pull the bytes with
    the fast parallel-range downloader and mux with ffmpeg. Extraction works
    from the datacenter IP directly (no proxy, no bot-wall); the proxy list is
    kept as a fallback for anything the direct IP can't extract."""
    # non-blocking: never let a cold-container yt-dlp -U (up to 120s) stall the
    # download at 0% — the 12h marker + boot-time update keep yt-dlp current.
    threading.Thread(target=maybe_self_update, daemon=True).start()
    cookies_file = None
    if cookies:
        cookies_file = os.path.join(DIR, f"{job_id}.cookies.txt")
        with open(cookies_file, "w") as fh:
            fh.write(cookies)
    attempts = PROXIES + [None]  # direct is the primary path; proxies are fallback
    if pinned_proxy:
        attempts = [pinned_proxy, None]
    last_err = "no attempts"
    for proxy in attempts:
        label = proxy or "direct"
        try:
            with jobs_lock:
                jobs[job_id]["attempts"] = jobs[job_id].get("attempts", []) + [label]
                jobs[job_id]["pct"] = 0.0
            # 1. extract direct URLs + metadata via the android_vr client
            # use_aria2 kept for caller compatibility; parallel byte-ranges replace it.
            client = player_client or "android_vr"
            cmd = ["yt-dlp", "-J", "--skip-download", "--no-playlist", "--no-warnings",
                   "--extractor-args", f"youtube:player_client={client}", "--socket-timeout", "20"]
            if cookies_file:
                cmd += ["--cookies", cookies_file]
            if proxy:
                cmd += ["--proxy", proxy]
            cmd.append(url)
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if proc.returncode != 0 or not proc.stdout.strip():
                last_err = (proc.stderr or "").strip()[-400:] or f"extract exit {proc.returncode}"
                continue
            info = json.loads(proc.stdout)
            sel = _pick_formats(info, video)

            def dl_pct(base, span):
                def cb(p):
                    with jobs_lock:
                        jobs[job_id]["pct"] = base + p * span / 100.0
                return cb

            if not video:
                a = sel.get("audio")
                if not a:
                    last_err = "no audio format"
                    continue
                produced = os.path.join(DIR, f"{job_id}.{a.get('ext') or 'm4a'}")
                parallel_download(a["url"], produced, _fmt_clen(a), proxy, dl_pct(0, 95))
            elif sel.get("progressive"):
                p = sel["progressive"]
                raw = os.path.join(DIR, f"{job_id}.raw.mp4")
                parallel_download(p["url"], raw, _fmt_clen(p), proxy, dl_pct(0, 85))
                produced = os.path.join(DIR, f"{job_id}.mp4")
                _ffmpeg(["-i", raw, "-c", "copy", "-movflags", "+faststart", produced])
                os.remove(raw)
            else:
                v, a = sel.get("video"), sel.get("audio")
                if not (v and a):
                    last_err = "no suitable video+audio formats"
                    continue
                vpath = os.path.join(DIR, f"{job_id}.v.mp4")
                apath = os.path.join(DIR, f"{job_id}.a.m4a")
                parallel_download(v["url"], vpath, _fmt_clen(v), proxy, dl_pct(0, 55))
                parallel_download(a["url"], apath, _fmt_clen(a), proxy, dl_pct(55, 30))
                produced = os.path.join(DIR, f"{job_id}.mp4")
                _ffmpeg(["-i", vpath, "-i", apath, "-c", "copy", "-movflags", "+faststart", produced])
                os.remove(vpath)
                os.remove(apath)

            if cookies_file and os.path.exists(cookies_file):
                os.remove(cookies_file)
            with jobs_lock:
                jobs[job_id].update(
                    status="done", pct=100.0, file=produced, ext=produced.rsplit(".", 1)[-1],
                    four_k=any((f.get("height") or 0) > 1080 for f in (info.get("formats") or [])),
                    title=info.get("title", ""),
                    channel=info.get("uploader", "") or info.get("channel", ""),
                    thumbnail=info.get("thumbnail", ""),
                    duration=info.get("duration", 0),
                    description=(info.get("description") or "")[:5000],
                    channel_id=info.get("channel_id", ""),
                    vid=info.get("id", ""),
                    via=label,
                )
            return
        except subprocess.TimeoutExpired:
            last_err = f"timeout via {label}"
        except Exception as exc:  # noqa: BLE001
            last_err = f"{type(exc).__name__}: {exc}"
    if cookies_file and os.path.exists(cookies_file):
        os.remove(cookies_file)
    with jobs_lock:
        jobs[job_id].update(status="error", error=last_err)


def probe_video(url: str, cookies: str | None) -> dict:
    """Fast metadata probe (no download): title, channel, duration, thumbnail,
    four_k. Uses the android_vr client (works direct from the datacenter IP) and
    -J so it returns in ~1-3s, far quicker than a Browser Rendering probe."""
    cookies_file = None
    if cookies:
        cookies_file = os.path.join(DIR, f"probe-{uuid.uuid4()}.cookies.txt")
        with open(cookies_file, "w") as fh:
            fh.write(cookies)
    try:
        attempts = PROXIES + [None]
        last_err = "no attempts"
        for proxy in attempts:
            cmd = ["yt-dlp", "-J", "--no-playlist", "--skip-download", "--no-warnings",
                   "--extractor-args", "youtube:player_client=android_vr", "--socket-timeout", "15", url]
            if cookies_file:
                cmd[1:1] = ["--cookies", cookies_file]
            if proxy:
                cmd[1:1] = ["--proxy", proxy]
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                if proc.returncode == 0 and proc.stdout.strip():
                    d = json.loads(proc.stdout)
                    return {
                        "title": d.get("title", ""),
                        "channel": d.get("uploader", "") or d.get("channel", ""),
                        "duration": d.get("duration") or 0,
                        "thumbnail": d.get("thumbnail", ""),
                        "four_k": any((f.get("height") or 0) > 1080 for f in (d.get("formats") or [])),
                    }
                last_err = (proc.stderr or "").strip()[-200:]
            except subprocess.TimeoutExpired:
                last_err = "probe timeout"
        return {"error": last_err}
    finally:
        if cookies_file and os.path.exists(cookies_file):
            os.remove(cookies_file)



def enumerate_playlist(url: str, cookies: str | None) -> dict:
    """Flat-enumerate a playlist/channel without downloading anything."""
    cookies_file = None
    if cookies:
        cookies_file = os.path.join(DIR, f"enum-{uuid.uuid4()}.cookies.txt")
        with open(cookies_file, "w") as fh:
            fh.write(cookies)
    try:
        attempts = PROXIES + [None]
        last_err = "no attempts"
        for proxy in attempts:
            cmd = ["yt-dlp", "--flat-playlist", "-J", "--no-warnings", "--socket-timeout", "20", url]
            if cookies_file:
                cmd[1:1] = ["--cookies", cookies_file]
            if proxy:
                cmd[1:1] = ["--proxy", proxy]
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
                if proc.returncode == 0 and proc.stdout.strip():
                    data = json.loads(proc.stdout)
                    entries = data.get("entries") or []
                    out = []
                    for e in entries:
                        if not e:
                            continue
                        vid = e.get("id", "")
                        out.append({
                            "id": vid,
                            "title": e.get("title", ""),
                            "duration": e.get("duration") or 0,
                            "url": e.get("url") if str(e.get("url", "")).startswith("http")
                                   else f"https://www.youtube.com/watch?v={vid}",
                            "uploader": e.get("uploader") or data.get("uploader") or "",
                        })
                    return {"title": data.get("title", ""), "count": len(out), "entries": out[:500]}
                last_err = (proc.stderr or "").strip()[-300:]
            except subprocess.TimeoutExpired:
                last_err = "enumeration timeout"
        return {"error": last_err}
    finally:
        if cookies_file and os.path.exists(cookies_file):
            os.remove(cookies_file)


def run_clip(job_id: str, payload: dict) -> None:
    """Render a 9:16 viral clip: blur-pad framing, ASS karaoke captions,
    animated gold progress bar. The ASS (captions + hook title) is authored
    by the Worker; this just composes and burns."""
    url = payload["url"]
    start = float(payload["start"])
    end = float(payload["end"])
    dur = max(0.5, end - start)
    ass_path = os.path.join(DIR, f"{job_id}.ass")
    out_path = os.path.join(DIR, f"{job_id}.mp4")
    try:
        import base64
        with open(ass_path, "wb") as fh:
            fh.write(base64.b64decode(payload.get("ass_b64", "")))
        # LLM-directed motion: subtle Ken Burns + punch zooms + shake, applied
        # to the composed frame BEFORE captions burn (text stays crisp).
        fx = payload.get("fx") or []
        motion = ""
        if payload.get("kb") or fx:
            # zoompan: the only ffmpeg filter with per-frame zoom expressions
            # (crop w/h evaluate once at init). t = on/30 after fps=30.
            terms = ["1", f"0.030*on/(30*{dur:.3f})"]
            for e in fx:
                if e.get("type") == "punch":
                    terms.append(f"0.085*max(0,1-abs(on/30-{float(e['t']):.2f})/0.16)")
            terms = terms[:14]
            z = "+".join(terms)
            shakes = [e for e in fx if e.get("type") == "shake"][:3]
            xoff = "+".join(f"10*sin(48*on/30)*max(0,1-abs(on/30-{float(e['t']):.2f})/0.30)" for e in shakes)
            zesc = z.replace(",", "\\,")
            xesc = ("+(" + xoff.replace(",", "\\,") + ")") if xoff else ""
            motion = (f"fps=30,zoompan=z='{zesc}':"
                      f"x='iw/2-(iw/zoom/2){xesc}':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,")
        if payload.get("framing") == "fit":
            base_chain = (
                "[0:v]split=2[bg][fg];"
                "[bg]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,"
                "boxblur=8:2,scale=1080:1920,eq=brightness=-0.18:saturation=0.85[bgb];"
                "[fg]scale=1080:-2[fgs];"
                "[bgb][fgs]overlay=(W-w)/2:(H-h)/2:format=auto[base];"
            )
        else:
            # fill: full-bleed center crop on the speaker — the TikTok look
            base_chain = "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base];"
        vf = (
            base_chain +
            f"[base]{motion}ass={ass_path}:fontsdir=/usr/share/fonts/custom[subbed];"
            f"[subbed]drawbox=x=0:y=ih-16:w=iw*min(t/{dur:.3f}\\,1):h=16:color=0x45b3a2@0.95:t=fill[out]"
        )
        # Hard flash cuts (LLM-directed): 80ms white pops on transition beats
        flashes = [e for e in fx if e.get("type") == "flash"][:3]
        if flashes:
            fl = "".join(
                f",drawbox=x=0:y=0:w=iw:h=ih:color=white@0.85:t=fill:enable='between(t,{float(e['t']):.2f},{float(e['t']) + 0.08:.2f})'"
                for e in flashes
            )
            vf = vf.replace("[out]", "") + fl + "[out]"
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start), "-to", str(end), "-i", url,
            "-filter_complex", vf,
            "-map", "[out]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            "-t", str(dur),
            out_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
        if proc.returncode == 0 and os.path.exists(out_path):
            files = {}
            if payload.get("poster"):
                poster_path = os.path.join(DIR, f"{job_id}-poster.jpg")
                pp = subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(min(1.0, dur / 2)),
                                     "-i", out_path, "-frames:v", "1", "-q:v", "3", poster_path],
                                    capture_output=True, timeout=60)
                if pp.returncode == 0 and os.path.exists(poster_path):
                    files["poster.jpg"] = poster_path
            with jobs_lock:
                jobs[job_id].update(status="done", file=out_path, ext="mp4", files=files, names=list(files.keys()))
        else:
            with jobs_lock:
                jobs[job_id].update(status="error", error=(proc.stderr or "").strip()[-400:])
    except Exception as exc:  # noqa: BLE001
        with jobs_lock:
            jobs[job_id].update(status="error", error=f"{type(exc).__name__}: {exc}")
    finally:
        if os.path.exists(ass_path):
            os.remove(ass_path)


def run_thumbs(job_id: str, url: str, timestamps: list, variants: bool = False) -> None:
    """Extract one frame per timestamp. faststart mp4 + range-capable CDN makes
    -ss on a URL input a near-instant HTTP seek, so frames run in parallel.
    variants=True additionally emits 320/480/640w WebP for each frame."""
    files: dict = {}
    errors: list = []
    lock = threading.Lock()

    def grab(i: int, ts: float) -> None:
        out = os.path.join(DIR, f"{job_id}-t{i}.jpg")
        # ts=0 means a still-image source; -ss 0 yields zero frames for
        # some image demuxers (jpg), so seek only when entering a video
        cmd = ["ffmpeg", "-y"]
        if ts > 0:
            cmd += ["-ss", str(ts)]
        cmd += ["-i", url, "-frames:v", "1",
                "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", out]
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if p.returncode != 0 or not os.path.exists(out):
            with lock:
                errors.append(f"t{i}: {(p.stderr or '')[-200:]}")
            return
        with lock:
            files[f"t{i}.jpg"] = out
        if variants:
            for w in (320, 480, 640):
                vout = os.path.join(DIR, f"{job_id}-t{i}-{w}w.webp")
                vp = subprocess.run(
                    ["ffmpeg", "-y", "-i", out, "-vf", f"scale={w}:-2", "-quality", "82", vout],
                    capture_output=True, text=True, timeout=60)
                if vp.returncode == 0 and os.path.exists(vout):
                    with lock:
                        files[f"t{i}-{w}w.webp"] = vout

    threads = [threading.Thread(target=grab, args=(i, float(ts))) for i, ts in enumerate(timestamps)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    with jobs_lock:
        if files:
            jobs[job_id].update(status="done", files=files, names=list(files.keys()))
        else:
            jobs[job_id].update(status="error", error="; ".join(errors) or "no frames produced")


def run_mux(job_id: str, video_url: str, audio_url: str) -> None:
    """Replace a video's audio track (dubbing mux). Streams both inputs."""
    out_path = os.path.join(DIR, f"{job_id}.mp4")
    try:
        cmd = ["ffmpeg", "-y", "-i", video_url, "-i", audio_url,
               "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
               "-shortest", "-movflags", "+faststart", out_path]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        if proc.returncode == 0 and os.path.exists(out_path):
            with jobs_lock:
                jobs[job_id].update(status="done", file=out_path, ext="mp4")
        else:
            with jobs_lock:
                jobs[job_id].update(status="error", error=(proc.stderr or "").strip()[-400:])
    except Exception as exc:  # noqa: BLE001
        with jobs_lock:
            jobs[job_id].update(status="error", error=f"{type(exc).__name__}: {exc}")


def run_split(job_id: str, url: str, seconds: int) -> None:
    """Split long audio into segments (stream copy, no re-encode) for
    chunked ASR. Returns per-segment durations for exact word offsets."""
    try:
        pattern = os.path.join(DIR, f"{job_id}.seg%03d.m4a")
        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", url, "-f", "segment", "-segment_time", str(seconds),
             "-c", "copy", "-reset_timestamps", "1", pattern],
            capture_output=True, text=True, timeout=1200,
        )
        if proc.returncode != 0:
            with jobs_lock:
                jobs[job_id].update(status="error", error=(proc.stderr or "").strip()[-300:])
            return
        files = {}
        durations = []
        names = sorted(n for n in os.listdir(DIR) if n.startswith(f"{job_id}.seg"))
        for name in names:
            path = os.path.join(DIR, name)
            short = name.split(".", 1)[1]  # seg000.m4a
            files[short] = path
            dp = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "csv=p=0", path],
                capture_output=True, text=True, timeout=60,
            )
            try:
                durations.append(float(dp.stdout.strip()))
            except ValueError:
                durations.append(float(seconds))
        with jobs_lock:
            jobs[job_id].update(status="done", files=files, names=sorted(files.keys()), durations=durations)
    except subprocess.TimeoutExpired:
        with jobs_lock:
            jobs[job_id].update(status="error", error="split timeout")
    except Exception as exc:  # noqa: BLE001
        with jobs_lock:
            jobs[job_id].update(status="error", error=f"{type(exc).__name__}: {exc}")


def cleanup_loop() -> None:
    while True:
        now = time.time()
        for name in os.listdir(DIR):
            path = os.path.join(DIR, name)
            try:
                if now - os.path.getmtime(path) > MAX_AGE_SEC:
                    os.remove(path)
            except OSError:
                pass
        time.sleep(1800)


class Handler(BaseHTTPRequestHandler):
    server_version = "ytdlp-svc/1.0"

    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self) -> bool:
        return TOKEN and self.headers.get("Authorization", "") == f"Bearer {TOKEN}"

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            return self._send(200, {"ok": True})
        if self.path == "/debug":
            if not self._authed():
                return self._send(401, {"error": "unauthorized"})
            with jobs_lock:
                dump = {k: {kk: vv for kk, vv in v.items() if kk not in ("file", "files")} for k, v in jobs.items()}
            return self._send(200, {"jobs": dump, "proxies": len(PROXIES)})
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})

        m = re.match(r"^/jobs/([a-f0-9-]+)$", self.path)
        if m:
            with jobs_lock:
                job = jobs.get(m.group(1))
            if not job:
                return self._send(404, {"error": "unknown job"})
            public = {k: v for k, v in job.items() if k not in ("file", "files")}
            public["has_file"] = bool(job.get("file"))
            return self._send(200, public)

        m = re.match(r"^/files/([a-f0-9-]+)(?:\?name=([\w.-]+))?$", self.path)
        if m:
            with jobs_lock:
                job = jobs.get(m.group(1))
            name = m.group(2)
            if job and name and job.get("files"):
                path = job["files"].get(name)
            else:
                path = job.get("file") if job else None
            if not path or not os.path.exists(path):
                return self._send(404, {"error": "no file"})
            ctype = ("image/jpeg" if path.endswith(".jpg") else "image/webp" if path.endswith(".webp") else "video/mp4" if path.endswith(".mp4") else "audio/mp4" if path.endswith((".m4a", ".mp4a")) else "audio/webm" if path.endswith(".webm") else "audio/ogg")
            size = os.path.getsize(path)
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(size))
            self.end_headers()
            with open(path, "rb") as fh:
                shutil.copyfileobj(fh, self.wfile)
            return None

        return self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})
        if self.path == "/probe":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._send(400, {"error": "bad JSON"})
            if not re.match(r"^https?://", payload.get("url", "")):
                return self._send(400, {"error": "valid url required"})
            return self._send(200, probe_video(payload["url"], payload.get("cookies")))
        if self.path == "/playlist":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._send(400, {"error": "bad JSON"})
            if not re.match(r"^https?://", payload.get("url", "")):
                return self._send(400, {"error": "valid url required"})
            threading.Thread(target=maybe_self_update, daemon=True).start()
            return self._send(200, enumerate_playlist(payload["url"], payload.get("cookies")))
        if self.path == "/clip":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._send(400, {"error": "bad JSON"})
            if not re.match(r"^https?://", payload.get("url", "")):
                return self._send(400, {"error": "valid url required"})
            job_id = str(uuid.uuid4())
            with jobs_lock:
                jobs[job_id] = {"status": "running", "kind": "clip"}
            threading.Thread(target=run_clip, args=(job_id, payload), daemon=True).start()
            return self._send(200, {"id": job_id})
        if self.path == "/audioclip":
            # Synchronous window clip for audio-in-the-loop translation:
            # cut [start, start+dur] from the source, downmix to 16 kHz mono
            # mp3 (small enough to inline into an LLM request), return base64.
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._send(400, {"error": "bad JSON"})
            if not re.match(r"^https?://", payload.get("url", "")):
                return self._send(400, {"error": "valid url required"})
            try:
                start = max(0.0, float(payload.get("start") or 0))
                dur = min(480.0, max(1.0, float(payload.get("dur") or 0)))
            except (TypeError, ValueError):
                return self._send(400, {"error": "start/dur required"})
            proc = subprocess.run(
                ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(dur),
                 "-i", payload["url"], "-vn", "-ac", "1", "-ar", "16000",
                 "-b:a", "32k", "-f", "mp3", "pipe:1"],
                capture_output=True, timeout=180,
            )
            if proc.returncode != 0 or not proc.stdout:
                return self._send(502, {"error": (proc.stderr or b"").decode()[-200:] or "empty clip"})
            import base64 as _b64
            return self._send(200, {"b64": _b64.b64encode(proc.stdout).decode(), "bytes": len(proc.stdout)})
        if self.path == "/split":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._send(400, {"error": "bad JSON"})
            if not re.match(r"^https?://", payload.get("url", "")):
                return self._send(400, {"error": "valid url required"})
            job_id = str(uuid.uuid4())
            with jobs_lock:
                jobs[job_id] = {"status": "running", "kind": "split"}
            threading.Thread(target=run_split, args=(job_id, payload["url"], int(payload.get("seconds") or 2700)), daemon=True).start()
            return self._send(200, {"id": job_id})
        if self.path == "/mux":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._send(400, {"error": "bad JSON"})
            if not all(re.match(r"^https?://", payload.get(k, "")) for k in ("video_url", "audio_url")):
                return self._send(400, {"error": "video_url and audio_url required"})
            job_id = str(uuid.uuid4())
            with jobs_lock:
                jobs[job_id] = {"status": "running", "kind": "mux"}
            threading.Thread(target=run_mux, args=(job_id, payload["video_url"], payload["audio_url"]), daemon=True).start()
            return self._send(200, {"id": job_id})
        if self.path == "/grade":
            # Deterministic v2 brand re-grade: neutralize golden/sepia cast +
            # warm rim glow (verified filter chain), preserve likeness exactly.
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._send(400, {"error": "bad JSON"})
            g_url = payload.get("url", "")
            if not re.match(r"^https?://", g_url):
                return self._send(400, {"error": "valid url required"})
            if payload.get("canvas"):
                # Outpaint prep: flatten any alpha onto light gray (transparent
                # inputs make the edit model paint glows/ghosts), scale to fit
                # 1536x1024 bottom-center with exact integer geometry, pad the
                # rest transparent. Placement goes back in headers so the
                # worker can composite the ORIGINAL pixels over the outpaint.
                pr = subprocess.run(
                    ["ffprobe", "-v", "error", "-select_streams", "v",
                     "-show_entries", "stream=width,height", "-of", "csv=p=0", g_url],
                    capture_output=True, text=True, timeout=60)
                try:
                    w, h = map(int, pr.stdout.strip().split(","))
                except ValueError:
                    return self._send(500, {"error": "probe failed"})
                cw, ch = int(w * 920 / h) // 2 * 2, 920
                if cw > 1400:
                    cw, ch = 1400, int(h * 1400 / w) // 2 * 2
                ox, oy = (1536 - cw) // 2, 1024 - ch
                out = os.path.join(DIR, f"canvas-{uuid.uuid4()}.png")
                proc = subprocess.run(
                    ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=0xF2F2F2:s={w}x{h}",
                     "-i", g_url, "-filter_complex",
                     f"[0][1]overlay=0:0:format=auto,scale={cw}:{ch},format=rgba,"
                     f"pad=1536:1024:{ox}:{oy}:color=black@0",
                     "-frames:v", "1", out], capture_output=True, text=True, timeout=120)
                if proc.returncode != 0 or not os.path.exists(out):
                    return self._send(500, {"error": (proc.stderr or "canvas failed")[-300:]})
                size = os.path.getsize(out)
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(size))
                for hk, hv in (("X-Ox", ox), ("X-Oy", oy), ("X-Ow", cw), ("X-Oh", ch)):
                    self.send_header(hk, str(hv))
                self.end_headers()
                with open(out, "rb") as fh:
                    shutil.copyfileobj(fh, self.wfile)
                os.remove(out)
                return None
            if payload.get("overlay_url"):
                # Composite the original photo back over the outpainted scene at
                # the exact canvas placement — the face is never an AI re-render.
                ov = payload["overlay_url"]
                if not re.match(r"^https?://", ov):
                    return self._send(400, {"error": "valid overlay_url required"})
                try:
                    ox, oy = int(payload["ox"]), int(payload["oy"])
                    ow, ohh = int(payload["ow"]), int(payload["oh"])
                except (KeyError, ValueError):
                    return self._send(400, {"error": "ox/oy/ow/oh required"})
                out = os.path.join(DIR, f"comp-{uuid.uuid4()}.png")
                proc = subprocess.run(
                    ["ffmpeg", "-y", "-v", "error", "-i", g_url, "-i", ov, "-filter_complex",
                     f"[1]scale={ow}:{ohh},format=rgba[m];[0][m]overlay={ox}:{oy}:format=auto",
                     "-frames:v", "1", out], capture_output=True, text=True, timeout=120)
                if proc.returncode != 0 or not os.path.exists(out):
                    return self._send(500, {"error": (proc.stderr or "composite failed")[-300:]})
                size = os.path.getsize(out)
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(size))
                self.end_headers()
                with open(out, "rb") as fh:
                    shutil.copyfileobj(fh, self.wfile)
                os.remove(out)
                return None
            want_webp = payload.get("out") == "webp"
            out = os.path.join(DIR, f"grade-{uuid.uuid4()}." + ("webp" if want_webp else "png"))
            src = g_url
            chain = payload.get("filter")
            if payload.get("keyauto"):
                # Chroma-key whatever flat background color the generator painted:
                # sample a corner pixel and key on it. Pure ffmpeg (urllib hangs
                # behind the container's proxy env; ffmpeg fetches URLs directly).
                probe = subprocess.run(
                    ["ffmpeg", "-v", "error", "-i", g_url, "-vf", "crop=1:1:4:4,format=rgb24",
                     "-f", "rawvideo", "-"], capture_output=True, timeout=60)
                rgb = probe.stdout[:3]
                if len(rgb) == 3:
                    # Full deterministic finish: chroma key -> 3px fringe shave ->
                    # bottom alpha fade (last 10%) -> transparent side/top pad.
                    # Geometry never trusts the model; expressions need no dims.
                    # Clean cutout only: chroma key + fringe erosion. No fades,
                    # no padding — the card edge crops naturally (user decision).
                    # 0.25 similarity keyed holes into pink-ish ghutra weave; the bg is
                    # flat pure magenta so a tight key clears it fully
                    chain = (f"colorkey=0x{rgb.hex().upper()}:0.10:0.08,format=rgba,"
                             "split[c][a];[a]alphaextract,erosion,erosion,erosion[sh];[c][sh]alphamerge")
            if not chain:
                chain = (
                     "colortemperature=temperature=10000:mix=0.9,"
                     "huesaturation=saturation=-0.85:colors=y+r+m:strength=10,"
                     "eq=saturation=0.55:brightness=-0.015:contrast=1.05")
            enc = ["-c:v", "libwebp", "-q:v", "85", "-pix_fmt", "yuva420p"] if want_webp else []
            proc = subprocess.run(["ffmpeg", "-y", "-i", src, "-vf", chain, *enc, out],
                                  capture_output=True, text=True, timeout=120)
            if proc.returncode != 0 or not os.path.exists(out):
                return self._send(500, {"error": (proc.stderr or "grade failed")[-300:]})
            size = os.path.getsize(out)
            self.send_response(200)
            self.send_header("Content-Type", "image/webp" if want_webp else "image/png")
            self.send_header("Content-Length", str(size))
            self.end_headers()
            with open(out, "rb") as fh:
                shutil.copyfileobj(fh, self.wfile)
            os.remove(out)
            return None
        if self.path == "/thumbs":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, json.JSONDecodeError):
                return self._send(400, {"error": "bad JSON"})
            t_url = payload.get("url", "")
            if not re.match(r"^https?://", t_url):
                return self._send(400, {"error": "valid url required"})
            timestamps = payload.get("timestamps") or [30]
            job_id = str(uuid.uuid4())
            with jobs_lock:
                jobs[job_id] = {"status": "running", "kind": "thumbs"}
            threading.Thread(
                target=run_thumbs,
                args=(job_id, t_url, timestamps, bool(payload.get("variants"))),
                daemon=True,
            ).start()
            return self._send(200, {"id": job_id})
        if self.path != "/download":
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"error": "bad JSON"})
        url = payload.get("url", "")
        if not re.match(r"^https?://", url):
            return self._send(400, {"error": "valid url required"})
        job_id = str(uuid.uuid4())
        with jobs_lock:
            jobs[job_id] = {"status": "running", "url": url}
        threading.Thread(target=run_download, args=(job_id, url, payload.get("cookies"), bool(payload.get("video")), payload.get("proxy") or None, payload.get("aria2", True), payload.get("player_client")), daemon=True).start()
        return self._send(200, {"id": job_id})

    def do_DELETE(self):  # noqa: N802
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})
        m = re.match(r"^/files/([a-f0-9-]+)$", self.path)
        if not m:
            return self._send(404, {"error": "not found"})
        with jobs_lock:
            job = jobs.pop(m.group(1), None)
        paths = []
        if job:
            if job.get("file"):
                paths.append(job["file"])
            paths.extend((job.get("files") or {}).values())
        for pth in paths:
            try:
                if os.path.exists(pth):
                    os.remove(pth)
            except OSError:
                pass
        return self._send(200, {"ok": True})

    def log_message(self, fmt, *args):  # quiet default access log
        pass


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("YTDLP_TOKEN is required")
    threading.Thread(target=maybe_self_update, daemon=True).start()  # latest yt-dlp on boot
    threading.Thread(target=cleanup_loop, daemon=True).start()
    print(f"ytdlp-svc listening on :{PORT}, proxies: {len(PROXIES)}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
