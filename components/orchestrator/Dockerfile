FROM public.ecr.aws/docker/library/python:3.12-slim AS base
WORKDIR /app

COPY pyproject.toml .
COPY app/ app/

RUN pip install --no-cache-dir . && \
    rm -rf /root/.cache/pip

EXPOSE 8080

# Run as non-root (matches the k8s securityContext runAsUser 10001).
USER 10001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/health', timeout=3).status==200 else 1)"]

# Workers=2 for concurrency on Graviton (2 vCPU pod), keep-alive for ALB health checks
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2", "--timeout-keep-alive", "75"]
