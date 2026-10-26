"""Request bodies (Pydantic models) with input validation.

Validation happens twice on purpose:
  1. here, so the user gets fast, field-level feedback, and
  2. in MySQL (NOT NULL, CHECK, FOREIGN KEY, triggers), which is the final
     authority and also protects the data from any other client.
"""
from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, create_model, model_validator

# ---------------------------------------------------------------------------
# Reusable field types
# ---------------------------------------------------------------------------
Money = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]
Rate = Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2)]
Phone = Annotated[str, Field(pattern=r"^[0-9+() -]{7,20}$", description="Digits, spaces, + - ( )")]
Email = Annotated[str, Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=120)]
Name50 = Annotated[str, Field(min_length=1, max_length=50)]
Name100 = Annotated[str, Field(min_length=1, max_length=100)]
Description = Annotated[Optional[str], Field(max_length=255)]
Id = Annotated[int, Field(gt=0)]

ShopStatus = Literal["vacant", "occupied", "under_maintenance"]
Role = Literal["admin", "manager", "staff"]
PaymentMethod = Literal["cash", "card", "bank_transfer", "cheque", "online"]
Priority = Literal["low", "medium", "high", "critical"]
TicketStatus = Literal["open", "in_progress", "resolved", "closed"]


class Schema(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


def partial(model: type[BaseModel], name: str) -> type[BaseModel]:
    """Create a copy of `model` where every field is optional (for PATCH)."""
    fields: dict[str, Any] = {}
    for field_name, info in model.model_fields.items():
        annotation = Annotated[(info.annotation, *info.metadata)] if info.metadata else info.annotation
        fields[field_name] = (Optional[annotation], None)
    return create_model(name, __base__=Schema, **fields)


# ---------------------------------------------------------------------------
# Auth & users
# ---------------------------------------------------------------------------
class LoginIn(Schema):
    username: Annotated[str, Field(min_length=1, max_length=50)]
    password: Annotated[str, Field(min_length=1, max_length=128)]


class ChangePasswordIn(Schema):
    current_password: Annotated[str, Field(min_length=1, max_length=128)]
    new_password: Annotated[str, Field(min_length=8, max_length=128)]


class UserCreate(Schema):
    username: Annotated[str, Field(pattern=r"^[A-Za-z0-9_.-]{3,50}$")]
    full_name: Name100
    role: Role = "staff"
    password: Annotated[str, Field(min_length=8, max_length=128)]
    is_active: bool = True


class UserUpdate(Schema):
    full_name: Optional[Name100] = None
    role: Optional[Role] = None
    is_active: Optional[bool] = None


class PasswordResetIn(Schema):
    new_password: Annotated[str, Field(min_length=8, max_length=128)]


# ---------------------------------------------------------------------------
# Lookup tables
# ---------------------------------------------------------------------------
class FloorIn(Schema):
    level_number: Annotated[int, Field(ge=-5, le=50)]
    name: Name50


class CategoryIn(Schema):
    name: Name50
    description: Description = None


# ---------------------------------------------------------------------------
# Core entities
# ---------------------------------------------------------------------------
class ShopIn(Schema):
    unit_code: Annotated[str, Field(pattern=r"^[A-Za-z0-9-]{1,10}$")]
    floor_id: Id
    category_id: Optional[Id] = None
    area_sqft: Annotated[Decimal, Field(gt=0, max_digits=8, decimal_places=2)]
    base_rent: Money
    status: ShopStatus = "vacant"


class TenantIn(Schema):
    business_name: Name100
    contact_person: Name100
    email: Email
    phone: Phone
    tax_id: Annotated[Optional[str], Field(max_length=20)] = None


class LeaseIn(Schema):
    shop_id: Id
    tenant_id: Id
    start_date: date
    end_date: date
    monthly_rent: PositiveMoney
    security_deposit: Money = Decimal("0")
    tax_rate: Rate = Decimal("18")

    @model_validator(mode="after")
    def check_dates(self):
        if self.end_date <= self.start_date:
            raise ValueError("end_date must be after start_date")
        return self


class LeaseUpdate(Schema):
    """Only commercial terms can be edited; status changes go through
    /terminate (stored procedure) so related invoices stay consistent."""

    end_date: Optional[date] = None
    monthly_rent: Optional[PositiveMoney] = None
    security_deposit: Optional[Money] = None
    tax_rate: Optional[Rate] = None


class TerminateLeaseIn(Schema):
    end_date: date


class EmployeeIn(Schema):
    employee_code: Annotated[str, Field(pattern=r"^[A-Za-z0-9-]{2,10}$")]
    full_name: Name100
    email: Optional[Email] = None
    phone: Phone
    department_id: Id
    job_title: Annotated[str, Field(min_length=1, max_length=60)]
    monthly_salary: Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)]
    hire_date: date
    is_active: bool = True


class ExpenseIn(Schema):
    category_id: Id
    description: Annotated[str, Field(min_length=1, max_length=255)]
    vendor: Annotated[Optional[str], Field(max_length=100)] = None
    expense_date: date
    amount: PositiveMoney
    tax_rate: Rate = Decimal("0")


class MaintenanceIn(Schema):
    shop_id: Optional[Id] = None
    title: Annotated[str, Field(min_length=1, max_length=120)]
    description: Annotated[Optional[str], Field(max_length=5000)] = None
    priority: Priority = "medium"
    status: TicketStatus = "open"
    assigned_to: Optional[Id] = None
    cost: Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)] = Decimal("0")


# ---------------------------------------------------------------------------
# Billing
# ---------------------------------------------------------------------------
class GenerateInvoicesIn(Schema):
    month: date = Field(description="Any date inside the month to bill")
    due_days: Annotated[int, Field(ge=0, le=60)] = 10


class PaymentIn(Schema):
    invoice_id: Id
    amount: PositiveMoney
    payment_date: date = Field(default_factory=date.today)
    method: PaymentMethod
    reference_no: Annotated[Optional[str], Field(max_length=50)] = None


# ---------------------------------------------------------------------------
# Database tools
# ---------------------------------------------------------------------------
class SqlQueryIn(Schema):
    sql: Annotated[str, Field(min_length=1, max_length=10000)]


# Partial (PATCH) variants -------------------------------------------------
FloorUpdate = partial(FloorIn, "FloorUpdate")
CategoryUpdate = partial(CategoryIn, "CategoryUpdate")
ShopUpdate = partial(ShopIn, "ShopUpdate")
TenantUpdate = partial(TenantIn, "TenantUpdate")
EmployeeUpdate = partial(EmployeeIn, "EmployeeUpdate")
ExpenseUpdate = partial(ExpenseIn, "ExpenseUpdate")
MaintenanceUpdate = partial(MaintenanceIn, "MaintenanceUpdate")
