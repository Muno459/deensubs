#!/usr/bin/env python3
"""DeenSubs 4K single-file encoder — macOS (Apple Silicon) + Windows.

Takes a YouTube URL (downloads the best <=4K source locally with yt-dlp) or a
local/remote video file, and produces ONE highest-quality 4K HEVC MP4
(hvc1 tag so Safari/iOS play it, +faststart so CDN playback seeks instantly).
Hardware encoders only — VideoToolbox on Apple Silicon, NVENC/QSV/AMF on
Windows — so a 2-hour lecture encodes in minutes, not hours.

Usage:
  python3 encode-4k.py "https://youtube.com/watch?v=..."          # download + encode
  python3 encode-4k.py lecture.webm                               # encode a local file
  python3 encode-4k.py "https://cdn.deensubs.com/scribe/<id>/source-4k.webm"
  python3 encode-4k.py <input> --job ab12cd34ef                   # name output scribe/<job>/source-4k.mp4
  python3 encode-4k.py <input> --upload                           # push to R2 after encoding

Requirements: ffmpeg + ffprobe on PATH (mac: `brew install ffmpeg`,
win: `winget install ffmpeg`). YouTube input needs yt-dlp
(`brew install yt-dlp` / `winget install yt-dlp`). Upload needs either an
rclone remote named `r2` (recommended for multi-GB files) or wrangler.
"""
import argparse
import json
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BUCKET = 'deensubs-media-weur'


def die(msg: str) -> None:
    print(f'ERROR: {msg}', file=sys.stderr)
    sys.exit(1)


def need(tool: str, hint: str) -> None:
    if not shutil.which(tool):
        die(f'{tool} not found on PATH. Install it: {hint}')


def probe(path: str) -> dict:
    r = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
         'stream=width,height,pix_fmt,codec_name,r_frame_rate', '-show_entries',
         'format=duration', '-of', 'json', path],
        capture_output=True, text=True)
    if r.returncode != 0:
        die(f'ffprobe failed: {r.stderr.strip()[:200]}')
    j = json.loads(r.stdout)
    s = j['streams'][0]
    return {
        'w': int(s['width']), 'h': int(s['height']),
        'pix_fmt': s.get('pix_fmt', 'yuv420p'),
        'codec': s.get('codec_name', '?'),
        'dur': float(j.get('format', {}).get('duration', 0) or 0),
    }


def download_youtube(url: str, workdir: Path) -> Path:
    need('yt-dlp', 'brew install yt-dlp  /  winget install yt-dlp')
    out = workdir / 'source.%(ext)s'
    # Best video up to 2160p regardless of codec (4K on YouTube is VP9/AV1
    # only) + best audio, merged to mkv so any codec pair is accepted.
    r = subprocess.run(
        ['yt-dlp', '--no-playlist', '-f',
         'bv*[height<=2160]+ba/b[height<=2160]/b',
         '--merge-output-format', 'mkv', '-o', str(out), url])
    if r.returncode != 0:
        die('yt-dlp download failed')
    files = sorted(workdir.glob('source.*'))
    if not files:
        die('yt-dlp reported success but produced no file')
    return files[0]


def pick_encoder() -> tuple[str, list[str]]:
    """Return (encoder_name, quality_args) for the best hardware HEVC encoder."""
    r = subprocess.run(['ffmpeg', '-hide_banner', '-encoders'], capture_output=True, text=True)
    encoders = r.stdout
    system = platform.system()
    if system == 'Darwin' and 'hevc_videotoolbox' in encoders:
        # -q:v is VideoToolbox constant quality 1-100; 62 lands ~12-18 Mbps
        # for detailed 2160p lecture footage — visually transparent.
        return 'hevc_videotoolbox', ['-q:v', '62', '-allow_sw', '1']
    if system == 'Windows':
        for enc, args in (
            ('hevc_nvenc', ['-preset', 'p6', '-rc', 'vbr', '-cq', '22', '-b:v', '0']),
            ('hevc_qsv', ['-global_quality', '22', '-preset', 'slower']),
            ('hevc_amf', ['-quality', 'quality', '-rc', 'cqp', '-qp_i', '22', '-qp_p', '24']),
        ):
            if enc in encoders:
                return enc, args
    if 'libx265' in encoders:
        print('WARNING: no hardware HEVC encoder found — falling back to libx265 '
              '(software, MUCH slower: expect ~realtime or worse for 4K).')
        return 'libx265', ['-crf', '20', '-preset', 'medium']
    die('no HEVC encoder available in this ffmpeg build')
    raise AssertionError


def encode(src: Path, dst: Path) -> None:
    info = probe(str(src))
    print(f"source: {info['w']}x{info['h']} {info['codec']} {info['pix_fmt']} "
          f"{info['dur']/60:.1f} min")
    enc, qargs = pick_encoder()
    print(f'encoder: {enc}')
    cmd = ['ffmpeg', '-y', '-i', str(src), '-c:v', enc, *qargs]
    ten_bit = '10' in info['pix_fmt']
    if ten_bit and enc in ('hevc_nvenc', 'hevc_qsv'):
        cmd += ['-profile:v', 'main10']
    elif not ten_bit and enc != 'libx265':
        cmd += ['-pix_fmt', 'yuv420p']
    # hvc1 (not hev1) or Safari/QuickTime refuse the file outright
    cmd += ['-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '160k',
            '-movflags', '+faststart', str(dst)]
    r = subprocess.run(cmd)
    if r.returncode != 0 or not dst.exists():
        die('encode failed')
    out = probe(str(dst))
    src_mb = src.stat().st_size / 1e6
    dst_mb = dst.stat().st_size / 1e6
    print(f"encoded: {out['w']}x{out['h']} hevc  {dst_mb:.0f} MB "
          f"(source {src_mb:.0f} MB)")


def upload(dst: Path, key: str) -> None:
    target = f'{BUCKET}/{key}'
    if shutil.which('rclone'):
        r = subprocess.run(['rclone', 'listremotes'], capture_output=True, text=True)
        if 'r2:' in r.stdout:
            print(f'uploading via rclone -> {target}')
            if subprocess.run(['rclone', 'copyto', str(dst), f'r2:{target}',
                               '--s3-upload-concurrency', '8']).returncode == 0:
                print(f'UPLOADED https://cdn.deensubs.com/{key}')
                return
            die('rclone upload failed')
    npx = shutil.which('npx') or shutil.which('npx.cmd')
    if npx and dst.stat().st_size < 290 * 1024 * 1024:
        print(f'uploading via wrangler -> {target}')
        if subprocess.run([npx, 'wrangler', 'r2', 'object', 'put', target,
                           '--file', str(dst), '--content-type', 'video/mp4',
                           '--remote']).returncode == 0:
            print(f'UPLOADED https://cdn.deensubs.com/{key}')
            return
        die('wrangler upload failed')
    print(f'\nNo uploader available for a file this size. Configure an rclone '
          f'remote named "r2" (R2 S3 credentials), then run:\n'
          f'  rclone copyto "{dst}" r2:{target}')


def main() -> None:
    ap = argparse.ArgumentParser(description='DeenSubs single-file 4K HEVC encoder')
    ap.add_argument('input', help='YouTube URL, http(s) media URL, or local file')
    ap.add_argument('--job', help='scribe job id — output key becomes scribe/<job>/source-4k.mp4')
    ap.add_argument('--out', help='output file path (default: <input>-4k.mp4 next to input)')
    ap.add_argument('--upload', action='store_true', help='upload the result to R2')
    args = ap.parse_args()

    need('ffmpeg', 'brew install ffmpeg  /  winget install ffmpeg')
    need('ffprobe', 'ships with ffmpeg')

    tmp = Path(tempfile.mkdtemp(prefix='ds4k-'))
    src = args.input
    if 'youtube.com' in src or 'youtu.be' in src:
        srcp = download_youtube(src, tmp)
    elif src.startswith(('http://', 'https://')):
        srcp = Path(src)  # ffmpeg reads URLs directly
    else:
        srcp = Path(src)
        if not srcp.exists():
            die(f'input not found: {srcp}')

    if args.out:
        dst = Path(args.out)
    elif args.job:
        dst = tmp / 'source-4k.mp4'
    else:
        base = Path(str(srcp).split('?')[0]).stem or 'output'
        dst = Path.cwd() / f'{base}-4k.mp4'

    encode(Path(str(srcp)), dst)

    if args.upload or args.job:
        key = f'scribe/{args.job}/source-4k.mp4' if args.job else f'uploads/{dst.name}'
        upload(dst, key)
    else:
        print(f'\ndone: {dst}\n(re-run with --upload, or --job <id> to place it '
              f'at scribe/<id>/source-4k.mp4)')


if __name__ == '__main__':
    main()
