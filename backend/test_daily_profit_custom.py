import sys
import requests

session = requests.Session()
# 1. Login as manager
res = session.post("http://localhost:8004/api/auth/login", json={"username": "danat.yoh", "password": "123"})
print("Manager login status:", res.status_code, res.json())
sys.stdout.flush()
assert res.status_code == 200, "Manager login failed"

# 2. Get daily-profit
res_dp = session.get("http://localhost:8004/api/reports/daily-profit")
print("Daily profit status:", res_dp.status_code)
sys.stdout.flush()
assert res_dp.status_code == 200, "Get daily-profit failed"
dp_json = res_dp.json()
report_date = dp_json.get("report_date")
print("Report date:", report_date)
rows = dp_json.get("rows", [])
print("Row count:", len(rows))
sys.stdout.flush()

if rows:
    first = rows[0]
    row_key = first.get("row_key")
    plate_number = first.get("plate_number")
    trip_id = first.get("trip_id")
    print(f"Testing with row_key={row_key}, plate={plate_number}, trip_id={trip_id}")
    sys.stdout.flush()
    
    # 3. Post custom actual and remark as manager
    custom_payload = {
        "report_date": report_date,
        "row_key": row_key,
        "actual": "88500.00",
        "remark": "Manager approved special rate",
        "plate_number": plate_number,
        "trip_id": trip_id
    }
    save_res = session.post("http://localhost:8004/api/reports/daily-profit/custom", json=custom_payload)
    print("Save status:", save_res.status_code, save_res.json())
    sys.stdout.flush()
    assert save_res.status_code == 200, "Save failed"
    
    # 4. Fetch daily-profit again to verify persisted value (from cache/db with custom layer)
    res_dp2 = session.get(f"http://localhost:8004/api/reports/daily-profit?report_date={report_date}")
    print("Fetch updated status:", res_dp2.status_code)
    sys.stdout.flush()
    dp2_json = res_dp2.json()
    rows2 = dp2_json.get("rows", [])
    updated = next((r for r in rows2 if r.get("row_key") == row_key), None)
    assert updated is not None, "Row not found in refreshed daily profit"
    print("Updated row actual:", updated.get("actual"))
    print("Updated row remark:", updated.get("remark"))
    sys.stdout.flush()
    assert str(updated.get("actual")) == "88500.00", f"Expected 88500.00, got {updated.get('actual')}"
    assert updated.get("remark") == "Manager approved special rate", f"Expected remark match, got {updated.get('remark')}"
    print("SUCCESS: Manager persistence verified!")
    sys.stdout.flush()

# 5. Verify supervisor is blocked
sup_session = requests.Session()
sup_login = sup_session.post("http://localhost:8004/api/auth/login", json={"username": "alula.yem", "password": "123"})
print("Supervisor login status:", sup_login.status_code, sup_login.json())
sys.stdout.flush()
assert sup_login.status_code == 200, "Supervisor login failed"
sup_save = sup_session.post("http://localhost:8004/api/reports/daily-profit/custom", json={"report_date": report_date or "2026-11-26", "row_key": "test", "actual": "100"})
print("Supervisor save status:", sup_save.status_code, sup_save.text)
sys.stdout.flush()
assert sup_save.status_code == 403, "Supervisor should be forbidden from saving custom daily report!"
print("SUCCESS: Supervisor correctly blocked with 403 Forbidden!")
print("ALL TESTS PASSED SUCCESSFULLY!")
