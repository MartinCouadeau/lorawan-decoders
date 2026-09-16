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

**Two payload generations.** Legacy (V4): one or more fixed 8-byte packets.
V6: CBOR map. Detected by shape (`0xBF` or `0xA0`–`0xB7` first byte = V6).
Override with `scaling: { generation: 'legacy' | 'v6' }`.

**Legacy bytes 0–2.** Bytes 0–1 are the last two bytes of the DevEUI in the
first packet and a frame counter in later packets → `attributes.device_id`,
`attributes.frame_counter`. Byte 2 is the data type: `0x00` sensor reading;
other values are configuration echoes (`0x01` interval, `0x16` auto-reset seen
in captures) → kept in `attributes.data_type` / `attributes.data` with an
`undocumented_field` warning, no telemetry. Confirmed on ThingPark captures.

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
platform decoders; no vendor document). No status/alarm field documented.

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

`test/vendors/captures.test.ts` holds uplinks captured from production
devices through ThingPark: Milesight EM300-SLD, AM307, AM308, AM308L,
AM319-HCHO, WS301; Dragino LHT65N; Ellenex PLS2-L, PTS2-L, PDS2-L (legacy
and V6). Every other format is verified against vendor documentation only.
More captures are the most useful contribution: open an issue with model,
hex payload, fPort, and what the device's own platform showed.
