from __future__ import annotations

import os
import sqlite3
import uuid

DB_PATH = os.getenv("DB_PATH", "plana.db")


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id           TEXT PRIMARY KEY,
                email        TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role         TEXT NOT NULL DEFAULT 'user',
                created_at   TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.commit()

    # Автоматически создаём seed-пользователя при старте, если задан в env.
    # Это позволяет Render пересоздавать пользователя после каждого редеплоя.
    seed_email = os.getenv("AUTH_SEED_EMAIL")
    seed_password = os.getenv("AUTH_SEED_PASSWORD")
    if seed_email and seed_password:
        from passlib.context import CryptContext  # lazy import
        ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
        if get_user_by_email(seed_email) is None:
            _create_user_raw(seed_email, ctx.hash(seed_password), role="admin")


def get_user_by_email(email: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def create_user(email: str, password_hash: str, role: str = "user") -> dict:
    return _create_user_raw(email, password_hash, role)


def _create_user_raw(email: str, password_hash: str, role: str) -> dict:
    user_id = str(uuid.uuid4())
    with _conn() as c:
        c.execute(
            "INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)",
            (user_id, email, password_hash, role),
        )
        c.commit()
    return {"id": user_id, "email": email, "role": role}
