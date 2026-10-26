-- =============================================================================
--  Mall Management System - Triggers
--
--  Concepts shown:
--    * BEFORE triggers that VALIDATE data (SIGNAL SQLSTATE '45000')
--    * BEFORE triggers that DERIVE values (SET NEW.col = ...)
--    * AFTER triggers that keep related tables consistent
--    * Rules a CHECK constraint cannot express (CURDATE() is not allowed in
--      CHECK, and CHECK cannot look at other rows or tables)
--    * Automatic AUDIT TRAIL written as JSON (OLD / NEW row images)
--
--  The backend runs `SET @app_user = '<username>'` on every connection so the
--  audit log records the application user, not just the MySQL account.
--  Setting @skip_audit = 1 disables auditing (used only while seeding).
-- =============================================================================
USE mall_db;

DROP TRIGGER IF EXISTS trg_shops_before_insert;
DROP TRIGGER IF EXISTS trg_shops_before_update;
DROP TRIGGER IF EXISTS trg_shops_after_update;
DROP TRIGGER IF EXISTS trg_shops_after_delete;
DROP TRIGGER IF EXISTS trg_tenants_after_update;
DROP TRIGGER IF EXISTS trg_tenants_after_delete;
DROP TRIGGER IF EXISTS trg_leases_before_insert;
DROP TRIGGER IF EXISTS trg_leases_after_insert;
DROP TRIGGER IF EXISTS trg_leases_before_update;
DROP TRIGGER IF EXISTS trg_leases_after_update;
DROP TRIGGER IF EXISTS trg_leases_after_delete;
DROP TRIGGER IF EXISTS trg_invoices_before_update;
DROP TRIGGER IF EXISTS trg_invoices_after_update;
DROP TRIGGER IF EXISTS trg_payments_before_insert;
DROP TRIGGER IF EXISTS trg_payments_after_insert;
DROP TRIGGER IF EXISTS trg_payments_before_update;
DROP TRIGGER IF EXISTS trg_payments_after_delete;
DROP TRIGGER IF EXISTS trg_employees_before_insert;
DROP TRIGGER IF EXISTS trg_employees_before_update;
DROP TRIGGER IF EXISTS trg_employees_after_update;
DROP TRIGGER IF EXISTS trg_employees_after_delete;
DROP TRIGGER IF EXISTS trg_expenses_before_insert;
DROP TRIGGER IF EXISTS trg_expenses_before_update;
DROP TRIGGER IF EXISTS trg_maintenance_before_insert;
DROP TRIGGER IF EXISTS trg_maintenance_before_update;

DELIMITER $$

-- =============================================================================
-- SHOPS
-- =============================================================================
CREATE TRIGGER trg_shops_before_insert
BEFORE INSERT ON shops FOR EACH ROW
BEGIN
    -- A brand-new unit cannot have a lease yet
    IF NEW.status = 'occupied' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'A new shop cannot be occupied; create a lease to occupy it';
    END IF;
END$$

CREATE TRIGGER trg_shops_before_update
BEFORE UPDATE ON shops FOR EACH ROW
BEGIN
    DECLARE v_active INT;
    IF NEW.status <> OLD.status THEN
        SELECT COUNT(*) INTO v_active
        FROM leases WHERE shop_id = NEW.shop_id AND status = 'active';

        IF NEW.status = 'occupied' AND v_active = 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Shop can only be marked occupied through an active lease';
        ELSEIF NEW.status = 'vacant' AND v_active > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Shop has an active lease; terminate the lease first';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_shops_after_update
AFTER UPDATE ON shops FOR EACH ROW
BEGIN
    IF COALESCE(@skip_audit, 0) = 0 THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES ('shops', NEW.shop_id, 'UPDATE',
            JSON_OBJECT('unit_code', OLD.unit_code, 'floor_id', OLD.floor_id, 'category_id', OLD.category_id,
                        'area_sqft', OLD.area_sqft, 'base_rent', OLD.base_rent, 'status', OLD.status),
            JSON_OBJECT('unit_code', NEW.unit_code, 'floor_id', NEW.floor_id, 'category_id', NEW.category_id,
                        'area_sqft', NEW.area_sqft, 'base_rent', NEW.base_rent, 'status', NEW.status),
            COALESCE(@app_user, CURRENT_USER()));
    END IF;
END$$

CREATE TRIGGER trg_shops_after_delete
AFTER DELETE ON shops FOR EACH ROW
BEGIN
    IF COALESCE(@skip_audit, 0) = 0 THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by)
        VALUES ('shops', OLD.shop_id, 'DELETE',
            JSON_OBJECT('unit_code', OLD.unit_code, 'floor_id', OLD.floor_id, 'category_id', OLD.category_id,
                        'area_sqft', OLD.area_sqft, 'base_rent', OLD.base_rent, 'status', OLD.status),
            COALESCE(@app_user, CURRENT_USER()));
    END IF;
END$$

-- =============================================================================
-- TENANTS (audit only)
-- =============================================================================
CREATE TRIGGER trg_tenants_after_update
AFTER UPDATE ON tenants FOR EACH ROW
BEGIN
    IF COALESCE(@skip_audit, 0) = 0 THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES ('tenants', NEW.tenant_id, 'UPDATE',
            JSON_OBJECT('business_name', OLD.business_name, 'contact_person', OLD.contact_person,
                        'email', OLD.email, 'phone', OLD.phone, 'tax_id', OLD.tax_id),
            JSON_OBJECT('business_name', NEW.business_name, 'contact_person', NEW.contact_person,
                        'email', NEW.email, 'phone', NEW.phone, 'tax_id', NEW.tax_id),
            COALESCE(@app_user, CURRENT_USER()));
    END IF;
END$$

CREATE TRIGGER trg_tenants_after_delete
AFTER DELETE ON tenants FOR EACH ROW
BEGIN
    IF COALESCE(@skip_audit, 0) = 0 THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by)
        VALUES ('tenants', OLD.tenant_id, 'DELETE',
            JSON_OBJECT('business_name', OLD.business_name, 'contact_person', OLD.contact_person,
                        'email', OLD.email, 'phone', OLD.phone, 'tax_id', OLD.tax_id),
            COALESCE(@app_user, CURRENT_USER()));
    END IF;
END$$

-- =============================================================================
-- LEASES
-- =============================================================================
CREATE TRIGGER trg_leases_before_insert
BEFORE INSERT ON leases FOR EACH ROW
BEGIN
    DECLARE v_active     INT;
    DECLARE v_shop_state VARCHAR(20);

    IF NEW.status = 'active' THEN
        SELECT status INTO v_shop_state FROM shops WHERE shop_id = NEW.shop_id;
        IF v_shop_state = 'under_maintenance' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Shop is under maintenance and cannot be leased';
        END IF;

        SELECT COUNT(*) INTO v_active
        FROM leases WHERE shop_id = NEW.shop_id AND status = 'active';
        IF v_active > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Shop already has an active lease';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_leases_after_insert
AFTER INSERT ON leases FOR EACH ROW
BEGIN
    IF NEW.status = 'active' THEN
        UPDATE shops SET status = 'occupied' WHERE shop_id = NEW.shop_id;
    END IF;

    IF COALESCE(@skip_audit, 0) = 0 THEN
        INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by)
        VALUES ('leases', NEW.lease_id, 'INSERT',
            JSON_OBJECT('shop_id', NEW.shop_id, 'tenant_id', NEW.tenant_id,
                        'start_date', NEW.start_date, 'end_date', NEW.end_date,
                        'monthly_rent', NEW.monthly_rent, 'security_deposit', NEW.security_deposit,
                        'tax_rate', NEW.tax_rate, 'status', NEW.status),
            COALESCE(@app_user, CURRENT_USER()));
    END IF;
END$$

CREATE TRIGGER trg_leases_before_update
BEFORE UPDATE ON leases FOR EACH ROW
BEGIN
    DECLARE v_active INT;
    IF NEW.status = 'active' AND (OLD.status <> 'active' OR NEW.shop_id <> OLD.shop_id) THEN
        SELECT COUNT(*) INTO v_active
        FROM leases
        WHERE shop_id = NEW.shop_id AND status = 'active' AND lease_id <> NEW.lease_id;
        IF v_active > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Shop already has an active lease';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_leases_after_update
AFTER UPDATE ON leases FOR EACH ROW
BEGIN
    -- lease ended or moved: free the old shop
    IF OLD.status = 'active' AND (NEW.status <> 'active' OR NEW.shop_id <> OLD.shop_id) THEN
        UPDATE shops SET status = 'vacant'
        WHERE shop_id = OLD.shop_id AND status = 'occupied';
    END IF;
    -- lease (re)activated or moved: occupy the new shop
    IF NEW.status = 'active' AND (OLD.status <> 'active' OR NEW.shop_id <> OLD.shop_id) THEN
        UPDATE shops SET status = 'occupied' WHERE shop_id = NEW.shop_id;
    END IF;

    IF COALESCE(@skip_audit, 0) = 0 THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES ('leases', NEW.lease_id, 'UPDATE',
            JSON_OBJECT('shop_id', OLD.shop_id, 'tenant_id', OLD.tenant_id,
                        'start_date', OLD.start_date, 'end_date', OLD.end_date,
                        'monthly_rent', OLD.monthly_rent, 'security_deposit', OLD.security_deposit,
                        'tax_rate', OLD.tax_rate, 'status', OLD.status),
            JSON_OBJECT('shop_id', NEW.shop_id, 'tenant_id', NEW.tenant_id,
                        'start_date', NEW.start_date, 'end_date', NEW.end_date,
                        'monthly_rent', NEW.monthly_rent, 'security_deposit', NEW.security_deposit,
                        'tax_rate', NEW.tax_rate, 'status', NEW.status),
            COALESCE(@app_user, CURRENT_USER()));
    END IF;
END$$

CREATE TRIGGER trg_leases_after_delete
AFTER DELETE ON leases FOR EACH ROW
BEGIN
    IF OLD.status = 'active' THEN
        UPDATE shops SET status = 'vacant'
        WHERE shop_id = OLD.shop_id AND status = 'occupied';
    END IF;

    IF COALESCE(@skip_audit, 0) = 0 THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by)
        VALUES ('leases', OLD.lease_id, 'DELETE',
            JSON_OBJECT('shop_id', OLD.shop_id, 'tenant_id', OLD.tenant_id,
                        'start_date', OLD.start_date, 'end_date', OLD.end_date,
                        'monthly_rent', OLD.monthly_rent, 'status', OLD.status),
            COALESCE(@app_user, CURRENT_USER()));
    END IF;
END$$

-- =============================================================================
-- INVOICES
-- =============================================================================
CREATE TRIGGER trg_invoices_before_update
BEFORE UPDATE ON invoices FOR EACH ROW
BEGIN
    IF NEW.status = 'void' AND OLD.status <> 'void' AND fn_invoice_paid(OLD.invoice_id) > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'An invoice with payments cannot be voided';
    END IF;
    IF (NEW.rent_amount <> OLD.rent_amount OR NEW.tax_rate <> OLD.tax_rate)
       AND fn_invoice_paid(OLD.invoice_id) > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Amounts of an invoice with payments cannot be changed';
    END IF;
END$$

CREATE TRIGGER trg_invoices_after_update
AFTER UPDATE ON invoices FOR EACH ROW
BEGIN
    IF COALESCE(@skip_audit, 0) = 0 AND NOT (OLD.status <=> NEW.status AND OLD.rent_amount <=> NEW.rent_amount
                                             AND OLD.due_date <=> NEW.due_date) THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES ('invoices', NEW.invoice_id, 'UPDATE',
            JSON_OBJECT('invoice_no', OLD.invoice_no, 'rent_amount', OLD.rent_amount,
                        'due_date', OLD.due_date, 'status', OLD.status),
            JSON_OBJECT('invoice_no', NEW.invoice_no, 'rent_amount', NEW.rent_amount,
                        'due_date', NEW.due_date, 'status', NEW.status),
            COALESCE(@app_user, CURRENT_USER()));
    END IF;
END$$

-- =============================================================================
-- PAYMENTS
-- =============================================================================
CREATE TRIGGER trg_payments_before_insert
BEFORE INSERT ON payments FOR EACH ROW
BEGIN
    DECLARE v_status  VARCHAR(20);
    DECLARE v_balance DECIMAL(12,2);

    SELECT status INTO v_status FROM invoices WHERE invoice_id = NEW.invoice_id;
    IF v_status = 'void' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot pay a void invoice';
    END IF;

    IF NEW.payment_date > CURDATE() THEN               -- not expressible as CHECK
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment date cannot be in the future';
    END IF;

    SET v_balance = fn_invoice_balance(NEW.invoice_id);
    IF NEW.amount > v_balance THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment exceeds the balance due';
    END IF;
END$$

CREATE TRIGGER trg_payments_after_insert
AFTER INSERT ON payments FOR EACH ROW
BEGIN
    UPDATE invoices
    SET    status = fn_invoice_status(NEW.invoice_id)
    WHERE  invoice_id = NEW.invoice_id;

    IF COALESCE(@skip_audit, 0) = 0 THEN
        INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by)
        VALUES ('payments', NEW.payment_id, 'INSERT',
            JSON_OBJECT('invoice_id', NEW.invoice_id, 'amount', NEW.amount,
                        'payment_date', NEW.payment_date, 'method', NEW.method,
                        'reference_no', NEW.reference_no),
            COALESCE(@app_user, CURRENT_USER()));
    END IF;
END$$

-- Accounting rule: a recorded payment is never edited, only reversed (deleted)
CREATE TRIGGER trg_payments_before_update
BEFORE UPDATE ON payments FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Payments are immutable; delete the payment and record it again';
END$$

CREATE TRIGGER trg_payments_after_delete
AFTER DELETE ON payments FOR EACH ROW
BEGIN
    UPDATE invoices
    SET    status = fn_invoice_status(OLD.invoice_id)
    WHERE  invoice_id = OLD.invoice_id;

    IF COALESCE(@skip_audit, 0) = 0 THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by)
        VALUES ('payments', OLD.payment_id, 'DELETE',
            JSON_OBJECT('invoice_id', OLD.invoice_id, 'amount', OLD.amount,
                        'payment_date', OLD.payment_date, 'method', OLD.method,
                        'reference_no', OLD.reference_no),
            COALESCE(@app_user, CURRENT_USER()));
    END IF;
END$$

-- =============================================================================
-- EMPLOYEES
-- =============================================================================
CREATE TRIGGER trg_employees_before_insert
BEFORE INSERT ON employees FOR EACH ROW
BEGIN
    IF NEW.hire_date > CURDATE() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hire date cannot be in the future';
    END IF;
    SET NEW.employee_code = UPPER(TRIM(NEW.employee_code));
END$$

CREATE TRIGGER trg_employees_before_update
BEFORE UPDATE ON employees FOR EACH ROW
BEGIN
    IF NEW.hire_date > CURDATE() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hire date cannot be in the future';
    END IF;
    SET NEW.employee_code = UPPER(TRIM(NEW.employee_code));
END$$

CREATE TRIGGER trg_employees_after_update
AFTER UPDATE ON employees FOR EACH ROW
BEGIN
    IF COALESCE(@skip_audit, 0) = 0 THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
        VALUES ('employees', NEW.employee_id, 'UPDATE',
            JSON_OBJECT('employee_code', OLD.employee_code, 'full_name', OLD.full_name,
                        'department_id', OLD.department_id, 'job_title', OLD.job_title,
                        'monthly_salary', OLD.monthly_salary, 'is_active', OLD.is_active),
            JSON_OBJECT('employee_code', NEW.employee_code, 'full_name', NEW.full_name,
                        'department_id', NEW.department_id, 'job_title', NEW.job_title,
                        'monthly_salary', NEW.monthly_salary, 'is_active', NEW.is_active),
            COALESCE(@app_user, CURRENT_USER()));
    END IF;
END$$

CREATE TRIGGER trg_employees_after_delete
AFTER DELETE ON employees FOR EACH ROW
BEGIN
    IF COALESCE(@skip_audit, 0) = 0 THEN
        INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by)
        VALUES ('employees', OLD.employee_id, 'DELETE',
            JSON_OBJECT('employee_code', OLD.employee_code, 'full_name', OLD.full_name,
                        'department_id', OLD.department_id, 'job_title', OLD.job_title,
                        'monthly_salary', OLD.monthly_salary),
            COALESCE(@app_user, CURRENT_USER()));
    END IF;
END$$

-- =============================================================================
-- EXPENSES
-- =============================================================================
CREATE TRIGGER trg_expenses_before_insert
BEFORE INSERT ON expenses FOR EACH ROW
BEGIN
    IF NEW.expense_date > CURDATE() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Expense date cannot be in the future';
    END IF;
END$$

CREATE TRIGGER trg_expenses_before_update
BEFORE UPDATE ON expenses FOR EACH ROW
BEGIN
    IF NEW.expense_date > CURDATE() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Expense date cannot be in the future';
    END IF;
END$$

-- =============================================================================
-- MAINTENANCE REQUESTS - derive resolved_at from status
-- =============================================================================
CREATE TRIGGER trg_maintenance_before_insert
BEFORE INSERT ON maintenance_requests FOR EACH ROW
BEGIN
    IF NEW.status IN ('resolved','closed') THEN
        SET NEW.resolved_at = COALESCE(NEW.resolved_at, NOW());
    ELSE
        SET NEW.resolved_at = NULL;
    END IF;
END$$

CREATE TRIGGER trg_maintenance_before_update
BEFORE UPDATE ON maintenance_requests FOR EACH ROW
BEGIN
    IF NEW.status IN ('resolved','closed') AND OLD.status NOT IN ('resolved','closed') THEN
        SET NEW.resolved_at = NOW();
    ELSEIF NEW.status IN ('open','in_progress') THEN
        SET NEW.resolved_at = NULL;
    END IF;
END$$

DELIMITER ;
