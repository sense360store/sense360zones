import os
from typing import Any, Dict

import httpx
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

APP_ROOT = os.path.dirname(__file__)
STATIC_ROOT = os.path.join(os.path.dirname(APP_ROOT), "static")

HA_BASE_URL = os.environ.get("SENSE360_HA_BASE_URL")
HA_AUTH_HEADER = os.environ.get("SENSE360_HA_AUTH_HEADER")

if not HA_BASE_URL or not HA_AUTH_HEADER:
    raise RuntimeError("Home Assistant credentials are not configured. Ensure run.sh sets them.")

app = FastAPI(title="Sense360 Zones")


async def ha_request(method: str, path: str, **kwargs: Any) -> httpx.Response:
    headers = kwargs.pop("headers", {})
    headers["Authorization"] = HA_AUTH_HEADER
    headers.setdefault("Content-Type", "application/json")
    async with httpx.AsyncClient(base_url=HA_BASE_URL, timeout=15) as client:
        response = await client.request(method, path, headers=headers, **kwargs)
        return response


def zone_entity_id(device_id: str) -> str:
    return f"sensor.{device_id}_zones"


async def get_existing_zones(device_id: str) -> Dict[str, Any]:
    entity = zone_entity_id(device_id)
    resp = await ha_request("GET", f"/states/{entity}")
    if resp.status_code == 404:
        # No existing zone entity yet
        return {}
    if resp.is_error:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    data = resp.json()
    return data.get("attributes", {}).get("zones", {})


async def write_zones(device_id: str, merged: Dict[str, Any]) -> Dict[str, Any]:
    entity = zone_entity_id(device_id)
    payload = {"state": "configured", "attributes": {"zones": merged}}
    resp = await ha_request("POST", f"/states/{entity}", json=payload)
    if resp.is_error:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json().get("attributes", {}).get("zones", {})


@app.get("/api/devices")
async def list_devices() -> Dict[str, Any]:
    """Return mmWave-related devices discovered via HA states."""
    resp = await ha_request("GET", "/states")
    if resp.is_error:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    states = resp.json()
    devices = []
    for item in states:
        entity_id = item.get("entity_id", "")
        if "sense360" in entity_id:
            devices.append({"entity_id": entity_id, "name": item.get("attributes", {}).get("friendly_name", entity_id)})
    return {"devices": devices}


@app.get("/api/zones")
async def fetch_zones(device_id: str = Query(..., description="Sense360 device identifier")) -> Dict[str, Any]:
    existing = await get_existing_zones(device_id)
    return {"zones": existing}


@app.post("/api/zones")
async def save_zones(
    device_id: str = Query(..., description="Sense360 device identifier"),
    body: Dict[str, Any] = Body(..., example={"changed_zones": {"1": {"name": "Kitchen", "polygon": []}}}),
) -> Dict[str, Any]:
    changed = body.get("changed_zones") or {}
    if not isinstance(changed, dict):
        raise HTTPException(status_code=400, detail="changed_zones must be an object")

    existing = await get_existing_zones(device_id)
    merged = {**existing, **changed}
    saved = await write_zones(device_id, merged)
    return {"zones": saved, "message": "Zones saved non-destructively"}


# Serve built SPA if present
if os.path.isdir(STATIC_ROOT):
    app.mount("/", StaticFiles(directory=STATIC_ROOT, html=True), name="static")


@app.get("/")
async def root() -> FileResponse:
    index = os.path.join(STATIC_ROOT, "index.html")
    if not os.path.exists(index):
        raise HTTPException(status_code=404, detail="Static frontend is not built")
    return FileResponse(index)
