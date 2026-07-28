FROM public.ecr.aws/docker/library/python:3.12-slim
WORKDIR /app
COPY server.py requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
EXPOSE 8505
USER 10001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import socket; socket.create_connection(('127.0.0.1', 8505), timeout=3)"]
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8505"]
