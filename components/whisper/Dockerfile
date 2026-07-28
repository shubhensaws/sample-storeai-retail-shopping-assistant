FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir faster-whisper numpy aiohttp "PyJWT[crypto]"

# Bake the large-v3 weights at build time (from a non-throttled IP). The cluster
# NAT IP gets throttled by HuggingFace on large pulls, so a runtime download is
# unreliable — this makes the image self-contained (D-038 pattern).
ENV HF_HOME=/models/hf HF_HUB_DISABLE_XET=1
RUN python3 -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-large-v3')"

WORKDIR /app
COPY whisper_server.py ./
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["python3", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8765/whisper/health', timeout=3).status==200 else 1)"]
CMD ["python3", "whisper_server.py"]
