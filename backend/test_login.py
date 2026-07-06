import asyncio
from app.core.auth import authenticate

async def main():
    try:
        print("Testing authenticate with dummy credentials...")
        user = await authenticate("testbed_user", "estbed@321")
        print(f"Result: {user}")
    except Exception as e:
        print(f"Exception: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
