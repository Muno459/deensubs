# yt-dlp + ffmpeg helper for the Scribe pipeline (Cloudflare Container).
# Based on the maintained jauderho/yt-dlp alpine image (yt-dlp + ffmpeg +
# python preinstalled, rebuilt upstream on every yt-dlp release).
# server.py self-updates yt-dlp on boot and every 12h.
FROM jauderho/yt-dlp:latest

# Fonts for the clip renderer: Geist for Latin captions/titles,
# Noto Naskh Arabic for Arabic text in ASS subtitles.
RUN apk add --no-cache aria2 fontconfig font-noto font-noto-naskh-arabic font-inter font-noto-emoji \
  && mkdir -p /usr/share/fonts/custom
COPY fonts/*.ttf /usr/share/fonts/custom/
RUN fc-cache -f

COPY server.py /opt/server.py
RUN mkdir -p /data
ENV YTDLP_DIR=/data
EXPOSE 8199

ENTRYPOINT []
CMD ["python3", "/opt/server.py"]
