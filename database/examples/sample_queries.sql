-- =============================================================================
--  Mall Management System - Sample queries
--
--  A tour of SQL features, run against the sample data. Every query here is
--  read-only, so each one can also be pasted into the SQL console of the web
--  app (Database -> SQL console), one statement at a time.
--
--  Run the whole file:  mysql -u mall_readonly -p mall_db < sample_queries.sql
-- =============================================================================
USE mall_db;

-- -----------------------------------------------------------------------------
-- 1. Basic SELECT, WHERE, ORDER BY, LIMIT
-- -----------------------------------------------------------------------------
-- 1.1 Five largest vacant units
SELECT unit_code, area_sqft, base_rent
FROM shops
WHERE status = 'vacant'
ORDER BY area_sqft DESC
LIMIT 5;

-- 1.2 Pattern matching and ranges: ground-floor units renting for 50k-100k
SELECT unit_code, base_rent
FROM shops
WHERE unit_code LIKE 'G-%'
  AND base_rent BETWEEN 50000 AND 100000;

-- 1.3 NULL handling: maintenance tickets nobody has been assigned to
SELECT request_id, title, priority
FROM maintenance_requests
WHERE assigned_to IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Joins
-- -----------------------------------------------------------------------------
-- 2.1 INNER JOIN across four tables: who rents which unit, on which floor
SELECT s.unit_code, f.name AS floor, t.business_name, l.monthly_rent
FROM leases l
JOIN shops   s ON s.shop_id   = l.shop_id
JOIN floors  f ON f.floor_id  = s.floor_id
JOIN tenants t ON t.tenant_id = l.tenant_id
WHERE l.status = 'active'
ORDER BY f.level_number, s.unit_code;

-- 2.2 LEFT JOIN: every shop, with its tenant if it has one
SELECT s.unit_code, s.status, t.business_name
FROM shops s
LEFT JOIN leases  l ON l.shop_id = s.shop_id AND l.status = 'active'
LEFT JOIN tenants t ON t.tenant_id = l.tenant_id
ORDER BY s.unit_code;

-- 2.3 Self-style comparison: employees who earn more than their department average
SELECT e.employee_code, e.full_name, d.name AS department, e.monthly_salary
FROM employees e
JOIN departments d ON d.department_id = e.department_id
WHERE e.monthly_salary > (SELECT AVG(x.monthly_salary)
                          FROM employees x
                          WHERE x.department_id = e.department_id)
ORDER BY d.name;

-- -----------------------------------------------------------------------------
-- 3. Aggregation: GROUP BY, HAVING
-- -----------------------------------------------------------------------------
-- 3.1 Shop count and total area per floor
SELECT f.name AS floor, COUNT(*) AS units, SUM(s.area_sqft) AS total_area
FROM shops s
JOIN floors f ON f.floor_id = s.floor_id
GROUP BY f.floor_id, f.name
ORDER BY f.level_number;

-- 3.2 Expense categories costing more than 1,000,000 over the last 12 months
SELECT c.name, COUNT(*) AS entries, SUM(x.total_amount) AS total_spent
FROM expenses x
JOIN expense_categories c ON c.category_id = x.category_id
WHERE x.expense_date >= CURDATE() - INTERVAL 12 MONTH
GROUP BY c.category_id, c.name
HAVING total_spent > 1000000
ORDER BY total_spent DESC;

-- 3.3 Conditional aggregation: invoice counts by status in one row per month
SELECT DATE_FORMAT(billing_month, '%Y-%m')   AS period,
       SUM(status = 'paid')                  AS paid,
       SUM(status = 'partially_paid')        AS partially_paid,
       SUM(status = 'unpaid')                AS unpaid
FROM invoices
GROUP BY billing_month
ORDER BY billing_month;

-- -----------------------------------------------------------------------------
-- 4. Subqueries
-- -----------------------------------------------------------------------------
-- 4.1 IN: tenants who have paid by cheque at least once
SELECT business_name
FROM tenants
WHERE tenant_id IN (SELECT l.tenant_id
                    FROM payments p
                    JOIN invoices i ON i.invoice_id = p.invoice_id
                    JOIN leases   l ON l.lease_id   = i.lease_id
                    WHERE p.method = 'cheque');

-- 4.2 NOT EXISTS: units that have never been leased
SELECT unit_code, status
FROM shops s
WHERE NOT EXISTS (SELECT 1 FROM leases l WHERE l.shop_id = s.shop_id);

-- 4.3 Derived table: average monthly collection
SELECT ROUND(AVG(collected), 2) AS avg_monthly_collection
FROM (SELECT DATE_FORMAT(payment_date, '%Y-%m') AS period, SUM(amount) AS collected
      FROM payments
      GROUP BY period) AS m;

-- -----------------------------------------------------------------------------
-- 5. Set operations
-- -----------------------------------------------------------------------------
-- 5.1 UNION ALL: one cash ledger from two tables
SELECT payment_date AS txn_date, 'IN'  AS direction, amount        AS value FROM payments
UNION ALL
SELECT expense_date,             'OUT',              total_amount           FROM expenses
ORDER BY txn_date DESC
LIMIT 15;

-- -----------------------------------------------------------------------------
-- 6. Common table expressions (CTE)
-- -----------------------------------------------------------------------------
-- 6.1 Non-recursive CTE: tenants whose balance is above the average balance
WITH balances AS (
    SELECT business_name, outstanding FROM v_tenant_balances
)
SELECT business_name, outstanding
FROM balances
WHERE outstanding > (SELECT AVG(outstanding) FROM balances)
ORDER BY outstanding DESC;

-- 6.2 Recursive CTE: a calendar of the next 6 months (no table needed)
WITH RECURSIVE months AS (
    SELECT DATE_FORMAT(CURDATE(), '%Y-%m-01') AS month_start, 1 AS n
    UNION ALL
    SELECT month_start + INTERVAL 1 MONTH, n + 1 FROM months WHERE n < 6
)
SELECT month_start,
       (SELECT COUNT(*) FROM leases l
        WHERE l.status = 'active' AND l.end_date < month_start + INTERVAL 1 MONTH
          AND l.end_date >= month_start) AS leases_ending
FROM months;

-- -----------------------------------------------------------------------------
-- 7. Window functions
-- -----------------------------------------------------------------------------
-- 7.1 Rank shops by rent within each floor
SELECT f.name AS floor, s.unit_code, l.monthly_rent,
       RANK() OVER (PARTITION BY s.floor_id ORDER BY l.monthly_rent DESC) AS rank_on_floor
FROM leases l
JOIN shops  s ON s.shop_id  = l.shop_id
JOIN floors f ON f.floor_id = s.floor_id
WHERE l.status = 'active';

-- 7.2 Running total and month-over-month change of collections
SELECT period, income,
       SUM(income) OVER (ORDER BY period)          AS running_total,
       income - LAG(income) OVER (ORDER BY period) AS change_vs_previous
FROM v_profit_and_loss;

-- 7.3 Share of each category in total contracted rent
SELECT category_name, monthly_rent,
       ROUND(100 * monthly_rent / SUM(monthly_rent) OVER (), 1) AS pct_of_total
FROM v_category_revenue
ORDER BY monthly_rent DESC;

-- -----------------------------------------------------------------------------
-- 8. Views, stored functions and procedures
-- -----------------------------------------------------------------------------
-- 8.1 A view hides a 4-table join plus aggregation
SELECT * FROM v_floor_occupancy;

-- 8.2 Stored functions used inside a query
SELECT invoice_no, total_amount,
       fn_invoice_paid(invoice_id)    AS paid,
       fn_invoice_balance(invoice_id) AS balance,
       fn_invoice_status(invoice_id)  AS computed_status
FROM invoices
WHERE status = 'partially_paid';

-- 8.3 Stored procedures returning result sets (needs EXECUTE: run as mall_app)
-- CALL sp_monthly_summary(YEAR(CURDATE()));
-- CALL sp_tenant_statement(1);

-- -----------------------------------------------------------------------------
-- 9. Metadata: the data dictionary (INFORMATION_SCHEMA)
-- -----------------------------------------------------------------------------
-- 9.1 All foreign keys and their delete rules
SELECT k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, r.DELETE_RULE
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
WHERE k.TABLE_SCHEMA = 'mall_db'
ORDER BY k.TABLE_NAME;

-- 9.2 Does the overdue-invoice query use an index?
EXPLAIN SELECT invoice_no FROM invoices WHERE status = 'unpaid' AND due_date < CURDATE();
