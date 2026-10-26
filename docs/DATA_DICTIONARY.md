# Data dictionary

_Generated from `INFORMATION_SCHEMA` by `scripts/generate_data_dictionary.py`._

Key: **PK** primary key, **FK** foreign key, **UQ** unique, **IX** indexed. Columns marked _generated_ are computed by MySQL and cannot be written.

## Tables

| Table | Description |
|---|---|
| [`app_users`](#app_users) | Login accounts with role-based access |
| [`audit_log`](#audit_log) | Change history captured by triggers |
| [`departments`](#departments) | Internal departments of mall staff |
| [`employees`](#employees) | Staff employed by mall management |
| [`expense_categories`](#expense_categories) | Classification of operating expenses |
| [`expenses`](#expenses) | Operating expenses of the mall |
| [`floors`](#floors) | Physical floors / levels of the building |
| [`invoices`](#invoices) | Monthly rent bills raised against leases |
| [`leases`](#leases) | Rental agreement between a tenant and a shop |
| [`maintenance_requests`](#maintenance_requests) | Repair / service tickets for shops and common areas |
| [`payments`](#payments) | Money received against invoices (partial payments allowed) |
| [`shop_categories`](#shop_categories) | Retail category of a shop unit (apparel, food ...) |
| [`shops`](#shops) | Rentable shop units inside the mall |
| [`tenants`](#tenants) | Businesses that rent shop units |

## app_users

Login accounts with role-based access

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `user_id` | `int unsigned` | no | PK | auto_increment |  |
| `username` | `varchar(50)` | no | UQ |  |  |
| `password_hash` | `varchar(255)` | no |  |  | bcrypt hash; never the plain password |
| `full_name` | `varchar(100)` | no |  |  |  |
| `role` | `enum('admin','manager','staff')` | no |  | default `staff` | admin: everything; manager: data entry; staff: read-only + maintenance |
| `is_active` | `tinyint(1)` | no |  | default `1` |  |
| `created_at` | `timestamp` | no |  | default `CURRENT_TIMESTAMP` |  |
| `last_login_at` | `timestamp` | yes |  |  |  |

**Unique keys**

- `uq_app_users_username` (username)

**Check constraints**

- `chk_app_users_active`: `` (`is_active` in (0,1)) ``
- `chk_app_users_username`: `` (char_length(`username`) >= 3) ``

## audit_log

Change history captured by triggers

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `audit_id` | `bigint unsigned` | no | PK | auto_increment |  |
| `table_name` | `varchar(64)` | no | IX |  | Table the change happened in |
| `record_id` | `int unsigned` | no |  |  | Primary key of the changed row |
| `action` | `enum('INSERT','UPDATE','DELETE')` | no |  |  |  |
| `old_data` | `json` | yes |  |  | Row image before the change (JSON), NULL for INSERT |
| `new_data` | `json` | yes |  |  | Row image after the change (JSON), NULL for DELETE |
| `changed_by` | `varchar(100)` | no |  |  | Application user (@app_user) or MySQL account |
| `changed_at` | `timestamp(3)` | no | IX | default `CURRENT_TIMESTAMP(3)` |  |

## departments

Internal departments of mall staff

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `department_id` | `smallint unsigned` | no | PK | auto_increment |  |
| `name` | `varchar(50)` | no | UQ |  |  |
| `description` | `varchar(255)` | yes |  |  |  |

**Unique keys**

- `uq_departments_name` (name)

## employees

Staff employed by mall management

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `employee_id` | `int unsigned` | no | PK | auto_increment |  |
| `employee_code` | `varchar(10)` | no | UQ |  | Staff number, e.g. EMP001 |
| `full_name` | `varchar(100)` | no |  |  |  |
| `email` | `varchar(120)` | yes | UQ |  |  |
| `phone` | `varchar(20)` | no |  |  |  |
| `department_id` | `smallint unsigned` | no | FK → `departments.department_id` |  |  |
| `job_title` | `varchar(60)` | no |  |  |  |
| `monthly_salary` | `decimal(10,2)` | no |  |  |  |
| `hire_date` | `date` | no |  |  |  |
| `is_active` | `tinyint(1)` | no |  | default `1` | 0 once the employee has left (rows are kept for history) |

**Foreign keys**

- `fk_employees_department`: `department_id` → `departments(department_id)` ON DELETE RESTRICT ON UPDATE CASCADE

**Unique keys**

- `uq_employees_code` (employee_code)
- `uq_employees_email` (email)

**Check constraints**

- `chk_employees_active`: `` (`is_active` in (0,1)) ``
- `chk_employees_phone`: `` regexp_like(`phone`,_utf8mb4\'^[0-9+() -]{7,20}$\') ``
- `chk_employees_salary`: `` (`monthly_salary` >= 0) ``

## expense_categories

Classification of operating expenses

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `category_id` | `smallint unsigned` | no | PK | auto_increment |  |
| `name` | `varchar(50)` | no | UQ |  |  |
| `description` | `varchar(255)` | yes |  |  |  |

**Unique keys**

- `uq_expense_categories_name` (name)

## expenses

Operating expenses of the mall

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `expense_id` | `int unsigned` | no | PK | auto_increment |  |
| `category_id` | `smallint unsigned` | no | FK → `expense_categories.category_id` |  |  |
| `description` | `varchar(255)` | no |  |  |  |
| `vendor` | `varchar(100)` | yes |  |  |  |
| `expense_date` | `date` | no | IX |  |  |
| `amount` | `decimal(12,2)` | no |  |  | Amount before tax |
| `tax_rate` | `decimal(5,2)` | no |  | default `0.00` |  |
| `tax_amount` | `decimal(12,2)` | yes |  | _generated_: `` round(((`amount` * `tax_rate`) / 100),2) `` | amount x tax_rate / 100 |
| `total_amount` | `decimal(12,2)` | yes |  | _generated_: `` (`amount` + `tax_amount`) `` | amount + tax_amount |
| `recorded_by` | `int unsigned` | yes | FK → `app_users.user_id` |  | Application user who entered the expense |
| `created_at` | `timestamp` | no |  | default `CURRENT_TIMESTAMP` |  |

**Foreign keys**

- `fk_expenses_category`: `category_id` → `expense_categories(category_id)` ON DELETE RESTRICT ON UPDATE CASCADE
- `fk_expenses_user`: `recorded_by` → `app_users(user_id)` ON DELETE SET NULL ON UPDATE CASCADE

**Check constraints**

- `chk_expenses_amount`: `` (`amount` > 0) ``
- `chk_expenses_tax`: `` (`tax_rate` between 0 and 100) ``

## floors

Physical floors / levels of the building

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `floor_id` | `tinyint unsigned` | no | PK | auto_increment |  |
| `level_number` | `tinyint` | no | UQ |  | Negative numbers are basement levels |
| `name` | `varchar(50)` | no | UQ |  |  |

**Unique keys**

- `uq_floors_level` (level_number)
- `uq_floors_name` (name)

**Check constraints**

- `chk_floors_level`: `` (`level_number` between -(5) and 50) ``

## invoices

Monthly rent bills raised against leases

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `invoice_id` | `int unsigned` | no | PK | auto_increment |  |
| `invoice_no` | `varchar(20)` | no | UQ |  | INV-YYYYMM-LLLL (billing month + lease id) |
| `lease_id` | `int unsigned` | no | FK → `leases.lease_id` |  |  |
| `billing_month` | `date` | no | IX |  | First day of the month being billed |
| `rent_amount` | `decimal(12,2)` | no |  |  | Copied from the lease when the invoice is generated |
| `tax_rate` | `decimal(5,2)` | no |  |  |  |
| `tax_amount` | `decimal(12,2)` | yes |  | _generated_: `` round(((`rent_amount` * `tax_rate`) / 100),2) `` | rent_amount x tax_rate / 100 |
| `total_amount` | `decimal(12,2)` | yes |  | _generated_: `` (`rent_amount` + `tax_amount`) `` | rent_amount + tax_amount |
| `issue_date` | `date` | no |  |  |  |
| `due_date` | `date` | no |  |  |  |
| `status` | `enum('unpaid','partially_paid','paid','void')` | no | IX | default `unpaid` | Derived from payments by triggers; void = cancelled |

**Foreign keys**

- `fk_invoices_lease`: `lease_id` → `leases(lease_id)` ON DELETE RESTRICT ON UPDATE CASCADE

**Unique keys**

- `uq_invoices_lease_month` (lease_id, billing_month)
- `uq_invoices_no` (invoice_no)

**Check constraints**

- `chk_invoices_due`: `` (`due_date` >= `issue_date`) ``
- `chk_invoices_month`: `` (dayofmonth(`billing_month`) = 1) ``
- `chk_invoices_rent`: `` (`rent_amount` >= 0) ``

## leases

Rental agreement between a tenant and a shop

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `lease_id` | `int unsigned` | no | PK | auto_increment |  |
| `shop_id` | `int unsigned` | no | FK → `shops.shop_id` |  |  |
| `tenant_id` | `int unsigned` | no | FK → `tenants.tenant_id` |  |  |
| `start_date` | `date` | no |  |  |  |
| `end_date` | `date` | no | IX |  |  |
| `monthly_rent` | `decimal(12,2)` | no |  |  | Agreed rent per month (before tax) |
| `security_deposit` | `decimal(12,2)` | no |  | default `0.00` |  |
| `tax_rate` | `decimal(5,2)` | no |  | default `18.00` | Tax percentage applied to each invoice |
| `status` | `enum('active','terminated','expired')` | no |  | default `active` | active / terminated / expired |
| `created_at` | `timestamp` | no |  | default `CURRENT_TIMESTAMP` |  |
| `active_shop_key` | `int unsigned` | yes | UQ | _generated_: `` (case when (`status` = _utf8mb4\'active\') then `shop_id` end) `` | shop_id while active, else NULL; its UNIQUE index allows one active lease per shop |

**Foreign keys**

- `fk_leases_shop`: `shop_id` → `shops(shop_id)` ON DELETE RESTRICT ON UPDATE CASCADE
- `fk_leases_tenant`: `tenant_id` → `tenants(tenant_id)` ON DELETE RESTRICT ON UPDATE CASCADE

**Unique keys**

- `uq_leases_one_active_per_shop` (active_shop_key)

**Check constraints**

- `chk_leases_dates`: `` (`end_date` > `start_date`) ``
- `chk_leases_deposit`: `` (`security_deposit` >= 0) ``
- `chk_leases_rent`: `` (`monthly_rent` > 0) ``
- `chk_leases_tax`: `` (`tax_rate` between 0 and 100) ``

## maintenance_requests

Repair / service tickets for shops and common areas

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `request_id` | `int unsigned` | no | PK | auto_increment |  |
| `shop_id` | `int unsigned` | yes | FK → `shops.shop_id` |  | NULL means a common area |
| `title` | `varchar(120)` | no |  |  |  |
| `description` | `text` | yes |  |  |  |
| `priority` | `enum('low','medium','high','critical')` | no |  | default `medium` |  |
| `status` | `enum('open','in_progress','resolved','closed')` | no | IX | default `open` |  |
| `assigned_to` | `int unsigned` | yes | FK → `employees.employee_id` |  | Employee responsible for the ticket |
| `reported_at` | `datetime` | no |  | default `CURRENT_TIMESTAMP` |  |
| `resolved_at` | `datetime` | yes |  |  | Set automatically by a trigger when status becomes resolved / closed |
| `cost` | `decimal(10,2)` | no |  | default `0.00` |  |

**Foreign keys**

- `fk_maint_employee`: `assigned_to` → `employees(employee_id)` ON DELETE SET NULL ON UPDATE CASCADE
- `fk_maint_shop`: `shop_id` → `shops(shop_id)` ON DELETE SET NULL ON UPDATE CASCADE

**Check constraints**

- `chk_maint_cost`: `` (`cost` >= 0) ``
- `chk_maint_resolved`: `` ((`resolved_at` is null) or (`resolved_at` >= `reported_at`)) ``

## payments

Money received against invoices (partial payments allowed)

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `payment_id` | `int unsigned` | no | PK | auto_increment |  |
| `invoice_id` | `int unsigned` | no | FK → `invoices.invoice_id` |  |  |
| `amount` | `decimal(12,2)` | no |  |  |  |
| `payment_date` | `date` | no | IX |  |  |
| `method` | `enum('cash','card','bank_transfer','cheque','online')` | no |  |  |  |
| `reference_no` | `varchar(50)` | yes |  |  | Bank / card / cheque reference |
| `recorded_by` | `int unsigned` | yes | FK → `app_users.user_id` |  | Application user who recorded the payment |
| `created_at` | `timestamp` | no |  | default `CURRENT_TIMESTAMP` |  |

**Foreign keys**

- `fk_payments_invoice`: `invoice_id` → `invoices(invoice_id)` ON DELETE RESTRICT ON UPDATE CASCADE
- `fk_payments_user`: `recorded_by` → `app_users(user_id)` ON DELETE SET NULL ON UPDATE CASCADE

**Check constraints**

- `chk_payments_amount`: `` (`amount` > 0) ``

## shop_categories

Retail category of a shop unit (apparel, food ...)

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `category_id` | `smallint unsigned` | no | PK | auto_increment |  |
| `name` | `varchar(50)` | no | UQ |  |  |
| `description` | `varchar(255)` | yes |  |  |  |

**Unique keys**

- `uq_shop_categories_name` (name)

## shops

Rentable shop units inside the mall

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `shop_id` | `int unsigned` | no | PK | auto_increment |  |
| `unit_code` | `varchar(10)` | no | UQ |  | Unit number shown to visitors, e.g. G-05 |
| `floor_id` | `tinyint unsigned` | no | FK → `floors.floor_id` |  |  |
| `category_id` | `smallint unsigned` | yes | FK → `shop_categories.category_id` |  |  |
| `area_sqft` | `decimal(8,2)` | no |  |  |  |
| `base_rent` | `decimal(12,2)` | no |  |  | Asking rent per month for the unit |
| `status` | `enum('vacant','occupied','under_maintenance')` | no | IX | default `vacant` | Kept in sync with leases by triggers |

**Foreign keys**

- `fk_shops_category`: `category_id` → `shop_categories(category_id)` ON DELETE SET NULL ON UPDATE CASCADE
- `fk_shops_floor`: `floor_id` → `floors(floor_id)` ON DELETE RESTRICT ON UPDATE CASCADE

**Unique keys**

- `uq_shops_unit_code` (unit_code)

**Check constraints**

- `chk_shops_area`: `` (`area_sqft` > 0) ``
- `chk_shops_rent`: `` (`base_rent` >= 0) ``

## tenants

Businesses that rent shop units

| Column | Type | Null | Key | Default / extra | Description |
|---|---|---|---|---|---|
| `tenant_id` | `int unsigned` | no | PK | auto_increment |  |
| `business_name` | `varchar(100)` | no | IX |  |  |
| `contact_person` | `varchar(100)` | no |  |  |  |
| `email` | `varchar(120)` | no | UQ |  |  |
| `phone` | `varchar(20)` | no |  |  |  |
| `tax_id` | `varchar(20)` | yes | UQ |  | Tax registration number of the business |
| `created_at` | `timestamp` | no |  | default `CURRENT_TIMESTAMP` |  |

**Unique keys**

- `uq_tenants_email` (email)
- `uq_tenants_tax_id` (tax_id)

**Check constraints**

- `chk_tenants_email`: `` regexp_like(`email`,_utf8mb4\'^[^@[:space:]]+@[^@[:space:]]+\\\\.[^@[:space:]]+$\') ``
- `chk_tenants_phone`: `` regexp_like(`phone`,_utf8mb4\'^[0-9+() -]{7,20}$\') ``

## Views

See `database/02_views.sql` for the definitions.

- `v_category_revenue`
- `v_department_payroll`
- `v_expiring_leases`
- `v_floor_occupancy`
- `v_invoice_summary`
- `v_lease_details`
- `v_monthly_expenses`
- `v_monthly_income`
- `v_open_maintenance`
- `v_payment_register`
- `v_profit_and_loss`
- `v_shop_directory`
- `v_tenant_balances`
