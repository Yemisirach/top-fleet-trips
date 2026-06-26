from __future__ import annotations

import asyncio
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
        await asyncio.wait_for(
            session.execute(text("SELECT 1")),
            timeout=settings.db_query_timeout_seconds,
        )
        return OdooConnectionStatus(
            configured=True,
            reachable=True,
            message="Odoo connection is reachable.",
        )
    except asyncio.TimeoutError:
        return OdooConnectionStatus(
            configured=True,
            reachable=False,
            message=f"Odoo connection timed out after {settings.db_query_timeout_seconds:g}s.",
        )
    except Exception as exc:  # pragma: no cover - surfaced to API
        return OdooConnectionStatus(
            configured=True,
            reachable=False,
            message=f"Odoo connection failed: {exc}",
        )
