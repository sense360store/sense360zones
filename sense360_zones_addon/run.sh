#!/usr/bin/with-contenv bash
set -euo pipefail

# Determine Home Assistant API endpoint and auth
if [[ -n "${SUPERVISOR_TOKEN:-}" ]]; then
  export SENSE360_HA_BASE_URL="http://supervisor/core/api"
  export SENSE360_HA_AUTH_HEADER="Authorization: Bearer ${SUPERVISOR_TOKEN}"
else
  : "${HA_URL:?Set HA_URL for standalone mode (e.g. http://homeassistant.local:8123)}"
  : "${HA_TOKEN:?Set HA_TOKEN for standalone mode (Long-Lived Access Token)}"
  export SENSE360_HA_BASE_URL="${HA_URL%/}/api"
  export SENSE360_HA_AUTH_HEADER="Authorization: Bearer ${HA_TOKEN}"
fi

exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8099
