"""Generic, configuration-driven CRUD endpoints.

Each `Resource` describes one table: which SELECT to use for listing, which
columns may be searched / sorted / filtered, which Pydantic models validate
input and which roles may write. `build_router` turns that description into a
standard REST API:

    GET    /api/<name>            list   (search, filters, sort, pagination)
    GET    /api/<name>/options    id/label pairs for drop-down lists
    GET    /api/<name>/{id}       one record
    POST   /api/<name>            create
    PATCH  /api/<name>/{id}       partial update
    DELETE /api/<name>/{id}       delete

Table and column names come only from this configuration (never from the
request), and every value is passed as a `%s` parameter.
"""
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from .database import execute, fetch_all, fetch_one, get_db
from .security import WRITE_ROLES, require_roles

ALL_ROLES = ("admin", "manager", "staff")


@dataclass
class Resource:
    name: str                       # URL segment, e.g. "shops"
    table: str                      # base table for INSERT / UPDATE / DELETE
    pk: str                         # primary-key column
    list_sql: str                   # SELECT used for list / detail (may join / use a view)
    columns: list[str]              # columns of list_sql allowed for sort / filter
    search: list[str]               # columns searched by ?search=
    default_sort: str
    label_sql: str                  # SQL expression used as option label
    create_model: type[BaseModel] | None = None
    update_model: type[BaseModel] | None = None
    filters: list[str] = field(default_factory=list)   # exact-match query filters
    read_roles: tuple[str, ...] = ALL_ROLES
    create_roles: tuple[str, ...] = WRITE_ROLES
    update_roles: tuple[str, ...] = WRITE_ROLES
    delete_roles: tuple[str, ...] = WRITE_ROLES
    allow_delete: bool = True
    # extra columns filled from the logged-in user, e.g. {"recorded_by": "user_id"}
    stamp_user: dict[str, str] = field(default_factory=dict)
    title: str = ""


def _wrap(list_sql: str) -> str:
    return f"SELECT * FROM ({list_sql}) AS q"


def list_records(conn, res: Resource, request: Request, search: str | None, sort: str | None,
                 order: str, page: int, page_size: int) -> dict[str, Any]:
    where, params = [], []
    if search:
        like = f"%{search}%"
        where.append("(" + " OR ".join(f"CAST(q.`{c}` AS CHAR) LIKE %s" for c in res.search) + ")")
        params.extend([like] * len(res.search))
    for f in res.filters:
        value = request.query_params.get(f)
        if value not in (None, ""):
            where.append(f"q.`{f}` = %s")
            params.append(value)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    sort_col = sort if sort in res.columns else res.default_sort
    direction = "DESC" if order.lower() == "desc" else "ASC"

    total = fetch_one(conn, f"SELECT COUNT(*) AS n FROM ({res.list_sql}) AS q{where_sql}", params)["n"]
    rows = fetch_all(
        conn,
        f"{_wrap(res.list_sql)}{where_sql} ORDER BY q.`{sort_col}` {direction}, q.`{res.pk}` "
        f"LIMIT %s OFFSET %s",
        [*params, page_size, (page - 1) * page_size],
    )
    return {"items": rows, "total": total, "page": page, "page_size": page_size}


def get_record(conn, res: Resource, record_id: int) -> dict[str, Any]:
    row = fetch_one(conn, f"{_wrap(res.list_sql)} WHERE q.`{res.pk}` = %s", (record_id,))
    if row is None:
        raise HTTPException(status_code=404, detail=f"{res.title or res.name} {record_id} not found")
    return row


def insert_record(conn, table: str, data: dict[str, Any]) -> int:
    cols = list(data)
    sql = (f"INSERT INTO `{table}` (" + ", ".join(f"`{c}`" for c in cols) + ") VALUES ("
           + ", ".join(["%s"] * len(cols)) + ")")
    _, last_id = execute(conn, sql, [data[c] for c in cols])
    return last_id


def update_record(conn, table: str, pk: str, record_id: int, data: dict[str, Any]) -> None:
    if not data:
        return
    sets = ", ".join(f"`{c}` = %s" for c in data)
    execute(conn, f"UPDATE `{table}` SET {sets} WHERE `{pk}` = %s", [*data.values(), record_id])


def build_router(res: Resource) -> APIRouter:
    router = APIRouter(prefix=f"/api/{res.name}", tags=[res.title or res.name])

    @router.get("", summary=f"List {res.name}")
    def list_endpoint(
        request: Request,
        search: str | None = Query(None, max_length=100),
        sort: str | None = None,
        order: str = Query("asc", pattern="^(asc|desc|ASC|DESC)$"),
        page: int = Query(1, ge=1),
        page_size: int = Query(25, ge=1, le=500),
        conn=Depends(get_db),
        _user=Depends(require_roles(*res.read_roles)),
    ):
        return list_records(conn, res, request, search, sort, order, page, page_size)

    @router.get("/options", summary=f"Drop-down options for {res.name}")
    def options_endpoint(conn=Depends(get_db), _user=Depends(require_roles(*ALL_ROLES))):
        return fetch_all(
            conn,
            f"SELECT `{res.pk}` AS value, {res.label_sql} AS label FROM `{res.table}` ORDER BY label",
        )

    @router.get("/{record_id}", summary=f"Get one {res.name} record")
    def get_endpoint(record_id: int, conn=Depends(get_db),
                     _user=Depends(require_roles(*res.read_roles))):
        return get_record(conn, res, record_id)

    if res.create_model is not None:
        create_model = res.create_model

        @router.post("", status_code=201, summary=f"Create {res.name} record")
        def create_endpoint(body: create_model, conn=Depends(get_db),  # type: ignore[valid-type]
                            user=Depends(require_roles(*res.create_roles))):
            data = body.model_dump()
            for col, user_key in res.stamp_user.items():
                data[col] = user[user_key]
            new_id = insert_record(conn, res.table, data)
            return get_record(conn, res, new_id)

    if res.update_model is not None:
        update_model = res.update_model

        @router.patch("/{record_id}", summary=f"Update {res.name} record")
        def update_endpoint(record_id: int, body: update_model,  # type: ignore[valid-type]
                            conn=Depends(get_db), _user=Depends(require_roles(*res.update_roles))):
            get_record(conn, res, record_id)  # 404 if missing
            update_record(conn, res.table, res.pk, record_id, body.model_dump(exclude_unset=True))
            return get_record(conn, res, record_id)

    if res.allow_delete:
        @router.delete("/{record_id}", status_code=204, summary=f"Delete {res.name} record")
        def delete_endpoint(record_id: int, conn=Depends(get_db),
                            _user=Depends(require_roles(*res.delete_roles))):
            rowcount, _ = execute(conn, f"DELETE FROM `{res.table}` WHERE `{res.pk}` = %s", (record_id,))
            if rowcount == 0:
                raise HTTPException(status_code=404, detail=f"{res.title or res.name} {record_id} not found")

    return router
