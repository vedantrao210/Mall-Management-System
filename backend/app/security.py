"""Authentication (JWT bearer tokens) and role-based authorisation.

Roles
-----
admin    full access, including user management and database tools
manager  create / update / delete business data, run billing, reports
staff    read access to business data, log maintenance requests
"""
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings
from .database import fetch_one, get_db

ROLES = ("admin", "manager", "staff")
WRITE_ROLES = ("admin", "manager")

_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user: dict[str, Any]) -> tuple[str, int]:
    s = get_settings()
    expires_in = s.jwt_expire_minutes * 60
    payload = {
        "sub": str(user["user_id"]),
        "username": user["username"],
        "role": user["role"],
        "exp": datetime.now(timezone.utc) + timedelta(seconds=expires_in),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm), expires_in


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    conn=Depends(get_db),
) -> dict[str, Any]:
    """Validate the bearer token and load the user.

    Also tags the database session with the username (`@app_user`) so the audit
    triggers know which application user made each change.
    """
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized
    s = get_settings()
    try:
        payload = jwt.decode(credentials.credentials, s.jwt_secret, algorithms=[s.jwt_algorithm])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized from None

    user = fetch_one(
        conn,
        "SELECT user_id, username, full_name, role, is_active, last_login_at FROM app_users WHERE user_id = %s",
        (user_id,),
    )
    if not user or not user["is_active"]:
        raise unauthorized

    with conn.cursor() as cur:
        cur.execute("SET @app_user = %s", (user["username"],))
    return user


def require_roles(*roles: str):
    """Dependency factory: allow only users whose role is in `roles`."""

    def checker(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        if user["role"] not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires one of the roles: {', '.join(roles)}",
            )
        return user

    return checker


any_user = get_current_user
writer = require_roles(*WRITE_ROLES)
admin_only = require_roles("admin")
