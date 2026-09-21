"""
Runtime-configurable settings.

Defaults live in `config.Settings`. Anything in `config.TUNABLE_KEYS` can be
overridden at runtime through `PUT /api/settings`, which writes to the
`app_settings` table. Every tariff, emission factor and verification threshold
used in a calculation is resolved through here, so the numbers a judge sees can
be re-derived by changing a single value in the UI.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import TUNABLE_KEYS, settings as defaults
from ..models import AppSetting


def _coerce(key: str, raw: str) -> Any:
    caster = TUNABLE_KEYS.get(key, str)
    try:
        return caster(raw)
    except (TypeError, ValueError):
        return getattr(defaults, key, raw)


def get_effective(db: Session) -> dict[str, Any]:
    """Defaults merged with any stored overrides."""
    effective = {key: getattr(defaults, key) for key in TUNABLE_KEYS}
    for row in db.execute(select(AppSetting)).scalars():
        if row.key in TUNABLE_KEYS:
            effective[row.key] = _coerce(row.key, row.value)
    return effective


def get_value(db: Session, key: str) -> Any:
    """One resolved setting."""
    row = db.get(AppSetting, key)
    if row is not None and key in TUNABLE_KEYS:
        return _coerce(key, row.value)
    return getattr(defaults, key, None)


def update(db: Session, updates: dict[str, Any]) -> dict[str, Any]:
    """
    Apply overrides. Unknown keys are ignored rather than raising, so a
    partial payload from the settings form is always safe.
    """
    for key, value in updates.items():
        if key not in TUNABLE_KEYS or value is None:
            continue
        try:
            coerced = TUNABLE_KEYS[key](value)
        except (TypeError, ValueError):
            continue
        row = db.get(AppSetting, key)
        if row is None:
            db.add(AppSetting(key=key, value=str(coerced)))
        else:
            row.value = str(coerced)
    db.commit()
    return get_effective(db)


def reset(db: Session) -> dict[str, Any]:
    """Drop every override and fall back to the shipped defaults."""
    for row in db.execute(select(AppSetting)).scalars().all():
        db.delete(row)
    db.commit()
    return get_effective(db)


def economics(db: Session) -> dict[str, Any]:
    """The subset needed for money and carbon conversions, plus display info."""
    eff = get_effective(db)
    return {
        "electricity_tariff": eff["electricity_tariff"],
        "water_tariff_per_kl": eff["water_tariff_per_kl"],
        "grid_emission_factor": eff["grid_emission_factor"],
        "water_emission_factor": eff["water_emission_factor"],
        "currency": defaults.currency,
        "currency_symbol": defaults.currency_symbol,
    }
