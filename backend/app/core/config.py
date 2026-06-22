from pydantic import BaseModel


class Settings(BaseModel):
    app_name: str = "Fleet Trips API"
    environment: str = "development"
    snapshot_path: str = "/tmp/fleet_snapshot.json"


settings = Settings()
