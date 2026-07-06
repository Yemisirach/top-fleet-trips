import asyncio
import asyncpg
import sys

async def main():
    db_url = "postgresql://testbed_user:estbed%40321@167.235.55.60:5432/Testbed"
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
