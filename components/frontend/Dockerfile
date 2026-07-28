# Static export served by lightweight nginx (for EKS/container deployment)
# For CloudFront+S3 deployment, skip this and upload out/ directly.
FROM public.ecr.aws/docker/library/nginx:alpine
COPY out/ /usr/share/nginx/html/
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 3000;
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files $uri $uri.html $uri/ /index.html;
    }
}
EOF
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/ || exit 1
