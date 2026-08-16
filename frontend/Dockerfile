# ── Frontend Dockerfile (Multi-stage build) ────────────────────────────────
# Stage 1: Build React app with Vite
# Stage 2: Serve with Nginx (non-root, minimal image)

# --- Build Stage ---
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# --- Production Stage ---
FROM nginx:1.27-alpine

LABEL maintainer="lab-student" \
      service="frontend"

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx config for SPA routing
COPY nginx-spa.conf /etc/nginx/conf.d/default.conf

# Problem 5 fix: pre-create nginx runtime dirs and chown to nginx user
# (non-root user cannot create these at startup — Permission denied on /var/cache/nginx)
RUN mkdir -p /var/cache/nginx/client_temp \
             /var/cache/nginx/proxy_temp \
             /var/cache/nginx/fastcgi_temp \
             /var/cache/nginx/uwsgi_temp \
             /var/cache/nginx/scgi_temp \
    && chown -R nginx:nginx /var/cache/nginx \
    && chown -R nginx:nginx /var/log/nginx \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid

# Switch to non-root user AFTER fixing ownership
USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
