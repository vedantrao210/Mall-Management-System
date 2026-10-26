-- =============================================================================
--  Mall Management System - Database Schema (DDL)
--  Target: MySQL 8.0.16+ (CHECK constraints, roles, JSON, generated columns)
--
--  Run order:  01_schema -> 02_views -> 03_routines -> 04_triggers
--              -> 05_seed -> 06_security
--
--  Concepts shown in this file:
--    * Normalised relational design (3NF) - see docs/NORMALIZATION.md
--    * PRIMARY KEY, FOREIGN KEY (with ON DELETE / ON UPDATE rules)
--    * UNIQUE, NOT NULL, DEFAULT, CHECK and ENUM domain constraints
--    * Composite UNIQUE keys and secondary indexes
--    * STORED generated (computed) columns
--    * JSON columns (audit log)
-- =============================================================================

DROP DATABASE IF EXISTS mall_db;
CREATE DATABASE mall_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;
USE mall_db;

-- -----------------------------------------------------------------------------
-- 1. Application users (people who log in to the system)
-- -----------------------------------------------------------------------------
CREATE TABLE app_users (
    user_id        INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    username       VARCHAR(50)      NOT NULL,
    password_hash  VARCHAR(255)     NOT NULL,          -- bcrypt hash, never plain text
    full_name      VARCHAR(100)     NOT NULL,
    role           ENUM('admin','manager','staff') NOT NULL DEFAULT 'staff',
    is_active      TINYINT(1)       NOT NULL DEFAULT 1,
    created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at  TIMESTAMP        NULL,
    CONSTRAINT pk_app_users PRIMARY KEY (user_id),
    CONSTRAINT uq_app_users_username UNIQUE (username),
    CONSTRAINT chk_app_users_username CHECK (CHAR_LENGTH(username) >= 3),
    CONSTRAINT chk_app_users_active CHECK (is_active IN (0, 1))
) ENGINE = InnoDB COMMENT = 'Login accounts with role-based access';

-- -----------------------------------------------------------------------------
-- 2. Lookup / reference tables
-- -----------------------------------------------------------------------------
CREATE TABLE floors (
    floor_id      TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    level_number  TINYINT          NOT NULL,           -- -1 = lower ground, 0 = ground ...
    name          VARCHAR(50)      NOT NULL,
    CONSTRAINT pk_floors PRIMARY KEY (floor_id),
    CONSTRAINT uq_floors_level UNIQUE (level_number),
    CONSTRAINT uq_floors_name UNIQUE (name),
    CONSTRAINT chk_floors_level CHECK (level_number BETWEEN -5 AND 50)
) ENGINE = InnoDB COMMENT = 'Physical floors / levels of the building';

CREATE TABLE shop_categories (
    category_id  SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name         VARCHAR(50)       NOT NULL,
    description  VARCHAR(255)      NULL,
    CONSTRAINT pk_shop_categories PRIMARY KEY (category_id),
    CONSTRAINT uq_shop_categories_name UNIQUE (name)
) ENGINE = InnoDB COMMENT = 'Retail category of a shop unit (apparel, food ...)';

CREATE TABLE departments (
    department_id  SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name           VARCHAR(50)       NOT NULL,
    description    VARCHAR(255)      NULL,
    CONSTRAINT pk_departments PRIMARY KEY (department_id),
    CONSTRAINT uq_departments_name UNIQUE (name)
) ENGINE = InnoDB COMMENT = 'Internal departments of mall staff';

CREATE TABLE expense_categories (
    category_id  SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name         VARCHAR(50)       NOT NULL,
    description  VARCHAR(255)      NULL,
    CONSTRAINT pk_expense_categories PRIMARY KEY (category_id),
    CONSTRAINT uq_expense_categories_name UNIQUE (name)
) ENGINE = InnoDB COMMENT = 'Classification of operating expenses';

-- -----------------------------------------------------------------------------
-- 3. Core entities
-- -----------------------------------------------------------------------------
CREATE TABLE shops (
    shop_id      INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    unit_code    VARCHAR(10)       NOT NULL,           -- e.g. G-01, F1-04
    floor_id     TINYINT UNSIGNED  NOT NULL,
    category_id  SMALLINT UNSIGNED NULL,
    area_sqft    DECIMAL(8,2)      NOT NULL,
    base_rent    DECIMAL(12,2)     NOT NULL,           -- asking rent per month
    -- 'occupied' / 'vacant' is maintained automatically by lease triggers
    -- (controlled redundancy - see docs/NORMALIZATION.md)
    status       ENUM('vacant','occupied','under_maintenance') NOT NULL DEFAULT 'vacant',
    CONSTRAINT pk_shops PRIMARY KEY (shop_id),
    CONSTRAINT uq_shops_unit_code UNIQUE (unit_code),
    CONSTRAINT chk_shops_area CHECK (area_sqft > 0),
    CONSTRAINT chk_shops_rent CHECK (base_rent >= 0),
    CONSTRAINT fk_shops_floor FOREIGN KEY (floor_id)
        REFERENCES floors (floor_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_shops_category FOREIGN KEY (category_id)
        REFERENCES shop_categories (category_id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_shops_status (status)
) ENGINE = InnoDB COMMENT = 'Rentable shop units inside the mall';

CREATE TABLE tenants (
    tenant_id       INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    business_name   VARCHAR(100)  NOT NULL,
    contact_person  VARCHAR(100)  NOT NULL,
    email           VARCHAR(120)  NOT NULL,
    phone           VARCHAR(20)   NOT NULL,
    tax_id          VARCHAR(20)   NULL,                -- business tax registration no.
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_tenants PRIMARY KEY (tenant_id),
    CONSTRAINT uq_tenants_email UNIQUE (email),
    CONSTRAINT uq_tenants_tax_id UNIQUE (tax_id),      -- UNIQUE allows many NULLs
    CONSTRAINT chk_tenants_email CHECK (email REGEXP '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'),
    CONSTRAINT chk_tenants_phone CHECK (phone REGEXP '^[0-9+() -]{7,20}$'),
    INDEX idx_tenants_business_name (business_name)
) ENGINE = InnoDB COMMENT = 'Businesses that rent shop units';

CREATE TABLE leases (
    lease_id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    shop_id           INT UNSIGNED  NOT NULL,
    tenant_id         INT UNSIGNED  NOT NULL,
    start_date        DATE          NOT NULL,
    end_date          DATE          NOT NULL,
    monthly_rent      DECIMAL(12,2) NOT NULL,
    security_deposit  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    tax_rate          DECIMAL(5,2)  NOT NULL DEFAULT 18.00,   -- percent
    status            ENUM('active','terminated','expired') NOT NULL DEFAULT 'active',
    created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Virtual column that is NULL unless the lease is active. A UNIQUE index on
    -- it means a shop can have at most ONE active lease (NULLs never collide).
    active_shop_key   INT UNSIGNED  GENERATED ALWAYS AS
                        (CASE WHEN status = 'active' THEN shop_id END) VIRTUAL,
    CONSTRAINT pk_leases PRIMARY KEY (lease_id),
    CONSTRAINT uq_leases_one_active_per_shop UNIQUE (active_shop_key),
    CONSTRAINT chk_leases_dates CHECK (end_date > start_date),
    CONSTRAINT chk_leases_rent CHECK (monthly_rent > 0),
    CONSTRAINT chk_leases_deposit CHECK (security_deposit >= 0),
    CONSTRAINT chk_leases_tax CHECK (tax_rate BETWEEN 0 AND 100),
    CONSTRAINT fk_leases_shop FOREIGN KEY (shop_id)
        REFERENCES shops (shop_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_leases_tenant FOREIGN KEY (tenant_id)
        REFERENCES tenants (tenant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_leases_shop_status (shop_id, status),
    INDEX idx_leases_end_date (end_date)
) ENGINE = InnoDB COMMENT = 'Rental agreement between a tenant and a shop';

CREATE TABLE invoices (
    invoice_id     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    invoice_no     VARCHAR(20)   NOT NULL,                 -- INV-YYYYMM-LLLL
    lease_id       INT UNSIGNED  NOT NULL,
    billing_month  DATE          NOT NULL,                 -- always the 1st of a month
    rent_amount    DECIMAL(12,2) NOT NULL,
    tax_rate       DECIMAL(5,2)  NOT NULL,
    -- Generated (derived) columns: always consistent, never typed by hand
    tax_amount     DECIMAL(12,2) GENERATED ALWAYS AS (ROUND(rent_amount * tax_rate / 100, 2)) STORED,
    total_amount   DECIMAL(12,2) GENERATED ALWAYS AS (rent_amount + tax_amount) STORED,
    issue_date     DATE          NOT NULL,
    due_date       DATE          NOT NULL,
    status         ENUM('unpaid','partially_paid','paid','void') NOT NULL DEFAULT 'unpaid',
    CONSTRAINT pk_invoices PRIMARY KEY (invoice_id),
    CONSTRAINT uq_invoices_no UNIQUE (invoice_no),
    CONSTRAINT uq_invoices_lease_month UNIQUE (lease_id, billing_month),  -- one bill per lease per month
    CONSTRAINT chk_invoices_month CHECK (DAYOFMONTH(billing_month) = 1),
    CONSTRAINT chk_invoices_due CHECK (due_date >= issue_date),
    CONSTRAINT chk_invoices_rent CHECK (rent_amount >= 0),
    CONSTRAINT fk_invoices_lease FOREIGN KEY (lease_id)
        REFERENCES leases (lease_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_invoices_status_due (status, due_date),
    INDEX idx_invoices_billing_month (billing_month)
) ENGINE = InnoDB COMMENT = 'Monthly rent bills raised against leases';

CREATE TABLE payments (
    payment_id    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    invoice_id    INT UNSIGNED  NOT NULL,
    amount        DECIMAL(12,2) NOT NULL,
    payment_date  DATE          NOT NULL,
    method        ENUM('cash','card','bank_transfer','cheque','online') NOT NULL,
    reference_no  VARCHAR(50)   NULL,
    recorded_by   INT UNSIGNED  NULL,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_payments PRIMARY KEY (payment_id),
    CONSTRAINT chk_payments_amount CHECK (amount > 0),
    CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (invoice_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_payments_user FOREIGN KEY (recorded_by)
        REFERENCES app_users (user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_payments_date (payment_date)
) ENGINE = InnoDB COMMENT = 'Money received against invoices (partial payments allowed)';

CREATE TABLE employees (
    employee_id     INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    employee_code   VARCHAR(10)       NOT NULL,
    full_name       VARCHAR(100)      NOT NULL,
    email           VARCHAR(120)      NULL,
    phone           VARCHAR(20)       NOT NULL,
    department_id   SMALLINT UNSIGNED NOT NULL,
    job_title       VARCHAR(60)       NOT NULL,
    monthly_salary  DECIMAL(10,2)     NOT NULL,
    hire_date       DATE              NOT NULL,
    is_active       TINYINT(1)        NOT NULL DEFAULT 1,
    CONSTRAINT pk_employees PRIMARY KEY (employee_id),
    CONSTRAINT uq_employees_code UNIQUE (employee_code),
    CONSTRAINT uq_employees_email UNIQUE (email),
    CONSTRAINT chk_employees_salary CHECK (monthly_salary >= 0),
    CONSTRAINT chk_employees_phone CHECK (phone REGEXP '^[0-9+() -]{7,20}$'),
    CONSTRAINT chk_employees_active CHECK (is_active IN (0, 1)),
    CONSTRAINT fk_employees_department FOREIGN KEY (department_id)
        REFERENCES departments (department_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_employees_dept_active (department_id, is_active)
) ENGINE = InnoDB COMMENT = 'Staff employed by mall management';

CREATE TABLE expenses (
    expense_id    INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    category_id   SMALLINT UNSIGNED NOT NULL,
    description   VARCHAR(255)      NOT NULL,
    vendor        VARCHAR(100)      NULL,
    expense_date  DATE              NOT NULL,
    amount        DECIMAL(12,2)     NOT NULL,
    tax_rate      DECIMAL(5,2)      NOT NULL DEFAULT 0.00,
    tax_amount    DECIMAL(12,2) GENERATED ALWAYS AS (ROUND(amount * tax_rate / 100, 2)) STORED,
    total_amount  DECIMAL(12,2) GENERATED ALWAYS AS (amount + tax_amount) STORED,
    recorded_by   INT UNSIGNED      NULL,
    created_at    TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_expenses PRIMARY KEY (expense_id),
    CONSTRAINT chk_expenses_amount CHECK (amount > 0),
    CONSTRAINT chk_expenses_tax CHECK (tax_rate BETWEEN 0 AND 100),
    CONSTRAINT fk_expenses_category FOREIGN KEY (category_id)
        REFERENCES expense_categories (category_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_expenses_user FOREIGN KEY (recorded_by)
        REFERENCES app_users (user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_expenses_date_category (expense_date, category_id)
) ENGINE = InnoDB COMMENT = 'Operating expenses of the mall';

CREATE TABLE maintenance_requests (
    request_id   INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    shop_id      INT UNSIGNED  NULL,                       -- NULL = common area
    title        VARCHAR(120)  NOT NULL,
    description  TEXT          NULL,
    priority     ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
    status       ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
    assigned_to  INT UNSIGNED  NULL,
    reported_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at  DATETIME      NULL,                       -- set by trigger
    cost         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    CONSTRAINT pk_maintenance_requests PRIMARY KEY (request_id),
    CONSTRAINT chk_maint_cost CHECK (cost >= 0),
    CONSTRAINT chk_maint_resolved CHECK (resolved_at IS NULL OR resolved_at >= reported_at),
    CONSTRAINT fk_maint_shop FOREIGN KEY (shop_id)
        REFERENCES shops (shop_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_maint_employee FOREIGN KEY (assigned_to)
        REFERENCES employees (employee_id) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_maint_status_priority (status, priority)
) ENGINE = InnoDB COMMENT = 'Repair / service tickets for shops and common areas';

-- -----------------------------------------------------------------------------
-- 4. Audit trail (written ONLY by triggers - application cannot modify it)
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
    audit_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    table_name  VARCHAR(64)     NOT NULL,
    record_id   INT UNSIGNED    NOT NULL,
    action      ENUM('INSERT','UPDATE','DELETE') NOT NULL,
    old_data    JSON            NULL,
    new_data    JSON            NULL,
    changed_by  VARCHAR(100)    NOT NULL,
    changed_at  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT pk_audit_log PRIMARY KEY (audit_id),
    INDEX idx_audit_table_record (table_name, record_id),
    INDEX idx_audit_changed_at (changed_at)
) ENGINE = InnoDB COMMENT = 'Change history captured by triggers';
