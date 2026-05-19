from __future__ import annotations

import os
import sqlite3
import uuid

import bcrypt as _bcrypt

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
        c.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id         TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name       TEXT NOT NULL DEFAULT 'Без названия',
                params     TEXT NOT NULL DEFAULT '{}',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS project_assets (
                id          TEXT PRIMARY KEY,
                project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                tab         TEXT NOT NULL,
                variant_key TEXT NOT NULL,
                floor       INTEGER NOT NULL DEFAULT 1,
                file_path   TEXT NOT NULL,
                model_used  TEXT,
                created_at  TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.commit()
    # migration: add floor column to existing tables
    with _conn() as c:
        try:
            c.execute("ALTER TABLE project_assets ADD COLUMN floor INTEGER NOT NULL DEFAULT 1")
            c.commit()
        except Exception:
            pass  # column already exists

    # Автоматически создаём seed-пользователя при старте, если задан в env.
    # Это позволяет Render пересоздавать пользователя после каждого редеплоя.
    seed_email = os.getenv("AUTH_SEED_EMAIL")
    seed_password = os.getenv("AUTH_SEED_PASSWORD")
    if seed_email and seed_password:
        if get_user_by_email(seed_email) is None:
            hashed = _bcrypt.hashpw(seed_password.encode(), _bcrypt.gensalt()).decode()
            _create_user_raw(seed_email, hashed, role="admin")


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


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

def create_project(user_id: str, name: str, params: str) -> dict:
    project_id = str(uuid.uuid4())
    with _conn() as c:
        c.execute(
            "INSERT INTO projects (id, user_id, name, params) VALUES (?, ?, ?, ?)",
            (project_id, user_id, name, params),
        )
        c.commit()
    return {"id": project_id, "user_id": user_id, "name": name, "params": params}


def list_projects(user_id: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_project(project_id: str, user_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user_id),
        ).fetchone()
        return dict(row) if row else None


def update_project(project_id: str, user_id: str, name: str | None, params: str | None) -> bool:
    fields, values = [], []
    if name is not None:
        fields.append("name = ?"); values.append(name)
    if params is not None:
        fields.append("params = ?"); values.append(params)
    if not fields:
        return False
    fields.append("updated_at = CURRENT_TIMESTAMP")
    values += [project_id, user_id]
    with _conn() as c:
        cur = c.execute(
            f"UPDATE projects SET {', '.join(fields)} WHERE id = ? AND user_id = ?",
            values,
        )
        c.commit()
        return cur.rowcount > 0


def delete_project(project_id: str, user_id: str) -> bool:
    with _conn() as c:
        cur = c.execute(
            "DELETE FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user_id),
        )
        c.commit()
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Project assets
# ---------------------------------------------------------------------------

def create_asset(
    project_id: str, tab: str, variant_key: str, file_path: str,
    model_used: str | None, floor: int = 1,
) -> dict:
    asset_id = str(uuid.uuid4())
    with _conn() as c:
        c.execute(
            "INSERT INTO project_assets (id, project_id, tab, variant_key, floor, file_path, model_used) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (asset_id, project_id, tab, variant_key, floor, file_path, model_used),
        )
        c.execute("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (project_id,))
        c.commit()
    return {"id": asset_id, "project_id": project_id, "tab": tab, "variant_key": variant_key, "floor": floor, "file_path": file_path}


def list_assets(project_id: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM project_assets WHERE project_id = ? ORDER BY created_at",
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_project_thumbnail(project_id: str) -> str | None:
    with _conn() as c:
        row = c.execute(
            "SELECT file_path FROM project_assets WHERE project_id = ? ORDER BY created_at LIMIT 1",
            (project_id,),
        ).fetchone()
        return row["file_path"] if row else None
