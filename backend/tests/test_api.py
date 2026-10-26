"""Integration tests: run against a real MySQL database created from database/*.sql.

    cd backend
    pytest -q

The tests create their own uniquely-named records, so they can be re-run.
They do leave those records behind: run `python manage.py setup-db` afterwards to
get back to the clean sample data.
"""
import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SUFFIX = uuid.uuid4().hex[:6]


def login(username: str, password: str) -> dict:
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def admin():
    return login("admin", "Admin@123")


@pytest.fixture(scope="module")
def manager():
    return login("manager", "Manager@123")


@pytest.fixture(scope="module")
def staff():
    return login("staff", "Staff@123")


# ---------------------------------------------------------------------------
def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["database"] == "up"


def test_login_rejects_bad_password():
    r = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code == 401


def test_requires_token():
    assert client.get("/api/shops").status_code == 401


def test_me(manager):
    r = client.get("/api/auth/me", headers=manager)
    assert r.json()["role"] == "manager"


def test_list_search_sort_paginate(staff):
    r = client.get("/api/shops", params={"page_size": 5, "sort": "base_rent", "order": "desc"}, headers=staff)
    body = r.json()
    assert r.status_code == 200 and len(body["items"]) == 5 and body["total"] >= 20
    rents = [row["base_rent"] for row in body["items"]]
    assert rents == sorted(rents, reverse=True)
    r = client.get("/api/shops", params={"status": "vacant"}, headers=staff)
    assert all(row["status"] == "vacant" for row in r.json()["items"])


def test_staff_cannot_write(staff):
    r = client.post("/api/floors", json={"level_number": 9, "name": "Nope"}, headers=staff)
    assert r.status_code == 403


def test_validation_and_check_constraints(manager):
    # Pydantic validation
    r = client.post("/api/tenants", json={"business_name": "X", "contact_person": "Y",
                                          "email": "not-an-email", "phone": "123"}, headers=manager)
    assert r.status_code == 422
    # Unique constraint from MySQL
    r = client.post("/api/shop-categories", json={"name": "Apparel"}, headers=manager)
    assert r.status_code == 409 and "already exists" in r.json()["detail"]


def test_foreign_key_restrict(manager):
    # floor 1 has shops -> ON DELETE RESTRICT
    r = client.delete("/api/floors/1", headers=manager)
    assert r.status_code == 409


def test_full_lease_billing_cycle(manager, admin):
    # 1. new tenant + new shop
    tenant = client.post("/api/tenants", json={
        "business_name": f"Test Tenant {SUFFIX}", "contact_person": "Store Manager",
        "email": f"t{SUFFIX}@test.example", "phone": "9000000999"}, headers=manager).json()
    shop = client.post("/api/shops", json={
        "unit_code": f"T-{SUFFIX[:4]}", "floor_id": 2, "category_id": 1,
        "area_sqft": 500, "base_rent": 40000}, headers=manager).json()
    assert shop["status"] == "vacant"

    # 2. lease -> trigger marks shop occupied
    start = date.today().replace(day=1) - timedelta(days=40)
    lease = client.post("/api/leases", json={
        "shop_id": shop["shop_id"], "tenant_id": tenant["tenant_id"],
        "start_date": start.isoformat(), "end_date": (start + timedelta(days=730)).isoformat(),
        "monthly_rent": 40000, "security_deposit": 120000, "tax_rate": 18}, headers=manager)
    assert lease.status_code == 201, lease.text
    lease = lease.json()
    assert client.get(f"/api/shops/{shop['shop_id']}", headers=manager).json()["status"] == "occupied"

    # 3. a second active lease on the same shop is rejected by a trigger
    r = client.post("/api/leases", json={
        "shop_id": shop["shop_id"], "tenant_id": 2, "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=365)).isoformat(), "monthly_rent": 1000}, headers=manager)
    assert r.status_code == 409 and "active lease" in r.json()["detail"]

    # 4. generate invoices (stored procedure) - idempotent
    r = client.post("/api/invoices/generate", json={"month": date.today().isoformat()}, headers=manager)
    assert r.status_code == 200
    r2 = client.post("/api/invoices/generate", json={"month": date.today().isoformat()}, headers=manager)
    assert r2.json()["created"] == 0
    invoices = client.get("/api/invoices", params={"lease_id": lease["lease_id"]}, headers=manager).json()["items"]
    assert len(invoices) == 1
    inv = invoices[0]
    assert inv["total_amount"] == 47200.0          # 40000 + 18 % tax (generated column)

    # 5. partial payment -> status partially_paid
    r = client.post("/api/payments", json={"invoice_id": inv["invoice_id"], "amount": 20000,
                                           "method": "cash"}, headers=manager)
    assert r.status_code == 201, r.text
    assert r.json()["invoice"]["status"] == "partially_paid"

    # 6. overpayment rejected by the procedure
    r = client.post("/api/payments", json={"invoice_id": inv["invoice_id"], "amount": 999999,
                                           "method": "cash"}, headers=manager)
    assert r.status_code == 409 and "exceeds" in r.json()["detail"]

    # 7. pay the rest -> paid; voiding is now forbidden
    r = client.post("/api/payments", json={"invoice_id": inv["invoice_id"], "amount": 27200,
                                           "method": "card"}, headers=manager)
    assert r.json()["invoice"]["status"] == "paid"
    assert client.post(f"/api/invoices/{inv['invoice_id']}/void", headers=manager).status_code == 409

    # 8. statement with running balance (window function) ends at 0
    st = client.get(f"/api/reports/tenant-statement/{tenant['tenant_id']}", headers=manager).json()
    assert st["rows"][-1]["running_balance"] == 0

    # 9. terminate -> shop vacant again
    r = client.post(f"/api/leases/{lease['lease_id']}/terminate",
                    json={"end_date": date.today().isoformat()}, headers=manager)
    assert r.status_code == 200, r.text
    assert client.get(f"/api/shops/{shop['shop_id']}", headers=manager).json()["status"] == "vacant"

    # 10. audit trail recorded the application user
    audit = client.get("/api/admin/audit", params={"table_name": "leases", "record_id": lease["lease_id"]},
                       headers=admin).json()["items"]
    assert {a["action"] for a in audit} >= {"INSERT", "UPDATE"}
    assert all(a["changed_by"] == "manager" for a in audit)


def test_reports(staff):
    catalogue = client.get("/api/reports", headers=staff).json()
    assert len(catalogue) >= 10
    for report in catalogue:
        r = client.get(f"/api/reports/{report['key']}", headers=staff)
        assert r.status_code == 200, report["key"]
    r = client.get("/api/reports/profit-and-loss", params={"format": "csv"}, headers=staff)
    assert r.headers["content-type"].startswith("text/csv")
    r = client.get("/api/reports/monthly-summary", headers=staff)
    assert len(r.json()["rows"]) == 12
    assert client.get("/api/dashboard", headers=staff).status_code == 200


def test_sql_console_is_read_only(admin):
    r = client.post("/api/admin/sql", json={"sql": "SELECT COUNT(*) AS n FROM shops"}, headers=admin)
    assert r.status_code == 200 and r.json()["rows"][0]["n"] > 0
    assert client.post("/api/admin/sql", json={"sql": "DELETE FROM shops"}, headers=admin).status_code == 422
    assert client.post("/api/admin/sql", json={"sql": "SELECT 1; DROP TABLE shops"},
                       headers=admin).status_code == 422
    # column-level privilege: the read-only account cannot read password hashes
    r = client.post("/api/admin/sql", json={"sql": "SELECT password_hash FROM app_users"}, headers=admin)
    assert r.status_code == 403


def test_admin_tools(admin, staff):
    assert client.get("/api/admin/overview", headers=staff).status_code == 403
    ov = client.get("/api/admin/overview", headers=admin).json()
    assert ov["object_counts"]["TRIGGER"] >= 20
    detail = client.get("/api/admin/tables/leases", headers=admin).json()
    assert detail["foreign_keys"] and detail["checks"] and detail["triggers"]
    rows = client.get("/api/admin/tables/app_users/rows", headers=admin).json()
    assert "password_hash" not in rows["columns"]
    backup = client.get("/api/admin/backup", headers=admin)
    assert backup.status_code == 200 and "INSERT INTO `shops`" in backup.text
    # DEFAULT CURRENT_TIMESTAMP columns are kept, generated columns are skipped
    assert "`reported_at`" in backup.text and "`total_amount`" not in backup.text
    er = client.get("/api/admin/er-diagram", headers=admin).json()
    assert len(er["tables"]) == 14 and any(r["to_table"] == "shops" for r in er["relations"])


def test_user_management(admin):
    r = client.post("/api/users", json={"username": f"user{SUFFIX}", "full_name": "Test User",
                                        "role": "staff", "password": "Password1!"}, headers=admin)
    assert r.status_code == 201
    uid = r.json()["user_id"]
    login(f"user{SUFFIX}", "Password1!")
    client.patch(f"/api/users/{uid}", json={"is_active": False}, headers=admin)
    r = client.post("/api/auth/login", json={"username": f"user{SUFFIX}", "password": "Password1!"})
    assert r.status_code == 403
    assert client.delete(f"/api/users/{uid}", headers=admin).status_code == 204
