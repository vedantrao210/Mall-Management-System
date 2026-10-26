"""Login, current user, password change and user administration."""
from fastapi import APIRouter, Depends, HTTPException, Query

from .. import schemas as s
from ..database import execute, fetch_all, fetch_one, get_db
from ..security import admin_only, any_user, create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["Auth"])

USER_COLUMNS = "user_id, username, full_name, role, is_active, created_at, last_login_at"


@router.post("/login", summary="Exchange username + password for a bearer token")
def login(body: s.LoginIn, conn=Depends(get_db)):
    user = fetch_one(
        conn,
        f"SELECT {USER_COLUMNS}, password_hash FROM app_users WHERE username = %s",
        (body.username,),
    )
    # same message for unknown user and wrong password (no user enumeration)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="This account is disabled")

    execute(conn, "UPDATE app_users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = %s",
            (user["user_id"],))
    token, expires_in = create_access_token(user)
    user.pop("password_hash")
    return {"access_token": token, "token_type": "bearer", "expires_in": expires_in, "user": user}


@router.get("/me", summary="The logged-in user")
def me(user=Depends(any_user)):
    return user


@router.post("/change-password", summary="Change your own password")
def change_password(body: s.ChangePasswordIn, conn=Depends(get_db), user=Depends(any_user)):
    row = fetch_one(conn, "SELECT password_hash FROM app_users WHERE user_id = %s", (user["user_id"],))
    if not verify_password(body.current_password, row["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    execute(conn, "UPDATE app_users SET password_hash = %s WHERE user_id = %s",
            (hash_password(body.new_password), user["user_id"]))
    return {"ok": True}


# ---------------------------------------------------------------------------
# User administration (admin only)
# ---------------------------------------------------------------------------
users = APIRouter(prefix="/api/users", tags=["Users"])


def _get_user(conn, user_id: int):
    row = fetch_one(conn, f"SELECT {USER_COLUMNS} FROM app_users WHERE user_id = %s", (user_id,))
    if not row:
        raise HTTPException(status_code=404, detail=f"User {user_id} not found")
    return row


@users.get("", summary="List users")
def list_users(search: str | None = Query(None, max_length=50), conn=Depends(get_db), _a=Depends(admin_only)):
    sql = f"SELECT {USER_COLUMNS} FROM app_users"
    params: list = []
    if search:
        sql += " WHERE username LIKE %s OR full_name LIKE %s"
        params = [f"%{search}%"] * 2
    items = fetch_all(conn, sql + " ORDER BY user_id", params)
    return {"items": items, "total": len(items), "page": 1, "page_size": len(items)}


@users.post("", status_code=201, summary="Create a user")
def create_user(body: s.UserCreate, conn=Depends(get_db), _a=Depends(admin_only)):
    _, new_id = execute(
        conn,
        "INSERT INTO app_users (username, password_hash, full_name, role, is_active) VALUES (%s,%s,%s,%s,%s)",
        (body.username, hash_password(body.password), body.full_name, body.role, body.is_active),
    )
    return _get_user(conn, new_id)


@users.patch("/{user_id}", summary="Update name, role or active flag")
def update_user(user_id: int, body: s.UserUpdate, conn=Depends(get_db), admin=Depends(admin_only)):
    _get_user(conn, user_id)
    data = body.model_dump(exclude_unset=True)
    if user_id == admin["user_id"] and (data.get("is_active") is False or data.get("role", "admin") != "admin"):
        raise HTTPException(status_code=400, detail="You cannot demote or disable your own account")
    if data:
        sets = ", ".join(f"`{k}` = %s" for k in data)
        execute(conn, f"UPDATE app_users SET {sets} WHERE user_id = %s", [*data.values(), user_id])
    return _get_user(conn, user_id)


@users.post("/{user_id}/reset-password", summary="Set a new password for a user")
def reset_password(user_id: int, body: s.PasswordResetIn, conn=Depends(get_db), _a=Depends(admin_only)):
    _get_user(conn, user_id)
    execute(conn, "UPDATE app_users SET password_hash = %s WHERE user_id = %s",
            (hash_password(body.new_password), user_id))
    return {"ok": True}


@users.delete("/{user_id}", status_code=204, summary="Delete a user")
def delete_user(user_id: int, conn=Depends(get_db), admin=Depends(admin_only)):
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    rowcount, _ = execute(conn, "DELETE FROM app_users WHERE user_id = %s", (user_id,))
    if rowcount == 0:
        raise HTTPException(status_code=404, detail=f"User {user_id} not found")
