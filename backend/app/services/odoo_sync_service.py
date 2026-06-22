from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


EXPECTED_TABLES = [
    "trip_trip",
    "trip_location",
    "trip_expense_type",
    "trip_revenue_type",
    "trip_expense_line",
    "trip_revenue_line",
    "trip_financial_template",
    "trip_financial_template_expense_line",
    "trip_financial_template_revenue_line",
    "trip_receivable",
    "trip_receivable_line",
    "trip_timeline",
    "trip_timeline_entry",
    "fleet_vehicle_supervisor",
]


@dataclass
class SyncResult:
    ok: bool
    message: str
    tables_seen: list[str]
    tables_missing: list[str]


async def inspect_trip_schema(session: AsyncSession) -> SyncResult:
    rows = await session.execute(
        text(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
            """
        )
    )
    tables_seen = [row[0] for row in rows.fetchall()]
    missing = [table for table in EXPECTED_TABLES if table not in tables_seen]
    return SyncResult(
        ok=not missing,
        message="Schema inspection complete." if not missing else "Some expected tables are missing.",
        tables_seen=tables_seen,
        tables_missing=missing,
    )
