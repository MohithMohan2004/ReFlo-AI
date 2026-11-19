# syntax=docker/dockerfile:1
#
# Image for Azure Container Apps (built by .github/workflows/azure.yml).
#
#   docker build --platform linux/amd64 -f deploy/Dockerfile -t reflow .
#   docker run --rm -p 8080:8080 --env-file <your env file> reflow
#
# The build context is the repository root. deploy/Dockerfile.dockerignore
# (used automatically with -f deploy/Dockerfile) keeps .git, .env files,
# virtualenvs, node_modules, local data, logs and the Android app out of it.
#
# This file sits next to the repo's own Dockerfile (used by docker-compose)
# and does not replace it. Differences: listens on 8080 by default, runs one
# gunicorn worker with threads (fits 0.5 GiB, and the app's in-process locks
# then cover every request), runs as a non-root user, and only copies the
# files the server needs.
#
# Package registries are build args, so a local build can use a mirror when
# the network blocks the default one, e.g.
#   --build-arg NPM_REGISTRY=https://registry.yarnpkg.com/

# ---- 1. Build the React web app (output is plain files, so build natively) ----
FROM --platform=$BUILDPLATFORM node:22-slim AS web
WORKDIR /build/frontend
ARG NPM_REGISTRY=https://registry.npmjs.org/
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund --registry="$NPM_REGISTRY"
COPY frontend/ ./
# vite.config.ts writes the bundle to ../static/app (= /build/static/app)
RUN npm run build

# ---- 2. Install Python packages into a virtualenv ----
FROM python:3.12-slim AS deps
ARG PIP_INDEX_URL=https://pypi.org/simple
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_INDEX_URL=$PIP_INDEX_URL
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY requirements.txt .
RUN pip install -r requirements.txt

# ---- 3. Runtime ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH \
    MPLCONFIGDIR=/tmp/matplotlib \
    PORT=8080 \
    WEB_CONCURRENCY=1 \
    GUNICORN_THREADS=8

# libgomp1 is needed by xgboost. apt over HTTPS: some networks block the
# plain-HTTP Debian mirrors.
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 reflow

WORKDIR /app
COPY --from=deps /opt/venv /opt/venv

# Only what the server needs at runtime. data/ and database/ hold the seed
# files the app reads (and, without DATABASE_URL, writes).
COPY --chown=reflow:reflow app.py config.py store.py ocems_api.py ./
COPY --chown=reflow:reflow chatbot/ ./chatbot/
COPY --chown=reflow:reflow ml/ ./ml/
COPY --chown=reflow:reflow data/ ./data/
COPY --chown=reflow:reflow database/ ./database/
COPY --chown=reflow:reflow templates/ ./templates/
COPY --chown=reflow:reflow static/ ./static/
COPY --chown=reflow:reflow --from=web /build/static/app ./static/app
RUN mkdir -p uploads/tanker_documents && chown -R reflow:reflow uploads

USER 10001
EXPOSE 8080
CMD ["sh", "-c", "exec gunicorn app:app --bind 0.0.0.0:${PORT:-8080} --workers ${WEB_CONCURRENCY:-1} --threads ${GUNICORN_THREADS:-8} --worker-class gthread --timeout 120 --access-logfile - --error-logfile -"]
