-- =============================================================================
--  Mall Management System - Views
--
--  Views give the application and reports a simple, stable interface over the
--  normalised tables. Concepts shown:
--    * INNER / LEFT OUTER JOINs across several tables
--    * Aggregation with GROUP BY, conditional aggregation (SUM(CASE ...))
--    * Correlated and derived-table subqueries
--    * Date arithmetic (DATEDIFF, DATE_FORMAT, LAST_DAY)
--    * UNION ALL to combine income and expense streams
-- =============================================================================
USE mall_db;

-- Every shop with its floor, category and (if any) current tenant ------------
CREATE OR REPLACE VIEW v_shop_directory AS
SELECT  s.shop_id,
        s.unit_code,
        f.floor_id,
        f.name              AS floor_name,
        f.level_number,
        c.category_id,
        c.name              AS category_name,
        s.area_sqft,
        s.base_rent,
        s.status,
        l.lease_id          AS current_lease_id,
        t.tenant_id         AS current_tenant_id,
        t.business_name     AS current_tenant,
        l.monthly_rent      AS current_rent,
        l.end_date          AS lease_end_date
FROM        shops s
INNER JOIN  floors f            ON f.floor_id = s.floor_id
LEFT JOIN   shop_categories c   ON c.category_id = s.category_id
LEFT JOIN   leases l            ON l.shop_id = s.shop_id AND l.status = 'active'
LEFT JOIN   tenants t           ON t.tenant_id = l.tenant_id;

-- Leases with readable tenant / shop data and time remaining -----------------
CREATE OR REPLACE VIEW v_lease_details AS
SELECT  l.lease_id,
        l.shop_id,
        s.unit_code,
        f.name                              AS floor_name,
        l.tenant_id,
        t.business_name,
        l.start_date,
        l.end_date,
        l.monthly_rent,
        l.security_deposit,
        l.tax_rate,
        l.status,
        TIMESTAMPDIFF(MONTH, l.start_date, l.end_date) AS term_months,
        CASE WHEN l.status = 'active' THEN DATEDIFF(l.end_date, CURDATE()) END AS days_remaining,
        l.created_at
FROM        leases l
INNER JOIN  shops s   ON s.shop_id = l.shop_id
INNER JOIN  floors f  ON f.floor_id = s.floor_id
INNER JOIN  tenants t ON t.tenant_id = l.tenant_id;

-- Invoice with amount paid, balance and overdue information -----------------
CREATE OR REPLACE VIEW v_invoice_summary AS
SELECT  i.invoice_id,
        i.invoice_no,
        i.lease_id,
        l.tenant_id,
        t.business_name,
        s.unit_code,
        i.billing_month,
        DATE_FORMAT(i.billing_month, '%Y-%m')          AS period,
        i.rent_amount,
        i.tax_rate,
        i.tax_amount,
        i.total_amount,
        COALESCE(p.amount_paid, 0)                     AS amount_paid,
        i.total_amount - COALESCE(p.amount_paid, 0)    AS balance_due,
        i.issue_date,
        i.due_date,
        i.status,
        CASE WHEN i.status IN ('unpaid','partially_paid') AND i.due_date < CURDATE()
             THEN DATEDIFF(CURDATE(), i.due_date) ELSE 0 END AS days_overdue
FROM        invoices i
INNER JOIN  leases  l ON l.lease_id = i.lease_id
INNER JOIN  tenants t ON t.tenant_id = l.tenant_id
INNER JOIN  shops   s ON s.shop_id = l.shop_id
LEFT JOIN  (SELECT invoice_id, SUM(amount) AS amount_paid
            FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.invoice_id;

-- Payment register ------------------------------------------------------------
CREATE OR REPLACE VIEW v_payment_register AS
SELECT  p.payment_id,
        p.invoice_id,
        i.invoice_no,
        t.tenant_id,
        t.business_name,
        s.unit_code,
        p.amount,
        p.payment_date,
        p.method,
        p.reference_no,
        u.username AS recorded_by,
        p.created_at
FROM        payments p
INNER JOIN  invoices i ON i.invoice_id = p.invoice_id
INNER JOIN  leases   l ON l.lease_id = i.lease_id
INNER JOIN  tenants  t ON t.tenant_id = l.tenant_id
INNER JOIN  shops    s ON s.shop_id = l.shop_id
LEFT JOIN   app_users u ON u.user_id = p.recorded_by;

-- Outstanding balance per tenant -------------------------------------------
CREATE OR REPLACE VIEW v_tenant_balances AS
SELECT  t.tenant_id,
        t.business_name,
        t.contact_person,
        t.email,
        t.phone,
        (SELECT COUNT(*) FROM leases l2
          WHERE l2.tenant_id = t.tenant_id AND l2.status = 'active')     AS active_leases,
        COALESCE(SUM(v.total_amount), 0)                                  AS total_invoiced,
        COALESCE(SUM(v.amount_paid), 0)                                   AS total_paid,
        COALESCE(SUM(v.balance_due), 0)                                   AS outstanding,
        COALESCE(SUM(CASE WHEN v.days_overdue > 0 THEN v.balance_due END), 0) AS overdue_amount
FROM        tenants t
LEFT JOIN   v_invoice_summary v ON v.tenant_id = t.tenant_id AND v.status <> 'void'
GROUP BY    t.tenant_id, t.business_name, t.contact_person, t.email, t.phone;

-- Occupancy statistics per floor (conditional aggregation) -----------------
CREATE OR REPLACE VIEW v_floor_occupancy AS
SELECT  f.floor_id,
        f.name                                                     AS floor_name,
        f.level_number,
        COUNT(s.shop_id)                                           AS total_units,
        SUM(CASE WHEN s.status = 'occupied' THEN 1 ELSE 0 END)     AS occupied_units,
        SUM(CASE WHEN s.status = 'vacant' THEN 1 ELSE 0 END)       AS vacant_units,
        SUM(CASE WHEN s.status = 'under_maintenance' THEN 1 ELSE 0 END) AS maintenance_units,
        COALESCE(SUM(s.area_sqft), 0)                              AS total_area_sqft,
        ROUND(100 * SUM(CASE WHEN s.status = 'occupied' THEN 1 ELSE 0 END)
              / NULLIF(COUNT(s.shop_id), 0), 1)                    AS occupancy_pct
FROM        floors f
LEFT JOIN   shops s ON s.floor_id = f.floor_id
GROUP BY    f.floor_id, f.name, f.level_number;

-- Contracted monthly rent by shop category ---------------------------------
CREATE OR REPLACE VIEW v_category_revenue AS
SELECT  COALESCE(c.name, 'Uncategorised')   AS category_name,
        COUNT(DISTINCT s.shop_id)           AS units,
        COUNT(l.lease_id)                   AS active_leases,
        COALESCE(SUM(l.monthly_rent), 0)    AS monthly_rent,
        ROUND(COALESCE(SUM(l.monthly_rent), 0) / NULLIF(SUM(CASE WHEN l.lease_id IS NOT NULL THEN s.area_sqft END), 0), 2)
                                            AS rent_per_sqft
FROM        shops s
LEFT JOIN   shop_categories c ON c.category_id = s.category_id
LEFT JOIN   leases l ON l.shop_id = s.shop_id AND l.status = 'active'
GROUP BY    COALESCE(c.name, 'Uncategorised');

-- Cash collected per month --------------------------------------------------
CREATE OR REPLACE VIEW v_monthly_income AS
SELECT  DATE_FORMAT(payment_date, '%Y-%m') AS period,
        COUNT(*)                           AS payments,
        SUM(amount)                        AS collected
FROM    payments
GROUP BY DATE_FORMAT(payment_date, '%Y-%m');

-- Expenses per month and category -------------------------------------------
CREATE OR REPLACE VIEW v_monthly_expenses AS
SELECT  DATE_FORMAT(e.expense_date, '%Y-%m') AS period,
        ec.name                              AS category_name,
        COUNT(*)                             AS entries,
        SUM(e.total_amount)                  AS total_spent
FROM        expenses e
INNER JOIN  expense_categories ec ON ec.category_id = e.category_id
GROUP BY    DATE_FORMAT(e.expense_date, '%Y-%m'), ec.name;

-- Profit & loss per month (UNION ALL of two streams, then pivot) ------------
CREATE OR REPLACE VIEW v_profit_and_loss AS
SELECT  period,
        SUM(income)            AS income,
        SUM(expense)           AS expenses,
        SUM(income) - SUM(expense) AS net_profit
FROM (
        SELECT DATE_FORMAT(payment_date, '%Y-%m') AS period, amount AS income, 0 AS expense
        FROM payments
        UNION ALL
        SELECT DATE_FORMAT(expense_date, '%Y-%m'), 0, total_amount
        FROM expenses
     ) AS ledger
GROUP BY period;

-- Active leases that end within the next 90 days -----------------------------
CREATE OR REPLACE VIEW v_expiring_leases AS
SELECT  lease_id, unit_code, floor_name, business_name, start_date, end_date,
        monthly_rent, days_remaining
FROM    v_lease_details
WHERE   status = 'active' AND days_remaining BETWEEN 0 AND 90;

-- Open maintenance tickets ----------------------------------------------------
CREATE OR REPLACE VIEW v_open_maintenance AS
SELECT  m.request_id,
        m.title,
        m.priority,
        m.status,
        COALESCE(s.unit_code, 'Common area')    AS location,
        e.full_name                             AS assigned_to,
        m.reported_at,
        TIMESTAMPDIFF(DAY, m.reported_at, NOW()) AS age_days
FROM        maintenance_requests m
LEFT JOIN   shops s     ON s.shop_id = m.shop_id
LEFT JOIN   employees e ON e.employee_id = m.assigned_to
WHERE       m.status IN ('open','in_progress');

-- Head count and payroll per department -------------------------------------
CREATE OR REPLACE VIEW v_department_payroll AS
SELECT  d.department_id,
        d.name                                  AS department_name,
        COUNT(e.employee_id)                    AS headcount,
        COALESCE(SUM(e.monthly_salary), 0)      AS monthly_payroll,
        ROUND(COALESCE(AVG(e.monthly_salary), 0), 2) AS avg_salary
FROM        departments d
LEFT JOIN   employees e ON e.department_id = d.department_id AND e.is_active = 1
GROUP BY    d.department_id, d.name;
