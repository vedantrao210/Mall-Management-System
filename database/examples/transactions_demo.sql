-- =============================================================================
--  Mall Management System - Transactions, constraints and triggers demo
--
--  Run as an account that can write (root or mall_app). Every block is rolled
--  back or reversed, so the sample data is left unchanged (apart from audit
--  log rows, which are kept on purpose).
--
--      mysql -u mall_app -p mall_db < transactions_demo.sql
--
--  Statements that are EXPECTED to fail are in comments, so the file runs
--  without stopping. Paste them into a mysql session one at a time to see the
--  error each rule raises.
-- =============================================================================
USE mall_db;
SET @app_user = 'demo';

-- -----------------------------------------------------------------------------
-- 1. Atomicity: COMMIT or ROLLBACK as a unit
-- -----------------------------------------------------------------------------
START TRANSACTION;
    UPDATE shops SET base_rent = base_rent * 1.10 WHERE floor_id = 2;
    SELECT unit_code, base_rent FROM shops WHERE floor_id = 2;   -- new values visible inside the transaction
ROLLBACK;
SELECT unit_code, base_rent FROM shops WHERE floor_id = 2;       -- original values are back

-- -----------------------------------------------------------------------------
-- 2. SAVEPOINT: undo part of a transaction
-- -----------------------------------------------------------------------------
START TRANSACTION;
    INSERT INTO tenants (business_name, contact_person, email, phone)
    VALUES ('Demo Kiosk One', 'Owner', 'one@demo.example', '9000000901');
    SAVEPOINT after_first;
    INSERT INTO tenants (business_name, contact_person, email, phone)
    VALUES ('Demo Kiosk Two', 'Owner', 'two@demo.example', '9000000902');
    ROLLBACK TO SAVEPOINT after_first;                           -- only the second insert is undone
    SELECT business_name FROM tenants WHERE business_name LIKE 'Demo Kiosk%';
ROLLBACK;

-- -----------------------------------------------------------------------------
-- 3. A stored procedure that is itself a transaction
--    sp_record_payment runs START TRANSACTION ... COMMIT internally, locks the
--    invoice row (SELECT ... FOR UPDATE), checks the balance, inserts the
--    payment and lets a trigger update the invoice status.
--
--    NOTE: MySQL has no nested transactions. START TRANSACTION inside the
--    procedure implicitly COMMITs any transaction the caller had open, so a
--    procedure like this must NOT be wrapped in an outer transaction that you
--    expect to roll back. Here we undo the demo by reversing the payments
--    (DELETE is allowed for reversals; a trigger recomputes the status).
-- -----------------------------------------------------------------------------
SELECT invoice_id, invoice_no, total_amount, fn_invoice_balance(invoice_id), status
INTO @inv, @no, @total, @bal, @status
FROM invoices WHERE status = 'unpaid' ORDER BY invoice_id LIMIT 1;
SELECT @no AS invoice, @total AS total, @bal AS balance, @status AS status_before;

CALL sp_record_payment(@inv, @bal / 2, CURDATE(), 'online', 'DEMO-1', NULL, @p1);
SELECT status AS status_after_half FROM invoices WHERE invoice_id = @inv;   -- partially_paid

CALL sp_record_payment(@inv, fn_invoice_balance(@inv), CURDATE(), 'online', 'DEMO-2', NULL, @p2);
SELECT status AS status_after_full FROM invoices WHERE invoice_id = @inv;   -- paid

SELECT table_name, action, record_id, changed_by FROM audit_log ORDER BY audit_id DESC LIMIT 4;

DELETE FROM payments WHERE payment_id IN (@p1, @p2);                       -- reverse the demo
SELECT status AS status_after_reversal FROM invoices WHERE invoice_id = @inv;  -- unpaid again

-- -----------------------------------------------------------------------------
-- 4. Integrity rules (each statement below fails; try them one by one)
-- -----------------------------------------------------------------------------
-- PRIMARY KEY / UNIQUE: duplicate unit code             -> ERROR 1062
-- INSERT INTO shops (unit_code, floor_id, area_sqft, base_rent) VALUES ('G-01', 2, 500, 40000);

-- FOREIGN KEY: floor 99 does not exist                  -> ERROR 1452
-- INSERT INTO shops (unit_code, floor_id, area_sqft, base_rent) VALUES ('X-01', 99, 500, 40000);

-- FOREIGN KEY ON DELETE RESTRICT: floor still has shops -> ERROR 1451
-- DELETE FROM floors WHERE floor_id = 2;

-- CHECK constraint: negative area                       -> ERROR 3819
-- INSERT INTO shops (unit_code, floor_id, area_sqft, base_rent) VALUES ('X-02', 2, -5, 40000);

-- CHECK constraint: lease must end after it starts      -> ERROR 3819
-- INSERT INTO leases (shop_id, tenant_id, start_date, end_date, monthly_rent)
-- VALUES (3, 1, '2026-06-01', '2026-01-01', 50000);

-- TRIGGER: a shop can have only one active lease        -> ERROR 1644 (SIGNAL)
-- INSERT INTO leases (shop_id, tenant_id, start_date, end_date, monthly_rent)
-- VALUES (1, 2, CURDATE(), CURDATE() + INTERVAL 1 YEAR, 50000);

-- Payments are immutable: mall_app has no UPDATE privilege -> ERROR 1142;
-- as root the BEFORE UPDATE trigger stops it                -> ERROR 1644
-- UPDATE payments SET amount = 1 WHERE payment_id = 1;

-- TRIGGER: expenses cannot be dated in the future       -> ERROR 1644
-- INSERT INTO expenses (category_id, description, expense_date, amount)
-- VALUES (1, 'Future', CURDATE() + INTERVAL 5 DAY, 100);

-- -----------------------------------------------------------------------------
-- 5. Triggers keeping data consistent: leasing a vacant shop marks it occupied
--    (plain DML, so the whole block can be rolled back)
-- -----------------------------------------------------------------------------
START TRANSACTION;
    SELECT shop_id, unit_code, status INTO @sid, @unit, @before FROM shops WHERE status = 'vacant' LIMIT 1;
    INSERT INTO leases (shop_id, tenant_id, start_date, end_date, monthly_rent)
    VALUES (@sid, 1, CURDATE(), CURDATE() + INTERVAL 1 YEAR, 45000);
    SELECT @unit AS unit, @before AS status_before, status AS status_after FROM shops WHERE shop_id = @sid;
    UPDATE leases SET status = 'terminated' WHERE lease_id = LAST_INSERT_ID();
    SELECT status AS status_after_termination FROM shops WHERE shop_id = @sid;
ROLLBACK;

-- -----------------------------------------------------------------------------
-- 6. Isolation (needs two sessions)
--    Session A:  START TRANSACTION;
--                SELECT * FROM invoices WHERE invoice_id = 1 FOR UPDATE;
--    Session B:  CALL sp_record_payment(1, 10, CURDATE(), 'cash', NULL, NULL, @p);
--                -- waits until session A commits / rolls back (row lock)
--    Session A:  ROLLBACK;
-- -----------------------------------------------------------------------------
