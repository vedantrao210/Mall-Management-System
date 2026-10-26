"""MySQL connection handling.

Every API request gets its own connection (opened by the `get_db` dependency)
and runs inside one transaction: it is committed when the request succeeds and
rolled back when any exception is raised.

All SQL in this project uses `%s` placeholders, so user input is always sent as
data and never concatenated into SQL text (prevents SQL injection).
"""
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pymysql
from pymysql.cursors import DictCursor

from .config import get_settings


def _connect(user: str, password: str, *, autocommit: bool = False) -> pymysql.connections.Connection:
    s = get_settings()
    return pymysql.connect(
        host=s.db_host,
        port=s.db_port,
        user=user,
        password=password,
        database=s.db_name,
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=autocommit,
        connect_timeout=5,
    )


def connect_app() -> pymysql.connections.Connection:
    s = get_settings()
    return _connect(s.db_user, s.db_password)


def connect_readonly() -> pymysql.connections.Connection:
    s = get_settings()
    return _connect(s.db_readonly_user, s.db_readonly_password, autocommit=True)


def get_db() -> Iterator[pymysql.connections.Connection]:
    """FastAPI dependency: one transactional connection per request."""
    conn = connect_app()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def readonly_connection() -> Iterator[pymysql.connections.Connection]:
    conn = connect_readonly()
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def fetch_all(conn, sql: str, params: tuple | list | dict | None = None) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params or None)
        return list(cur.fetchall())


def fetch_one(conn, sql: str, params: tuple | list | dict | None = None) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(sql, params or None)
        return cur.fetchone()


def execute(conn, sql: str, params: tuple | list | dict | None = None) -> tuple[int, int]:
    """Run a write statement. Returns (rowcount, lastrowid)."""
    with conn.cursor() as cur:
        cur.execute(sql, params or None)
        return cur.rowcount, cur.lastrowid


def call_procedure(conn, sql: str, params: tuple | list | None = None) -> list[dict[str, Any]]:
    """Run a CALL statement and return the first result set (if any).

    Remaining result sets are drained so the connection can be reused.
    """
    with conn.cursor() as cur:
        cur.execute(sql, params or None)
        rows = list(cur.fetchall()) if cur.description else []
        while cur.nextset():
            pass
        return rows
