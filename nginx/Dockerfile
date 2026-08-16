# ── Nginx Reverse Proxy Dockerfile ───────────────────────────────────────────
FROM nginx:1.27-alpine

LABEL maintainer="lab-student" \
      service="nginx-proxy"

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:80/health/jobs || exit 1

CMD ["nginx", "-g", "daemon off;"]
