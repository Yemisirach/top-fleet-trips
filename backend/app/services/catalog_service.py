from app.models.trip import ExpenseType, FinancialTemplate, PaymentRequest, Receivable, RevenueType, TripLocation
from app.repositories.memory import repo


def seed_catalog_data() -> None:
    if repo.list_locations() or repo.list_expense_types() or repo.list_revenue_types():
        return

    repo.save_location(TripLocation(name="Addis Ababa Depot"))
    repo.save_location(TripLocation(name="Airport"))
    repo.save_expense_type(ExpenseType(name="Fuel"))
    repo.save_expense_type(ExpenseType(name="Maintenance"))
    repo.save_revenue_type(RevenueType(name="Customer Order"))
    repo.save_revenue_type(RevenueType(name="Trip Revenue"))
    repo.save_financial_template(FinancialTemplate(name="Default Trip Template"))


def list_locations() -> list[TripLocation]:
    seed_catalog_data()
    return repo.list_locations()


def list_expense_types() -> list[ExpenseType]:
    seed_catalog_data()
    return repo.list_expense_types()


def list_revenue_types() -> list[RevenueType]:
    seed_catalog_data()
    return repo.list_revenue_types()


def list_financial_templates() -> list[FinancialTemplate]:
    seed_catalog_data()
    return repo.list_financial_templates()


def list_receivables() -> list[Receivable]:
    seed_catalog_data()
    return repo.list_receivables()


def list_payment_requests() -> list[PaymentRequest]:
    seed_catalog_data()
    return repo.list_payment_requests()
