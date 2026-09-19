# Vendor quirks

Undocumented or inconsistent behaviour per vendor, and what this library does.

## Milesight

**Unknown channels end the frame.** No length field; data width comes from
the (channel, type) pair. An unknown pair stops parsing with an
`unknown_channel` warning naming the pair and the bytes dropped.

**Same channel, different meaning per model.**

| Channel | EM400-TLD | EM300-SLD | WS301 | WS303 | AM308L |
|---|---|---|---|---|---|
| `03/00` | — | — | magnet | leak | — |
| `05/00` | tilt | leak | — | — | PIR |
| `03/67` | temperature | temperature | — | — | temperature |

GS301 channel ids are one lower than AM308L (`02/67` temperature, `03/68`
humidity).

**Same quantity, two units.** AM308L tVOC: `08/7d` index → `tvoc_index`;
`08/e6` µg/m³ → `tvoc`. GS301 H2S: `05/7d` 0.01 ppm and `06/7d` 0.001 ppm,
both → `h2s`.

**Sentinel values.** A wire pattern the vendor documents as "no reading"
never becomes a number. The decoder emits `<key>_status` instead of `<key>`.
Two kinds. **Fault** (`collection_failed`, `not_detected`): the device could
not measure; also a `sensor_fault` warning, so `strict` throws. **State**
(`out_of_range`, `below_minimum`, `polarizing`, `tilted`, `not_connected`):
the device measured and reports a condition on purpose; status only, no
warning. Matched on the unsigned pattern, so `0xffff` on an int16 field is a
sentinel, not −0.1. Live channels, alarm channels and history records alike.

| Models | Field | Pattern | Status | Kind |
|---|---|---|---|---|
| EM500-UDL, SWL, PT100, PP, SMTC | 2-byte sensor fields | `ffff` | `collection_failed` | fault |
| same | same | `fffd` | `out_of_range` | state |
| EM500-LGT | 4-byte illuminance | `ffffffff` / `fffffffd` | same as above | fault / state |
| EM500-SMTC, EM500-CO2 | 1-byte humidity/moisture | `ff` | `collection_failed` | fault |
| EM500-CO2 | 2-byte fields | `ffff` | `collection_failed` (guide documents no out-of-range code) | fault |
| GS301 | gas, temperature | `ffff` | `collection_failed` | fault |
| GS301 | gas | `fffe` | `polarizing` (sensor warm-up) | state |
| GS301 | humidity | `ff` | `collection_failed` | fault |
| EM400-TLD, EM400-MUD | distance | `65000` | `tilted` when the same frame has `position: tilt` (tilt switch turned the sensor off), else `out_of_range`. Field report, not in vendor docs. | state |
| EM310-UDL | distance | `0` | `out_of_range` (≥ 4.5 m). ≤ 30 mm is clamped to 30 and reported as a value. | state |
| CT101, CT103, CT105 | current | `ffff` | `collection_failed` | fault |
| same | temperature (NTC) | `ffff` / `fffd` | `collection_failed` / `out_of_range` | fault / state |

Sources: EM500 user guides ("fails to collect → all ffff; outside the
measuring range → fffd"), GS301 user guide ("ffff or ff = collection error,
fffe = polarizing"), EM310-UDL user guide. Cost of the PT100/SMTC/CO2 rule: a
real −0.1 °C (`ffff`) or −0.3 °C (`fffd`) reading is reported as a status.
Vendor code checks the same patterns on SMTC and SWL.

**EM500-PP pressure** is UINT16 kPa per the user guide, not signed.

**EM500-UDL alarm channel.** `83/e9`: distance mm, change since last report
mm, alarm byte, per the user guide. The vendor decoder divides both by 10.
Guide wins; emitted as `distance`, `distance_change`, `distance_alarm` with a
`vendor_quirk` warning until a capture settles it.

**Hardcoded bytes in the vendor decoder.** `ff/fe` (reset) and `ff/0b`
(status) are decoded as the literal 1 in vendor code. This library reads the
byte, so `reset_event` can be `normal`.

**Serial number length.** READMEs say `ff/16` is 2 bytes; vendor code reads 8.
This library reads 8.

**WS302 key names.** Vendor decoder renames outputs by weighting (`LAF`,
`LZS`…). This library uses `sound_level`, `sound_level_eq`, `sound_level_max`
and puts the weighting in attributes. Levels are INT16/10 per the user guide.

**WS101 `msgid`** is random in the vendor decoder, not wire data. Not
emitted.

**AM308L humidity** is 1 byte live, 2 bytes in history records. Same ÷2.

**EM500-SWL depth** is centimetres on the wire; emitted as `level` in metres.

**EM500-SMTC moisture** is 1 byte ÷2 on `04/68`, 2 bytes ÷100 on `04/ca` and
in history. Same key `soil_moisture`.

**AM107 tVOC** is ppb; AM308L/AM319 tVOC is µg/m³ or an index. Three keys:
`tvoc_ppb`, `tvoc`, `tvoc_index`.

**AM104/AM107 illumination** channel `06/65` carries three uint16 values:
`illuminance`, `illuminance_ir_visible`, `illuminance_ir`.

**CT10x (CT101/CT103/CT105)** share one format. Current is 0.01 A on the
wire → `current`, `current_max`, `current_min` in mA. `03/97` is
accumulated current in Ah → `total_current`; it wraps at `ffffffff`. `10/99`
total energy (kWh → `energy`) is in the user guide only, not the README.
`84/98` alarm byte is a bitfield (1 threshold, 2 release, 4 over range, 8
over range release; the guide shows 0x05 and 0x0a) → `current_alarm` and
`current_over_range_alarm`, each present only when its bits are set. The
README example `0498B80B00000000` has four trailing zero bytes against a
2-byte table entry; guide and capture confirm 2 bytes. Low-voltage alarm is
not decoded: the guide's table says `13/73`, its example `13/75`, the README
has neither → `unknown_channel`.

**VS351** counters are uint16 and wrap at 65535 (VS132 totals are uint32).
History `20/ce` is 9 bytes, or 13 when its `data_type` byte is 1 (periodic +
totals); the only variable-length channel in the library, resolved by
peeking that byte. `83/67` adds `high_temperature_alarm` /
`high_temperature_alarm_release` to the threshold pair.

**AM319** ships as HCHO or O3 variants with different history layouts, so they
are two models: `AM319-HCHO` (alias `AM319`) and `AM319-O3`.

**WS523/WS525 energy** is watt-hours on the wire; emitted as `energy` in kWh.

**PIR labels.** WS202 README says `normal`/`trigger`; this library uses
`idle`/`trigger` on every model.

## Netvox

**Battery byte.** Bits 0–6 tenths of a volt, bit 7 low-battery flag.

**Multiplier encoding.** ReportType 0x01/0x02: literal byte (`0x0A` = ×10).
ReportType 0x03: three 2-bit fields, `00`→1, `01`→5, `10`→10, `11`→100.

**Three-phase ReportType 0x01 carries only multiplier 1.** Multipliers 2 and
3 come in ReportType 0x02. `current_2` and `current_3` are emitted raw with
`unscaled_value` warnings unless passed:

```ts
netvox.r718n3(payload, { scaling: { multiplier2: 5, multiplier3: 100 } });
```

**RA02A** (smoke detector, DeviceType 0x0A). ReportType 0x01: battery, fire
alarm byte, high-temperature alarm byte (fixed 60 °C), temperature int16
0.1 °C → `fire_alarm`, `temperature_alarm`, `temperature`. fPort 7
configuration responses are decoded for this model only: `0x81` →
`attributes.config_status`; `0x82` → `attributes.min_time`, `max_time` (s),
`battery_change` (V). No telemetry.

**R718N360 ReportType 0x02 has no battery byte.** Channel values are raw
counts → `channel_1..3` with unit `raw`.

**Model suffixes.** Digits = CT rating (no decoding effect). `E` = detachable
cables (none). `L` = light sensor, different DeviceType and a lux field.
`D` = revision documenting ReportTypes 0x03/0x04; partially verified.

**Unverified.** `R718NL36` appears in the wild but not in Netvox sources
(manual lists `R718NL363`). Base three-phase CT rating differs between manual
revisions (50 A vs 60 A). The manuals document no sentinel or error value
in the current fields.

## Ellenex

**Two payload generations.** Legacy (V4): one or more fixed 8-byte packets.
V6: CBOR map. Detected by shape (`0xBF` or `0xA0`–`0xB7` first byte = V6).
Override with `scaling: { generation: 'legacy' | 'v6' }`.

**Legacy bytes 0–2.** Bytes 0–1 are the last two bytes of the DevEUI in the
first packet and a frame counter in later packets → `attributes.device_id`,
`attributes.frame_counter`. Byte 2 is the data type: `0x00` sensor reading;
other values are configuration echoes (`0x01` interval, `0x16` auto-reset
observed) → kept in `attributes.data_type` / `attributes.data` with an
`undocumented_field` warning, no telemetry. Confirmed on hardware.

**Legacy readings are engineering units on the wire.** mbar for pressure and
differential pressure, mm for level, 0.01 °C for temperature. Emitted as
`pressure` / `differential_pressure` (kPa), `level` (m), `temperature` (°C).
Confirmed: a PLS2-L sending `0x064F` = 1615 mm alongside V6 frames from the
same model reading 1.6155 m. Ellenex's own "-1192 bar" sample is the mbar
vector read with the wrong unit. `scaling: { profile, range, density }`
remains as an opt-in ADC conversion for 4–20 mA count sensors.

**Multi-packet legacy frames** (length a multiple of 8) decode every packet;
repeated keys keep the last value with `duplicate_key` warnings and
`attributes.packets` gives the count.

**V6 conversions.** bar → kPa, Pa → kPa (PDT2-L), `D` metres → mm. `v` =
battery mV, `V` = input voltage mV.

**Unverified.** Legacy secondary temperature scaling (0.01 °C per the
platform decoders; no vendor document). No status, alarm or sentinel value
is documented for either generation.

## Dragino

**Battery word.** Bits 15–14 status (`ultra_low`, `low`, `ok`, `good`), bits
13–0 mV. → `battery_voltage`, `battery_status`.

**Sentinels.** `0x7FFF` on any probe field (LHT65/LHT65N, LHT52, LDDS75,
LSN50v2 DS18B20, SHT temperature and humidity) = nothing attached →
`<key>_status: not_connected`, no warning: the device is telling you its
configuration, not failing. LDDS75 distance `0x0000` = ultrasonic module
not detected → `distance_status: not_detected` plus `sensor_fault`;
`0x0014` = object inside the 280 mm blind zone → `below_minimum`, no warning.

**Byte 6: low nibble = external type, high nibble = status flags.** Types:
`0x01` DS18B20 and `0x02` TMP117 → `temperature_external`; `0x04` interrupt
→ `input_level`, `interrupt`; `0x05` → `illuminance`; `0x06` ADC →
`input_voltage` (V); `0x07`/`0x08`/`0x0E` → `pulse_count`; `0x0B` SHT31 →
`temperature_external`, `humidity_external`. The LHT65N manual writes the
last three as 0x10/0x11 but the nibble holds decimal 10/11. Flags (bit 7
no-ACK resend, bit 6 poll reply, bit 5 time synced, bit 4 time request) →
attributes when set; a set bit 7 no longer suppresses the external reading.
Probe `0x7FFF` → `temperature_external_status: not_connected`, never a
temperature.

**LHT65N timestamp layout.** Types `0x09`/`0x0A` (E3/E2 probe with unix
time) and every fPort 3 datalog entry use a different 11-byte frame:
external value, SHT temperature, battery status (2 bits) + humidity (12
bits), status & type, unix time. On fPort 2 it is reported live with
`attributes.device_time`; on fPort 3 each entry goes to `history`, all-zero
entries ("no data in range") are skipped, `attributes.datalog_entries`
counts them. No battery voltage in this layout.

**Unverified.** Only `0x01` and the fPort 3 example have vendor vectors.
`LHT65N` is an alias of `LHT65`; same documented frame.

**LDS02 / LWL02.** Bytes 0–1: bit 15 door open (LDS02), bit 14 leak (LWL02),
bits 13–0 mV. Byte 2 MOD (1 door, 2 leak) → `attributes.mode`. Counts and
durations are uint24; duration in minutes → `open_count`, `open_duration` on
both models. Byte 9 bit 0 → `alarm`. A 5-byte frame (fPort 7) is the EDC
event-count packet: bit 15 = which event is counted → `attributes.edc_event`,
uint24 → `event_count`.

**LDDS75 distance sentinels.** See Sentinels above. Frames before firmware
1.1.4 are 4 bytes. Byte 7 → `attributes.ultrasonic_sensor`.

**LSE01 bytes 2–3.** The manual marks the DS18B20 field "reserve, ignore now";
exposed as `attributes.reserved`. The manual's negative-temperature example
subtracts 0xFFFF; this library uses two's complement (0xFF7E → −1.30, not
−1.29). Byte 10 bit 7 is MOD (firmware ≥ 1.2.1): MOD=1 sends raw AD values
(conductivity, moisture, dielectric constant) → attributes with an
`unscaled_value` warning, no soil telemetry. `attributes.mode` always.

**LSN50v2 modes.** Byte 6 bits 2–6 hold MOD−1 (TTN Device Repository decoder
convention). Only MOD=1 is decoded; other modes emit battery only with an
`undocumented_field` warning. Bit 0 → `interrupt`, bit 1 (PA12) →
`input_level`, bit 7 (PB14) → `attributes.interrupt_pin`. SHT and DS18B20
`0x7FFF` → `<key>_status: not_connected`.

**LHT52** sends its sample time in bytes 7–10 → `attributes.device_time`.
fPort 3 datalog entries reorder the fields (external temperature, humidity,
SHT temperature, type, time) and go to `history`; all-zero entries skipped.

## Hardware verification

`test/vendors/captures.test.ts` holds reference uplinks recorded from real
hardware (payload and fPort only, no device identifiers): Milesight EM300-SLD, AM307, AM308, AM308L,
AM319-HCHO, WS301, CT103, VS351; Netvox RA02A; Dragino LHT65N; Ellenex
PLS2-L, PTS2-L, PDS2-L (legacy and V6). Every other format is verified against vendor documentation only.
More hardware vectors are the most useful contribution: open an issue with
model, hex payload, fPort, and the values the device's platform showed.
