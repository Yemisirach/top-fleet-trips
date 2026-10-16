from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trip import (
    ExpenseType,
    FinancialTemplate,
    FinancialTemplateExpenseLine,
    FinancialTemplateRevenueLine,
    PaymentRequest,
    PaymentRequestLine,
    Receivable,
    ReceivableLine,
    RevenueType,
    TripLocation,
)


async def list_locations(db: AsyncSession) -> list[TripLocation]:
    rows = await db.execute(text("SELECT id, name FROM trip_location ORDER BY id"))
    return [TripLocation(id=str(row.id), name=row.name) for row in rows.fetchall()]


async def list_expense_types(db: AsyncSession) -> list[ExpenseType]:
    rows = await db.execute(text("SELECT id, name FROM trip_expense_type ORDER BY id"))
    return [ExpenseType(id=str(row.id), name=row.name) for row in rows.fetchall()]


async def list_revenue_types(db: AsyncSession) -> list[RevenueType]:
    rows = await db.execute(text("SELECT id, name FROM trip_revenue_type ORDER BY id"))
    return [RevenueType(id=str(row.id), name=row.name) for row in rows.fetchall()]


async def list_financial_templates(db: AsyncSession) -> list[FinancialTemplate]:
    templates = await db.execute(text("SELECT id, name FROM trip_financial_template ORDER BY id"))
    expense_lines = await db.execute(text("""
        SELECT id, financial_template_id, expense_type_id, description, amount, quantity
        FROM trip_financial_template_expense_line
        ORDER BY id
    """))
    revenue_lines = await db.execute(text("""
        SELECT id, financial_template_id, revenue_type_id, description, amount, quantity
        FROM trip_financial_template_revenue_line
        ORDER BY id
    """))

    expense_by_template: dict[str, list[FinancialTemplateExpenseLine]] = {}
    for row in expense_lines.fetchall():
        key = str(row.financial_template_id)
        expense_by_template.setdefault(key, []).append(
            FinancialTemplateExpenseLine(
                id=str(row.id),
                expense_type_id=str(row.expense_type_id) if row.expense_type_id is not None else None,
                description=row.description,
                amount=float(row.amount or 0),
                quantity=float(row.quantity or 1),
            )
        )

    revenue_by_template: dict[str, list[FinancialTemplateRevenueLine]] = {}
    for row in revenue_lines.fetchall():
        key = str(row.financial_template_id)
        revenue_by_template.setdefault(key, []).append(
            FinancialTemplateRevenueLine(
                id=str(row.id),
                revenue_type_id=str(row.revenue_type_id) if row.revenue_type_id is not None else None,
                description=row.description,
                amount=float(row.amount or 0),
                quantity=float(row.quantity or 1),
            )
        )

    result: list[FinancialTemplate] = []
    for row in templates.fetchall():
        template_id = str(row.id)
        result.append(
            FinancialTemplate(
                id=template_id,
                name=row.name,
                expense_lines=expense_by_template.get(template_id, []),
                revenue_lines=revenue_by_template.get(template_id, []),
            )
        )
    return result


async def list_receivables(db: AsyncSession) -> list[Receivable]:
    rows = await db.execute(text("""
        SELECT
            id,
            reference,
            trip_id,
            receivable_type,
            customer_name,
            contact,
            amount_due,
            payment_reference,
            state
        FROM trip_receivable
        ORDER BY id
    """))
    line_rows = await db.execute(text("""
        SELECT id, receivable_id, description, amount, quantity
        FROM trip_receivable_line
        ORDER BY id
    """))
    lines_by_receivable: dict[str, list[ReceivableLine]] = {}
    for row in line_rows.fetchall():
        key = str(row.receivable_id)
        lines_by_receivable.setdefault(key, []).append(
            ReceivableLine(
                id=str(row.id),
                description=row.description,
                amount=float(row.amount or 0),
                quantity=float(row.quantity or 1),
            )
        )

    result: list[Receivable] = []
    for row in rows.fetchall():
        receivable_id = str(row.id)
        result.append(
            Receivable(
                id=receivable_id,
                reference=row.reference,
                trip_id=str(row.trip_id) if row.trip_id is not None else None,
                receivable_type=row.receivable_type,
                customer_name=row.customer_name,
                contact=row.contact,
                amount_due=float(row.amount_due or 0),
                payment_reference=row.payment_reference,
                state=row.state or "draft",
                line_ids=lines_by_receivable.get(receivable_id, []),
            )
        )
    return result


async def list_payment_requests(db: AsyncSession) -> list[PaymentRequest]:
    rows = await db.execute(text("""
        SELECT id, trip_id, source_doc, state
        FROM payment_request
        ORDER BY id
    """))
    line_rows = await db.execute(text("""
        SELECT payment_request_id, item, description, amount, quantity
        FROM payment_request_line
        ORDER BY id
    """))
    lines_by_request: dict[str, list[PaymentRequestLine]] = {}
    for row in line_rows.fetchall():
        key = str(row.payment_request_id)
        lines_by_request.setdefault(key, []).append(
            PaymentRequestLine(
                item=row.item or "General",
                description=row.description or "",
                amount=float(row.amount or 0),
                quantity=float(row.quantity or 1),
            )
        )

    result: list[PaymentRequest] = []
    for row in rows.fetchall():
        request_id = str(row.id)
        result.append(
            PaymentRequest(
                id=request_id,
                trip_id=str(row.trip_id) if row.trip_id is not None else None,
                source_doc=row.source_doc,
                state=row.state or "draft",
                line_ids=lines_by_request.get(request_id, []),
            )
        )
    return result
