"""Translate MySQL errors into clear HTTP responses.

Business rules live in the database (constraints, triggers, procedures). When
one of them rejects a change, MySQL raises an error with a numeric code; this
module maps those codes to an HTTP status and a readable message for the UI.
"""
import logging
import re

import pymysql
from fastapi import Request
from fastapi.responses import JSONResponse

log = logging.getLogger("mall.errors")

# Friendly text for CHECK constraints defined in 01_schema.sql
CHECK_MESSAGES = {
    "chk_app_users_username": "Username must be at least 3 characters",
    "chk_floors_level": "Floor level must be between -5 and 50",
    "chk_shops_area": "Area must be greater than zero",
    "chk_shops_rent": "Base rent cannot be negative",
    "chk_tenants_email": "Email address is not valid",
    "chk_tenants_phone": "Phone number may contain only digits, spaces, +, -, ( ) (7-20 characters)",
    "chk_leases_dates": "Lease end date must be after the start date",
    "chk_leases_rent": "Monthly rent must be greater than zero",
    "chk_leases_deposit": "Security deposit cannot be negative",
    "chk_leases_tax": "Tax rate must be between 0 and 100",
    "chk_invoices_month": "Billing month must be the first day of a month",
    "chk_invoices_due": "Due date cannot be before the issue date",
    "chk_payments_amount": "Payment amount must be greater than zero",
    "chk_employees_salary": "Salary cannot be negative",
    "chk_employees_phone": "Phone number may contain only digits, spaces, +, -, ( ) (7-20 characters)",
    "chk_expenses_amount": "Expense amount must be greater than zero",
    "chk_expenses_tax": "Tax rate must be between 0 and 100",
    "chk_maint_cost": "Cost cannot be negative",
    "chk_maint_resolved": "Resolved time cannot be before the reported time",
}

UNIQUE_MESSAGES = {
    "uq_app_users_username": "That username is already taken",
    "uq_floors_level": "A floor with that level number already exists",
    "uq_floors_name": "A floor with that name already exists",
    "uq_shop_categories_name": "A category with that name already exists",
    "uq_departments_name": "A department with that name already exists",
    "uq_expense_categories_name": "An expense category with that name already exists",
    "uq_shops_unit_code": "A shop with that unit code already exists",
    "uq_tenants_email": "A tenant with that email already exists",
    "uq_tenants_tax_id": "A tenant with that tax ID already exists",
    "uq_leases_one_active_per_shop": "Shop already has an active lease",
    "uq_invoices_lease_month": "An invoice for that lease and month already exists",
    "uq_employees_code": "An employee with that code already exists",
    "uq_employees_email": "An employee with that email already exists",
}


def mysql_error_to_response(code: int, message: str) -> tuple[int, str]:
    if code == 1644:  # SIGNAL SQLSTATE '45000' from a trigger / procedure
        return 409, message
    if code == 3819:  # CHECK constraint violated
        m = re.search(r"'([^']+)'", message)
        name = m.group(1) if m else ""
        return 422, CHECK_MESSAGES.get(name, f"Value rejected by rule {name}")
    if code == 1062:  # duplicate key
        m = re.search(r"for key '(?:[^.']+\.)?([^']+)'", message)
        name = m.group(1) if m else ""
        return 409, UNIQUE_MESSAGES.get(name, "A record with the same unique value already exists")
    if code == 1451:  # cannot delete / update parent row
        m = re.search(r"CONSTRAINT `([^`]+)`", message)
        return 409, (
            "This record is still referenced by other records and cannot be deleted"
            + (f" ({m.group(1)})" if m else "")
        )
    if code == 1452:  # child row references a missing parent
        return 422, "A referenced record does not exist"
    if code in (1048, 1364):  # NOT NULL / no default
        m = re.search(r"'([^']+)'", message)
        return 422, f"Field '{m.group(1) if m else '?'}' is required"
    if code in (1406, 1264, 1265, 1366, 1292):  # data too long / out of range / bad value
        return 422, f"Invalid value: {message}"
    if code in (1142, 1143, 1227):  # privilege errors
        return 403, f"Database permission denied: {message}"
    if code in (3024,):  # MAX_EXECUTION_TIME exceeded
        return 408, "Query took too long and was stopped"
    if code in (2003, 2006, 2013, 1045):
        return 503, "Database is not reachable"
    return 400, message


async def mysql_exception_handler(request: Request, exc: pymysql.err.MySQLError) -> JSONResponse:
    code = exc.args[0] if exc.args and isinstance(exc.args[0], int) else 0
    message = exc.args[1] if len(exc.args) > 1 else str(exc)
    status_code, detail = mysql_error_to_response(code, str(message))
    if status_code >= 500:
        log.error("MySQL error %s: %s", code, message)
    return JSONResponse(status_code=status_code, content={"detail": detail, "mysql_error": code})
