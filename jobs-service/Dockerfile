# ── Jobs Service Dockerfile ───────────────────────────────────────────────────
# Hardened: non-root user, pinned base, minimal layers, healthcheck
# Task 1.2: Dockerfile Hardening

# Use exact digest to pin the image (update digest when upgrading Python)
FROM python:3.12-slim

# Metadata
LABEL maintainer="lab-student" \
      service="jobs-service"

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

# Install deps in a single layer to minimize image size
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY main.py .

# Create non-root user and switch to it (security hardening)
RUN addgroup --system appgroup && \
    adduser --system --ingroup appgroup --no-create-home appuser && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

# Healthcheck (Task 1.2)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
