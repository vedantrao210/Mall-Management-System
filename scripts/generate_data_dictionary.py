#!/usr/bin/env python3
"""Generate docs/DATA_DICTIONARY.md from the live database (INFORMATION_SCHEMA).

    cd backend && python ../scripts/generate_data_dictionary.py

Uses the same connection settings as the backend (backend/.env), so it runs as
the least-privilege mall_app account.
"""
from __future__ import annotations

import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR / "backend"))

from app.database import connect_app, fetch_all  # noqa: E402

OUT = PROJECT_DIR / "docs" / "DATA_DICTIONARY.md"


# Descriptions for columns whose meaning is not obvious from the name
NOTES = {
    "app_users.password_hash": "bcrypt hash; never the plain password",
    "app_users.role": "admin: everything; manager: data entry; staff: read-only + maintenance",
    "audit_log.table_name": "Table the change happened in",
    "audit_log.record_id": "Primary key of the changed row",
    "audit_log.old_data": "Row image before the change (JSON), NULL for INSERT",
    "audit_log.new_data": "Row image after the change (JSON), NULL for DELETE",
    "audit_log.changed_by": "Application user (@app_user) or MySQL account",
    "floors.level_number": "Negative numbers are basement levels",
    "shops.unit_code": "Unit number shown to visitors, e.g. G-05",
    "shops.base_rent": "Asking rent per month for the unit",
    "shops.status": "Kept in sync with leases by triggers",
    "tenants.tax_id": "Tax registration number of the business",
    "leases.monthly_rent": "Agreed rent per month (before tax)",
    "leases.tax_rate": "Tax percentage applied to each invoice",
    "leases.status": "active / terminated / expired",
    "leases.active_shop_key": "shop_id while active, else NULL; its UNIQUE index allows one active lease per shop",
    "invoices.invoice_no": "INV-YYYYMM-LLLL (billing month + lease id)",
    "invoices.billing_month": "First day of the month being billed",
    "invoices.rent_amount": "Copied from the lease when the invoice is generated",
    "invoices.tax_amount": "rent_amount x tax_rate / 100",
    "invoices.total_amount": "rent_amount + tax_amount",
    "invoices.status": "Derived from payments by triggers; void = cancelled",
    "payments.reference_no": "Bank / card / cheque reference",
    "payments.recorded_by": "Application user who recorded the payment",
    "expenses.amount": "Amount before tax",
    "expenses.tax_amount": "amount x tax_rate / 100",
    "expenses.total_amount": "amount + tax_amount",
    "expenses.recorded_by": "Application user who entered the expense",
    "employees.employee_code": "Staff number, e.g. EMP001",
    "employees.is_active": "0 once the employee has left (rows are kept for history)",
    "maintenance_requests.shop_id": "NULL means a common area",
    "maintenance_requests.assigned_to": "Employee responsible for the ticket",
    "maintenance_requests.resolved_at": "Set automatically by a trigger when status becomes resolved / closed",
}


def code(value) -> str:
    """Inline code that may itself contain backticks."""
    text = md(value)
    return f"`` {text} ``" if "`" in text else f"`{text}`"


def md(value) -> str:
    if value is None:
        return ""
    return str(value).replace("|", "\\|").replace("\n", " ")


def main() -> None:
    conn = connect_app()
    tables = fetch_all(conn, """
        SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME""")
    views = fetch_all(conn, """
        SELECT TABLE_NAME AS name FROM information_schema.VIEWS
        WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME""")

    lines = [
        "# Data dictionary",
        "",
        "_Generated from `INFORMATION_SCHEMA` by `scripts/generate_data_dictionary.py`._",
        "",
        "Key: **PK** primary key, **FK** foreign key, **UQ** unique, **IX** indexed. "
        "Columns marked _generated_ are computed by MySQL and cannot be written.",
        "",
        "## Tables",
        "",
        "| Table | Description |",
        "|---|---|",
    ]
    lines += [f"| [`{t['name']}`](#{t['name']}) | {md(t['comment'])} |" for t in tables]
    lines.append("")

    for t in tables:
        name = t["name"]
        cols = fetch_all(conn, """
            SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
                   COLUMN_KEY AS ckey, COLUMN_DEFAULT AS dflt, EXTRA AS extra,
                   GENERATION_EXPRESSION AS gen, COLUMN_COMMENT AS comment
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
            ORDER BY ORDINAL_POSITION""", (name,))
        fks = fetch_all(conn, """
            SELECT k.COLUMN_NAME AS col, k.REFERENCED_TABLE_NAME AS rt, k.REFERENCED_COLUMN_NAME AS rc,
                   r.DELETE_RULE AS on_delete, r.UPDATE_RULE AS on_update, k.CONSTRAINT_NAME AS cname
            FROM information_schema.KEY_COLUMN_USAGE k
            JOIN information_schema.REFERENTIAL_CONSTRAINTS r
              ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
            WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = %s""", (name,))
        fk_cols = {f["col"]: f for f in fks}
        uniques = fetch_all(conn, """
            SELECT INDEX_NAME AS name,
                   GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS cols
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
              AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
            GROUP BY INDEX_NAME""", (name,))
        checks = fetch_all(conn, """
            SELECT tc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS clause
            FROM information_schema.TABLE_CONSTRAINTS tc
            JOIN information_schema.CHECK_CONSTRAINTS cc
              ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
            WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = %s AND tc.CONSTRAINT_TYPE = 'CHECK'
            ORDER BY tc.CONSTRAINT_NAME""", (name,))

        lines += [f"## {name}", "", md(t["comment"]), "",
                  "| Column | Type | Null | Key | Default / extra | Description |",
                  "|---|---|---|---|---|---|"]
        for c in cols:
            keys = []
            if c["ckey"] == "PRI":
                keys.append("PK")
            if c["name"] in fk_cols:
                f = fk_cols[c["name"]]
                keys.append(f"FK → `{f['rt']}.{f['rc']}`")
            if c["ckey"] == "UNI":
                keys.append("UQ")
            elif c["ckey"] == "MUL" and c["name"] not in fk_cols:
                keys.append("IX")
            extra = []
            if c["gen"]:
                extra.append(f"_generated_: {code(c['gen'])}")
            else:
                if c["dflt"] is not None:
                    extra.append(f"default `{md(c['dflt'])}`")
                if c["extra"] and "DEFAULT_GENERATED" not in c["extra"]:
                    extra.append(md(c["extra"]))
                elif c["extra"] and "on update" in c["extra"]:
                    extra.append("on update CURRENT_TIMESTAMP")
            lines.append(
                f"| `{c['name']}` | `{md(c['type'])}` | {'yes' if c['nullable'] == 'YES' else 'no'} | "
                f"{', '.join(keys)} | {'; '.join(extra)} | {md(c['comment'] or NOTES.get(name + '.' + c['name'], ''))} |")
        lines.append("")
        if fks:
            lines += ["**Foreign keys**", ""]
            lines += [f"- `{f['cname']}`: `{f['col']}` → `{f['rt']}({f['rc']})` "
                      f"ON DELETE {f['on_delete']} ON UPDATE {f['on_update']}" for f in fks]
            lines.append("")
        if uniques:
            lines += ["**Unique keys**", ""]
            lines += [f"- `{u['name']}` ({u['cols']})" for u in uniques]
            lines.append("")
        if checks:
            lines += ["**Check constraints**", ""]
            lines += [f"- `{c['name']}`: {code(c['clause'])}" for c in checks]
            lines.append("")

    lines += ["## Views", "", "See `database/02_views.sql` for the definitions.", ""]
    lines += [f"- `{v['name']}`" for v in views]
    lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    conn.close()
    print(f"Wrote {OUT.relative_to(PROJECT_DIR)}")


if __name__ == "__main__":
    main()
