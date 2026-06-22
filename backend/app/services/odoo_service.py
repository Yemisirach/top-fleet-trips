from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import get_settings

settings = get_settings()


@dataclass
class OdooConnectionStatus:
    configured: bool
    reachable: bool
    message: str


async def check_odoo_connection(session: AsyncSession) -> OdooConnectionStatus:
    if not settings.odoo_database_url:
        return OdooConnectionStatus(
            configured=False,
            reachable=False,
            message="Odoo database URL is not configured yet.",
        )

    try:
        await session.execute(text("SELECT 1"))
        return OdooConnectionStatus(
            configured=True,
            reachable=True,
            message="Odoo connection is reachable.",
        )
    except Exception as exc:  # pragma: no cover - surfaced to API
        return OdooConnectionStatus(
            configured=True,
            reachable=False,
            message=f"Odoo connection failed: {exc}",
        )
