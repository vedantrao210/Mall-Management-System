# Entity-relationship model

The diagram below renders on GitHub and in any Mermaid-aware Markdown viewer.
The web app also draws a **live** ER diagram straight from `INFORMATION_SCHEMA`
(Database → ER diagram).

```mermaid
erDiagram
    FLOORS ||--o{ SHOPS : "contains"
    SHOP_CATEGORIES |o--o{ SHOPS : "classifies"
    SHOPS ||--o{ LEASES : "is rented through"
    TENANTS ||--o{ LEASES : "signs"
    LEASES ||--o{ INVOICES : "is billed by"
    INVOICES ||--o{ PAYMENTS : "is settled by"
    APP_USERS |o--o{ PAYMENTS : "records"
    DEPARTMENTS ||--o{ EMPLOYEES : "employs"
    EXPENSE_CATEGORIES ||--o{ EXPENSES : "classifies"
    APP_USERS |o--o{ EXPENSES : "records"
    SHOPS |o--o{ MAINTENANCE_REQUESTS : "location of"
    EMPLOYEES |o--o{ MAINTENANCE_REQUESTS : "is assigned"

    FLOORS {
        tinyint floor_id PK
        tinyint level_number UK
        varchar name UK
    }
    SHOP_CATEGORIES {
        smallint category_id PK
        varchar name UK
        varchar description
    }
    SHOPS {
        int shop_id PK
        varchar unit_code UK
        tinyint floor_id FK
        smallint category_id FK
        decimal area_sqft
        decimal base_rent
        enum status
    }
    TENANTS {
        int tenant_id PK
        varchar business_name
        varchar contact_person
        varchar email UK
        varchar phone
        varchar tax_id UK
        timestamp created_at
    }
    LEASES {
        int lease_id PK
        int shop_id FK
        int tenant_id FK
        date start_date
        date end_date
        decimal monthly_rent
        decimal security_deposit
        decimal tax_rate
        enum status
        int active_shop_key UK "generated"
    }
    INVOICES {
        int invoice_id PK
        varchar invoice_no UK
        int lease_id FK
        date billing_month
        decimal rent_amount
        decimal tax_rate
        decimal tax_amount "generated"
        decimal total_amount "generated"
        date issue_date
        date due_date
        enum status
    }
    PAYMENTS {
        int payment_id PK
        int invoice_id FK
        decimal amount
        date payment_date
        enum method
        varchar reference_no
        int recorded_by FK
    }
    DEPARTMENTS {
        smallint department_id PK
        varchar name UK
        varchar description
    }
    EMPLOYEES {
        int employee_id PK
        varchar employee_code UK
        varchar full_name
        varchar email UK
        varchar phone
        smallint department_id FK
        varchar job_title
        decimal monthly_salary
        date hire_date
        tinyint is_active
    }
    EXPENSE_CATEGORIES {
        smallint category_id PK
        varchar name UK
        varchar description
    }
    EXPENSES {
        int expense_id PK
        smallint category_id FK
        varchar description
        varchar vendor
        date expense_date
        decimal amount
        decimal tax_rate
        decimal tax_amount "generated"
        decimal total_amount "generated"
        int recorded_by FK
    }
    MAINTENANCE_REQUESTS {
        int request_id PK
        int shop_id FK "NULL = common area"
        varchar title
        text description
        enum priority
        enum status
        int assigned_to FK
        datetime reported_at
        datetime resolved_at
        decimal cost
    }
    APP_USERS {
        int user_id PK
        varchar username UK
        varchar password_hash
        varchar full_name
        enum role
        tinyint is_active
    }
    AUDIT_LOG {
        bigint audit_id PK
        varchar table_name
        int record_id
        enum action
        json old_data
        json new_data
        varchar changed_by
        timestamp changed_at
    }
```

`AUDIT_LOG` has no foreign keys on purpose: it must keep history even after
the referenced row is deleted.

## Entities and relationships

| Relationship | Cardinality | Participation | Delete rule |
|---|---|---|---|
| Floor contains shops | 1 : N | every shop is on exactly one floor | RESTRICT |
| Category classifies shops | 1 : N | a shop may be uncategorised | SET NULL |
| Shop – Tenant through **Lease** | M : N (resolved by `leases`) | a shop may be vacant; a tenant may lease several shops | RESTRICT |
| Lease is billed by invoices | 1 : N | one invoice per lease per month (`UNIQUE(lease_id, billing_month)`) | RESTRICT |
| Invoice is settled by payments | 1 : N | partial payments allowed | RESTRICT |
| Department employs employees | 1 : N | every employee has a department | RESTRICT |
| Expense category classifies expenses | 1 : N | mandatory | RESTRICT |
| Shop is location of maintenance requests | 1 : N | NULL = common area | SET NULL |
| Employee is assigned maintenance requests | 1 : N | optional | SET NULL |
| App user records payments / expenses | 1 : N | optional | SET NULL |

### Business rules that keys alone cannot express

| Rule | Enforced by |
|---|---|
| A shop has at most one **active** lease | `trg_leases_before_insert/update` **and** `UNIQUE(active_shop_key)` on a generated column |
| Leases can only be created for a vacant (not under-maintenance) shop | `trg_leases_before_insert` |
| Shop status follows its leases (occupied / vacant) | `trg_leases_after_insert/update/delete` |
| Invoice status follows its payments (unpaid → partially paid → paid) | `trg_payments_after_insert/delete` |
| A payment cannot exceed the balance, be dated in the future or target a void invoice | `trg_payments_before_insert` and `sp_record_payment` |
| Payments are immutable (corrections are reversals) | `trg_payments_before_update` + no UPDATE privilege for the app account |
| Expenses cannot be dated in the future | `trg_expenses_before_insert/update` (CHECK cannot use `CURDATE()`) |
| `resolved_at` is set when a ticket is resolved / closed | `trg_maintenance_before_update` |
| Every change to key tables is recorded | `AFTER` triggers writing JSON row images to `audit_log` |
