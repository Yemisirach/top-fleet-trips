"""Persistent storage for manager edits on daily reports (Actual and Remark)."""
from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3
from typing import Any, Optional


def _get_db_path() -> Path:
    data_dir_env = os.getenv("FLEET_DATA_DIR")
    if data_dir_env:
        data_dir = Path(data_dir_env)
    else:
        # Default to backend/data
        data_dir = Path(__file__).resolve().parents[2] / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "daily_profit_custom.db"


def _init_db(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS daily_profit_custom (
            report_date TEXT NOT NULL,
            row_key TEXT NOT NULL,
            plate_number TEXT,
            trip_id TEXT,
            actual TEXT,
            remark TEXT,
            updated_by TEXT,
            updated_at TEXT,
            PRIMARY KEY (report_date, row_key)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_daily_profit_custom_date
        ON daily_profit_custom(report_date)
    """)
    conn.commit()


def get_custom_entries(report_date: str) -> dict[str, dict[str, Any]]:
    """Retrieve all custom overrides for a specific date, keyed by row_key."""
    db_path = _get_db_path()
    try:
        with sqlite3.connect(db_path, timeout=5.0) as conn:
            _init_db(conn)
            cursor = conn.execute("""
                SELECT row_key, plate_number, trip_id, actual, remark, updated_by, updated_at
                FROM daily_profit_custom
                WHERE report_date = ?
            """, (report_date,))
            result: dict[str, dict[str, Any]] = {}
            for row in cursor.fetchall():
                row_key, plate, trip_id, actual, remark, by, at = row
                item = {
                    "row_key": row_key,
                    "plate_number": plate,
                    "trip_id": trip_id,
                    "actual": actual,
                    "remark": remark,
                    "updated_by": by,
                    "updated_at": at,
                }
                result[row_key] = item
                if plate:
                    result[f"plate:{plate}"] = item
                if trip_id:
                    result[f"trip:{trip_id}"] = item
            return result
    except Exception:
        return {}


def save_custom_entry(
    report_date: str,
    row_key: str,
    actual: Optional[str] = None,
    remark: Optional[str] = None,
    plate_number: Optional[str] = None,
    trip_id: Optional[str] = None,
    updated_by: Optional[str] = None,
) -> dict[str, Any]:
    """Insert or update a single custom override entry."""
    db_path = _get_db_path()
    now_iso = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(db_path, timeout=5.0) as conn:
        _init_db(conn)
        conn.execute("""
            INSERT INTO daily_profit_custom (report_date, row_key, plate_number, trip_id, actual, remark, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(report_date, row_key) DO UPDATE SET
                actual = COALESCE(excluded.actual, daily_profit_custom.actual),
                remark = COALESCE(excluded.remark, daily_profit_custom.remark),
                plate_number = COALESCE(excluded.plate_number, daily_profit_custom.plate_number),
                trip_id = COALESCE(excluded.trip_id, daily_profit_custom.trip_id),
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
        """, (
            report_date,
            row_key,
            plate_number,
            str(trip_id) if trip_id is not None else None,
            str(actual) if actual is not None else None,
            str(remark) if remark is not None else None,
            updated_by,
            now_iso,
        ))
        conn.commit()
    return {
        "report_date": report_date,
        "row_key": row_key,
        "actual": actual,
        "remark": remark,
        "updated_by": updated_by,
        "updated_at": now_iso,
    }


def save_custom_entries_bulk(
    report_date: str,
    entries: list[dict[str, Any]],
    updated_by: Optional[str] = None,
) -> int:
    """Insert or update multiple custom override entries in a transaction."""
    if not entries:
        return 0
    db_path = _get_db_path()
    now_iso = datetime.now(timezone.utc).isoformat()
    count = 0
    with sqlite3.connect(db_path, timeout=5.0) as conn:
        _init_db(conn)
        for entry in entries:
            row_key = str(entry.get("row_key") or entry.get("plate_number") or "")
            if not row_key:
                continue
            actual = entry.get("actual")
            remark = entry.get("remark")
            plate = entry.get("plate_number")
            trip_id = entry.get("trip_id")
            conn.execute("""
                INSERT INTO daily_profit_custom (report_date, row_key, plate_number, trip_id, actual, remark, updated_by, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(report_date, row_key) DO UPDATE SET
                    actual = excluded.actual,
                    remark = excluded.remark,
                    plate_number = COALESCE(excluded.plate_number, daily_profit_custom.plate_number),
                    trip_id = COALESCE(excluded.trip_id, daily_profit_custom.trip_id),
                    updated_by = excluded.updated_by,
                    updated_at = excluded.updated_at
            """, (
                report_date,
                row_key,
                plate,
                str(trip_id) if trip_id is not None else None,
                str(actual) if actual is not None else None,
                str(remark) if remark is not None else None,
                updated_by,
                now_iso,
            ))
            count += 1
        conn.commit()
    return count
