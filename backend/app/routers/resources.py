"""Standard CRUD resources, declared as configuration.

Adding a new simple table to the API only requires a new `Resource(...)`
entry here (plus its Pydantic models in schemas.py).
"""
from .. import schemas as s
from ..crud import Resource, build_router

FLOORS = Resource(
    name="floors", title="Floors", table="floors", pk="floor_id",
    list_sql="""
        SELECT f.floor_id, f.level_number, f.name,
               (SELECT COUNT(*) FROM shops x WHERE x.floor_id = f.floor_id) AS shop_count
        FROM floors f""",
    columns=["floor_id", "level_number", "name", "shop_count"],
    search=["name"], default_sort="level_number", label_sql="name",
    create_model=s.FloorIn, update_model=s.FloorUpdate,
)

SHOP_CATEGORIES = Resource(
    name="shop-categories", title="Shop categories", table="shop_categories", pk="category_id",
    list_sql="""
        SELECT c.category_id, c.name, c.description,
               (SELECT COUNT(*) FROM shops x WHERE x.category_id = c.category_id) AS shop_count
        FROM shop_categories c""",
    columns=["category_id", "name", "description", "shop_count"],
    search=["name", "description"], default_sort="name", label_sql="name",
    create_model=s.CategoryIn, update_model=s.CategoryUpdate,
)

DEPARTMENTS = Resource(
    name="departments", title="Departments", table="departments", pk="department_id",
    list_sql="""
        SELECT d.department_id, d.name, d.description,
               (SELECT COUNT(*) FROM employees x WHERE x.department_id = d.department_id
                                                  AND x.is_active = 1) AS headcount
        FROM departments d""",
    columns=["department_id", "name", "description", "headcount"],
    search=["name", "description"], default_sort="name", label_sql="name",
    create_model=s.CategoryIn, update_model=s.CategoryUpdate,
)

EXPENSE_CATEGORIES = Resource(
    name="expense-categories", title="Expense categories", table="expense_categories", pk="category_id",
    list_sql="""
        SELECT c.category_id, c.name, c.description,
               (SELECT COUNT(*) FROM expenses x WHERE x.category_id = c.category_id) AS expense_count
        FROM expense_categories c""",
    columns=["category_id", "name", "description", "expense_count"],
    search=["name", "description"], default_sort="name", label_sql="name",
    create_model=s.CategoryIn, update_model=s.CategoryUpdate,
)

SHOPS = Resource(
    name="shops", title="Shops", table="shops", pk="shop_id",
    list_sql="SELECT * FROM v_shop_directory",
    columns=["shop_id", "unit_code", "floor_name", "level_number", "category_name", "area_sqft",
             "base_rent", "status", "current_tenant", "current_rent", "lease_end_date",
             "floor_id", "category_id"],
    search=["unit_code", "floor_name", "category_name", "current_tenant"],
    filters=["status", "floor_id", "category_id"],
    default_sort="unit_code",
    label_sql="CONCAT(unit_code, ' (', REPLACE(status, '_', ' '), ')')",
    create_model=s.ShopIn, update_model=s.ShopUpdate,
)

TENANTS = Resource(
    name="tenants", title="Tenants", table="tenants", pk="tenant_id",
    list_sql="""
        SELECT t.tenant_id, t.business_name, t.contact_person, t.email, t.phone, t.tax_id,
               t.created_at, b.active_leases, b.total_invoiced, b.total_paid,
               b.outstanding, b.overdue_amount
        FROM tenants t JOIN v_tenant_balances b ON b.tenant_id = t.tenant_id""",
    columns=["tenant_id", "business_name", "contact_person", "email", "phone", "tax_id",
             "created_at", "active_leases", "outstanding", "overdue_amount"],
    search=["business_name", "contact_person", "email", "phone", "tax_id"],
    default_sort="business_name", label_sql="business_name",
    create_model=s.TenantIn, update_model=s.TenantUpdate,
)

EMPLOYEES = Resource(
    name="employees", title="Employees", table="employees", pk="employee_id",
    list_sql="""
        SELECT e.employee_id, e.employee_code, e.full_name, e.email, e.phone,
               e.department_id, d.name AS department_name, e.job_title,
               e.monthly_salary, e.hire_date, e.is_active,
               TIMESTAMPDIFF(YEAR, e.hire_date, CURDATE()) AS years_of_service
        FROM employees e JOIN departments d ON d.department_id = e.department_id""",
    columns=["employee_id", "employee_code", "full_name", "department_name", "job_title",
             "monthly_salary", "hire_date", "is_active", "department_id", "years_of_service"],
    search=["employee_code", "full_name", "email", "phone", "job_title", "department_name"],
    filters=["department_id", "is_active"],
    default_sort="employee_code",
    label_sql="CONCAT(employee_code, ' - ', full_name, ' (', job_title, ')')",
    create_model=s.EmployeeIn, update_model=s.EmployeeUpdate,
)

EXPENSES = Resource(
    name="expenses", title="Expenses", table="expenses", pk="expense_id",
    list_sql="""
        SELECT x.expense_id, x.expense_date, x.category_id, c.name AS category_name,
               x.description, x.vendor, x.amount, x.tax_rate, x.tax_amount, x.total_amount,
               u.username AS recorded_by, x.created_at
        FROM expenses x
        JOIN expense_categories c ON c.category_id = x.category_id
        LEFT JOIN app_users u ON u.user_id = x.recorded_by""",
    columns=["expense_id", "expense_date", "category_name", "description", "vendor", "amount",
             "tax_amount", "total_amount", "category_id"],
    search=["description", "vendor", "category_name"],
    filters=["category_id"],
    default_sort="expense_date",
    label_sql="CONCAT(expense_date, ' - ', description)",
    create_model=s.ExpenseIn, update_model=s.ExpenseUpdate,
    stamp_user={"recorded_by": "user_id"},
)

MAINTENANCE = Resource(
    name="maintenance", title="Maintenance requests", table="maintenance_requests", pk="request_id",
    list_sql="""
        SELECT m.request_id, m.title, m.description, m.priority, m.status,
               m.shop_id, COALESCE(s.unit_code, 'Common area') AS location,
               m.assigned_to, e.full_name AS assigned_name,
               m.reported_at, m.resolved_at, m.cost,
               CASE m.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                               WHEN 'medium' THEN 3 ELSE 4 END AS priority_rank
        FROM maintenance_requests m
        LEFT JOIN shops s ON s.shop_id = m.shop_id
        LEFT JOIN employees e ON e.employee_id = m.assigned_to""",
    columns=["request_id", "title", "priority", "status", "location", "assigned_name",
             "reported_at", "resolved_at", "cost", "priority_rank", "shop_id", "assigned_to"],
    search=["title", "description", "location", "assigned_name"],
    filters=["status", "priority", "shop_id"],
    default_sort="reported_at",
    label_sql="CONCAT('#', request_id, ' ', title)",
    create_model=s.MaintenanceIn, update_model=s.MaintenanceUpdate,
    # staff may log and update tickets, only managers may delete them
    create_roles=("admin", "manager", "staff"),
    update_roles=("admin", "manager", "staff"),
)

RESOURCES = [FLOORS, SHOP_CATEGORIES, DEPARTMENTS, EXPENSE_CATEGORIES, SHOPS, TENANTS,
             EMPLOYEES, EXPENSES, MAINTENANCE]

routers = [build_router(r) for r in RESOURCES]
