"""Configuration for the wretch pipeline.

Paths derive from this file's location so the pipeline is portable across
checkouts (mirrors content/scripts/lib/paths.ts). Every path is
overridable via an env var for host cutover — see ../.env.example.

Defaults resolve to `pkg/wretch/{data,tmp}`. INCOMING_PATH defaults to the
host's Craig sync folder (`~/drive/Craig`); override it on other hosts.
"""

import os
from pathlib import Path

# pkg/wretch/python/consts.py -> pkg/wretch
_PKG_ROOT = Path(__file__).resolve().parent.parent


def _env_path(name: str, default: str) -> str:
    return os.environ.get(name, default)


DATA_PATH = _env_path("LISTENER_DATA_PATH", str(_PKG_ROOT / "data"))
TMP_PATH = _env_path("LISTENER_TMP_PATH", str(_PKG_ROOT / "tmp"))
INCOMING_PATH = _env_path(
    "LISTENER_INCOMING_PATH", os.path.expanduser("~/drive/Craig")
)
STATE_FILE = _env_path("LISTENER_STATE_FILE", f"{DATA_PATH}/data.pkl")

MODEL = os.environ.get("LISTENER_MODEL", "large-v3")  # or "distil-large-v3"
DEVICE = os.environ.get("LISTENER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("LISTENER_COMPUTE_TYPE", "int8")

# Discord user-id -> display name. Mirrors content/scripts/lib/roster.ts
# (userToName), the downstream SSOT. Used here to filter which tracks belong to
# real players. Phase 2 will collapse this to a single shared source.
PLAYERS = {
    "Josh": "iiri___",
    "Jorge": "boiledpacakes",
    "Mike": "miked6187",
    "Tanner": "tanner_kn",
    "Noah": "nnaiman",
}
