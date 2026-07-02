from functools import lru_cache
import os
from pydantic import BaseModel


class Settings(BaseModel):
    app_name: str = os.getenv("APP_NAME", "Fleet Trips API")
    environment: str = os.getenv("ENVIRONMENT", "development")
    snapshot_path: str = os.getenv("SNAPSHOT_PATH", "/tmp/fleet_snapshot.json")
    # Primary app DB (for fleet-trips app state)
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://testbed_user:testbed%40321@100.121.12.65:5432/Testbed",
    )
    # Odoo read replica / source DB
    odoo_database_url: str = os.getenv(
        "ODOO_DATABASE_URL",
        "postgresql://testbed_user:testbed%40321@100.121.12.65:5432/Testbed",
    )
    odoo_url: str = os.getenv("ODOO_URL", "")
    odoo_db: str = os.getenv("ODOO_DB", "Testbed")
    db_connect_timeout_seconds: float = float(os.getenv("DB_CONNECT_TIMEOUT_SECONDS", "5"))
    db_query_timeout_seconds: float = float(os.getenv("DB_QUERY_TIMEOUT_SECONDS", "8"))
    odoo_role_lookup_timeout_seconds: float = float(os.getenv("ODOO_ROLE_LOOKUP_TIMEOUT_SECONDS", "1.5"))
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    mayet_url: str = os.getenv("MAYET_URL", "https://mayetgps.com/")
    mayet_username: str = os.getenv("MAYET_USERNAME", "")
    mayet_password: str = os.getenv("MAYET_PASSWORD", "")


@lru_cache
def get_settings() -> Settings:
    return Settings()
