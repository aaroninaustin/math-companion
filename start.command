#!/bin/bash
# One-click launcher for the Math Companion.
# Creates a virtualenv (first run only), installs deps, then starts uvicorn on :8080.

set -e
cd "$(dirname "$0")"

echo "=== Math Companion ==="
echo "Working dir: $(pwd)"
echo

# 1. Create venv on first run
if [ ! -d ".venv" ]; then
  echo "Creating virtualenv at .venv ..."
  python3 -m venv .venv
fi

# 2. Activate venv
# shellcheck disable=SC1091
source .venv/bin/activate
echo "Python: $(which python)"

# 3. Install deps (idempotent — pip will skip if already satisfied)
echo
echo "Installing dependencies ..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

# 4. Open the browser once the server is up (background subshell)
(
  # Wait for the port to accept connections, then open Chrome
  for i in {1..30}; do
    if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/ | grep -qE "^(2|3)"; then
      open "http://localhost:8080"
      exit 0
    fi
    sleep 0.5
  done
) &

# 5. Run the server (foreground — Ctrl+C to stop)
echo
echo "Starting server on http://localhost:8080 ..."
echo "Press Ctrl+C in this window to stop."
echo
exec uvicorn app:app --reload --port 8080
