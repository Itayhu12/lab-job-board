# ── Applications Service Dockerfile ──────────────────────────────────────────
# Hardened: non-root user, pinned base, minimal layers, healthcheck

FROM node:20-alpine

LABEL maintainer="lab-student" \
      service="applications-service"

ENV NODE_ENV=production \
    PORT=3001

WORKDIR /app

# Copy manifests first (better layer caching)
COPY package*.json ./

# Install production deps only in a single RUN layer
RUN npm install --omit=dev && \
    npm cache clean --force

# Copy source
COPY index.js .

# Non-root user
RUN addgroup -S appgroup && \
    adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3001/health || exit 1

CMD ["node", "index.js"]
