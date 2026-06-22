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

# ── ODA File Converter (опционально) — для DWG-экспорта ─────────────────────
# Кладётся в engine/vendor/*.deb (не в git, см. vendor/README.md). Если файла
# нет — образ собирается без конвертера, /export/floorplan-dwg отдаёт 503.
# ODA File Converter — GUI-приложение на Qt, поэтому ставим xvfb и оборачиваем
# вызов в xvfb-run (виртуальный дисплей для headless-сервера). Qt-runtime уже
# встроен в .deb.
COPY vendor/ /tmp/oda/
RUN if ls /tmp/oda/*.deb >/dev/null 2>&1; then \
        apt-get update && \
        apt-get install -y --no-install-recommends xvfb xauth libxcb-util1 && \
        apt-get install -y --no-install-recommends /tmp/oda/*.deb && \
        ( ln -sf /usr/lib/x86_64-linux-gnu/libxcb-util.so.1 \
                 /usr/lib/x86_64-linux-gnu/libxcb-util.so.0 || true ) && \
        printf '#!/bin/sh\nexec xvfb-run -a ODAFileConverter "$@"\n' \
            > /usr/local/bin/oda-convert && \
        chmod +x /usr/local/bin/oda-convert && \
        rm -rf /var/lib/apt/lists/* && \
        echo "ODA File Converter installed for DWG export"; \
    else \
        echo "no ODA .deb in vendor/ — DWG export disabled (DXF/IFC/PDF still work)"; \
    fi && \
    rm -rf /tmp/oda

# Указываем код, где искать конвертер (no-op, если конвертер не установлен).
ENV ODA_FILE_CONVERTER=/usr/local/bin/oda-convert

COPY plana_engine ./plana_engine

EXPOSE 8001

CMD ["uvicorn", "plana_engine.api.main:app", "--host", "0.0.0.0", "--port", "8001"]
