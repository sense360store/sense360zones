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
them to the device. Apply writes the zone regions and the global mode to the
sensor, then reads them back to confirm the device accepted them, so the per zone
target count and presence entities react to your zones. Revert reads the device
back, so it returns the editor to what the hardware currently holds.

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

When a set does not fit, the editor blocks Apply and lists the reasons rather than
silently dropping anything. The reasons are one or more of: more than three zones,
a rotated or polygon zone, a mix of detection and exclusion, a region outside the
sensor range, or two zones that overlap. Adjust the zones until the reasons clear,
then Apply. Support for these richer zone sets comes in a later phase.

Revert reads the device back and discards your edits, and the unsaved indicator
reflects the real difference between the editor and the device.

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
