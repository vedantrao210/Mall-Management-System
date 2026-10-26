"""Database administration tools.

* schema explorer built on INFORMATION_SCHEMA (the data dictionary)
* catalogue of triggers / procedures / functions / views / events
* read-only SQL console (separate MySQL account + statement whitelist)
* audit log viewer
* logical data backup (INSERT statements) download
"""
import json
import re
import time
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse

from .. import schemas as s
from ..config import get_settings
from ..database import call_procedure, fetch_all, fetch_one, get_db, readonly_connection
from ..security import admin_only, writer

router = APIRouter(prefix="/api/admin", tags=["Database administration"])

# Restore order respects foreign keys (parents before children)
BACKUP_ORDER = [
    "app_users", "floors", "shop_categories", "departments", "expense_categories",
    "shops", "tenants", "leases", "invoices", "payments", "employees", "expenses",
    "maintenance_requests", "audit_log",
]
HIDDEN_COLUMNS = {"app_users": {"password_hash"}}   # never shown in the table browser


def _object_names(conn) -> dict[str, str]:
    rows = fetch_all(conn, """
        SELECT TABLE_NAME AS name, TABLE_TYPE AS type
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()""")
    return {r["name"]: r["type"] for r in rows}


def _require_object(conn, name: str) -> str:
    objects = _object_names(conn)
    if name not in objects:
        raise HTTPException(status_code=404, detail=f"Table or view '{name}' not found")
    return objects[name]


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------
@router.get("/overview", summary="Server info, tables, sizes and object counts")
def overview(conn=Depends(get_db), _u=Depends(writer)):
    server = fetch_one(conn, """
        SELECT VERSION() AS version, DATABASE() AS database_name, @@hostname AS host,
               @@event_scheduler AS event_scheduler, @@default_storage_engine AS storage_engine,
               @@character_set_database AS charset, @@collation_database AS collation,
               @@transaction_isolation AS isolation_level, NOW() AS server_time""")
    tables = fetch_all(conn, """
        SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine,
               COALESCE(DATA_LENGTH, 0) AS data_bytes, COALESCE(INDEX_LENGTH, 0) AS index_bytes,
               TABLE_COMMENT AS comment
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_TYPE, TABLE_NAME""")
    for t in tables:
        if t["type"] == "BASE TABLE":
            # name comes from the data dictionary, not from the request
            t["rows"] = fetch_one(conn, f"SELECT COUNT(*) AS n FROM `{t['name']}`")["n"]
        else:
            t["rows"] = None
            t["comment"] = ""
    objects = call_procedure(conn, "CALL sp_db_objects()")
    counts: dict[str, int] = {}
    for o in objects:
        counts[o["object_type"]] = counts.get(o["object_type"], 0) + 1
    constraints = fetch_all(conn, """
        SELECT CONSTRAINT_TYPE AS type, COUNT(*) AS n
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() GROUP BY CONSTRAINT_TYPE""")
    indexes = fetch_one(conn, """
        SELECT COUNT(DISTINCT TABLE_NAME, INDEX_NAME) AS n
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()""")
    return {
        "server": server,
        "tables": tables,
        "object_counts": counts,
        "constraint_counts": {c["type"]: c["n"] for c in constraints},
        "index_count": indexes["n"],
        "total_bytes": sum(t["data_bytes"] + t["index_bytes"] for t in tables),
    }


# ---------------------------------------------------------------------------
# Schema explorer
# ---------------------------------------------------------------------------
@router.get("/tables/{name}", summary="Columns, keys, indexes, constraints, triggers and DDL")
def table_detail(name: str, conn=Depends(get_db), _u=Depends(writer)):
    obj_type = _require_object(conn, name)
    columns = fetch_all(conn, """
        SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
               COLUMN_KEY AS `key`, COLUMN_DEFAULT AS default_value, EXTRA AS extra,
               GENERATION_EXPRESSION AS generated_as, COLUMN_COMMENT AS comment
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
        ORDER BY ORDINAL_POSITION""", (name,))
    result = {"name": name, "type": obj_type, "columns": columns}

    if obj_type == "BASE TABLE":
        result["indexes"] = fetch_all(conn, """
            SELECT INDEX_NAME AS name, NON_UNIQUE = 0 AS is_unique, INDEX_TYPE AS index_type,
                   GROUP_CONCAT(COALESCE(COLUMN_NAME, EXPRESSION) ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS columns
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
            GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE
            ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME""", (name,))
        result["foreign_keys"] = fetch_all(conn, """
            SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS column_name,
                   k.REFERENCED_TABLE_NAME AS references_table, k.REFERENCED_COLUMN_NAME AS references_column,
                   r.UPDATE_RULE AS on_update, r.DELETE_RULE AS on_delete
            FROM information_schema.KEY_COLUMN_USAGE k
            JOIN information_schema.REFERENTIAL_CONSTRAINTS r
              ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
            WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = %s
            ORDER BY k.CONSTRAINT_NAME""", (name,))
        result["referenced_by"] = fetch_all(conn, """
            SELECT k.TABLE_NAME AS table_name, k.COLUMN_NAME AS column_name, k.CONSTRAINT_NAME AS name,
                   r.DELETE_RULE AS on_delete
            FROM information_schema.KEY_COLUMN_USAGE k
            JOIN information_schema.REFERENTIAL_CONSTRAINTS r
              ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
            WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME = %s
            ORDER BY k.TABLE_NAME""", (name,))
        result["checks"] = fetch_all(conn, """
            SELECT tc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS clause
            FROM information_schema.TABLE_CONSTRAINTS tc
            JOIN information_schema.CHECK_CONSTRAINTS cc
              ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
            WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = %s AND tc.CONSTRAINT_TYPE = 'CHECK'
            ORDER BY tc.CONSTRAINT_NAME""", (name,))
        result["triggers"] = [
            o for o in call_procedure(conn, "CALL sp_db_objects()")
            if o["object_type"] == "TRIGGER" and o["related_table"] == name
        ]
        result["row_count"] = fetch_one(conn, f"SELECT COUNT(*) AS n FROM `{name}`")["n"]
        result["ddl"] = fetch_one(conn, f"SHOW CREATE TABLE `{name}`")["Create Table"]
    else:
        view = next((o for o in call_procedure(conn, "CALL sp_db_objects()")
                     if o["object_type"] == "VIEW" and o["object_name"] == name), None)
        result["ddl"] = f"CREATE VIEW `{name}` AS\n{view['definition']}" if view else None
    return result


@router.get("/er-diagram", summary="Tables, columns and foreign keys for an ER diagram")
def er_diagram(conn=Depends(get_db), _u=Depends(writer)):
    columns = fetch_all(conn, """
        SELECT c.TABLE_NAME AS table_name, c.COLUMN_NAME AS name, c.COLUMN_TYPE AS type,
               c.COLUMN_KEY AS `key`, c.IS_NULLABLE = 'YES' AS nullable,
               c.GENERATION_EXPRESSION <> '' AS is_generated
        FROM information_schema.COLUMNS c
        JOIN information_schema.TABLES t
          ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
        WHERE c.TABLE_SCHEMA = DATABASE()
        ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION""")
    relations = fetch_all(conn, """
        SELECT TABLE_NAME AS from_table, COLUMN_NAME AS from_column,
               REFERENCED_TABLE_NAME AS to_table, REFERENCED_COLUMN_NAME AS to_column,
               CONSTRAINT_NAME AS name
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY TABLE_NAME, CONSTRAINT_NAME""")
    fk_cols = {(r["from_table"], r["from_column"]) for r in relations}
    tables: dict[str, list] = {}
    for c in columns:
        c["is_fk"] = (c["table_name"], c["name"]) in fk_cols
        tables.setdefault(c.pop("table_name"), []).append(c)
    return {"tables": [{"name": n, "columns": cols} for n, cols in tables.items()], "relations": relations}


@router.get("/tables/{name}/rows", summary="Browse rows (read-only account)")
def table_rows(
    name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    conn=Depends(get_db),
    _u=Depends(writer),
):
    _require_object(conn, name)
    cols = [c["name"] for c in fetch_all(conn, """
        SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s ORDER BY ORDINAL_POSITION""", (name,))
            if c["name"] not in HIDDEN_COLUMNS.get(name, set())]
    col_sql = ", ".join(f"`{c}`" for c in cols)
    with readonly_connection() as ro:
        total = fetch_one(ro, f"SELECT COUNT(*) AS n FROM `{name}`")["n"]
        rows = fetch_all(ro, f"SELECT {col_sql} FROM `{name}` LIMIT %s OFFSET %s",
                         (page_size, (page - 1) * page_size))
    return {"columns": cols, "rows": rows, "total": total, "page": page, "page_size": page_size}


@router.get("/objects", summary="Triggers, procedures, functions, views and events with source")
def db_objects(conn=Depends(get_db), _u=Depends(writer)):
    return call_procedure(conn, "CALL sp_db_objects()")


# ---------------------------------------------------------------------------
# SQL scripts shipped with the project
# ---------------------------------------------------------------------------
def _scripts() -> dict[str, Path]:
    base = get_settings().sql_scripts_dir
    if not base.is_dir():
        return {}
    files = sorted(base.glob("*.sql")) + sorted(base.glob("examples/*.sql"))
    return {str(f.relative_to(base)): f for f in files}


@router.get("/scripts", summary="List SQL script files")
def list_scripts(_u=Depends(writer)):
    return [{"name": n, "bytes": p.stat().st_size} for n, p in _scripts().items()]


@router.get("/scripts/{name:path}", summary="Read one SQL script", response_class=PlainTextResponse)
def read_script(name: str, _u=Depends(writer)):
    path = _scripts().get(name)
    if path is None:
        raise HTTPException(status_code=404, detail="Script not found")
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Read-only SQL console
# ---------------------------------------------------------------------------
_ALLOWED = re.compile(r"^\s*(select|with|show|describe|desc|explain)\b", re.IGNORECASE)
_COMMENTS = re.compile(r"(--[^\n]*|#[^\n]*|/\*.*?\*/)", re.DOTALL)


@router.post("/sql", summary="Run a read-only query")
def run_sql(body: s.SqlQueryIn, _u=Depends(writer)):
    settings = get_settings()
    sql = _COMMENTS.sub(" ", body.sql).strip().rstrip(";").strip()
    if not sql:
        raise HTTPException(status_code=422, detail="Query is empty")
    if ";" in sql:
        raise HTTPException(status_code=422, detail="Only one statement can be run at a time")
    if not _ALLOWED.match(sql):
        raise HTTPException(status_code=422,
                            detail="Only SELECT, WITH, SHOW, DESCRIBE and EXPLAIN statements are allowed")

    # Defence in depth: even if the whitelist were bypassed, this MySQL account
    # only has SELECT privileges and the session is READ ONLY.
    with readonly_connection() as ro:
        with ro.cursor() as cur:
            cur.execute("SET SESSION TRANSACTION READ ONLY")
            cur.execute(f"SET SESSION MAX_EXECUTION_TIME = {int(settings.sql_console_timeout_ms)}")
            started = time.perf_counter()
            cur.execute(sql)
            elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            columns = [d[0] for d in cur.description] if cur.description else []
            rows = list(cur.fetchmany(settings.sql_console_max_rows + 1)) if columns else []
    truncated = len(rows) > settings.sql_console_max_rows
    return {
        "columns": columns,
        "rows": rows[: settings.sql_console_max_rows],
        "row_count": min(len(rows), settings.sql_console_max_rows),
        "truncated": truncated,
        "elapsed_ms": elapsed_ms,
    }


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------
@router.get("/audit", summary="Change history recorded by triggers")
def audit_log(
    table_name: str | None = None,
    action: str | None = Query(None, pattern="^(INSERT|UPDATE|DELETE)$"),
    record_id: int | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    conn=Depends(get_db),
    _u=Depends(writer),
):
    where, params = [], []
    if table_name:
        where.append("table_name = %s")
        params.append(table_name)
    if action:
        where.append("action = %s")
        params.append(action)
    if record_id:
        where.append("record_id = %s")
        params.append(record_id)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    total = fetch_one(conn, f"SELECT COUNT(*) AS n FROM audit_log{where_sql}", params)["n"]
    rows = fetch_all(conn, f"SELECT * FROM audit_log{where_sql} ORDER BY audit_id DESC LIMIT %s OFFSET %s",
                     [*params, page_size, (page - 1) * page_size])
    for r in rows:
        for k in ("old_data", "new_data"):
            if isinstance(r[k], str):
                r[k] = json.loads(r[k])
    return {"items": rows, "total": total, "page": page, "page_size": page_size}


# ---------------------------------------------------------------------------
# Logical backup (data only)
# ---------------------------------------------------------------------------
@router.get("/backup", summary="Download a data-only SQL backup", response_class=PlainTextResponse)
def backup(conn=Depends(get_db), _a=Depends(admin_only)):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = [
        "-- Mall Management System - data backup",
        f"-- Created {datetime.now().isoformat(timespec='seconds')}",
        "-- Restore into a freshly created schema (run database/01..04 and 06 first),",
        "-- as an account that can write every table, e.g.:",
        "--     mysql -u root -p mall_db < this_file.sql",
        "-- Shop status 'occupied' is written as 'vacant': the lease triggers set it",
        "-- back to 'occupied' when the active leases are restored (derived data).",
        "",
        "SET NAMES utf8mb4;",
        "SET @skip_audit = 1;",
        "SET FOREIGN_KEY_CHECKS = 0;",
    ]
    for table in reversed(BACKUP_ORDER):
        out.append(f"DELETE FROM `{table}`;")
    out.append("SET FOREIGN_KEY_CHECKS = 1;")
    for table in BACKUP_ORDER:
        cols = [c["name"] for c in fetch_all(conn, """
            SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
              AND GENERATION_EXPRESSION = ''          -- skip generated columns only
            ORDER BY ORDINAL_POSITION""", (table,))]
        select_cols = ", ".join(
            "CASE WHEN `status` = 'occupied' THEN 'vacant' ELSE `status` END AS `status`"
            if (table == "shops" and c == "status") else f"`{c}`" for c in cols)
        order = "start_date, lease_id" if table == "leases" else "1"
        rows = fetch_all(conn, f"SELECT {select_cols} FROM `{table}` ORDER BY {order}")
        out.append(f"\n-- {table}: {len(rows)} rows")
        col_list = ", ".join(f"`{c}`" for c in cols)
        for i in range(0, len(rows), 100):
            values = ",\n  ".join(
                "(" + ", ".join(conn.escape(r[c]) for c in cols) + ")" for r in rows[i:i + 100])
            out.append(f"INSERT INTO `{table}` ({col_list}) VALUES\n  {values};")
    out.append("\nSET @skip_audit = NULL;\n")
    return PlainTextResponse(
        "\n".join(out),
        media_type="application/sql",
        headers={"Content-Disposition": f'attachment; filename="mall_db-data-{stamp}.sql"'},
    )
