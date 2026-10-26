# REST API

Base URL: `/api`. Interactive documentation (Swagger UI) is served at
**`/docs`** and the OpenAPI schema at `/openapi.json` while the backend runs.

## Authentication

```http
POST /api/auth/login
Content-Type: application/json

{"username": "manager", "password": "Manager@123"}
```

Response: `{"access_token": "...", "token_type": "bearer", "user": {...}}`.
Send the token on every other request:

```http
Authorization: Bearer <access_token>
```

Roles: **admin** (everything), **manager** (create / edit business data,
reports, database explorer), **staff** (read everything, create / edit
maintenance requests only).

## Conventions

| Topic | Convention |
|---|---|
| Lists | `GET /api/<resource>?search=&sort=&order=asc|desc&page=1&page_size=25` plus exact-match filters, e.g. `?status=vacant&floor_id=2`. Response: `{items, total, page, page_size}` |
| Drop-downs | `GET /api/<resource>/options` → `[{value, label}]` |
| Create | `POST` → `201` with the created record |
| Update | `PATCH` with only the fields to change |
| Delete | `DELETE` → `204` |
| Errors | `{"detail": "...", "mysql_error": <code>}`; see the table below |

MySQL errors are translated into HTTP status codes, so database rules show up
as readable messages in the UI:

| MySQL error | Meaning | HTTP |
|---|---|---|
| 1644 (`SIGNAL` in a trigger / procedure) | business rule violated | 409 |
| 1062 | duplicate value for a UNIQUE key | 409 |
| 1451 | row is still referenced (FK RESTRICT) | 409 |
| 3819 | CHECK constraint violated | 422 |
| 1452, 1048, 1364, data errors | invalid reference / missing or invalid value | 422 |
| 1142, 1143, 1227 | the MySQL account lacks the privilege | 403 |
| 3024 | query exceeded `MAX_EXECUTION_TIME` | 408 |
| connection errors | database unavailable | 503 |

## Endpoints

### Auth and users
| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/login` | public | Get a token |
| GET | `/auth/me` | any | Current user |
| POST | `/auth/change-password` | any | Change own password |
| GET / POST | `/users` | admin | List / create users |
| PATCH / DELETE | `/users/{id}` | admin | Update / delete a user |
| POST | `/users/{id}/reset-password` | admin | Set a new password |

### Master data and operations (generic CRUD)
`floors`, `shop-categories`, `departments`, `expense-categories`, `shops`,
`tenants`, `employees`, `expenses`, `maintenance` each provide:

| Method | Path | Role |
|---|---|---|
| GET | `/{resource}`, `/{resource}/options`, `/{resource}/{id}` | any |
| POST, PATCH, DELETE | `/{resource}`, `/{resource}/{id}` | admin, manager (maintenance: also staff, except DELETE) |

### Leases, invoices and payments
| Method | Path | Role | Database object used |
|---|---|---|---|
| GET / POST | `/leases` | any / writer | `v_lease_details`, lease triggers |
| PATCH / DELETE | `/leases/{id}` | writer / admin | |
| POST | `/leases/{id}/terminate` | writer | `CALL sp_terminate_lease` |
| POST | `/leases/expire` | writer | `CALL sp_expire_leases` (also a nightly EVENT) |
| GET | `/invoices` | any | `v_invoice_summary` |
| POST | `/invoices/generate` `{month, due_days}` | writer | `CALL sp_generate_invoices` |
| POST | `/invoices/{id}/void` | writer | `trg_invoices_before_update` |
| GET | `/invoices/{id}/payments` | any | |
| GET | `/payments` | any | `v_payment_register` |
| POST | `/payments` `{invoice_id, amount, payment_date, method, reference_no}` | writer | `CALL sp_record_payment` (transaction + row lock) |
| DELETE | `/payments/{id}` | admin | reversal; `trg_payments_after_delete` |

### Reports
| Method | Path | Description |
|---|---|---|
| GET | `/dashboard` | KPIs and chart series |
| GET | `/reports` | Catalogue: key, title, description, SQL, chart hint |
| GET | `/reports/{key}` | Run a report; add `?format=csv` to download CSV |
| GET | `/reports/monthly-summary?year=2026` | `CALL sp_monthly_summary` (CSV too) |
| GET | `/reports/tenant-statement/{tenant_id}` | `CALL sp_tenant_statement` (CSV too) |

Report keys: `profit-and-loss`, `tenant-balances`, `overdue-invoices`,
`floor-occupancy`, `category-revenue`, `monthly-income`, `monthly-expenses`,
`expiring-leases`, `open-maintenance`, `department-payroll`, `shop-directory`,
`payment-register`.

### Database administration (admin, manager)
| Method | Path | Description |
|---|---|---|
| GET | `/admin/overview` | Server variables, tables with exact row counts and sizes, object counts |
| GET | `/admin/er-diagram` | Tables, columns and foreign keys |
| GET | `/admin/tables/{name}` | Columns, indexes, FKs, referencing tables, CHECKs, triggers, DDL |
| GET | `/admin/tables/{name}/rows` | Browse rows through the read-only account |
| GET | `/admin/objects` | Views, procedures, functions, triggers, events with source (`CALL sp_db_objects`) |
| GET | `/admin/scripts`, `/admin/scripts/{name}` | The SQL files in `database/` |
| POST | `/admin/sql` `{sql}` | Read-only console: one `SELECT/WITH/SHOW/DESCRIBE/EXPLAIN`, read-only account and transaction, 5 s limit, 500 rows |
| GET | `/admin/audit` | Audit log, filters `table_name`, `action`, `record_id` |
| GET | `/admin/backup` | **admin only**: data-only SQL dump |

### Health
`GET /api/health` → `{"status": "ok", "database": "up", "mysql_version": "8.4.x"}` (no login needed).
