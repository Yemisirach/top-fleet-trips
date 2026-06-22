from functools import lru_cache
import os
from pydantic import BaseModel


class Settings(BaseModel):
    app_name: str = os.getenv("APP_NAME", "Fleet Trips API")
    environment: str = os.getenv("ENVIRONMENT", "development")
    snapshot_path: str = os.getenv("SNAPSHOT_PATH", "/tmp/fleet_snapshot.json")
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://testbed_user:CHANGE_ME@localhost:5432/Testbed",
    )
    odoo_database_url: str | None = os.getenv("ODOO_DATABASE_URL")


@lru_cache
def get_settings() -> Settings:
    return Settings()
