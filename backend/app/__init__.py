"""VOLTAURA backend application package."""
from __future__ import annotations

import sys
from pathlib import Path

# Make the repo-root `ml` package importable regardless of where uvicorn is
# launched from.
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

__version__ = "1.0.0"
