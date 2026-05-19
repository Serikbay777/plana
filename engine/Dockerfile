FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --upgrade pip && \
    pip install \
        pydantic fastapi "uvicorn[standard]" \
        python-multipart "openai>=1.40" httpx pillow \
        "pypdfium2>=4.30" "ezdxf>=1.3" "shapely>=2.1" \
        "ifcopenshell>=0.8" "numpy>=1.26" \
        "python-jose[cryptography]>=3.3" "bcrypt>=4.0"

COPY plana_engine ./plana_engine

EXPOSE 8001

CMD ["uvicorn", "plana_engine.api.main:app", "--host", "0.0.0.0", "--port", "8001"]
