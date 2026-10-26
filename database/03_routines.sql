-- =============================================================================
--  Mall Management System - Stored Functions, Procedures and Events
--
--  Concepts shown:
--    * Stored FUNCTIONS (READS SQL DATA, used inside queries and triggers)
--    * Stored PROCEDURES with IN / OUT parameters
--    * Explicit TRANSACTIONS (START TRANSACTION / COMMIT / ROLLBACK)
--    * Row-level locking with SELECT ... FOR UPDATE
--    * Error handling: DECLARE EXIT HANDLER, SIGNAL, RESIGNAL
--    * Set-based INSERT ... SELECT with NOT EXISTS (idempotent batch job)
--    * Common Table Expressions, including WITH RECURSIVE
--    * Window functions (running balance with SUM() OVER)
--    * Scheduled EVENT (runs a procedure every day)
--    * SQL SECURITY DEFINER (controlled privilege elevation)
-- =============================================================================
USE mall_db;

DROP FUNCTION  IF EXISTS fn_invoice_paid;
DROP FUNCTION  IF EXISTS fn_invoice_balance;
DROP FUNCTION  IF EXISTS fn_invoice_status;
DROP PROCEDURE IF EXISTS sp_generate_invoices;
DROP PROCEDURE IF EXISTS sp_record_payment;
DROP PROCEDURE IF EXISTS sp_terminate_lease;
DROP PROCEDURE IF EXISTS sp_expire_leases;
DROP PROCEDURE IF EXISTS sp_tenant_statement;
DROP PROCEDURE IF EXISTS sp_monthly_summary;
DROP PROCEDURE IF EXISTS sp_db_objects;
DROP EVENT     IF EXISTS ev_daily_expire_leases;

DELIMITER $$

-- -----------------------------------------------------------------------------
-- fn_invoice_paid: total amount received against one invoice
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_invoice_paid(p_invoice_id INT UNSIGNED)
RETURNS DECIMAL(12,2)
READS SQL DATA
BEGIN
    DECLARE v_paid DECIMAL(12,2);
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM payments
    WHERE invoice_id = p_invoice_id;
    RETURN v_paid;
END$$

-- -----------------------------------------------------------------------------
-- fn_invoice_balance: amount still due on one invoice
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_invoice_balance(p_invoice_id INT UNSIGNED)
RETURNS DECIMAL(12,2)
READS SQL DATA
BEGIN
    DECLARE v_total DECIMAL(12,2);
    SELECT total_amount INTO v_total FROM invoices WHERE invoice_id = p_invoice_id;
    RETURN COALESCE(v_total, 0) - fn_invoice_paid(p_invoice_id);
END$$

-- -----------------------------------------------------------------------------
-- fn_invoice_status: derive the correct status from the payments made
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_invoice_status(p_invoice_id INT UNSIGNED)
RETURNS VARCHAR(20)
READS SQL DATA
BEGIN
    DECLARE v_total  DECIMAL(12,2);
    DECLARE v_status VARCHAR(20);
    DECLARE v_paid   DECIMAL(12,2);

    SELECT total_amount, status INTO v_total, v_status
    FROM invoices WHERE invoice_id = p_invoice_id;

    IF v_status = 'void' THEN
        RETURN 'void';
    END IF;

    SET v_paid = fn_invoice_paid(p_invoice_id);
    RETURN CASE
             WHEN v_paid >= v_total THEN 'paid'
             WHEN v_paid > 0        THEN 'partially_paid'
             ELSE 'unpaid'
           END;
END$$

-- -----------------------------------------------------------------------------
-- sp_generate_invoices
--   Raises one rent invoice for every lease that is in force during the given
--   month. Safe to run many times: existing invoices are skipped (NOT EXISTS +
--   UNIQUE(lease_id, billing_month)).
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_generate_invoices(
    IN  p_month     DATE,          -- any day in the month to bill
    IN  p_due_days  INT,           -- days after the 1st when payment is due
    OUT p_created   INT
)
MODIFIES SQL DATA
BEGIN
    DECLARE v_month DATE;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_month IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Billing month is required';
    END IF;

    SET v_month    = DATE_SUB(p_month, INTERVAL DAYOFMONTH(p_month) - 1 DAY);
    SET p_due_days = COALESCE(p_due_days, 10);

    IF p_due_days < 0 OR p_due_days > 60 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Due days must be between 0 and 60';
    END IF;

    START TRANSACTION;

    INSERT INTO invoices (invoice_no, lease_id, billing_month, rent_amount,
                          tax_rate, issue_date, due_date)
    SELECT  CONCAT('INV-', DATE_FORMAT(v_month, '%Y%m'), '-', LPAD(l.lease_id, 4, '0')),
            l.lease_id,
            v_month,
            l.monthly_rent,
            l.tax_rate,
            v_month,
            DATE_ADD(v_month, INTERVAL p_due_days DAY)
    FROM    leases l
    WHERE   l.start_date <= LAST_DAY(v_month)          -- lease has started
      AND   l.end_date   >= v_month                    -- and not yet ended
      AND   NOT EXISTS (SELECT 1 FROM invoices i
                        WHERE i.lease_id = l.lease_id
                          AND i.billing_month = v_month);

    SET p_created = ROW_COUNT();
    COMMIT;
END$$

-- -----------------------------------------------------------------------------
-- sp_record_payment
--   Records a payment inside a transaction. The invoice row is locked with
--   FOR UPDATE so two cashiers cannot over-collect the same bill at once.
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_record_payment(
    IN  p_invoice_id  INT UNSIGNED,
    IN  p_amount      DECIMAL(12,2),
    IN  p_date        DATE,
    IN  p_method      VARCHAR(20),
    IN  p_reference   VARCHAR(50),
    IN  p_user_id     INT UNSIGNED,
    OUT p_payment_id  INT UNSIGNED
)
MODIFIES SQL DATA
BEGIN
    DECLARE v_total   DECIMAL(12,2) DEFAULT NULL;
    DECLARE v_status  VARCHAR(20);
    DECLARE v_balance DECIMAL(12,2);
    DECLARE v_msg     VARCHAR(255);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT total_amount, status INTO v_total, v_status
    FROM   invoices
    WHERE  invoice_id = p_invoice_id
    FOR UPDATE;                                        -- pessimistic row lock

    IF v_total IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice not found';
    ELSEIF v_status = 'void' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot pay a void invoice';
    ELSEIF v_status = 'paid' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice is already fully paid';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment amount must be positive';
    END IF;

    SET v_balance = v_total - fn_invoice_paid(p_invoice_id);
    IF p_amount > v_balance THEN
        SET v_msg = CONCAT('Payment exceeds balance due of ', v_balance);
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;

    INSERT INTO payments (invoice_id, amount, payment_date, method, reference_no, recorded_by)
    VALUES (p_invoice_id, p_amount, COALESCE(p_date, CURDATE()), p_method,
            NULLIF(p_reference, ''), p_user_id);

    SET p_payment_id = LAST_INSERT_ID();
    COMMIT;                                            -- trigger has updated invoice status
END$$

-- -----------------------------------------------------------------------------
-- sp_terminate_lease
--   Ends a lease early and voids unpaid invoices for months after the end date.
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_terminate_lease(
    IN  p_lease_id  INT UNSIGNED,
    IN  p_end_date  DATE,
    OUT p_voided    INT
)
MODIFIES SQL DATA
BEGIN
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_start  DATE;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT status, start_date INTO v_status, v_start
    FROM   leases WHERE lease_id = p_lease_id
    FOR UPDATE;

    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Lease not found';
    ELSEIF v_status <> 'active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only an active lease can be terminated';
    ELSEIF p_end_date IS NULL OR p_end_date <= v_start THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Termination date must be after the lease start date';
    END IF;

    UPDATE leases
    SET    status = 'terminated', end_date = p_end_date
    WHERE  lease_id = p_lease_id;                      -- trigger frees the shop

    UPDATE invoices
    SET    status = 'void'
    WHERE  lease_id = p_lease_id
      AND  billing_month > p_end_date
      AND  status = 'unpaid';

    SET p_voided = ROW_COUNT();
    COMMIT;
END$$

-- -----------------------------------------------------------------------------
-- sp_expire_leases: housekeeping job - mark leases past their end date
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_expire_leases(OUT p_expired INT)
MODIFIES SQL DATA
BEGIN
    UPDATE leases
    SET    status = 'expired'
    WHERE  status = 'active' AND end_date < CURDATE();
    SET p_expired = ROW_COUNT();
END$$

-- -----------------------------------------------------------------------------
-- sp_tenant_statement: account ledger of one tenant with a running balance
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_tenant_statement(IN p_tenant_id INT UNSIGNED)
READS SQL DATA
BEGIN
    WITH ledger AS (
        SELECT  i.issue_date                  AS txn_date,
                'INVOICE'                     AS txn_type,
                i.invoice_no                  AS reference,
                CONCAT('Rent ', DATE_FORMAT(i.billing_month, '%Y-%m'), ' - unit ', s.unit_code) AS details,
                i.total_amount                AS debit,
                0.00                          AS credit
        FROM    invoices i
        JOIN    leases l ON l.lease_id = i.lease_id
        JOIN    shops  s ON s.shop_id  = l.shop_id
        WHERE   l.tenant_id = p_tenant_id AND i.status <> 'void'
        UNION ALL
        SELECT  p.payment_date,
                'PAYMENT',
                i.invoice_no,
                CONCAT('Payment by ', p.method, COALESCE(CONCAT(' (', p.reference_no, ')'), '')),
                0.00,
                p.amount
        FROM    payments p
        JOIN    invoices i ON i.invoice_id = p.invoice_id
        JOIN    leases   l ON l.lease_id   = i.lease_id
        WHERE   l.tenant_id = p_tenant_id
    )
    SELECT  txn_date, txn_type, reference, details, debit, credit,
            SUM(debit - credit) OVER (ORDER BY txn_date, txn_type, reference
                                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                AS running_balance
    FROM    ledger
    ORDER BY txn_date, txn_type, reference;
END$$

-- -----------------------------------------------------------------------------
-- sp_monthly_summary: 12-month financial summary for a year.
--   A recursive CTE generates all 12 months so months with no activity still
--   appear with zeros.
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_monthly_summary(IN p_year INT)
READS SQL DATA
BEGIN
    WITH RECURSIVE months (month_start) AS (
        SELECT MAKEDATE(p_year, 1)
        UNION ALL
        SELECT DATE_ADD(month_start, INTERVAL 1 MONTH)
        FROM   months
        WHERE  month_start < DATE_ADD(MAKEDATE(p_year, 1), INTERVAL 11 MONTH)
    ),
    figures AS (
        SELECT  m.month_start,
                (SELECT COALESCE(SUM(i.total_amount), 0) FROM invoices i
                  WHERE i.billing_month = m.month_start AND i.status <> 'void')  AS invoiced,
                (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
                  WHERE p.payment_date BETWEEN m.month_start AND LAST_DAY(m.month_start)) AS collected,
                (SELECT COALESCE(SUM(e.total_amount), 0) FROM expenses e
                  WHERE e.expense_date BETWEEN m.month_start AND LAST_DAY(m.month_start)) AS expenses
        FROM    months m
    )
    SELECT  DATE_FORMAT(month_start, '%Y-%m') AS period,
            invoiced,
            collected,
            expenses,
            collected - expenses              AS net_cash_flow,
            SUM(collected - expenses) OVER (ORDER BY month_start) AS cumulative_net
    FROM    figures
    ORDER BY month_start;
END$$

-- -----------------------------------------------------------------------------
-- sp_db_objects: catalogue of triggers, routines, views and events with their
--   source code, read from INFORMATION_SCHEMA.
--   SQL SECURITY DEFINER: the procedure runs with its creator's rights, so the
--   low-privilege application account can READ this metadata without being
--   granted the powerful TRIGGER / SHOW_ROUTINE privileges itself.
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_db_objects()
SQL SECURITY DEFINER
READS SQL DATA
BEGIN
    SELECT  'TRIGGER'                                       AS object_type,
            TRIGGER_NAME                                    AS object_name,
            EVENT_OBJECT_TABLE                              AS related_table,
            CONCAT(ACTION_TIMING, ' ', EVENT_MANIPULATION)  AS details,
            ACTION_STATEMENT                                AS definition
    FROM    information_schema.TRIGGERS
    WHERE   TRIGGER_SCHEMA = DATABASE()
    UNION ALL
    SELECT  ROUTINE_TYPE, ROUTINE_NAME, NULL,
            CONCAT(SQL_DATA_ACCESS, ' - SQL SECURITY ', SECURITY_TYPE,
                   IF(DTD_IDENTIFIER IS NULL, '', CONCAT(' - RETURNS ', DTD_IDENTIFIER))),
            ROUTINE_DEFINITION
    FROM    information_schema.ROUTINES
    WHERE   ROUTINE_SCHEMA = DATABASE()
    UNION ALL
    SELECT  'VIEW', TABLE_NAME, NULL, CONCAT('SQL SECURITY ', SECURITY_TYPE), VIEW_DEFINITION
    FROM    information_schema.VIEWS
    WHERE   TABLE_SCHEMA = DATABASE()
    UNION ALL
    SELECT  'EVENT', EVENT_NAME, NULL,
            CONCAT('EVERY ', INTERVAL_VALUE, ' ', INTERVAL_FIELD, ' - ', STATUS),
            EVENT_DEFINITION
    FROM    information_schema.EVENTS
    WHERE   EVENT_SCHEMA = DATABASE()
    ORDER BY object_type, object_name;
END$$

-- -----------------------------------------------------------------------------
-- Scheduled event: expire finished leases every night (needs event_scheduler=ON,
-- which is the MySQL 8 default)
-- -----------------------------------------------------------------------------
CREATE EVENT ev_daily_expire_leases
ON SCHEDULE EVERY 1 DAY
STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 1 HOUR)
COMMENT 'Marks leases whose end date has passed as expired'
DO
BEGIN
    CALL sp_expire_leases(@expired_count);
END$$

DELIMITER ;
