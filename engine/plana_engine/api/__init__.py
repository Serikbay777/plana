"""HTTP-сервис движка (FastAPI).

Запуск из корня проекта:
    uvicorn plana_engine.api.main:app --reload --port 8001
"""

from .main import app

__all__ = ["app"]
