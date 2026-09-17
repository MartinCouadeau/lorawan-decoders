# Changelog

## 0.3.0

### Added

- Milesight: EM500-CO2, EM500-SWL, EM500-PT100, EM500-LGT, EM500-SMTC, AM307,
  EM310-UDL, EM320-TH, EM300-MCS, WS202, WS523 (alias WS525), AM104, AM107,
  AM319-HCHO (alias AM319), AM319-O3. `83/d7` temperature alarm with
  `temperature_change` on the EM500 series.
- Dragino: LDS02, LWL02, LDDS75, LSE01, LHT52, LSN50v2 (MOD=1; other modes
  warn and decode only the battery).
- Vocabulary: `temperature_change`, `soil_moisture`, `soil_temperature`,
  `conductivity` (µS/cm), `daylight`, `activity`, `illuminance_ir`,
  `illuminance_ir_visible`, `tvoc_ppb`, `hcho` (mg/m³), `o3` (ppm),
  `voltage`, `active_power` (W), `power_factor`, `energy` (kWh),
  `socket_status`, `open_count`, `open_duration` (min), `alarm`.
- Units: ppb, mg/m³, µS/cm, W, kWh, min.

### Changed

- Ellenex legacy frames: readings are engineering units on the wire (mbar,
  mm, 0.01 °C), confirmed on field captures. `pressure`, `level` and
  `temperature` are emitted directly; `level_raw`, `pressure_raw`,
  `differential_pressure_raw`, `temperature_raw` are gone. Bytes 0–1 are the
  device id / frame counter (`attributes.device_id`, `frame_counter`), byte 2
  the data type; configuration echoes go to attributes with a warning
  instead of throwing. Multi-packet frames decode every packet.
- `scaling.profile` on Ellenex is now opt-in; without it the wire unit is
  converted directly.
- Milesight `pir` labels are `idle`/`trigger` on every model (WS202 README
  says `normal`/`trigger`).
- AM307 (alias AM307L) added; AM308 is an alias of AM308L.
- Sentinel audit against every vendor user guide. `<key>_status` replaces
  `<key>` when a device reports a documented "no reading" pattern, matched
  on the wire pattern so int16 `0xffff` is a sentinel, not −0.1. Faults
  (`collection_failed`, `not_detected`) warn `sensor_fault`; intended states
  (`out_of_range`, `below_minimum`, `polarizing`, `tilted`, `not_connected`)
  do not. Milesight EM500-UDL, SWL, PT100, PP, LGT, SMTC, CO2 (live, alarm
  and history), GS301 temperature/humidity, EM400-TLD/MUD distance 65000
  (`tilted` when position says so), EM310-UDL distance 0. Dragino `0x7FFF`
  probes and LDDS75 blind zone are states; LDDS75 missing module is a fault.
- EM500-PP pressure is UINT16 per the user guide. EM500-UDL `83/e9` is
  millimetres per the guide: `distance`, `distance_change`, `distance_alarm`
  (`distance_alarm_value` and `distance_mutation` are gone). WS302 levels
  are INT16.
- Dragino LHT65N: byte 6 low nibble is the type, high nibble status flags
  (attributes); TMP117 and SHT31 probes (`humidity_external`); timestamp
  layout for types 9/10 and fPort 3 datalog → history. LHT52 fPort 3
  datalog → history. LSE01 MOD=1 raw mode → attributes. LDS02/LWL02 EDC
  5-byte packet → `event_count`.
- `test/vendors/captures.test.ts`: production ThingPark uplinks for
  Milesight, Dragino and Ellenex, the first hardware-verified vectors.

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
