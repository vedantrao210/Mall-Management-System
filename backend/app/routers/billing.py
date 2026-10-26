"""Leases, invoices and payments.

The important business operations are executed by STORED PROCEDURES so the
logic (and its transaction) lives in the database:

    POST /api/leases/{id}/terminate  -> CALL sp_terminate_lease(...)
    POST /api/leases/expire          -> CALL sp_expire_leases(...)
    POST /api/invoices/generate      -> CALL sp_generate_invoices(...)
    POST /api/payments               -> CALL sp_record_payment(...)
"""
from fastapi import APIRouter, Depends, HTTPException

from .. import schemas as s
from ..crud import Resource, build_router, get_record
from ..database import call_procedure, execute, fetch_all, fetch_one, get_db
from ..security import admin_only, any_user, writer

# ---------------------------------------------------------------------------
# Leases
# ---------------------------------------------------------------------------
LEASES = Resource(
    name="leases", title="Leases", table="leases", pk="lease_id",
    list_sql="SELECT * FROM v_lease_details",
    columns=["lease_id", "unit_code", "floor_name", "business_name", "start_date", "end_date",
             "monthly_rent", "security_deposit", "tax_rate", "status", "days_remaining",
             "shop_id", "tenant_id", "term_months"],
    search=["unit_code", "business_name", "floor_name"],
    filters=["status", "shop_id", "tenant_id"],
    default_sort="lease_id",
    label_sql="CONCAT('#', lease_id, ' (', status, ')')",
    create_model=s.LeaseIn, update_model=s.LeaseUpdate,
    delete_roles=("admin",),
)

leases_extra = APIRouter(prefix="/api/leases", tags=["Leases"])


@leases_extra.post("/expire", summary="Mark leases past their end date as expired")
def expire_leases(conn=Depends(get_db), _user=Depends(writer)):
    call_procedure(conn, "CALL sp_expire_leases(@expired)")
    return {"expired": fetch_one(conn, "SELECT @expired AS n")["n"]}


@leases_extra.post("/{lease_id}/terminate", summary="Terminate an active lease early")
def terminate_lease(lease_id: int, body: s.TerminateLeaseIn, conn=Depends(get_db), _user=Depends(writer)):
    call_procedure(conn, "CALL sp_terminate_lease(%s, %s, @voided)", (lease_id, body.end_date))
    voided = fetch_one(conn, "SELECT @voided AS n")["n"]
    return {"lease": get_record(conn, LEASES, lease_id), "voided_invoices": voided}


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------
INVOICES = Resource(
    name="invoices", title="Invoices", table="invoices", pk="invoice_id",
    list_sql="SELECT v.*, (v.days_overdue > 0) AS is_overdue FROM v_invoice_summary v",
    columns=["invoice_id", "invoice_no", "business_name", "unit_code", "billing_month", "period",
             "total_amount", "amount_paid", "balance_due", "due_date", "status", "days_overdue",
             "tenant_id", "lease_id", "is_overdue"],
    search=["invoice_no", "business_name", "unit_code", "period"],
    filters=["status", "tenant_id", "lease_id", "period", "is_overdue"],
    default_sort="billing_month",
    label_sql="invoice_no",
    allow_delete=False,              # invoices are voided, never deleted
)

invoices_extra = APIRouter(prefix="/api/invoices", tags=["Invoices"])


@invoices_extra.post("/generate", summary="Generate monthly rent invoices")
def generate_invoices(body: s.GenerateInvoicesIn, conn=Depends(get_db), _user=Depends(writer)):
    call_procedure(conn, "CALL sp_generate_invoices(%s, %s, @created)", (body.month, body.due_days))
    created = fetch_one(conn, "SELECT @created AS n")["n"]
    return {"created": created, "month": body.month.replace(day=1).isoformat()}


@invoices_extra.post("/{invoice_id}/void", summary="Void an unpaid invoice")
def void_invoice(invoice_id: int, conn=Depends(get_db), _user=Depends(writer)):
    inv = get_record(conn, INVOICES, invoice_id)
    if inv["status"] == "void":
        raise HTTPException(status_code=409, detail="Invoice is already void")
    execute(conn, "UPDATE invoices SET status = 'void' WHERE invoice_id = %s", (invoice_id,))
    return get_record(conn, INVOICES, invoice_id)


@invoices_extra.get("/{invoice_id}/payments", summary="Payments made against an invoice")
def invoice_payments(invoice_id: int, conn=Depends(get_db), _user=Depends(any_user)):
    get_record(conn, INVOICES, invoice_id)
    return fetch_all(
        conn,
        "SELECT * FROM v_payment_register WHERE invoice_id = %s ORDER BY payment_date, payment_id",
        (invoice_id,),
    )


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------
PAYMENTS = Resource(
    name="payments", title="Payments", table="payments", pk="payment_id",
    list_sql="SELECT * FROM v_payment_register",
    columns=["payment_id", "invoice_no", "business_name", "unit_code", "amount", "payment_date",
             "method", "reference_no", "recorded_by", "tenant_id", "invoice_id"],
    search=["invoice_no", "business_name", "unit_code", "reference_no", "method"],
    filters=["method", "tenant_id", "invoice_id"],
    default_sort="payment_date",
    label_sql="CONCAT('#', payment_id)",
    delete_roles=("admin",),         # reversal of a payment is an admin action
)

payments_extra = APIRouter(prefix="/api/payments", tags=["Payments"])


@payments_extra.post("", status_code=201, summary="Record a payment (transactional procedure)")
def record_payment(body: s.PaymentIn, conn=Depends(get_db), user=Depends(writer)):
    call_procedure(
        conn,
        "CALL sp_record_payment(%s, %s, %s, %s, %s, %s, @payment_id)",
        (body.invoice_id, body.amount, body.payment_date, body.method, body.reference_no, user["user_id"]),
    )
    payment_id = fetch_one(conn, "SELECT @payment_id AS id")["id"]
    return {
        "payment": get_record(conn, PAYMENTS, payment_id),
        "invoice": get_record(conn, INVOICES, body.invoice_id),
    }


# extra routers first so fixed paths (e.g. /generate) win over /{id}
routers = [
    leases_extra, build_router(LEASES),
    invoices_extra, build_router(INVOICES),
    payments_extra, build_router(PAYMENTS),
]

_ = admin_only  # re-exported for clarity in docs
