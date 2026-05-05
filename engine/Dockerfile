FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --upgrade pip && \
    pip install pydantic fastapi "uvicorn[standard]" \
                python-multipart "openai>=1.40" httpx pillow \
                "pymupdf>=1.24"

COPY plana_engine ./plana_engine

EXPOSE 10000

CMD ["sh", "-c", "uvicorn plana_engine.api.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
