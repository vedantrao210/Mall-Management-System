# Normalisation

This document shows how the schema was derived step by step from a single
"rent register" spreadsheet to the final set of tables in **Boyce-Codd normal
form (BCNF)**. It also lists the few places where data is stored redundantly on
purpose, and how that redundancy is kept consistent.

## 0. Starting point: one flat register (unnormalised)

A spreadsheet that a mall office might keep, one row per shop per month:

| unit | floor | category | area | tenant | contact | phone | lease_start | lease_end | rent | tax% | month | invoice_total | payments |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G-05 | Ground Floor | Food & Beverage | 700 | Brew Haven Cafe | Outlet Manager | 9000000109 | 2023-12-01 | 2026-12-04 | 78000 | 18 | 2026-05 | 92040 | 2026-05-14 online 46020; 2026-05-28 card 46020 |
| G-05 | Ground Floor | Food & Beverage | 700 | Brew Haven Cafe | Outlet Manager | 9000000109 | 2023-12-01 | 2026-12-04 | 78000 | 18 | 2026-06 | 92040 | |

Problems:

* **Repeating group**: the `payments` cell holds a list.
* **Update anomaly**: a tenant's phone number is repeated on every row; changing it
  means changing many rows, and missing one leaves the data inconsistent.
* **Insertion anomaly**: a new, still vacant shop cannot be recorded without
  inventing a tenant and a month.
* **Deletion anomaly**: deleting the last invoice row of a tenant also deletes
  everything we know about that tenant and the shop.

## 1. First normal form (1NF)

*Every attribute holds one atomic value; there are no repeating groups.*

The payment list is moved to its own relation, one row per payment:

```
REGISTER(unit, month, floor, category, area, tenant, contact, phone,
         lease_start, lease_end, rent, tax_rate, invoice_total)
PAYMENT(unit, month, payment_date, amount, method)
```

Key of `REGISTER`: **{unit, month}**.

## 2. Second normal form (2NF)

*1NF, and every non-key attribute depends on the **whole** key.*

Functional dependencies in `REGISTER`:

| Dependency | Comment |
|---|---|
| unit → floor, category, area | describes the shop, independent of month: **partial dependency** |
| unit, month → tenant, rent, tax_rate, lease dates | who occupied the shop that month |
| unit, month → invoice_total | the bill for that month |

Removing the partial dependency:

```
SHOP(unit, floor, category, area)
MONTHLY_BILL(unit, month, tenant, contact, phone, lease_start, lease_end,
             rent, tax_rate, invoice_total)
PAYMENT(unit, month, payment_date, amount, method)
```

## 3. Third normal form (3NF)

*2NF, and no non-key attribute depends on another non-key attribute
(no transitive dependencies).*

Remaining transitive dependencies:

| Dependency chain | Fix |
|---|---|
| {unit, month} → tenant → contact, phone | `TENANTS` table |
| {unit, month} → lease → lease_start, lease_end, rent, tax_rate | `LEASES` table (a lease spans many months) |
| rent, tax_rate → invoice tax and total | not stored as independent facts: `tax_amount` and `total_amount` are **generated columns** |
| unit → floor (name) → level number | `FLOORS` lookup table |
| unit → category (name) → description | `SHOP_CATEGORIES` lookup table |

Surrogate keys (`*_id`, AUTO_INCREMENT) are introduced for every entity; the
natural keys (`unit_code`, `invoice_no`, `employee_code`, `username`, …) are kept
as `UNIQUE` constraints.

Result for the rental side:

```
FLOORS(floor_id PK, level_number UQ, name UQ)
SHOP_CATEGORIES(category_id PK, name UQ, description)
SHOPS(shop_id PK, unit_code UQ, floor_id FK, category_id FK, area_sqft, base_rent, status)
TENANTS(tenant_id PK, business_name, contact_person, email UQ, phone, tax_id UQ)
LEASES(lease_id PK, shop_id FK, tenant_id FK, start_date, end_date,
       monthly_rent, security_deposit, tax_rate, status)
INVOICES(invoice_id PK, invoice_no UQ, lease_id FK, billing_month,
         rent_amount, tax_rate, tax_amount*, total_amount*, issue_date, due_date, status)
         UQ(lease_id, billing_month)
PAYMENTS(payment_id PK, invoice_id FK, amount, payment_date, method, reference_no, recorded_by FK)
```

The same analysis applied to staff and costs gives `DEPARTMENTS → EMPLOYEES`
and `EXPENSE_CATEGORIES → EXPENSES`, and `MAINTENANCE_REQUESTS` references
`SHOPS` and `EMPLOYEES`.

## 4. Boyce-Codd normal form (BCNF)

*For every non-trivial dependency X → Y, X is a super key.*

Every table has only dependencies whose left side is a candidate key:

| Table | Candidate keys | Other determinants? |
|---|---|---|
| shops | shop_id, unit_code | none |
| floors | floor_id, level_number, name | none |
| leases | lease_id | none (several leases per shop and per tenant over time) |
| invoices | invoice_id, invoice_no, {lease_id, billing_month} | none |
| payments | payment_id | none |
| employees | employee_id, employee_code, email | none |
| app_users | user_id, username | none |

So the schema is in BCNF. (No multi-valued dependencies exist either, so it
also satisfies 4NF.)

## 5. Controlled redundancy (deliberate)

| Data | Why it is stored | How it stays correct |
|---|---|---|
| `invoices.rent_amount`, `invoices.tax_rate` | Historical snapshot: an invoice must not change if the lease rent or tax rate changes later. This is a different fact ("what was billed"), not a copy. | Copied once by `sp_generate_invoices`; a trigger blocks changing amounts after payments exist |
| `invoices.tax_amount`, `total_amount`, `expenses.tax_amount`, `total_amount` | Convenience for queries and indexes | `STORED GENERATED` columns: MySQL computes them, they cannot be written |
| `shops.status` (occupied / vacant) | Fast filtering without joining leases | Maintained only by lease triggers; manual changes to/from "occupied" are rejected |
| `invoices.status` (unpaid / partially paid / paid) | Fast filtering of overdue bills | Recomputed by payment triggers (`fn_invoice_status`) |
| `leases.active_shop_key` | Lets a `UNIQUE` index enforce "one active lease per shop" | `VIRTUAL GENERATED` column |

Derived figures that change constantly (amount paid, balance due, days overdue,
occupancy percentage, outstanding balance per tenant) are **not** stored at
all; views such as `v_invoice_summary`, `v_tenant_balances` and
`v_floor_occupancy` compute them on demand.
