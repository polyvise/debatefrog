#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ENV="$ROOT_DIR/local.secrets.env"

if [[ -f "$APP_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$APP_ENV"
  set +a
fi

cd "$ROOT_DIR"
exec npm run dev
