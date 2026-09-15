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

**EM500-UDL alarm channel.** `83/e9` divides distance by 10 in the vendor
decoder; `03/82` does not. No unit or example documented. Emitted as
`distance_alarm_value` with a `vendor_quirk` warning. Unverified against
hardware.

**Hardcoded bytes in the vendor decoder.** `ff/fe` (reset) and `ff/0b`
(status) are decoded as the literal 1 in vendor code. This library reads the
byte, so `reset_event` can be `normal`.

**Serial number length.** READMEs say `ff/16` is 2 bytes; vendor code reads 8.
This library reads 8.

**WS302 key names.** Vendor decoder renames outputs by weighting (`LAF`,
`LZS`…). This library uses `sound_level`, `sound_level_eq`, `sound_level_max`
and puts the weighting in attributes.

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

**R718N360 ReportType 0x02 has no battery byte.** Channel values are raw
counts → `channel_1..3` with unit `raw`.

**Model suffixes.** Digits = CT rating (no decoding effect). `E` = detachable
cables (none). `L` = light sensor, different DeviceType and a lux field.
`D` = revision documenting ReportTypes 0x03/0x04; partially verified.

**Unverified.** `R718NL36` appears in the wild but not in Netvox sources
(manual lists `R718NL363`). Base three-phase CT rating differs between manual
revisions (50 A vs 60 A).

## Ellenex

**Two payload generations.** Legacy: fixed 8 bytes. V6: CBOR map. Detected
by shape (`0xBF` or `0xA0`–`0xB7` first byte = V6). Override with
`scaling: { generation: 'legacy' | 'v6' }`.

**Bytes 0–2 undocumented.** Observed `01 E8 00`, `01 82 00`. On FMS2-L byte 0
`0x80` changes the layout. Exposed as `header` attribute; warns when byte 0
≠ `0x01`.

**Readings are raw counts.** Scale depends on sensor range and liquid
density, supplied per device. Without `scaling` → `level_raw`,
`pressure_raw`, `differential_pressure_raw`, `temperature_raw`. With
`scaling: { profile, range, density }` → `level` (m) or `pressure` (kPa);
pass `range` in that unit. V6 conversions: bar → kPa, Pa → kPa (PDT2-L),
`D` metres → mm.

**`v` vs `V` in V6.** `v` = battery mV, `V` = input voltage mV.

**Unverified.** Legacy secondary (temperature) scaling: emitted as
`temperature_raw`. No status/alarm field documented; none invented.

## Dragino

**Battery word.** Bits 15–14 status (`ultra_low`, `low`, `ok`, `good`), bits
13–0 mV. → `battery_voltage`, `battery_status`.

**Byte 6 selects the external layout.** `0x01` DS18B20 →
`temperature_external`; `0x04` interrupt → `input_level`, `interrupt`;
`0x05` → `illuminance`; `0x06` ADC → `input_voltage` (V); `0x07`/`0x08` →
`pulse_count`. Bit 7 = configured but disconnected: no external reading, a
`sensor_fault` warning. DS18B20 `0x7FFF` is never emitted as a temperature.

**Unverified.** Only `0x01` has a vendor example. `LHT65N` is an alias of
`LHT65`; same documented frame.

**LDS02 / LWL02.** Bytes 0–1: bit 15 door open (LDS02), bit 14 leak (LWL02),
bits 13–0 mV. Byte 2 MOD (1 door, 2 leak) → `attributes.mode`. Counts and
durations are uint24; duration in minutes → `open_count`, `open_duration` on
both models. Byte 9 bit 0 → `alarm`.

**LDDS75 distance sentinels.** `0x0000` = no ultrasonic sensor, `0x0014` =
object closer than 280 mm. Both warn `sensor_fault`; `distance` is absent.
Frames before firmware 1.1.4 are 4 bytes. Byte 7 → `attributes.ultrasonic_sensor`.

**LSE01 bytes 2–3.** The manual marks the DS18B20 field "reserve, ignore now";
exposed as `attributes.reserved`. The manual's negative-temperature example
subtracts 0xFFFF; this library uses two's complement (0xFF7E → −1.30, not
−1.29).

**LSN50v2 modes.** Byte 6 bits 2–6 hold MOD−1 (TTN Device Repository decoder
convention). Only MOD=1 is decoded; other modes emit battery only with an
`undocumented_field` warning. Bit 0 → `interrupt`, bit 1 (PA12) →
`input_level`, bit 7 (PB14) → `attributes.interrupt_pin`. SHT and DS18B20
`0x7FFF` = absent.

**LHT52** sends its sample time in bytes 7–10 → `attributes.device_time`.
fPort 3 datalog records share the layout.

## Hardware verification

Every format is verified against vendor documentation and published
examples, not against devices owned by this project. Captures from real
hardware are the most useful contribution: open an issue with model, hex
payload, and what the device's own platform showed.
