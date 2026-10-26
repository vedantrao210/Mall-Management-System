-- =============================================================================
--  Mall Management System - Sample Data
--
--  All names are fictional placeholders. Dates are RELATIVE to the day the
--  script is run (CURDATE()), so dashboards always show the last 12 months.
--
--  Default logins (change them after first login!):
--      admin   / Admin@123     (role: admin)
--      manager / Manager@123   (role: manager)
--      staff   / Staff@123     (role: staff)
-- =============================================================================
USE mall_db;

SET @skip_audit = 1;                                   -- do not audit seed rows
SET @month0 = DATE_SUB(CURDATE(), INTERVAL DAYOFMONTH(CURDATE()) - 1 DAY);  -- 1st of this month

-- -----------------------------------------------------------------------------
-- Users (bcrypt hashes, cost 12)
-- -----------------------------------------------------------------------------
INSERT INTO app_users (username, password_hash, full_name, role) VALUES
('admin',   '$2b$12$eKTEQd369F7Mv4OC78zo1.9eBTOf7Jp9ZxKvBzHnwjHW8iESYPaTG', 'System Administrator', 'admin'),
('manager', '$2b$12$YQ/D7tJ1Y0NDwGANttOPUuXeA81pA14omCpOPmzKIKdf9qEyO/ywi', 'Operations Manager',   'manager'),
('staff',   '$2b$12$Q9CVV3eYoCkNythUCRXFoO/3O2Irmv.9tF5jJdB9tFp5ZD3T40WHK', 'Front Desk Staff',     'staff');

-- -----------------------------------------------------------------------------
-- Lookup tables
-- -----------------------------------------------------------------------------
INSERT INTO floors (level_number, name) VALUES
(-1, 'Lower Ground'), (0, 'Ground Floor'), (1, 'First Floor'), (2, 'Second Floor'), (3, 'Third Floor');

INSERT INTO shop_categories (name, description) VALUES
('Apparel',             'Clothing and fashion'),
('Footwear',            'Shoes and accessories'),
('Electronics',         'Consumer electronics and gadgets'),
('Grocery',             'Supermarket and daily needs'),
('Food & Beverage',     'Restaurants, cafes and food court'),
('Jewellery & Watches', 'Jewellery, watches and luxury goods'),
('Health & Beauty',     'Cosmetics, pharmacy and personal care'),
('Books & Stationery',  'Books, stationery and gifts'),
('Sports & Fitness',    'Sportswear and equipment'),
('Entertainment',       'Cinema, gaming and leisure'),
('Home & Living',       'Furniture and home decor');

INSERT INTO departments (name, description) VALUES
('Administration',           'General management and HR'),
('Finance & Accounts',       'Billing, collections and accounts'),
('Security',                 'Safety and security of premises'),
('Housekeeping',             'Cleaning and hygiene'),
('Facilities & Maintenance', 'Electrical, plumbing and HVAC'),
('Customer Service',         'Help desk and visitor services'),
('Marketing',                'Events, promotions and leasing'),
('Parking Operations',       'Parking management');

INSERT INTO expense_categories (name, description) VALUES
('Electricity',            'Power for common areas and HVAC'),
('Water',                  'Water supply and treatment'),
('Housekeeping Services',  'Outsourced cleaning contracts'),
('Security Services',      'Outsourced guarding contracts'),
('Repairs & Maintenance',  'Repairs, spares and AMC'),
('Marketing & Events',     'Campaigns and in-mall events'),
('Staff Salaries',         'Monthly payroll'),
('Insurance',              'Property and liability insurance'),
('Property Tax',           'Municipal property tax'),
('Office & Admin',         'Stationery, software, misc.');

-- -----------------------------------------------------------------------------
-- Shops (26 units). One unit is under maintenance; vacant ones have no lease.
-- -----------------------------------------------------------------------------
INSERT INTO shops (unit_code, floor_id, category_id, area_sqft, base_rent, status) VALUES
('LG-01', 1,  4, 6500.00, 336000.00, 'vacant'),
('LG-02', 1,  5, 1200.00,  91000.00, 'vacant'),
('LG-03', 1, 11, 2400.00,  137000.00, 'vacant'),
('LG-04', 1,  3,  900.00,  73000.00, 'under_maintenance'),
('G-01',  2,  1, 3200.00, 259000.00, 'vacant'),
('G-02',  2,  6, 1100.00, 168000.00, 'vacant'),
('G-03',  2,  7,  850.00,  109000.00, 'vacant'),
('G-04',  2,  2, 1400.00,  134000.00, 'vacant'),
('G-05',  2,  5,  700.00,  81000.00, 'vacant'),
('G-06',  2,  6,  650.00,  90000.00, 'vacant'),
('G-07',  2,  1, 1800.00, 154000.00, 'vacant'),
('F1-01', 3,  1, 2600.00, 196000.00, 'vacant'),
('F1-02', 3,  3, 2200.00, 185000.00, 'vacant'),
('F1-03', 3,  9, 1900.00, 146000.00, 'vacant'),
('F1-04', 3,  8, 1500.00,  101000.00, 'vacant'),
('F1-05', 3,  3,  600.00,  59000.00, 'vacant'),
('F1-06', 3,  7,  750.00,  70000.00, 'vacant'),
('F2-01', 4, 11, 2000.00,  123000.00, 'vacant'),
('F2-02', 4,  1, 1300.00,  106000.00, 'vacant'),
('F2-03', 4,  2,  900.00,  76000.00, 'vacant'),
('F2-04', 4,  9, 1000.00,  78000.00, 'vacant'),
('F3-01', 5, 10, 8000.00, 364000.00, 'vacant'),
('F3-02', 5, 10, 3000.00, 168000.00, 'vacant'),
('F3-03', 5,  5,  600.00,  67000.00, 'vacant'),
('F3-04', 5,  5,  550.00,  63000.00, 'vacant'),
('F3-05', 5,  5,  500.00,  59000.00, 'vacant');

-- -----------------------------------------------------------------------------
-- Tenants (fictional businesses, reserved ".example" e-mail domain)
-- -----------------------------------------------------------------------------
INSERT INTO tenants (business_name, contact_person, email, phone, tax_id) VALUES
('Urban Threads Apparel',  'Store Manager',     'contact@urbanthreads.example',  '9000000101', 'TAX-100101'),
('FreshCart Grocers',      'Operations Head',   'accounts@freshcart.example',    '9000000102', 'TAX-100102'),
('PixelPoint Electronics', 'Store Manager',     'hello@pixelpoint.example',      '9000000103', 'TAX-100103'),
('StepUp Footwear',        'Franchise Owner',   'info@stepup.example',           '9000000104', 'TAX-100104'),
('Golden Hour Jewellers',  'Accounts Manager',  'billing@goldenhour.example',    '9000000105', 'TAX-100105'),
('Glow & Care Cosmetics',  'Store Manager',     'store@glowcare.example',        '9000000106', 'TAX-100106'),
('PageTurner Books',       'Franchise Owner',   'books@pageturner.example',      '9000000107', NULL),
('Peak Performance Sports','Regional Manager',  'contact@peaksports.example',    '9000000108', 'TAX-100108'),
('Brew Haven Cafe',        'Outlet Manager',    'cafe@brewhaven.example',        '9000000109', 'TAX-100109'),
('Spice Route Kitchen',    'Outlet Manager',    'orders@spiceroute.example',     '9000000110', 'TAX-100110'),
('CineStar Screens',       'Operations Head',   'ops@cinestar.example',          '9000000111', 'TAX-100111'),
('Nest & Nook Home Decor', 'Store Manager',     'hello@nestnook.example',        '9000000112', 'TAX-100112'),
('Little Steps Kidswear',  'Franchise Owner',   'care@littlesteps.example',      '9000000113', NULL),
('TimeCraft Watches',      'Store Manager',     'service@timecraft.example',     '9000000114', 'TAX-100114'),
('GameZone Arcade',        'Operations Head',   'fun@gamezone.example',          '9000000115', 'TAX-100115'),
('Daily Bake Bakery',      'Outlet Manager',    'bake@dailybake.example',        '9000000116', NULL),
('Fit Fuel Smoothies',     'Outlet Manager',    'hello@fitfuel.example',         '9000000117', 'TAX-100117'),
('TechFix Mobile Care',    'Franchise Owner',   'support@techfix.example',       '9000000118', 'TAX-100118');

-- -----------------------------------------------------------------------------
-- Leases. Active leases fire a trigger that marks the shop as 'occupied'.
-- -----------------------------------------------------------------------------
INSERT INTO leases (shop_id, tenant_id, start_date, end_date, monthly_rent, security_deposit, tax_rate, status) VALUES
-- shop, tenant, start, end, rent, deposit, tax, status
( 1,  2, DATE_SUB(@month0, INTERVAL 20 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 40 MONTH), INTERVAL 1 DAY),  329000,  987000, 18, 'active'),
( 2, 10, DATE_SUB(@month0, INTERVAL 16 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 20 MONTH), INTERVAL 1 DAY),    90000,  270000, 18, 'active'),
( 5,  1, DATE_SUB(@month0, INTERVAL 30 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 30 MONTH), INTERVAL 1 DAY),  252000,  756000, 18, 'active'),
( 6,  5, DATE_SUB(@month0, INTERVAL 14 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 22 MONTH), INTERVAL 1 DAY),  175000,  525000, 18, 'active'),
( 7,  6, DATE_SUB(@month0, INTERVAL 11 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 25 MONTH), INTERVAL 1 DAY),   106000,  318000, 18, 'active'),
( 8,  4, DATE_SUB(@month0, INTERVAL 24 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 12 MONTH), INTERVAL 1 DAY),   133000,  399000, 18, 'active'),
( 9,  9, DATE_SUB(@month0, INTERVAL 34 MONTH), DATE_ADD(CURDATE(), INTERVAL 45 DAY),                             78000,  234000, 18, 'active'),
(10, 14, DATE_SUB(@month0, INTERVAL  9 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 27 MONTH), INTERVAL 1 DAY),    91000,  273000, 18, 'active'),
(12,  1, DATE_SUB(@month0, INTERVAL  6 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 30 MONTH), INTERVAL 1 DAY),  193000,  579000, 18, 'active'),
(13,  3, DATE_SUB(@month0, INTERVAL 18 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 18 MONTH), INTERVAL 1 DAY),  182000,  546000, 18, 'active'),
(14,  8, DATE_SUB(@month0, INTERVAL 13 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 23 MONTH), INTERVAL 1 DAY),  143000,  429000, 18, 'active'),
(15,  7, DATE_SUB(@month0, INTERVAL 26 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 10 MONTH), INTERVAL 1 DAY),    98000,  294000, 12, 'active'),
(16, 18, DATE_SUB(@month0, INTERVAL 33 MONTH), DATE_ADD(CURDATE(), INTERVAL 75 DAY),                             57000,  171000, 18, 'active'),
(19, 13, DATE_SUB(@month0, INTERVAL  4 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 32 MONTH), INTERVAL 1 DAY),   105000,  315000, 18, 'active'),
(22, 11, DATE_SUB(@month0, INTERVAL 40 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 80 MONTH), INTERVAL 1 DAY),  357000, 1071000, 18, 'active'),
(23, 15, DATE_SUB(@month0, INTERVAL 10 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 26 MONTH), INTERVAL 1 DAY),  165000,  495000, 18, 'active'),
(24, 16, DATE_SUB(@month0, INTERVAL  8 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 28 MONTH), INTERVAL 1 DAY),    66000,  198000, 18, 'active'),
(25, 17, DATE_SUB(@month0, INTERVAL  2 MONTH), DATE_SUB(DATE_ADD(@month0, INTERVAL 34 MONTH), INTERVAL 1 DAY),    63000,  189000, 18, 'active'),
-- historical leases (do not occupy a shop)
(18, 12, DATE_SUB(@month0, INTERVAL 38 MONTH), DATE_SUB(DATE_SUB(@month0, INTERVAL 2 MONTH), INTERVAL 1 DAY),    120000,  360000, 18, 'expired'),
(20,  4, DATE_SUB(@month0, INTERVAL 10 MONTH), DATE_SUB(DATE_SUB(@month0, INTERVAL 4 MONTH), INTERVAL 1 DAY),     73000,  219000, 18, 'terminated');

-- -----------------------------------------------------------------------------
-- Invoices for the last 12 months (uses the stored procedure in a loop)
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_seed_invoice_history;
DELIMITER $$
CREATE PROCEDURE sp_seed_invoice_history(IN p_months INT)
BEGIN
    DECLARE i INT DEFAULT p_months;
    WHILE i >= 0 DO
        CALL sp_generate_invoices(DATE_SUB(@month0, INTERVAL i MONTH), 10, @n);
        SET i = i - 1;
    END WHILE;
END$$
DELIMITER ;
CALL sp_seed_invoice_history(11);
DROP PROCEDURE sp_seed_invoice_history;

-- -----------------------------------------------------------------------------
-- Payments. Pattern (deterministic):
--   * most past invoices fully paid around the due date
--   * every 7th invoice only half paid, every 11th left unpaid (overdue)
--   * about one third of this month's invoices already paid
--   Triggers update each invoice's status automatically.
-- -----------------------------------------------------------------------------
--   The rows are staged in a temporary table first, because MySQL does not let
--   a trigger update `invoices` while the same statement is reading it (1442).
CREATE TEMPORARY TABLE tmp_seed_payments AS
SELECT  i.invoice_id,
        CASE WHEN MOD(i.invoice_id, 7) = 0 THEN ROUND(i.total_amount / 2, 2) ELSE i.total_amount END AS amount,
        LEAST(CURDATE(), DATE_ADD(i.due_date, INTERVAL (CAST(MOD(i.invoice_id, 9) AS SIGNED) - 5) DAY)) AS payment_date,
        ELT(1 + MOD(i.invoice_id, 4), 'bank_transfer', 'online', 'cheque', 'card') AS method,
        CONCAT('TXN', LPAD(i.invoice_id, 6, '0'))    AS reference_no,
        2                                           AS recorded_by
FROM    invoices i
WHERE   (i.billing_month < @month0 AND MOD(i.invoice_id, 11) <> 0)
   OR   (i.billing_month = @month0 AND MOD(i.invoice_id, 3) = 0);

INSERT INTO payments (invoice_id, amount, payment_date, method, reference_no, recorded_by)
SELECT * FROM tmp_seed_payments ORDER BY invoice_id;
DROP TEMPORARY TABLE tmp_seed_payments;

-- -----------------------------------------------------------------------------
-- Employees (placeholder names)
-- -----------------------------------------------------------------------------
INSERT INTO employees (employee_code, full_name, email, phone, department_id, job_title, monthly_salary, hire_date, is_active) VALUES
('EMP001', 'Employee 001', 'emp001@mall.example', '9100000001', 1, 'General Manager',          185000, DATE_SUB(CURDATE(), INTERVAL 2200 DAY), 1),
('EMP002', 'Employee 002', 'emp002@mall.example', '9100000002', 1, 'HR Executive',              52000, DATE_SUB(CURDATE(), INTERVAL 1400 DAY), 1),
('EMP003', 'Employee 003', 'emp003@mall.example', '9100000003', 2, 'Finance Manager',           120000, DATE_SUB(CURDATE(), INTERVAL 1900 DAY), 1),
('EMP004', 'Employee 004', 'emp004@mall.example', '9100000004', 2, 'Accounts Executive',        48000, DATE_SUB(CURDATE(), INTERVAL  800 DAY), 1),
('EMP005', 'Employee 005', 'emp005@mall.example', '9100000005', 2, 'Billing Clerk',             36000, DATE_SUB(CURDATE(), INTERVAL  420 DAY), 1),
('EMP006', 'Employee 006', 'emp006@mall.example', '9100000006', 3, 'Security Supervisor',       45000, DATE_SUB(CURDATE(), INTERVAL 1600 DAY), 1),
('EMP007', 'Employee 007', NULL,                  '9100000007', 3, 'Security Officer',          28000, DATE_SUB(CURDATE(), INTERVAL  900 DAY), 1),
('EMP008', 'Employee 008', NULL,                  '9100000008', 3, 'Security Officer',          28000, DATE_SUB(CURDATE(), INTERVAL  650 DAY), 1),
('EMP009', 'Employee 009', NULL,                  '9100000009', 3, 'Control Room Operator',     32000, DATE_SUB(CURDATE(), INTERVAL  300 DAY), 1),
('EMP010', 'Employee 010', 'emp010@mall.example', '9100000010', 4, 'Housekeeping Supervisor',   38000, DATE_SUB(CURDATE(), INTERVAL 1250 DAY), 1),
('EMP011', 'Employee 011', NULL,                  '9100000011', 4, 'Housekeeping Associate',    22000, DATE_SUB(CURDATE(), INTERVAL  700 DAY), 1),
('EMP012', 'Employee 012', NULL,                  '9100000012', 4, 'Housekeeping Associate',    22000, DATE_SUB(CURDATE(), INTERVAL  200 DAY), 1),
('EMP013', 'Employee 013', 'emp013@mall.example', '9100000013', 5, 'Facilities Manager',        95000, DATE_SUB(CURDATE(), INTERVAL 1750 DAY), 1),
('EMP014', 'Employee 014', NULL,                  '9100000014', 5, 'Electrician',               34000, DATE_SUB(CURDATE(), INTERVAL 1100 DAY), 1),
('EMP015', 'Employee 015', NULL,                  '9100000015', 5, 'HVAC Technician',           36000, DATE_SUB(CURDATE(), INTERVAL  560 DAY), 1),
('EMP016', 'Employee 016', NULL,                  '9100000016', 5, 'Plumber',                   30000, DATE_SUB(CURDATE(), INTERVAL  480 DAY), 1),
('EMP017', 'Employee 017', 'emp017@mall.example', '9100000017', 6, 'Customer Service Lead',     42000, DATE_SUB(CURDATE(), INTERVAL  980 DAY), 1),
('EMP018', 'Employee 018', 'emp018@mall.example', '9100000018', 7, 'Marketing Manager',         88000, DATE_SUB(CURDATE(), INTERVAL 1300 DAY), 1),
('EMP019', 'Employee 019', 'emp019@mall.example', '9100000019', 7, 'Leasing Executive',         55000, DATE_SUB(CURDATE(), INTERVAL  610 DAY), 1),
('EMP020', 'Employee 020', NULL,                  '9100000020', 8, 'Parking Attendant',         21000, DATE_SUB(CURDATE(), INTERVAL  350 DAY), 1),
('EMP021', 'Employee 021', NULL,                  '9100000021', 4, 'Housekeeping Associate',    21000, DATE_SUB(CURDATE(), INTERVAL 1500 DAY), 0);

-- -----------------------------------------------------------------------------
-- Expenses for the last 12 months (recursive CTE x expense templates)
-- -----------------------------------------------------------------------------
INSERT INTO expenses (category_id, description, vendor, expense_date, amount, tax_rate, recorded_by)
WITH RECURSIVE months (n, month_start) AS (
    SELECT 0, DATE_SUB(@month0, INTERVAL 11 MONTH)
    UNION ALL
    SELECT n + 1, DATE_ADD(month_start, INTERVAL 1 MONTH) FROM months WHERE n < 11
),
templates (category_id, description, vendor, day_offset, base_amount, step, tax_rate) AS (
    SELECT 1, 'Electricity bill - common areas', 'City Power Utility',     4, 190000, 14000, 0  UNION ALL
    SELECT 2, 'Water supply charges',            'Municipal Water Board',  6,  42000,  2500, 0  UNION ALL
    SELECT 3, 'Housekeeping contract',           'SparkleClean Services',  2, 120000,     0, 18 UNION ALL
    SELECT 4, 'Security guarding contract',      'SafeGuard Agency',       2, 140000,     0, 18 UNION ALL
    SELECT 5, 'Preventive maintenance (AMC)',    'CoolAir HVAC Services', 12,  65000,  9000, 18 UNION ALL
    SELECT 6, 'Monthly promotion campaign',      'BrightAds Media',       15,  60000, 20000, 18 UNION ALL
    SELECT 7, 'Staff salaries',                  NULL,                     0,
           (SELECT SUM(monthly_salary) FROM employees WHERE is_active = 1), 0, 0  UNION ALL
    SELECT 10, 'Office supplies and software',   'OfficeHub Supplies',    20,  18000,  3000, 18
)
SELECT  t.category_id,
        CONCAT(t.description, ' - ', DATE_FORMAT(m.month_start, '%b %Y')),
        t.vendor,
        DATE_ADD(m.month_start, INTERVAL t.day_offset DAY),
        t.base_amount + t.step * MOD(m.n * 7 + t.category_id, 4),
        t.tax_rate,
        2
FROM    months m
CROSS JOIN templates t
WHERE   DATE_ADD(m.month_start, INTERVAL t.day_offset DAY) <= CURDATE();

-- Yearly / one-off expenses
INSERT INTO expenses (category_id, description, vendor, expense_date, amount, tax_rate, recorded_by) VALUES
(8, 'Annual property insurance premium', 'SecureLife Insurance',  DATE_SUB(@month0, INTERVAL 7 MONTH), 480000, 18, 2),
(9, 'Half-yearly property tax',          'Municipal Corporation', DATE_SUB(@month0, INTERVAL 9 MONTH), 650000,  0, 2),
(9, 'Half-yearly property tax',          'Municipal Corporation', DATE_SUB(@month0, INTERVAL 3 MONTH), 650000,  0, 2),
(5, 'Escalator motor replacement',       'LiftTech Engineering',  DATE_SUB(@month0, INTERVAL 5 MONTH), 235000, 18, 2),
(6, 'Festive season decoration',         'BrightAds Media',       DATE_SUB(@month0, INTERVAL 2 MONTH), 320000, 18, 2);

-- -----------------------------------------------------------------------------
-- Maintenance requests (resolved_at is filled by trigger when not given)
-- -----------------------------------------------------------------------------
INSERT INTO maintenance_requests (shop_id, title, description, priority, status, assigned_to, reported_at, resolved_at, cost) VALUES
(4,    'Water seepage from ceiling',     'Leak above the front display area, unit closed for repairs.', 'critical', 'in_progress', 16, NOW() - INTERVAL 6 DAY,  NULL, 0),
(NULL, 'Escalator E2 making noise',      'Grinding noise on the up escalator near the atrium.',        'high',     'open',        13, NOW() - INTERVAL 2 DAY,  NULL, 0),
(13,   'AC not cooling',                 'Store temperature above 28 C in the afternoon.',             'high',     'in_progress', 15, NOW() - INTERVAL 3 DAY,  NULL, 0),
(NULL, 'Parking level lights flickering','Row C lights flicker intermittently.',                       'medium',   'open',        14, NOW() - INTERVAL 1 DAY,  NULL, 0),
(9,    'Exhaust fan repair',             'Kitchen exhaust fan vibrating.',                             'medium',   'resolved',    15, NOW() - INTERVAL 20 DAY, NOW() - INTERVAL 18 DAY, 8500),
(NULL, 'Restroom tap replacement',       'Two taps leaking in first-floor restroom.',                  'low',      'closed',      16, NOW() - INTERVAL 35 DAY, NOW() - INTERVAL 34 DAY, 3200),
(22,   'Emergency exit sign not lit',    'Exit sign near screen 3 is off.',                            'high',     'closed',      14, NOW() - INTERVAL 50 DAY, NOW() - INTERVAL 49 DAY, 1500),
(5,    'Door sensor fault',              'Automatic door does not open consistently.',                 'medium',   'resolved',    14, NOW() - INTERVAL 12 DAY, NOW() - INTERVAL 10 DAY, 6400),
(NULL, 'Fountain pump service',          'Atrium fountain pump due for service.',                      'low',      'open',        NULL, NOW() - INTERVAL 4 DAY, NULL, 0),
(15,   'Shelf bracket broken',           'Wall bracket in reading corner is loose.',                   'low',      'resolved',    16, NOW() - INTERVAL 9 DAY,  NOW() - INTERVAL 8 DAY, 900),
(NULL, 'CCTV camera offline',            'Camera 14 at loading bay offline.',                          'critical', 'resolved',     9, NOW() - INTERVAL 15 DAY, NOW() - INTERVAL 15 DAY + INTERVAL 5 HOUR, 12000),
(24,   'Drain blockage',                 'Slow drain in bakery wash area.',                            'medium',   'open',        NULL, NOW() - INTERVAL 1 DAY, NULL, 0);

SET @skip_audit = NULL;
