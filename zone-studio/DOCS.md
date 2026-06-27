# Sense360 Zone Studio

Configure radar detection and exclusion zones over a live canvas for HLK LD2450
and DFRobot SEN0609 sensors, from the Home Assistant sidebar.

## What this add-on does

Zone Studio opens through Home Assistant ingress, so it is reachable from the
sidebar with no extra port or login. It serves a single page application backed
by a small server.

The server connects to Home Assistant and shows your real sensors. It discovers
ESPHome devices and entities, lists the rooms and devices it finds in the top bar
picker, and tracks live LD2450 targets on the canvas as people move. Pick a room
and a device to view, and the canvas follows that device.

For an LD2450 you can draw detection and exclusion zones on the canvas and apply
them. A simple set (up to three axis-aligned rectangles under one mode) goes
straight to the sensor's zone hardware. A richer set (polygons, rotated
rectangles, more zones, or mixed modes) is evaluated live by the add-on and
published to Home Assistant over MQTT, and can also be exported as an ESPHome
config to run on the device. Both paths are described below.

The DFRobot SEN0609 is discovered and its range band stays editable and saved with
the add-on, but no SEN0609 settings are written to the device yet, and its live
presence and distance are not streamed yet. Both come in a later phase.

## Connection states

The top bar shows the connection at a glance, and the canvas shows a clear
message when there is nothing to draw:

- Connecting: discovery is in progress.
- Live: Home Assistant answered and at least one sensor was found.
- No sensors: Home Assistant answered but no LD2450 or SEN0609 device was
  detected. Check that the sensors are set up in ESPHome, then retry.
- Offline: the add-on could not reach the Home Assistant WebSocket API. It keeps
  retrying in the background; use Retry to check again.

The add-on never shows simulated data in place of a real connection.

## Applying zones to an LD2450

The LD2450 hosts its zones in hardware, and that hardware is fixed and small: at
most three rectangular zones, all axis aligned to the sensor, under one global
mode (all detection, or all exclusion). When your zone set fits that shape the
editor shows the native profile and Apply is enabled. Apply writes the zone
regions and the mode to the device, then reads them back to confirm.

When a set does not fit that shape, the editor switches to the polygon profile and
explains why, rather than blocking. The reasons are one or more of: more than three
zones, a rotated or polygon zone, a mix of detection and exclusion, a region
outside the sensor range, or two zones that overlap. You can still apply the set;
the polygon profile handles it a different way, described next.

Revert reads the source of truth back and discards your edits, and the unsaved
indicator reflects the real difference. For a native set the source of truth is the
hardware; for a polygon set it is the add-on's active config (see below).

## Polygon zones and live occupancy

The polygon profile covers everything the native profile cannot: arbitrary
polygons, rotated rectangles, more than three zones, and a per-zone mix of
detection and exclusion. It does not push these to the LD2450's small zone
hardware. Instead, when you apply a polygon set the add-on does two things.

First, it puts the LD2450 into report-all mode: it clears the native regions and
disables the zone_type select, so the sensor reports every target it tracks rather
than filtering in hardware.

Second, it evaluates your zones against the live target stream in software and
publishes occupancy to Home Assistant over MQTT. Each zone becomes an occupancy
binary sensor, and the device gets a presence binary sensor. A target is counted
for presence when it is inside any detection zone, or anywhere in range when there
are no detection zones, and never when it is inside an exclusion zone, so exclusion
zones subtract from presence. Transitions are debounced with a small on and off
delay so a brief flicker at a zone edge does not toggle an entity.

This is instant and needs no flashing. The canvas lights a zone the moment a target
enters it, using the same evaluation that drives the published entities.

The entities are published with retained discovery and an availability topic, and
the add-on registers a last will, so if the add-on stops the entities show
unavailable rather than disappearing. Deleting a zone removes its entity.

### The MQTT integration is required

Publishing the polygon zone entities needs the Home Assistant MQTT integration. If
it is not available the canvas preview still works and the editor states that MQTT
is required to publish the entities; the device is not failed. Install and
configure the MQTT integration (and a broker, such as the Mosquitto broker add-on),
then apply again.

### Zones not retained without the add-on

Because a polygon set is evaluated by the add-on, the occupancy entities only
update while the add-on is running. For a version that runs on the device itself,
generate an ESPHome config, described next.

## Generate ESPHome config

Generate ESPHome config turns the drawn zones into an ESPHome package for the
TillFleisch ESPHome-HLK-LD2450 component, the durable on-device alternative to the
live path. It produces an occupancy binary sensor per zone, mapping each zone's
vertices into the sensor frame, and splits any non-convex zone into convex parts
because the component requires convex zone polygons.

To use it: open Generate ESPHome config, copy or download the YAML, add it to your
LD2450 device's ESPHome configuration (set `uart_id` to match your board), and
flash the device. On the device the component does the filtering itself, so the
report-all mode the live path needs does not apply. Flashing is a manual step.

The detection-minus-exclusion presence rule is a live-path feature; on the device
each zone reports its own occupancy, and you can compose the presence rule with a
Home Assistant template if you need it.

### Zones not retained across a power cycle

Some LD2450 firmware does not keep its zones after the sensor loses power. This is
a firmware quirk, not a fault in the add-on. If it affects your sensor, re-apply
the zones from the editor after the device comes back, or save the applied zones
through your ESPHome configuration so they are restored on boot.

## Correcting a misdetected device

Detection is heuristic. It identifies an LD2450 by its per target x and y
coordinate entities, its per zone region numbers, and a zone_type select, and a
SEN0609 by its presence sensor. If a device is read wrongly, you can override it
with a record under the add-on data directory (`/data/zone-studio.json`) that
forces the device kind and the entity roles, including the zone region numbers and
the zone_type select used by the apply path. Auto-detection only seeds the mapping
where there is no override, so your correction persists across restarts.

## Installation

1. In Home Assistant, open Settings then Add-ons, and open the Add-on Store.
2. From the store's overflow menu choose Repositories, and add
   `https://github.com/sense360store/sense360zones`.
3. Find Sense360 Zone Studio in the store and select Install.
4. Start the add-on, then open it from the sidebar.

## Configuration

The add-on has one option.

### Option: `log_level`

Controls how much the add-on writes to its log. One of `trace`, `debug`, `info`,
`notice`, `warning`, `error`, or `fatal`. The default is `info`. Use `debug` when
reporting a problem.

```yaml
log_level: info
```

## Networking and security

The server listens on port 8099 inside the container and is reached only through
Home Assistant ingress. In normal operation it rejects any request that does not
come from the Supervisor ingress address, so it is not exposed on your network.
There is no separate login: Home Assistant authenticates you before ingress.

## Support

Issues and questions: https://github.com/sense360store/sense360zones/issues
