from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository

router = APIRouter(prefix="/finance", tags=["finance"])


def _out(row, date_attr: str) -> schemas.FinanceEntryOut:
    return schemas.FinanceEntryOut(
        id=row.id,
        category=row.category,
        amount=row.amount,
        note=row.note,
        entry_date=getattr(row, date_attr),
        created_at=row.created_at,
        created_by=row.created_by,
        created_by_name=row.user.full_name if row.user else None,
    )


@router.get("/summary")
def finance_summary(
    days: int | None = Query(default=None, ge=1, le=365),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("finance.view")),
):
    def _total(model):
        query = db.query(func.coalesce(func.sum(model.amount), 0))
        if days is not None:
            since = datetime.utcnow() - timedelta(days=days)
            query = query.filter(model.entry_date >= since)
        return round(float(query.scalar()), 2)

    expenses = _total(models.Expense)
    income = _total(models.Income)

    category_rows = (
        db.query(models.Expense.category, func.sum(models.Expense.amount))
        .group_by(models.Expense.category)
        .order_by(func.sum(models.Expense.amount).desc())
        .all()
    )
    by_category = {cat: round(float(amt), 2) for cat, amt in category_rows}

    return schemas.FinanceSummary(
        total_expenses=expenses,
        total_income=income,
        net=round(income - expenses, 2),
        by_category=by_category,
    )


# ── Expenses ────────────────────────────────────────────────────────────
@router.post("/expenses", response_model=schemas.FinanceEntryOut, status_code=201)
def create_expense(
    data: schemas.FinanceEntryIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("expense.manage")),
):
    expense = models.Expense(
        category=data.category or "Miscellaneous",
        amount=data.amount,
        note=data.note,
        expense_date=data.entry_date or datetime.utcnow(),
        created_by=current.id,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    AuditLogRepository(db).log(
        action="expense.create",
        entity_type="expense",
        entity_id=expense.id,
        user_id=current.id,
        details=f"Expense of {expense.amount} ({expense.category})",
    )
    return _out(expense, "expense_date")


@router.get("/expenses")
def list_expenses(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("expense.view")),
):
    query = db.query(models.Expense)
    total = query.count()
    rows = (
        query.order_by(models.Expense.expense_date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return schemas.Paginated[schemas.FinanceEntryOut](
        items=[_out(r, "expense_date") for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=-(-total // page_size),
    )


@router.delete("/expenses/{expense_id}", response_model=schemas.FinanceEntryOut)
def delete_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("expense.manage")),
):
    expense = db.get(models.Expense, expense_id)
    if expense is None:
        raise HTTPException(status_code=404, detail="Expense not found")
    db.delete(expense)
    db.commit()
    AuditLogRepository(db).log(
        action="expense.delete",
        entity_type="expense",
        entity_id=expense_id,
        user_id=current.id,
        details=f"Deleted expense #{expense_id}",
    )
    return _out(expense, "expense_date")


# ── Income ──────────────────────────────────────────────────────────────
@router.post("/income", response_model=schemas.FinanceEntryOut, status_code=201)
def create_income(
    data: schemas.FinanceEntryIn,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("income.manage")),
):
    income = models.Income(
        category=data.category or "Other Income",
        amount=data.amount,
        note=data.note,
        income_date=data.entry_date or datetime.utcnow(),
        created_by=current.id,
    )
    db.add(income)
    db.commit()
    db.refresh(income)
    AuditLogRepository(db).log(
        action="income.create",
        entity_type="income",
        entity_id=income.id,
        user_id=current.id,
        details=f"Income of {income.amount} ({income.category})",
    )
    return _out(income, "income_date")


@router.get("/income")
def list_income(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("income.view")),
):
    query = db.query(models.Income)
    total = query.count()
    rows = (
        query.order_by(models.Income.income_date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return schemas.Paginated[schemas.FinanceEntryOut](
        items=[_out(r, "income_date") for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=-(-total // page_size),
    )


@router.delete("/income/{income_id}", response_model=schemas.FinanceEntryOut)
def delete_income(
    income_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("income.manage")),
):
    income = db.get(models.Income, income_id)
    if income is None:
        raise HTTPException(status_code=404, detail="Income not found")
    db.delete(income)
    db.commit()
    AuditLogRepository(db).log(
        action="income.delete",
        entity_type="income",
        entity_id=income_id,
        user_id=current.id,
        details=f"Deleted income #{income_id}",
    )
    return _out(income, "income_date")
