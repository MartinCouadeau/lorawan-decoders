# Changelog

## 0.2.0

Breaking. The output shape changed; nothing from 0.1 was published to npm.

### Changed

- A decode call returns one flat object of readings:
  `{ battery: 92, temperature: 25.7, distance: 2116, position: 'tilt' }`.
  Units, buffered history, device attributes and warnings are returned only
  with `{ detailed: true }`.
- Every key comes from one cross-vendor vocabulary with a fixed unit
  (`docs/naming.md`). Renames from 0.1: `current` with an index is now
  `current_1`..`current_4`; `angle` x/y/z is `angle_x`/`_y`/`_z`;
  `sound_level` current/equivalent/max is `sound_level`/`_eq`/`_max`;
  AM308L tVOC is `tvoc` (µg/m³) or `tvoc_index`; AM308L `pressure` is
  `barometric_pressure` (hPa); EM500-UDL alarm distance is
  `distance_alarm_value`; VS132 counters are `total_counter_in/out` and
  `periodic_counter_in/out`; Netvox R718N360 channels are `channel_1..3`;
  Ellenex unscaled counts are `level_raw`, `pressure_raw`,
  `differential_pressure_raw`, `temperature_raw`; Dragino external
  temperature is `temperature_external`, its ADC is `input_voltage` (V) and
  its counters are `pulse_count`.
- Ellenex V6 pressure converts bar to kPa, PDT2-L differential pressure
  pascals to kPa, and `D` metres to millimetres.
- Enum wire codes are no longer exposed; the label is the value.
- Unknown Ellenex V6 keys warn and are not emitted.

### Added

- Typed vendor namespaces: `milesight.em310_tilt(payload)`, with aliases as
  properties and per-model return types.
- Per-vendor subpath exports: `lorawan-decoders/milesight`, `/netvox`,
  `/ellenex`, `/dragino`.
- `decode(vendor, model, payload, options)` positional signature.
- `isModel(vendor, name)` and `models(vendor?)`.
- Base64 payloads via `{ encoding: 'base64' }`; CLI `--base64` / `-b`.
- Did-you-mean suggestion on `unknown_model` errors.
- `duplicate_key` warning when a live key repeats in one frame.
- `docs/naming.md`, generated from the vocabulary and checked in CI.
- `prepublishOnly` runs typecheck, lint, tests and build.

### Removed

- ThingsBoard, ChirpStack and TTN adapters. The flat object is what those
  platforms take; see `docs/examples.md` for the forwarding patterns.
- `createRegistry`, `Measurement`, `QuantityKind`, `DecodedUplink`,
  `DecodeRequest`.

## 0.1.0

Initial release. Milesight (16 models), Netvox (5 decoders, 85 names),
Ellenex (12 models), Dragino LHT65. Normalized `measurements[]` output with
per-reading unit and provenance. Written clean-room from public
documentation.
