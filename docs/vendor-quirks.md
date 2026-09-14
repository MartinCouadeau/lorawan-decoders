# Vendor quirks

Things that are surprising, undocumented, or inconsistent in the source
material — and what this library does about each. If you are debugging a value
that looks wrong, start here.

## Milesight

### Unknown channels end the frame

The format carries no length field. The width of each value is implied by its
`(channel_id, channel_type)` pair, so an unrecognised pair means the position of
the next channel is unknowable. Milesight's decoder `break`s silently. This
library also stops — there is no alternative — but emits an `unknown_channel`
warning naming the pair and the number of bytes dropped.

### The same channel means different things on different models

| Channel | EM400-TLD | EM300-SLD | WS301 | WS303 | AM308L |
|---|---|---|---|---|---|
| `03/00` | — | — | magnet | **leak** | — |
| `05/00` | position/tilt | **leak** | — | — | **motion (PIR)** |
| `03/67` | temperature | temperature | — | — | temperature |
| `03/82` | — | — | — | — | — |

GS301 shifts its channel ids down by one relative to AM308L: temperature is
`02/67`, humidity `03/68`. Do not reuse the AM308L map for it.

### Two channels reporting the same key with different units

- **AM308L tVOC**: `08/7d` is an IAQ index (raw ÷ 100); `08/e6` is µg/m³ (raw).
  Same channel id, two units, so two keys: `tvoc_index` and `tvoc`.
- **GS301 H2S**: `05/7d` is 0.01 ppm resolution; `06/7d` is 0.001 ppm, added in
  firmware v1.2. Same unit, so the same key `h2s`, with more decimals.

### EM500-UDL divides by ten on one channel and not the other

`03/82` reports raw millimetres. `83/e9` — the alarm channel, same physical
quantity — divides by 10 in Milesight's decoder. Their downlink threshold config
takes raw millimetres, their README gives no unit for `83/e9`, and there is no
worked example.

**Unresolved.** This library follows their implementation so values match a
ThingsBoard install running the vendor codec, reports it on its own key
`distance_alarm_value` so it is never confused with `distance`, and emits a
`vendor_quirk` warning. **Verify against hardware before trusting the magnitude.**

### Values the vendor decoder never actually reads

`ff/fe` (reset event) and `ff/0b` (device status) are decoded in Milesight's
code as `readResetEvent(1)` — the literal `1`, not the payload byte. They
therefore always report "reset" and "on". This library reads the byte, so its
output can differ from theirs. If you are migrating from the vendor codec and
see `reset_event: normal` where you used to see `reset`, this is why.

### The README length column is wrong for serial numbers

Every model's README lists `ff/16` as 2 bytes; the description in the same row
says 8, and their code reads 8. This library uses 8. Using 2 would desynchronise
every channel after it, and the symptom would appear on an unrelated reading.

### WS302 renames its own output keys

Milesight's decoder derives field names from the weighting byte: `LAF`, `LAeq`,
`LAFmax` under A-weighting/fast, `LZS`/`LZeq`/`LZSmax` under Z/slow. Dynamic
keys are hostile to time-series storage — your schema changes when someone
reconfigures a device. This library emits stable keys — `sound_level`,
`sound_level_eq`, `sound_level_max` — and puts the weighting in attributes.

### WS101 generates a random message id

Their decoder emits `button_event.msgid` from `getRandomIntInclusive()`. It is
not wire data and is not reproduced here.

### AM308L humidity changes width between live and buffered readings

One byte live, two bytes inside history records. Same `÷2` scaling. This is real,
confirmed in both the README and the code.

## Netvox

### Battery voltage hides a flag in the top bit

Bits 0–6 are tenths of a volt; bit 7 is the low-battery flag. Reading the byte
as a plain integer gives 17.8 V for a flagged 3.0 V cell — a mistake that looks
like a sensor fault rather than a decoding bug.

### The multiplier is encoded two different ways on the same device

On ReportType `0x01` and `0x02` the current multiplier is a literal value in its
own byte (`0x0A` means ×10). On ReportType `0x03` all three multipliers are
packed into one byte, two bits each, through a lookup: `0b00`→1, `0b01`→5,
`0b10`→10, `0b11`→100.

### A three-phase ReportType 0x01 frame cannot carry all three multipliers

Three 2-byte currents consume bytes 4–9, leaving one byte. Netvox split the
multipliers across ReportType `0x01` and `0x02`, so a single uplink is not
self-describing. A stateless decoder cannot resolve this.

This library reports `current_1` scaled, `current_2` and `current_3` as raw
milliamps, and warns with `unscaled_value`. Supply the missing values if you
know them:

```ts
netvox.r718n3(payload, { scaling: { multiplier2: 5, multiplier3: 100 } });
```

### R718N360 ReportType 0x02 has no battery byte

Channels B and C consume all eight payload bytes. Assuming "battery is always
byte 3" would misread the high half of channel B as a voltage. The channel
values are raw counts whose scale depends on the attached transformer, so they
are reported as `channel_1`, `channel_2`, `channel_3` with unit `raw`, never as
`current`.

### Model suffixes

- Numeric suffix = CT clamp rating, roughly rating ÷ 10. `R718N17` is 75 A,
  `R718N1100` is 1000 A. **No effect on decoding.**
- `E` = detachable cables. No effect on decoding.
- `L` = adds an ambient light sensor. **This does change decoding** — different
  DeviceType (`0x98`/`0x99`) and a 4-byte lux field.
- `D` = **partially verified.** The manual is titled "Three-phase Current
  Detection" rather than "Meter" and never defines the suffix. It is the only
  revision documenting ReportTypes `0x03` and `0x04`. Treat as a hardware
  revision and probe the device rather than assuming.

### Not verified

- `R718NL36` appears in the wild but in no Netvox source; the NL3 manual lists
  `R718NL363` (3 × 630 A). Probably a transcription slip.
- The three-phase base CT rating is inconsistent between manual revisions
  (50 A vs 60 A).

## Ellenex

### Two incompatible payload generations under the same model names

Legacy is a fixed 8-byte frame. Version 6 is CBOR, variable length. The device
does not announce which. This library detects by shape — a CBOR map header
(`0xBF`, or `0xA0`–`0xB7`) means V6 — and you can force it with
`scaling: { generation: 'legacy' | 'v6' }`.

### Bytes 0–2 are undocumented everywhere

Not in Ellenex's decoder repository (all 148 commits searched), not in the TTN
Device Repository, not in any datasheet. Observed values are `01 E8 00` and
`01 82 00`.

They are not meaningless: on the FMS2-L, byte 0 acts as a layout discriminator —
`0x80` moves the primary reading to bytes 1–2 and puts a 32-bit counter at
bytes 3–6. So an unexpected byte 0 may mean the rest of the frame is laid out
differently.

This library exposes them as a `header` attribute, stays quiet while byte 0 is
the observed `0x01`, and warns when it is not.

### The 16-bit reading is a raw count, not engineering units

The conversion depends on sensor range and liquid density and is supplied per
device with the EUI. Ellenex's own published sample data is labelled
"pressure -1192 bar". Without a scaling profile this library reports the count
on `level_raw` / `pressure_raw` / `differential_pressure_raw` and never on the
engineering key. With `scaling: { profile, range, density }` it reports `level`
in metres or `pressure` in kilopascals; pass `range` in that unit. On Version 6
payloads bar is converted to kPa (×100), pascals to kPa on the PDT2-L, and the
`D` distance key from metres to millimetres, so every key matches the shared
vocabulary.

### `v` and `V` are different things in V6

`v` is battery voltage in millivolts. `V` is a raw voltage input channel, also
in millivolts. One character apart, both plausible on the same device.

### Not verified

- Temperature scaling on the legacy frame. Emitted as `temperature_raw` with a
  warning.
- No status or alarm flag field is documented for any Ellenex model. None is
  invented here.

## Dragino

### Battery carries a status in its top two bits

Bytes 0–1 are not a plain millivolt reading: bits 15–14 are a four-level
battery status (`ultra_low`, `low`, `ok`, `good`) and bits 13–0 are millivolts.
`0xCBF6` is 3.062 V and "good", not 52.2 V. Both come out as separate keys:
`battery_voltage` and `battery_status`.

### Byte 6 changes the layout of everything after it

The external-sensor type byte selects how bytes 7–10 are read: a DS18B20
temperature (`temperature_external`), an interrupt pin (`input_level`,
`interrupt`), lux (`illuminance`), an ADC (`input_voltage`, converted to volts),
or a 16- or 32-bit counter (`pulse_count`). Bit 7 of the same byte means "configured but not connected" on
firmware 1.8 and later. This library emits the external reading only when the
probe is both configured and connected, and warns otherwise. The DS18B20 sentinel
`0x7FFF` is never emitted as a temperature.

### Not verified

- Only external type `0x01` (DS18B20) has a vendor worked example. Types `0x04`
  to `0x08` are implemented from the manual's byte tables and not verified
  against hardware.
- The LHT65N is registered as an alias of the LHT65 because Dragino document
  the same frame for both. A capture from an LHT65N would confirm it.

## Verified against documentation, not hardware

Every format in this library is verified against vendor documentation and, where
the vendor publishes one, a worked example. None has been tested against a
device owned by this project. Captures from real hardware are the most valuable
contribution this repository can receive — open an issue with the model, the hex
payload, and what the device's own platform showed.
