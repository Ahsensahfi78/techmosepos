from fastapi import Depends, HTTPException, status

from .auth import get_current_user
from .models import Role

# ── Permission registry ─────────────────────────────────────────────────
# Convention: "<domain>.<action>" where action is view | create | manage
ALL_PERMISSIONS: set[str] = {
    "dashboard.view",
    "pos.access",
    "sales.create",
    "sales.view",
    "sales.return",
    "quotation.manage",
    "quotation.view",
    "purchase.manage",
    "purchase.view",
    "product.manage",
    "product.view",
    "inventory.manage",
    "inventory.view",
    "supplier.manage",
    "supplier.view",
    "customer.manage",
    "customer.view",
    "expense.manage",
    "expense.view",
    "income.manage",
    "income.view",
    "warehouse.manage",
    "warehouse.view",
    "report.view",
    "finance.view",
    "user.manage",
    "settings.manage",
    "cheque.manage",
    "audit.view",
    "warranty.manage",
    "warranty.view",
    "repair.manage",
    "repair.view",
    "backup.manage",
    "export.view",
    "ezcash.view",
    "ezcash.create",
    "ezcash.manage",
    "ezcash.report",
}

_MANAGER_PERMISSIONS: set[str] = {
    "dashboard.view",
    "pos.access",
    "sales.create",
    "sales.view",
    "sales.return",
    "quotation.manage",
    "quotation.view",
    "purchase.manage",
    "purchase.view",
    "product.manage",
    "product.view",
    "inventory.manage",
    "inventory.view",
    "supplier.manage",
    "supplier.view",
    "customer.manage",
    "customer.view",
    "expense.manage",
    "expense.view",
    "income.manage",
    "income.view",
    "warehouse.manage",
    "warehouse.view",
    "report.view",
    "finance.view",
    "cheque.manage",
    "warranty.manage",
    "warranty.view",
    "repair.manage",
    "repair.view",
    "export.view",
    "ezcash.view",
    "ezcash.create",
    "ezcash.report",
}

_ACCOUNTANT_PERMISSIONS: set[str] = {
    "dashboard.view",
    "sales.view",
    "purchase.view",
    "product.view",
    "inventory.view",
    "supplier.view",
    "customer.view",
    "expense.manage",
    "expense.view",
    "income.manage",
    "income.view",
    "warehouse.view",
    "report.view",
    "finance.view",
    "cheque.manage",
    "audit.view",
    "warranty.view",
    "repair.view",
    "export.view",
    "ezcash.view",
    "ezcash.report",
}

_CASHIER_PERMISSIONS: set[str] = {
    "dashboard.view",
    "pos.access",
    "sales.create",
    "sales.view",
    "product.view",
    "inventory.view",
    "customer.manage",
    "customer.view",
    "warehouse.view",
    "warranty.view",
    "repair.view",
    "ezcash.view",
    "ezcash.create",
}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    Role.SUPER_ADMIN.value: set(ALL_PERMISSIONS),
    Role.ADMIN.value: set(ALL_PERMISSIONS),
    Role.MANAGER.value: _MANAGER_PERMISSIONS,
    Role.ACCOUNTANT.value: _ACCOUNTANT_PERMISSIONS,
    Role.CASHIER.value: _CASHIER_PERMISSIONS,
}


def get_role_permissions(role: str) -> set[str]:
    return ROLE_PERMISSIONS.get(role, set())


def require_permission(permission: str):
    """Dependency factory. Guards an endpoint with a named permission."""

    def checker(user=Depends(get_current_user)):
        if permission not in get_role_permissions(user.role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission required: {permission}",
            )
        return user

    return checker
