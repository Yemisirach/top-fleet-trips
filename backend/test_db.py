import asyncio
import os
import asyncpg
import pytest

async def main():
    db_url = (os.getenv("ODOO_DATABASE_URL") or os.getenv("DATABASE_URL") or "").replace("+asyncpg", "")
    if not db_url:
        raise RuntimeError("Set ODOO_DATABASE_URL or DATABASE_URL to run this check.")
    try:
        print("Connecting to DB...")
        conn = await asyncpg.connect(db_url, timeout=5)
        print("Success!")
        await conn.close()
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())


@pytest.mark.asyncio
async def test_database_connection_from_env():
    db_url = (os.getenv("ODOO_DATABASE_URL") or os.getenv("DATABASE_URL") or "").replace("+asyncpg", "")
    if not db_url:
        pytest.skip("ODOO_DATABASE_URL or DATABASE_URL is not set.")
    conn = await asyncpg.connect(db_url, timeout=5)
    try:
        result = await conn.fetchval("SELECT 1")
        assert result == 1
    finally:
        await conn.close()
