import asyncio
import os
import sys

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.core.auth import authenticate

async def main():
    try:
        print("Testing authenticate with danat.yoh...")
        user = await authenticate("danat.yoh", "123")
        print(f"Result: {user}")
    except Exception as e:
        print(f"Exception: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
