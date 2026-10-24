# Auralink cabin hub, built for a persistent Linux host (e.g. an Oracle Cloud Always Free Ampere
# A1 VM). AURALINK_LIVE_ASSIST is off here: that feature needs mlx-lm, which only ships wheels for
# Apple Silicon macOS (see requirements-linux.txt and engine/assist.py's available() check).

# web/out (the Next.js static export) is committed to the repo already, so no Node build stage
# is needed here. If you change anything under web/app, run `cd web && npm run build` locally
# first and commit the refreshed web/out before rebuilding this image.
FROM python:3.12-slim
WORKDIR /app

# espeak-ng: required by phonemizer for the accent-aware phonetic matcher and by Kokoro TTS.
RUN apt-get update && apt-get install -y --no-install-recommends \
    espeak-ng curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-linux.txt ./
RUN pip install --no-cache-dir -r requirements-linux.txt

COPY engine/ engine/
COPY hub/ hub/
COPY apps/ apps/
COPY data/ data/
COPY web/out/ web/out/
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV HOST=0.0.0.0 \
    PORT=8000 \
    AURALINK_LIVE_ASSIST=0 \
    AURALINK_PRELOAD_ASR=1

EXPOSE 8000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "hub.main:app", "--host", "0.0.0.0", "--port", "8000"]
