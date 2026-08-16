#!/bin/bash
# fix_digests.sh — Pull correct AMD64 digests and update all Dockerfiles
# Run this if you want to re-pin images to exact SHA256 after verifying on your platform.
# By default the Dockerfiles use tags only (safer for cross-platform use).

set -e

echo "=> Pulling images for linux/amd64..."
docker pull --platform linux/amd64 nginx:1.27-alpine
docker pull --platform linux/amd64 python:3.12-slim
docker pull --platform linux/amd64 node:20-alpine

echo "=> Getting amd64 digests..."
NGINX_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' nginx:1.27-alpine | cut -d'@' -f2)
PYTHON_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' python:3.12-slim | cut -d'@' -f2)
NODE_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' node:20-alpine | cut -d'@' -f2)

echo "  nginx:  $NGINX_DIGEST"
echo "  python: $PYTHON_DIGEST"
echo "  node:   $NODE_DIGEST"

echo "=> Patching Dockerfiles..."
find . -name 'Dockerfile' | while read f; do
  sed -i "s|nginx:1.27-alpine|nginx:1.27-alpine@${NGINX_DIGEST}|g" "$f"
  sed -i "s|python:3.12-slim|python:3.12-slim@${PYTHON_DIGEST}|g" "$f"
  sed -i "s|node:20-alpine|node:20-alpine@${NODE_DIGEST}|g" "$f"
done

echo "=> Done! Current FROM lines:"
grep -rn '^FROM' --include='Dockerfile' .
