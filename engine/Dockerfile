FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Системные зависимости (shapely подтягивает GEOS из бинарных колёс — обычно
# хватает, но оставим про запас build-essential в случае source-сборки).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libgeos-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install -e ".[dev]" --no-deps && \
    pip install shapely pydantic pyyaml fastapi "uvicorn[standard]" \
                python-multipart ezdxf

COPY plana_engine ./plana_engine
COPY data ./data

EXPOSE 8001

CMD ["uvicorn", "plana_engine.api.main:app", "--host", "0.0.0.0", "--port", "8001"]
