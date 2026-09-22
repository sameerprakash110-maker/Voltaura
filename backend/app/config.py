"""
Central configuration for VOLTAURA.

Every tariff / emission-factor / threshold used anywhere in the savings maths
lives here (or in the `app_settings` table, which overrides these defaults at
runtime).  Nothing that feeds a user-facing number is hard-coded elsewhere.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT_DIR / ".env", BACKEND_DIR / ".env"),
        env_prefix="VOLTAURA_",
        extra="ignore",
    )

    # ---- application -------------------------------------------------
    app_name: str = "VOLTAURA API"
    environment: str = "development"

    # ---- database ----------------------------------------------------
    # SQLite for local dev.  Swap for a postgresql+psycopg:// URL and the
    # rest of the stack works unchanged (see backend/app/database.py).
    database_url: str = f"sqlite:///{(DATA_DIR / 'voltaura.db').as_posix()}"

    # ---- CORS --------------------------------------------------------
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # ---- economics (defaults; overridable via /api/settings) ----------
    electricity_tariff: float = 8.50          # currency / kWh
    water_tariff_per_kl: float = 45.00        # currency / kilolitre
    grid_emission_factor: float = 0.71        # kg CO2e / kWh
    water_emission_factor: float = 0.344      # kg CO2e / kilolitre (pumping+treatment)
    currency: str = "INR"
    currency_symbol: str = "₹"

    # ---- M&V / verification -----------------------------------------
    verification_threshold_pct: float = 5.0   # min % reduction to call VERIFIED
    verification_significance: float = 0.05   # max p-value for VERIFIED
    baseline_window_days: int = 14
    post_window_days: int = 14
    min_post_days_for_verification: int = 7

    # ---- anomaly detection -------------------------------------------
    iforest_contamination: float = 0.045
    residual_z_threshold: float = 2.5
    min_deviation_pct: float = 12.0
    event_merge_gap_hours: int = 3
    min_event_duration_hours: int = 3
    event_cluster_gap_hours: int = 168

    # ---- synthetic data ----------------------------------------------
    history_days: int = 90
    random_seed: int = 20240917

    # ---- optional LLM --------------------------------------------------
    # Entirely optional.  The product works end-to-end with no key at all.
    llm_api_key: str = ""
    llm_model: str = "claude-sonnet-5"
    llm_enabled: bool = True   # only has effect when a key is present

    # ---- investigation reasoning provider ----------------------------
    # These intentionally use unprefixed aliases so local development can
    # configure the Gemini provider with GEMINI_API_KEY / GEMINI_MODEL.
    gemini_api_key: str = Field(default="", validation_alias="GEMINI_API_KEY")
    gemini_model: str = Field(
        default="gemini-2.5-flash",
        validation_alias="GEMINI_MODEL",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_available(self) -> bool:
        return bool(self.llm_api_key) and self.llm_enabled

    @property
    def gemini_available(self) -> bool:
        return bool(self.gemini_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

# Keys that may be overridden at runtime through the settings table/endpoint.
TUNABLE_KEYS: dict[str, type] = {
    "electricity_tariff": float,
    "water_tariff_per_kl": float,
    "grid_emission_factor": float,
    "water_emission_factor": float,
    "verification_threshold_pct": float,
    "verification_significance": float,
    "baseline_window_days": int,
    "post_window_days": int,
    "min_post_days_for_verification": int,
    "iforest_contamination": float,
    "residual_z_threshold": float,
    "min_deviation_pct": float,
}
