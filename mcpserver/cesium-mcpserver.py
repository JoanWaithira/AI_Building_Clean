import argparse
import os
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from shared import load_local_env_file, log

mcp = FastMCP(
    "cesium",
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)

# ===============================================================================
# >>> NEW: KNOWN CIRCUITS + ALIASES (mirrors circuitConfigs in CesiumGeoJsonViewer)

VALID_CIRCUITS = {
    "main", "circuit6boiler", "circuit7", "elevator", "circuit8",
    "circuit9", "circuit10", "circuit11", "circuit12",
    "airconditioner1", "airconditioner2",
    "outsidelighting1", "outsidelighting2",
    "vehiclecharging1", "vehiclecharging2", "3DLED",
}

CIRCUIT_ALIASES = {
    "boiler": "circuit6boiler",
    "boiler circuit": "circuit6boiler",
    "circuit 6": "circuit6boiler",
    "6": "circuit6boiler",
    "lift": "elevator",
    "ac1": "airconditioner1",
    "ac2": "airconditioner2",
    "air conditioning 1": "airconditioner1",
    "air conditioning 2": "airconditioner2",
    "ac": "airconditioner1",
    "led": "3DLED",
    "3d led": "3DLED",
    "led display": "3DLED",
    "ev1": "vehiclecharging1",
    "ev2": "vehiclecharging2",
    "ev charging 1": "vehiclecharging1",
    "ev charging 2": "vehiclecharging2",
    "vehicle charging 1": "vehiclecharging1",
    "vehicle charging 2": "vehiclecharging2",
    "outside light 1": "outsidelighting1",
    "outside light 2": "outsidelighting2",
    "lighting 1": "outsidelighting1",
    "lighting 2": "outsidelighting2",
}

# Valid heatmap metrics
VALID_HEATMAP_METRICS = {"temperature", "co2", "humidity", "occupancy", "energy"}

# Valid visualization modes
VALID_VIZ_MODES = {"rooms", "circuits", "heatmap", "energy", "sensors", "alerts", "default"}

# Valid layers
VALID_LAYERS = {"rooms", "circuits", "sensors", "alerts", "energy_flow", "labels", "exterior"}

# Valid color schemes
VALID_COLOR_SCHEMES = {"temperature", "co2", "humidity", "occupancy", "energy", "default", "circuit"}
# <<< END NEW


# ===============================================================================
# NORMALIZERS

def _normalize_circuit_id(raw: str) -> str:
    # >>> UPGRADED: full alias resolution + partial alias search
    """Resolve a user-supplied circuit name to its canonical ID."""
    value = str(raw or "").strip()
    lowered = value.lower().replace(" ", "")
    lowered_spaced = value.lower().strip()

    # Already valid
    if value in VALID_CIRCUITS:
        return value

    # Check alias map (exact)
    if lowered_spaced in CIRCUIT_ALIASES:
        return CIRCUIT_ALIASES[lowered_spaced]
    if lowered in CIRCUIT_ALIASES:
        return CIRCUIT_ALIASES[lowered]

    # "circuit N" or just digits
    if lowered.isdigit():
        candidate = f"circuit{lowered}"
        if candidate in VALID_CIRCUITS:
            return candidate

    if lowered.startswith("circuit"):
        candidate = lowered  # e.g. "circuit10"
        if candidate in VALID_CIRCUITS:
            return candidate

    # Partial alias search
    for alias, canonical in CIRCUIT_ALIASES.items():
        if alias in lowered_spaced:
            return canonical

    return value  # return as-is; viewer will try to match
    # <<< END UPGRADED


# >>> NEW: metric normalizer helper
def _normalize_metric(raw: str) -> str:
    lowered = str(raw or "").lower().strip()
    if lowered in ("temp", "temperature", "temp_c"):
        return "temperature"
    if lowered in ("co2", "co₂", "co2_ppm"):
        return "co2"
    if lowered in ("humidity", "humidity_rh", "rh"):
        return "humidity"
    if lowered in ("occupancy", "people", "count"):
        return "occupancy"
    if lowered in ("energy", "power", "watt", "kwh"):
        return "energy"
    return lowered
# <<< END NEW


# ===============================================================================
# NAVIGATION TOOLS

@mcp.tool()
async def fly_to_coordinates(lat: float, lon: float, height: float = 500.0) -> dict:
    """Fly the 3D camera to specific GPS coordinates."""
    return {
        "type": "cesium",
        "action": "fly_to_coordinates",
        "lat": lat,
        "lon": lon,
        "height": height,
    }


@mcp.tool()
async def zoom_to_building() -> dict:
    """Reset the view to show the whole building exterior."""
    return {
        "type": "cesium",
        "action": "zoom_to_building",
    }


@mcp.tool()
async def zoom_to_room(room_query: str) -> dict:
    """
    Zoom the 3D viewer to a specific room by room number or name.

    Examples:
    - zoom_to_room("Conference Room")
    - zoom_to_room("Room 0.02")
    - zoom_to_room("2.12")
    - zoom_to_room("Elevator")
    """
    return {
        "type": "cesium",
        "action": "zoom_to_room",
        "room_query": room_query,
    }


@mcp.tool()
async def zoom_to_floor(floor: int) -> dict:
    """
    Show all rooms on a specific building floor.

    Floor numbering: 0 = ground floor, 1 = first floor, etc.
    """
    return {
        "type": "cesium",
        "action": "zoom_to_floor",
        "floor": floor,
    }


@mcp.tool()
async def zoom_to_circuit(circuit_id: str) -> dict:
    """
    Highlight and zoom to all rooms/devices on a specific electrical circuit.

    Known circuits:
    main, circuit6boiler, circuit7, circuit8, circuit9, circuit10,
    circuit11, circuit12, elevator, airconditioner1, airconditioner2,
    outsidelighting1, outsidelighting2, vehiclecharging1, vehiclecharging2, 3DLED

    Also accepts aliases like: 'boiler', 'lift', 'ac1', 'led', 'ev1', etc.
    """
    return {
        "type": "cesium",
        "action": "zoom_to_circuit",
        "circuit_id": _normalize_circuit_id(circuit_id),
    }


# >>> NEW
@mcp.tool()
async def zoom_to_name(name: str) -> dict:
    """
    Search for any entity (room, circuit, device) by name and zoom to it.

    Use this when the user says something like 'show me the server room'
    or 'find the meeting rooms' without specifying a room number.
    """
    return {
        "type": "cesium",
        "action": "zoom_to_name",
        "name": name,
    }
# <<< END NEW


# ===============================================================================
# VISIBILITY TOOLS

@mcp.tool()
async def show_building() -> dict:
    """Show the 3D building exterior mesh."""
    return {"type": "cesium", "action": "show_building"}


@mcp.tool()
async def hide_building() -> dict:
    """Hide the 3D building exterior mesh so interior rooms are visible."""
    return {"type": "cesium", "action": "hide_building"}


# >>> NEW
@mcp.tool()
async def show_all_rooms() -> dict:
    """Make all room polygon entities visible at once."""
    return {"type": "cesium", "action": "show_all_rooms"}


@mcp.tool()
async def hide_all_rooms() -> dict:
    """Hide all room polygon entities."""
    return {"type": "cesium", "action": "hide_all_rooms"}


@mcp.tool()
async def toggle_layer(layer: str, visible: bool) -> dict:
    """
    Toggle a named visualization layer on or off.

    Valid layers:
    - rooms        : floor-plan room polygons
    - circuits     : circuit highlight overlays
    - sensors      : sensor location markers
    - alerts       : anomaly / warning indicators
    - energy_flow  : animated energy-flow polylines
    - labels       : floating room/sensor labels
    - exterior     : 3D building exterior mesh
    """
    layer = layer.lower().strip()
    if layer not in VALID_LAYERS:
        return {
            "type": "cesium",
            "action": "error",
            "message": f"Unknown layer '{layer}'. Valid layers: {', '.join(sorted(VALID_LAYERS))}",
        }
    return {
        "type": "cesium",
        "action": "toggle_layer",
        "layer": layer,
        "visible": bool(visible),
    }
# <<< END NEW


# ===============================================================================
# >>> NEW: HEATMAP / COLOR-CODING TOOLS

@mcp.tool()
async def show_heatmap(metric: str) -> dict:
    """
    Color all rooms by a live sensor metric to create an environmental heatmap.

    metric options:
    - temperature  : blue (cold) → green (comfortable) → red (hot)
    - co2          : green (good) → yellow (moderate) → red (high)
    - humidity     : red (dry) → green (comfortable) → blue (humid)
    - occupancy    : white (empty) → orange → red (crowded)
    - energy       : green (low) → yellow → red (high)

    Example: show_heatmap("co2")
    """
    normalized = _normalize_metric(metric)
    if normalized not in VALID_HEATMAP_METRICS:
        return {
            "type": "cesium",
            "action": "error",
            "message": f"Unknown metric '{metric}'. Valid options: {', '.join(sorted(VALID_HEATMAP_METRICS))}",
        }
    return {
        "type": "cesium",
        "action": "show_heatmap",
        "metric": normalized,
    }


@mcp.tool()
async def clear_heatmap() -> dict:
    """Remove the heatmap overlay and restore default room colors."""
    return {"type": "cesium", "action": "clear_heatmap"}


@mcp.tool()
async def set_visualization_mode(mode: str) -> dict:
    """
    Switch the viewer into a named visualization mode.

    Modes:
    - default   : standard room colors, no overlays
    - heatmap   : last-used or temperature heatmap
    - circuits  : circuit network highlighted
    - energy    : energy-flow animations active
    - sensors   : sensor markers visible
    - alerts    : anomaly / alert indicators active
    - rooms     : room polygons only, building hidden
    """
    mode = mode.lower().strip()
    if mode not in VALID_VIZ_MODES:
        return {
            "type": "cesium",
            "action": "error",
            "message": f"Unknown mode '{mode}'. Valid modes: {', '.join(sorted(VALID_VIZ_MODES))}",
        }
    return {
        "type": "cesium",
        "action": "set_visualization_mode",
        "mode": mode,
    }
# <<< END NEW


# ===============================================================================
# >>> NEW: HIGHLIGHT / ALERT TOOLS

@mcp.tool()
async def highlight_rooms(
    room_queries: list[str],
    color: str = "cyan",
    label_override: str | None = None,
) -> dict:
    """
    Highlight specific rooms by room number or name.

    Useful when the agent has identified rooms of interest from telemetry
    (e.g. 'top CO2 rooms') and wants to mark them visually.

    color: any CSS color string, e.g. 'red', '#FF4444', 'orange'
    label_override: optional text to show above each highlighted room
    """
    return {
        "type": "cesium",
        "action": "highlight_rooms",
        "room_queries": room_queries,
        "color": color,
        "label_override": label_override,
    }


@mcp.tool()
async def highlight_rooms_by_threshold(
    metric: str,
    operator: str,
    threshold: float,
    color: str = "red",
) -> dict:
    """
    Highlight all rooms where a sensor metric exceeds / falls below a threshold.

    metric   : temperature | co2 | humidity | occupancy
    operator : gt (greater than) | lt (less than) | gte | lte
    threshold: numeric value (e.g. 1000 for CO2 ppm, 26 for temperature °C)
    color    : CSS color for the highlighted rooms

    Example:
    - highlight_rooms_by_threshold("co2", "gt", 1000, "red")
      → highlight all rooms with CO2 > 1000 ppm in red

    - highlight_rooms_by_threshold("temperature", "gt", 26, "orange")
      → highlight overheated rooms in orange
    """
    normalized_metric = _normalize_metric(metric)
    if normalized_metric not in VALID_HEATMAP_METRICS:
        return {
            "type": "cesium",
            "action": "error",
            "message": f"Unknown metric '{metric}'.",
        }
    valid_operators = {"gt", "lt", "gte", "lte", "eq"}
    op = operator.lower().strip()
    if op not in valid_operators:
        return {
            "type": "cesium",
            "action": "error",
            "message": f"Unknown operator '{operator}'. Use: gt, lt, gte, lte, eq",
        }
    return {
        "type": "cesium",
        "action": "highlight_rooms_by_threshold",
        "metric": normalized_metric,
        "operator": op,
        "threshold": threshold,
        "color": color,
    }


@mcp.tool()
async def show_alerts() -> dict:
    """
    Show alert / anomaly indicators on all rooms that are currently
    outside healthy parameter ranges (high CO2, extreme temperature, etc.).
    """
    return {"type": "cesium", "action": "show_alerts"}


@mcp.tool()
async def clear_highlights() -> dict:
    """Remove all custom highlights and restore default room colors."""
    return {"type": "cesium", "action": "clear_highlights"}
# <<< END NEW


# ===============================================================================
# ENTITY-LEVEL TOOLS

@mcp.tool()
async def zoom_to_entity(entity_id: str) -> dict:
    """Zoom to a specific Cesium entity by its raw entity ID."""
    return {
        "type": "cesium",
        "action": "zoom_to_entity",
        "entity_id": entity_id,
    }


@mcp.tool()
async def highlight_entities(
    entity_ids: list[str],
    color: str = "yellow",
) -> dict:
    """Highlight a list of specific Cesium entities by their IDs."""
    return {
        "type": "cesium",
        "action": "highlight_entities",
        "entity_ids": entity_ids,
        "color": color,
    }


# ===============================================================================
# >>> NEW: ENERGY FLOW TOOLS

@mcp.tool()
async def show_energy_flow(circuit_id: str | None = None) -> dict:
    """
    Show animated energy-flow polylines for the whole building or a
    specific circuit.

    If circuit_id is omitted, all circuits are shown.
    """
    payload: dict = {"type": "cesium", "action": "show_energy_flow"}
    if circuit_id:
        payload["circuit_id"] = _normalize_circuit_id(circuit_id)
    return payload


@mcp.tool()
async def hide_energy_flow() -> dict:
    """Hide energy-flow animations."""
    return {"type": "cesium", "action": "hide_energy_flow"}
# <<< END NEW


# ===============================================================================
# >>> NEW: COMPARISON TOOLS

@mcp.tool()
async def compare_floors(
    floor_a: int,
    floor_b: int,
    metric: str = "temperature",
) -> dict:
    """
    Side-by-side visual comparison of two floors colored by a metric.

    Splits the view: left = floor_a, right = floor_b.
    metric: temperature | co2 | humidity | occupancy | energy
    """
    normalized = _normalize_metric(metric)
    return {
        "type": "cesium",
        "action": "compare_floors",
        "floor_a": floor_a,
        "floor_b": floor_b,
        "metric": normalized,
    }


@mcp.tool()
async def compare_rooms(
    room_queries: list[str],
    metric: str = "co2",
) -> dict:
    """
    Highlight a set of rooms with colors scaled to their relative metric values,
    making it easy to compare them visually.

    metric: temperature | co2 | humidity | occupancy
    """
    normalized = _normalize_metric(metric)
    return {
        "type": "cesium",
        "action": "compare_rooms",
        "room_queries": room_queries,
        "metric": normalized,
    }
# <<< END NEW


# ===============================================================================
# >>> NEW: SENSOR MARKER TOOLS

@mcp.tool()
async def show_sensor_markers(sensor_type: str = "all") -> dict:
    """
    Show floating sensor-location markers inside rooms.

    sensor_type options:
    - all         : all sensor types
    - temperature : thermometer icons
    - co2         : CO₂ sensor icons
    - humidity    : humidity sensor icons
    - motion      : occupancy/motion sensor icons
    """
    return {
        "type": "cesium",
        "action": "show_sensor_markers",
        "sensor_type": sensor_type.lower().strip(),
    }


@mcp.tool()
async def hide_sensor_markers() -> dict:
    """Hide all sensor location markers."""
    return {"type": "cesium", "action": "hide_sensor_markers"}
# <<< END NEW


# ===============================================================================
# >>> NEW: TIME / PLAYBACK TOOLS

@mcp.tool()
async def set_time_window(
    start_iso: str,
    end_iso: str | None = None,
) -> dict:
    """
    Set the historical time window for the viewer's telemetry overlays.

    start_iso : ISO-8601 datetime string, e.g. '2025-03-10T08:00:00'
    end_iso   : optional end time; defaults to now if omitted

    Once set, heatmaps and highlights will reflect data from this window.
    """
    return {
        "type": "cesium",
        "action": "set_time_window",
        "start_iso": start_iso,
        "end_iso": end_iso,
    }


@mcp.tool()
async def reset_time_window() -> dict:
    """Reset to live / real-time data mode."""
    return {"type": "cesium", "action": "reset_time_window"}
# <<< END NEW


# ===============================================================================
# >>> NEW: CAMERA PRESETS

@mcp.tool()
async def set_camera_preset(preset: str) -> dict:
    """
    Jump to a named camera preset position.

    Presets:
    - overview      : bird's-eye view of whole site
    - north_facade  : front of building from north
    - south_facade  : rear of building from south
    - roof          : looking straight down at roof
    - interior_fl0  : ground floor interior
    - interior_fl1  : first floor interior
    - interior_fl2  : second floor interior
    - interior_fl3  : third floor interior
    - interior_fl4  : fourth floor interior
    """
    return {
        "type": "cesium",
        "action": "set_camera_preset",
        "preset": preset.lower().strip(),
    }
# <<< END NEW


# ===============================================================================
# >>> NEW: RESET

@mcp.tool()
async def reset_view() -> dict:
    """Reset the viewer to the default building overview, clearing all overlays."""
    return {"type": "cesium", "action": "reset_view"}
# <<< END NEW


# ===============================================================================
# ENTRYPOINT

if __name__ == "__main__":
    load_local_env_file()

    parser = argparse.ArgumentParser(description="Cesium MCP Server")
    parser.add_argument("--host", default=os.getenv("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8092")))
    args = parser.parse_args()

    mcp.settings.host = args.host
    mcp.settings.port = args.port
    log(f"Cesium MCP HTTP running {args.host}:{args.port} (path: /mcp)")
    mcp.run(transport="streamable-http")
