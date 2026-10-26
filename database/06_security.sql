-- =============================================================================
--  Mall Management System - Database Security (DCL)
--
--  Concepts shown:
--    * Principle of least privilege
--    * MySQL 8 ROLES (CREATE ROLE, GRANT role TO user, SET DEFAULT ROLE)
--    * Table-level and COLUMN-level privileges
--    * Separate accounts for the application and for read-only reporting
--
--  Accounts created:
--    mall_app       - used by the backend API. Can read everything, write only
--                     business tables, run procedures. CANNOT modify audit_log.
--    mall_readonly  - used by the SQL console and reports. SELECT only, and it
--                     cannot see app_users.password_hash (column privilege).
--
--  !! Change the passwords below (and in backend/.env) for any real deployment.
-- =============================================================================
USE mall_db;

DROP USER IF EXISTS 'mall_app'@'%', 'mall_readonly'@'%';
DROP ROLE IF EXISTS 'mall_app_role', 'mall_readonly_role';

CREATE ROLE 'mall_app_role', 'mall_readonly_role';

-- ---------------------------------------------------------------------------
-- Application role
-- ---------------------------------------------------------------------------
GRANT SELECT, EXECUTE ON mall_db.* TO 'mall_app_role';

GRANT INSERT, UPDATE, DELETE ON mall_db.app_users            TO 'mall_app_role';
GRANT INSERT, UPDATE, DELETE ON mall_db.floors               TO 'mall_app_role';
GRANT INSERT, UPDATE, DELETE ON mall_db.shop_categories      TO 'mall_app_role';
GRANT INSERT, UPDATE, DELETE ON mall_db.departments          TO 'mall_app_role';
GRANT INSERT, UPDATE, DELETE ON mall_db.expense_categories   TO 'mall_app_role';
GRANT INSERT, UPDATE, DELETE ON mall_db.shops                TO 'mall_app_role';
GRANT INSERT, UPDATE, DELETE ON mall_db.tenants              TO 'mall_app_role';
GRANT INSERT, UPDATE, DELETE ON mall_db.leases               TO 'mall_app_role';
GRANT INSERT, UPDATE         ON mall_db.invoices             TO 'mall_app_role';  -- invoices are voided, never deleted
GRANT INSERT, DELETE         ON mall_db.payments             TO 'mall_app_role';  -- payments are immutable
GRANT INSERT, UPDATE, DELETE ON mall_db.employees            TO 'mall_app_role';
GRANT INSERT, UPDATE, DELETE ON mall_db.expenses             TO 'mall_app_role';
GRANT INSERT, UPDATE, DELETE ON mall_db.maintenance_requests TO 'mall_app_role';
-- audit_log: SELECT only (inherited from the database-level grant).
-- Triggers write to it with their DEFINER's privileges.

-- ---------------------------------------------------------------------------
-- Read-only reporting role (explicit per-object grants)
-- ---------------------------------------------------------------------------
GRANT SELECT (user_id, username, full_name, role, is_active, created_at, last_login_at)
      ON mall_db.app_users TO 'mall_readonly_role';                -- no password_hash!
GRANT SELECT ON mall_db.floors               TO 'mall_readonly_role';
GRANT SELECT ON mall_db.shop_categories      TO 'mall_readonly_role';
GRANT SELECT ON mall_db.departments          TO 'mall_readonly_role';
GRANT SELECT ON mall_db.expense_categories   TO 'mall_readonly_role';
GRANT SELECT ON mall_db.shops                TO 'mall_readonly_role';
GRANT SELECT ON mall_db.tenants              TO 'mall_readonly_role';
GRANT SELECT ON mall_db.leases               TO 'mall_readonly_role';
GRANT SELECT ON mall_db.invoices             TO 'mall_readonly_role';
GRANT SELECT ON mall_db.payments             TO 'mall_readonly_role';
GRANT SELECT ON mall_db.employees            TO 'mall_readonly_role';
GRANT SELECT ON mall_db.expenses             TO 'mall_readonly_role';
GRANT SELECT ON mall_db.maintenance_requests TO 'mall_readonly_role';
GRANT SELECT ON mall_db.audit_log            TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_shop_directory     TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_lease_details      TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_invoice_summary    TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_payment_register   TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_tenant_balances    TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_floor_occupancy    TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_category_revenue   TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_monthly_income     TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_monthly_expenses   TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_profit_and_loss    TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_expiring_leases    TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_open_maintenance   TO 'mall_readonly_role';
GRANT SELECT ON mall_db.v_department_payroll TO 'mall_readonly_role';
GRANT EXECUTE ON PROCEDURE mall_db.sp_db_objects TO 'mall_readonly_role';
-- read-only stored functions may be used in console queries
GRANT EXECUTE ON FUNCTION mall_db.fn_invoice_paid    TO 'mall_readonly_role';
GRANT EXECUTE ON FUNCTION mall_db.fn_invoice_balance TO 'mall_readonly_role';
GRANT EXECUTE ON FUNCTION mall_db.fn_invoice_status  TO 'mall_readonly_role';

-- ---------------------------------------------------------------------------
-- Login accounts
-- ---------------------------------------------------------------------------
CREATE USER 'mall_app'@'%'      IDENTIFIED BY 'MallApp#2024'   PASSWORD EXPIRE NEVER;
CREATE USER 'mall_readonly'@'%' IDENTIFIED BY 'MallRead#2024'  PASSWORD EXPIRE NEVER;

GRANT 'mall_app_role'      TO 'mall_app'@'%';
GRANT 'mall_readonly_role' TO 'mall_readonly'@'%';

SET DEFAULT ROLE 'mall_app_role'      TO 'mall_app'@'%';
SET DEFAULT ROLE 'mall_readonly_role' TO 'mall_readonly'@'%';

-- Limit the reporting account so a runaway query cannot hog the server
ALTER USER 'mall_readonly'@'%' WITH MAX_USER_CONNECTIONS 5;

FLUSH PRIVILEGES;

-- Check with:  SHOW GRANTS FOR 'mall_app'@'%' USING 'mall_app_role';
