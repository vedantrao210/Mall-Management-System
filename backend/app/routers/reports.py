"""Dashboard, named reports (backed by SQL views) and procedure-based reports.

Every report response includes the SQL that produced it, so the UI can show
students exactly which query / view / procedure is behind each screen.
"""
import csv
import io
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..database import call_procedure, fetch_all, fetch_one, get_db
from ..security import any_user

router = APIRouter(prefix="/api", tags=["Reports"])

# key -> definition. `sql` is fixed text (no user input).
REPORTS: dict[str, dict] = {
    "profit-and-loss": {
        "title": "Profit & loss by month",
        "description": "Cash collected vs. expenses per month (UNION ALL of two ledgers, then GROUP BY).",
        "sql": "SELECT * FROM v_profit_and_loss ORDER BY period",
        "chart": {"type": "bar", "x": "period", "y": ["income", "expenses", "net_profit"]},
    },
    "tenant-balances": {
        "title": "Tenant balances",
        "description": "Invoiced, paid and outstanding amount per tenant (LEFT JOIN + GROUP BY).",
        "sql": "SELECT * FROM v_tenant_balances ORDER BY outstanding DESC, business_name",
        "chart": {"type": "bar", "x": "business_name", "y": ["outstanding", "overdue_amount"]},
    },
    "overdue-invoices": {
        "title": "Overdue invoices",
        "description": "Unpaid or partially paid invoices past their due date.",
        "sql": "SELECT invoice_no, business_name, unit_code, period, total_amount, amount_paid, "
               "balance_due, due_date, days_overdue FROM v_invoice_summary "
               "WHERE days_overdue > 0 ORDER BY days_overdue DESC",
        "chart": None,
    },
    "floor-occupancy": {
        "title": "Occupancy by floor",
        "description": "Units per floor by status, using conditional aggregation SUM(CASE ...).",
        "sql": "SELECT * FROM v_floor_occupancy ORDER BY level_number",
        "chart": {"type": "bar", "x": "floor_name", "y": ["occupied_units", "vacant_units", "maintenance_units"],
                  "stacked": True},
    },
    "category-revenue": {
        "title": "Rent by shop category",
        "description": "Contracted monthly rent and rent per sq ft for each category.",
        "sql": "SELECT * FROM v_category_revenue ORDER BY monthly_rent DESC",
        "chart": {"type": "bar", "x": "category_name", "y": ["monthly_rent"]},
    },
    "monthly-income": {
        "title": "Collections by month",
        "description": "Number and value of payments received each month.",
        "sql": "SELECT * FROM v_monthly_income ORDER BY period",
        "chart": {"type": "line", "x": "period", "y": ["collected"]},
    },
    "monthly-expenses": {
        "title": "Expenses by month and category",
        "description": "Expense totals grouped by month and category.",
        "sql": "SELECT * FROM v_monthly_expenses ORDER BY period, total_spent DESC",
        "chart": None,
    },
    "expiring-leases": {
        "title": "Leases expiring in 90 days",
        "description": "Active leases whose end date is within the next 90 days.",
        "sql": "SELECT * FROM v_expiring_leases ORDER BY days_remaining",
        "chart": None,
    },
    "open-maintenance": {
        "title": "Open maintenance tickets",
        "description": "Tickets that are open or in progress, with their age in days.",
        "sql": "SELECT * FROM v_open_maintenance ORDER BY FIELD(priority,'critical','high','medium','low'), age_days DESC",
        "chart": None,
    },
    "department-payroll": {
        "title": "Payroll by department",
        "description": "Active head count and monthly payroll per department.",
        "sql": "SELECT * FROM v_department_payroll ORDER BY monthly_payroll DESC",
        "chart": {"type": "bar", "x": "department_name", "y": ["monthly_payroll"]},
    },
    "shop-directory": {
        "title": "Shop directory",
        "description": "All units with floor, category and current tenant.",
        "sql": "SELECT unit_code, floor_name, category_name, area_sqft, base_rent, status, "
               "current_tenant, current_rent, lease_end_date FROM v_shop_directory ORDER BY level_number, unit_code",
        "chart": None,
    },
    "payment-register": {
        "title": "Payment register",
        "description": "Every payment received, newest first.",
        "sql": "SELECT payment_id, payment_date, invoice_no, business_name, unit_code, amount, method, "
               "reference_no, recorded_by FROM v_payment_register ORDER BY payment_date DESC, payment_id DESC",
        "chart": None,
    },
}


def _csv_response(rows: list[dict], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _columns(rows: list[dict]) -> list[str]:
    return list(rows[0].keys()) if rows else []


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@router.get("/dashboard", summary="Key figures and chart data for the dashboard")
def dashboard(conn=Depends(get_db), _user=Depends(any_user)):
    kpis = fetch_one(conn, """
        SELECT
          (SELECT COUNT(*) FROM shops)                                         AS total_shops,
          (SELECT COUNT(*) FROM shops WHERE status = 'occupied')               AS occupied_shops,
          (SELECT COUNT(*) FROM shops WHERE status = 'vacant')                 AS vacant_shops,
          (SELECT COUNT(*) FROM shops WHERE status = 'under_maintenance')      AS maintenance_shops,
          (SELECT COUNT(*) FROM tenants)                                       AS tenants,
          (SELECT COUNT(*) FROM leases WHERE status = 'active')                AS active_leases,
          (SELECT COALESCE(SUM(monthly_rent), 0) FROM leases WHERE status = 'active') AS contracted_rent,
          (SELECT COALESCE(SUM(balance_due), 0) FROM v_invoice_summary
             WHERE status IN ('unpaid', 'partially_paid'))                     AS outstanding,
          (SELECT COALESCE(SUM(balance_due), 0) FROM v_invoice_summary WHERE days_overdue > 0) AS overdue_amount,
          (SELECT COUNT(*) FROM v_invoice_summary WHERE days_overdue > 0)      AS overdue_invoices,
          (SELECT COALESCE(SUM(amount), 0) FROM payments
             WHERE payment_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01'))         AS collected_this_month,
          (SELECT COALESCE(SUM(total_amount), 0) FROM expenses
             WHERE expense_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01'))         AS expenses_this_month,
          (SELECT COUNT(*) FROM maintenance_requests WHERE status IN ('open', 'in_progress')) AS open_tickets,
          (SELECT COUNT(*) FROM v_expiring_leases)                             AS expiring_leases,
          (SELECT COUNT(*) FROM employees WHERE is_active = 1)                 AS active_employees
    """)
    kpis["occupancy_pct"] = round(100 * kpis["occupied_shops"] / kpis["total_shops"], 1) if kpis["total_shops"] else 0

    return {
        "kpis": kpis,
        "profit_and_loss": fetch_all(conn, """
            SELECT * FROM v_profit_and_loss
            WHERE period >= DATE_FORMAT(CURDATE() - INTERVAL 11 MONTH, '%Y-%m')
            ORDER BY period"""),
        "floor_occupancy": fetch_all(conn, "SELECT * FROM v_floor_occupancy ORDER BY level_number"),
        "category_revenue": fetch_all(conn, """
            SELECT category_name, monthly_rent FROM v_category_revenue
            WHERE monthly_rent > 0 ORDER BY monthly_rent DESC"""),
        "invoice_status": fetch_all(conn, """
            SELECT status, COUNT(*) AS invoices, SUM(total_amount) AS amount
            FROM invoices GROUP BY status ORDER BY FIELD(status, 'paid', 'partially_paid', 'unpaid', 'void')"""),
        "expense_breakdown": fetch_all(conn, """
            SELECT category_name, SUM(total_spent) AS total
            FROM v_monthly_expenses
            WHERE period >= DATE_FORMAT(CURDATE() - INTERVAL 11 MONTH, '%Y-%m')
            GROUP BY category_name ORDER BY total DESC"""),
        "top_debtors": fetch_all(conn, """
            SELECT tenant_id, business_name, outstanding, overdue_amount
            FROM v_tenant_balances WHERE outstanding > 0
            ORDER BY outstanding DESC LIMIT 5"""),
        "recent_payments": fetch_all(conn, """
            SELECT payment_id, payment_date, business_name, invoice_no, amount, method
            FROM v_payment_register ORDER BY payment_date DESC, payment_id DESC LIMIT 6"""),
        "expiring_leases": fetch_all(conn, "SELECT * FROM v_expiring_leases ORDER BY days_remaining LIMIT 6"),
        "open_maintenance": fetch_all(conn, """
            SELECT * FROM v_open_maintenance
            ORDER BY FIELD(priority, 'critical', 'high', 'medium', 'low'), age_days DESC LIMIT 6"""),
    }


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
@router.get("/reports", summary="Catalogue of available reports")
def report_catalogue(_user=Depends(any_user)):
    return [{"key": k, **v} for k, v in REPORTS.items()]


@router.get("/reports/monthly-summary", summary="12-month summary (sp_monthly_summary, recursive CTE)")
def monthly_summary(
    year: int = Query(default_factory=lambda: date.today().year, ge=2000, le=2100),
    format: str = Query("json", pattern="^(json|csv)$"),
    conn=Depends(get_db),
    _user=Depends(any_user),
):
    rows = call_procedure(conn, "CALL sp_monthly_summary(%s)", (year,))
    if format == "csv":
        return _csv_response(rows, f"monthly-summary-{year}.csv")
    return {"year": year, "sql": f"CALL sp_monthly_summary({year})", "columns": _columns(rows), "rows": rows}


@router.get("/reports/tenant-statement/{tenant_id}",
            summary="Account statement with running balance (sp_tenant_statement, window function)")
def tenant_statement(
    tenant_id: int,
    format: str = Query("json", pattern="^(json|csv)$"),
    conn=Depends(get_db),
    _user=Depends(any_user),
):
    tenant = fetch_one(conn, "SELECT * FROM v_tenant_balances WHERE tenant_id = %s", (tenant_id,))
    if not tenant:
        raise HTTPException(status_code=404, detail=f"Tenant {tenant_id} not found")
    rows = call_procedure(conn, "CALL sp_tenant_statement(%s)", (tenant_id,))
    if format == "csv":
        return _csv_response(rows, f"tenant-{tenant_id}-statement.csv")
    return {"tenant": tenant, "sql": f"CALL sp_tenant_statement({tenant_id})",
            "columns": _columns(rows), "rows": rows}


@router.get("/reports/{key}", summary="Run a named report (JSON or CSV)")
def run_report(
    key: str,
    format: str = Query("json", pattern="^(json|csv)$"),
    conn=Depends(get_db),
    _user=Depends(any_user),
):
    report = REPORTS.get(key)
    if report is None:
        raise HTTPException(status_code=404, detail=f"Unknown report '{key}'")
    rows = fetch_all(conn, report["sql"])
    if format == "csv":
        return _csv_response(rows, f"{key}.csv")
    return {"key": key, **report, "columns": _columns(rows), "rows": rows}
