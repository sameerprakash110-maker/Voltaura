"""
Create the EcoTwin database schema.

    python scripts/init_db.py           # create missing tables
    python scripts/init_db.py --drop    # drop everything first
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for path in (str(ROOT), str(ROOT / "backend")):
    if path not in sys.path:
        sys.path.insert(0, path)

from app.config import settings  # noqa: E402
from app.database import engine, init_db  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Initialise the EcoTwin database")
    parser.add_argument("--drop", action="store_true", help="drop all tables first")
    args = parser.parse_args()

    print(f"Database: {settings.database_url}")
    init_db(drop=args.drop)

    from sqlalchemy import inspect

    tables = sorted(inspect(engine).get_table_names())
    print(f"{'Recreated' if args.drop else 'Ensured'} {len(tables)} tables:")
    for table in tables:
        print(f"  - {table}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
