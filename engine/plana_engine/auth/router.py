from __future__ import annotations

import bcrypt as _bcrypt

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .db import create_user, get_user_by_email
from .jwt_utils import create_token

router = APIRouter(prefix="/auth", tags=["auth"])


def _hash(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()


def _verify(password: str, hashed: str) -> bool:
    return _bcrypt.checkpw(password.encode(), hashed.encode())


def _derive_name(email: str) -> str:
    return (
        email.split("@")[0]
        .replace(".", " ")
        .replace("_", " ")
        .replace("-", " ")
        .title()
        or "Архитектор"
    )


# ---------------------------------------------------------------------------
# Схемы
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    email: str
    name: str


# ---------------------------------------------------------------------------
# Эндпоинты
# ---------------------------------------------------------------------------

@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest) -> TokenResponse:
    user = get_user_by_email(req.email.lower().strip())
    if not user or not _verify(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    token = create_token(user["id"], user["email"], user["role"])
    return TokenResponse(access_token=token, email=user["email"], name=_derive_name(user["email"]))


@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest) -> TokenResponse:
    email = req.email.lower().strip()
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Пароль должен быть не менее 8 символов")
    if get_user_by_email(email) is not None:
        raise HTTPException(status_code=409, detail="Пользователь с таким email уже существует")
    user = create_user(email, _hash(req.password))
    token = create_token(user["id"], user["email"], user["role"])
    return TokenResponse(access_token=token, email=user["email"], name=_derive_name(user["email"]))


@router.get("/me")
def me(request: Request) -> dict:
    user: dict | None = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"user_id": user["sub"], "email": user["email"], "role": user["role"]}
