"""Application settings, loaded from environment variables or a `.env` file."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    app_name: str = "Mall Management System"

    # Database (application account)
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_name: str = "mall_db"
    db_user: str = "mall_app"
    db_password: str = "MallApp#2024"

    # Database (read-only account for the SQL console / table browser)
    db_readonly_user: str = "mall_readonly"
    db_readonly_password: str = "MallRead#2024"

    # Auth
    jwt_secret: str = "change-this-to-a-long-random-string"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480

    # Web
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    frontend_dist: Path = PROJECT_DIR / "frontend" / "dist"
    sql_scripts_dir: Path = PROJECT_DIR / "database"

    # SQL console limits
    sql_console_max_rows: int = 500
    sql_console_timeout_ms: int = 5000

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
