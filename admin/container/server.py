#!/usr/bin/env python3
"""yt-dlp helper service for the DeenSubs Scribe pipeline.

Runs inside a Cloudflare Container, reached only through the Worker's
Durable Object binding (never exposed publicly). Downloads are attempted
directly first, then retried through each configured SOCKS proxy.
Audio is extracted to opus via ffmpeg to keep transfers small.
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

import json
import os
import re
import shutil
import subprocess
import threading
import time
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


def run_download(job_id: str, url: str, cookies: str | None = None, video: bool = False) -> None:
    maybe_self_update()
    out_tmpl = os.path.join(DIR, f"{job_id}.%(ext)s")
    cookies_file = None
    if cookies:
        cookies_file = os.path.join(DIR, f"{job_id}.cookies.txt")
        with open(cookies_file, "w") as fh:
            fh.write(cookies)
    attempts = PROXIES + [None]  # proxy first: YouTube throttles datacenter IPs
    last_err = "no attempts"
    for proxy in attempts:
        if video:
            # h264 first (universal browser decode; ext=mp4 alone can grab AV1),
            # faststart so moov leads and CDN playback/seek starts instantly
            fmt = ["-f", "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*[height<=1080]+ba/b",
                   "--merge-output-format", "mp4",
                   "--remux-video", "mp4",
                   "--ppa", "Merger:-movflags +faststart",
                   "--ppa", "VideoRemuxer:-movflags +faststart"]
        else:
            # Native audio stream, no re-encode: ffmpeg conversion of long
            # lectures crawls on fractional vCPUs and ElevenLabs accepts
            # m4a/webm/opus directly.
            fmt = ["-f", "bestaudio[ext=m4a]/bestaudio/best"]
        cmd = [
            "yt-dlp",
            "--no-playlist",
            "--socket-timeout", "30",
            "--retries", "3",
            "-N", "4",
            "--newline",
            "--progress-template", "download:PROG %(progress._percent_str)s",
            *fmt,
            "-o", out_tmpl,
            "--print-json",
            url,
        ]
        if cookies_file:
            cmd[1:1] = ["--cookies", cookies_file]
        if proxy:
            cmd[1:1] = ["--proxy", proxy]
        label = proxy or "direct"
        with jobs_lock:
            jobs[job_id]["attempts"] = jobs[job_id].get("attempts", []) + [label]
            jobs[job_id]["pct"] = 0.0
        try:
            info = {}
            tail: list = []
            # stderr merged into stdout: separate pipes deadlock once the
            # stderr buffer fills during ffmpeg post-processing.
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            deadline = time.time() + 1800
            threading.Timer(1800, lambda: proc.poll() is None and proc.kill()).start()
            for line in proc.stdout:  # type: ignore[union-attr]
                if time.time() > deadline:
                    proc.kill()
                    raise subprocess.TimeoutExpired(cmd, 1800)
                line = line.strip()
                if line.startswith("PROG "):
                    try:
                        pct = float(line.split()[-1].rstrip("%"))
                        with jobs_lock:
                            jobs[job_id]["pct"] = pct
                    except ValueError:
                        pass
                elif line.startswith("{"):
                    try:
                        info = json.loads(line)
                    except json.JSONDecodeError:
                        pass
                elif line:
                    tail.append(line)
                    if len(tail) > 12:
                        tail.pop(0)
                if line:
                    with jobs_lock:
                        jobs[job_id]["last"] = line[:200]
            stderr = "\n".join(tail)
            proc.wait(timeout=120)
            if proc.returncode == 0:
                produced = None
                for name in os.listdir(DIR):
                    if name.startswith(job_id + ".") and not name.endswith(".cookies.txt"):
                        produced = os.path.join(DIR, name)
                        break
                if not produced:
                    last_err = "yt-dlp succeeded but no output file found"
                    continue
                if cookies_file and os.path.exists(cookies_file):
                    os.remove(cookies_file)
                with jobs_lock:
                    jobs[job_id].update(
                        status="done",
                        pct=100.0,
                        file=produced,
                        ext=produced.rsplit(".", 1)[-1],
                        title=info.get("title", ""),
                        channel=info.get("uploader", "") or info.get("channel", ""),
                        thumbnail=info.get("thumbnail", ""),
                        duration=info.get("duration", 0),
                        via=label,
                    )
                return
            last_err = (stderr or "").strip()[-400:] or f"exit {proc.returncode}"
        except subprocess.TimeoutExpired:
            last_err = f"timeout via {label}"
        except Exception as exc:  # noqa: BLE001
            last_err = f"{type(exc).__name__}: {exc}"
    if cookies_file and os.path.exists(cookies_file):
        os.remove(cookies_file)
    with jobs_lock:
        jobs[job_id].update(status="error", error=last_err)


def probe_video(url: str, cookies: str | None) -> dict:
    """Fast metadata probe (no download): title, channel, duration, thumbnail."""
    cookies_file = None
    if cookies:
        cookies_file = os.path.join(DIR, f"probe-{uuid.uuid4()}.cookies.txt")
        with open(cookies_file, "w") as fh:
            fh.write(cookies)
    try:
        attempts = PROXIES + [None]
        last_err = "no attempts"
        for proxy in attempts:
            cmd = ["yt-dlp", "-J", "--no-playlist", "--skip-download", "--socket-timeout", "15", url]
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
        vf = (
            "[0:v]split=2[bg][fg];"
            "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
            "boxblur=22:3,eq=brightness=-0.18:saturation=0.85[bgb];"
            "[fg]scale=1080:-2[fgs];"
            "[bgb][fgs]overlay=(W-w)/2:(H-h)/2:format=auto[base];"
            f"[base]ass={ass_path}:fontsdir=/usr/share/fonts/custom[subbed];"
            f"[subbed]drawbox=x=0:y=ih-16:w=iw*min(t/{dur:.3f}\\,1):h=16:color=0x45b3a2@0.95:t=fill[out]"
        )
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start), "-to", str(end), "-i", url,
            "-filter_complex", vf,
            "-map", "[out]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            "-t", str(dur),
            out_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
        if proc.returncode == 0 and os.path.exists(out_path):
            with jobs_lock:
                jobs[job_id].update(status="done", file=out_path, ext="mp4")
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
        p = subprocess.run(
            ["ffmpeg", "-y", "-ss", str(ts), "-i", url, "-frames:v", "1",
             "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", out],
            capture_output=True, text=True, timeout=120)
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
            maybe_self_update()
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
            out = os.path.join(DIR, f"grade-{uuid.uuid4()}.png")
            chain = ("colortemperature=temperature=10000:mix=0.9,"
                     "huesaturation=saturation=-0.85:colors=y+r+m:strength=10,"
                     "eq=saturation=0.55:brightness=-0.015:contrast=1.05")
            proc = subprocess.run(["ffmpeg", "-y", "-i", g_url, "-vf", chain, out],
                                  capture_output=True, text=True, timeout=120)
            if proc.returncode != 0 or not os.path.exists(out):
                return self._send(500, {"error": (proc.stderr or "grade failed")[-300:]})
            size = os.path.getsize(out)
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
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
        threading.Thread(target=run_download, args=(job_id, url, payload.get("cookies"), bool(payload.get("video"))), daemon=True).start()
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
