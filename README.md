# Sense360 Zones Add-on

This repository contains a Home Assistant add-on (with Ingress) and standalone Docker image for editing Sense360 zones. It includes CI/CD workflows for linting and multi-architecture publishing to GHCR.

## Features
- **Ingress-ready add-on** with native Home Assistant authentication (via `SUPERVISOR_TOKEN`).
- **Standalone Docker mode** using `HA_URL` and `HA_TOKEN` environment variables.
- **Non-destructive zone saves** that merge changed zones with the current Home Assistant state.
- **GitHub Actions** for add-on linting, test builds, and multi-arch releases.

## Structure
- `repository.yaml` — Add-on repository metadata.
- `sense360_zones_addon/` — Add-on definition, Dockerfile, runtime, backend, and static frontend placeholder.
- `.github/workflows/` — CI (lint + test build) and release workflows.
- Branding assets (`logo.png`, `icon.png`) are not committed; add your own files into `sense360_zones_addon/` before packaging.

## Local development
1. Build the frontend (placeholder already compiled):
   ```bash
   cd sense360_zones_addon/frontend
   # add your frontend build pipeline; dist/ contains a placeholder index.html
   ```
2. Run locally (standalone):
   ```bash
   export HA_URL="http://homeassistant.local:8123"
   export HA_TOKEN="YOUR_LONG_LIVED_TOKEN"
   python -m uvicorn app.main:app --host 0.0.0.0 --port 8099
   ```

## Publishing
Push a tag like `v0.1.0` to trigger the release workflow, which builds and publishes `ghcr.io/sense360store/sense360zones-{arch}:0.1.0` images for all supported architectures.
