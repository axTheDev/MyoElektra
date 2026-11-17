#!/usr/bin/env bash
# MyoArm3D dev server - local only (127.0.0.1). Then open http://127.0.0.1:8890
set -euo pipefail
cd "$(dirname "$0")"
exec .venv/bin/python -m uvicorn app:app --app-dir server --host 127.0.0.1 --port 8890 --reload
