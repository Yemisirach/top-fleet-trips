import asyncio
import os
import sys
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app.main import app

def test_login_and_dashboard():
    client = TestClient(app)
    
    # 1. Login
    print("Logging in...")
    response = client.post("/api/auth/login", json={"username": "danat.yoh", "password": "123"})
    print(f"Login Status: {response.status_code}")
    print(f"Login Body: {response.text}")
    
    if response.status_code != 200:
        return

    # 2. Access dashboard
    print("\nAccessing dashboard...")
    response = client.get("/api/dashboard/full?mode=live")
    print(f"Dashboard Status: {response.status_code}")
    if response.status_code == 500:
        print(f"Dashboard Body: {response.text}")

if __name__ == "__main__":
    test_login_and_dashboard()
