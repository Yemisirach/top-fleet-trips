from functools import lru_cache
from pydantic import BaseModel


class Settings(BaseModel):
    app_name: str = "Fleet Trips API"
    environment: str = "development"
    snapshot_path: str = "/tmp/fleet_snapshot.json"
    database_url: str = "postgresql+asyncpg://testbed_user:CHANGE_ME@localhost:5432/Testbed"
    odoo_database_url: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
