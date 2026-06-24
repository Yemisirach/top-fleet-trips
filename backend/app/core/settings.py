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


@lru_cache
def get_settings() -> Settings:
    return Settings()
