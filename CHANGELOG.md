# Changelog

## 0.82.1 — 2026-10-30

- Schedule matching: an event stored with its end before its start on the same day (an overnight block such as
  Sun 22:00 -> 06:00, as a copied or hand-edited block can be saved) ends the next morning; it matched almost
  the whole week before.
- UI tests follow the smart-valve 0.82.1 defaults (TRV timeout 150 min, Valve alarm 0 = warning only).
- Tests: `npm test` (24 tests).

## 0.82.0 — 2026-10-30

- Schedule matching rewritten: events crossing midnight or spanning several days now match after midnight
  (they fell back to the default setpoint).
- "Off" sends the default setpoint (it sent nothing, valves kept heating).
- Manual mode sends a real setpoint without MQTT (it sent an empty message).
- Overrides: "Override" checkbox enforced, capped at Max setpoint, loop guard against a stuck device
  repeating the value that just expired.
- New options: Re-send every (default 15 min), Max setpoint (default 24 °C).
- Timer and input errors can no longer crash Node-RED; bad schedule JSON is reported instead of throwing.
- Saved state no longer overrides a changed editor configuration; rule changes are detected; MQTT root path
  from the settings node is used.
- Editor: works offline (FullCalendar 6.1.9 and iro 5.5.2 bundled; the old FullCalendar v3 files removed);
  clear message and safe save if the calendar cannot load; Copy day fixed for Sunday and events crossing
  midnight; no more global variables; set point values validated.
- Tests: `npm test` (23 tests) and browser tests in `test/ui` (19 tests).
