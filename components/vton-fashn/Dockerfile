# FASHN VTON v1.5 GPU server. Base already has torch+CUDA (amd64) so the build
# only installs wheels (fashn deps incl. onnxruntime-gpu). Weights are pulled at
# startup from HuggingFace (fashn-ai/fashn-vton-1.5) by entrypoint.sh.
FROM pytorch/pytorch:2.4.1-cuda12.4-cudnn9-runtime

WORKDIR /app
ENV WEIGHTS_DIR=/weights \
    HF_HOME=/weights/hf \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Open FASHN inference package (Apache-2.0). pip install -e . brings diffusers,
# transformers, onnxruntime-gpu (pose), opencv, safetensors, huggingface_hub, etc.
RUN git clone --depth 1 https://github.com/fashn-AI/fashn-vton-1.5.git /app/fashn \
    && pip install -e /app/fashn

# Pin transformers < 5.14: transformers 5.14.0+ unconditionally imports
# `torch.distributed.tensor.DTensor`, which is only public in torch >= 2.5 (this
# base image is torch 2.4.1). Unpinned, pip pulled the day-of-release 5.14.1 and
# the weight-download step below failed with "cannot import name 'DTensor'".
# Constraining to < 5.14 restores the previously-working resolution on torch 2.4.
RUN pip install "transformers<5.14"

RUN pip install fastapi "uvicorn[standard]" python-multipart pillow

# The FASHN pipeline imports OpenCV (cv2). Use the headless build (no X/GUI deps)
# and add the few runtime libs it still needs, so cv2 imports on the slim base.
# Placed AFTER the heavy install so the cached layers above are reused on rebuild.
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && (pip uninstall -y opencv-python opencv-contrib-python || true) \
    && pip install opencv-python-headless \
    && (pip uninstall -y onnxruntime-gpu || true) \
    && pip install onnxruntime

# Bake the weights at build time (from a non-throttled IP). The cluster NAT IP
# gets hard-throttled by HuggingFace on large pulls, so a runtime download is
# unreliable — baking makes the image self-contained + reproducible (~2.3GB):
#   /weights/model.safetensors (+ dwpose/) and the human parser in HF_HOME.
RUN cd /app/fashn && python scripts/download_weights.py --weights-dir /weights \
    && python -c "from huggingface_hub import snapshot_download; snapshot_download('fashn-ai/fashn-human-parser')"

COPY server.py entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh

EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8081/health', timeout=3).status==200 else 1)"]
CMD ["/app/entrypoint.sh"]
