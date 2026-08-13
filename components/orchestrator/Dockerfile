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

# Single worker: in-flight conversation state is per-process (LangGraph MemorySaver in
# app/main.py), so a second worker answers turns it has no state for. replicas is 1 for
# the same reason (deploy/config/defaults.json). Wire the DynamoDB checkpointer before
# scaling either one out; see docs/known-limitations.md.
# Keep-alive sits just above the ALB idle timeout set on the Ingress
# (idle_timeout.timeout_seconds=200), so the load balancer always closes an idle
# connection first. If the server closed first, the ALB could reuse a connection the
# server had already dropped and return 502.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--timeout-keep-alive", "205"]
