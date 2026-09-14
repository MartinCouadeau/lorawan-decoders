# lorawan-decoders

Typed LoRaWAN payload decoders that return one flat telemetry object with the
same key names and units for every vendor. Milesight, Netvox, Ellenex and
Dragino.

[![CI](https://github.com/MartinCouadeau/lorawan-decoders/actions/workflows/ci.yml/badge.svg)](https://github.com/MartinCouadeau/lorawan-decoders/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![License](https://img.shields.io/badge/license-MIT-green)

**34 decoders covering 136 model names across 4 vendors**, written clean-room
from public vendor documentation. No copied vendor code — see
[Provenance](#provenance-and-licensing).

```ts
import { milesight } from 'lorawan-decoders';

milesight.em400_tld('01755C0367010104824408050001');
// { battery: 92, temperature: 25.7, distance: 2116, position: 'tilt' }
```

That is the whole output. The library decodes sensor data; everything else is
yours.

## The problem

Every LoRaWAN vendor invents their own wire format, and none of them agree on
anything:

| | Milesight | Netvox | Ellenex | Dragino |
|---|---|---|---|---|
| Structure | channel/type TLV, **no length field** | fixed 11-byte frame | fixed 8-byte frame, or CBOR | fixed 11-byte frame, tail depends on byte 6 |
| Endianness | little | **big** | **big** | **big** |
| Battery | percent, 1 byte | volts in 7 bits + a flag in bit 7 | volts × 0.1 | millivolts in 14 bits + status in the top 2 |
| Scaling | per channel, in the docs | multiplier byte, encoded two different ways | **not on the wire at all** | fixed per field |

Decode each of them in its own bespoke way and you end up with a fleet where
`temperature` means °C on one device, tenths of a degree on another, and a raw
ADC count on a third. A problem that surfaces the day someone writes an alarm
rule across device types.

This library decodes each vendor's format faithfully, then normalizes onto one
vocabulary: `temperature` is always °C, `distance` always millimetres,
`battery_voltage` always volts. The full table is in
[docs/naming.md](docs/naming.md) and is enforced by the test suite.

## Install

```bash
npm install lorawan-decoders
```

Node 20 or later. ESM only.

## Quick start

```ts
import { milesight, netvox, decode, isModel } from 'lorawan-decoders';

// 1. Model known at compile time: typed accessor, per-model return type.
const t = milesight.em310_tilt('01755C03CF00000000282307');
//    { battery: 92, angle_x: 0, angle_threshold_x: 'trigger', angle_y: 0, angle_threshold_y: 'trigger',
//      angle_z: 90, angle_threshold_z: 'trigger' }

// 2. Model name arrives at runtime (device profile, MQTT topic, database row).
const profile = 'R718N3';                       // any spelling: r718n3, R718-N3, r718 n3
if (isModel('netvox', profile)) {
  decode('netvox', profile, '014A0324006400640064 36', { fPort: 6 });
  //  { battery_voltage: 3.6, battery_low: false, current_1: 1000, current_2: 500, current_3: 10000 }
}

// 3. Base64 straight from ChirpStack or TTN, and everything the decode produced.
const d = decode('milesight', 'EM300-SLD', 'AXVcIM4AEF5fAQFlAQ==', {
  encoding: 'base64', fPort: 85, detailed: true,
});
d.telemetry;   // { battery: 92 }
d.history;     // [ { ts: '2020-09-13T12:26:40.000Z', temperature: 25.7, humidity: 50.5, leakage_status: 'leak' } ]
d.warnings;    // []
```

More in [docs/examples.md](docs/examples.md): ChirpStack and TTN webhooks,
forwarding to ThingsBoard, MQTT, batch decoding, error handling. Full
signatures in [docs/api.md](docs/api.md).

## Two ways to call it

**Typed accessor**, when you know the model at compile time:

```ts
import { milesight, netvox, ellenex, dragino } from 'lorawan-decoders';

const t = milesight.em310_tilt(payload);
t.angle_x        // number | undefined, autocompletes
t.humidity       // compile error: EM310-TILT has no humidity
```

Property names are the model names lowercased with separators turned into `_`.
Aliases work too: `milesight.em310tilt`, `netvox.r718n17`.

**Dynamic strings**, when the model name arrives at runtime from your network
server:

```ts
import { decode, isModel } from 'lorawan-decoders';

decode('milesight', 'EM310-TILT', payload);
```

Vendor and model are matched case-insensitively and ignoring separators.
`EM310-TILT`, `EM310TILT`, `em310_tilt` and `Em310 Tilt` all reach the same
decoder, so a ThingsBoard profile named one way and a ChirpStack profile named
another both work. What you cannot do is misspell it:

```
DecodeError: no decoder for milesight "EM310-TLT"; did you mean "EM310-TILT"?
```

`isModel('milesight', name)` answers true or false with the same normalization,
for validating profile names at setup time. `models('milesight')` lists every
model with its accessor name, aliases, fPort and the keys it emits.

### Payload formats

Hex strings with or without separators, `Uint8Array`, `number[]`, or base64
with `{ encoding: 'base64' }`. The encoding is never guessed: `01AB` is valid
hex *and* valid base64, and a wrong guess produces plausible wrong numbers.

```ts
// ChirpStack v4 HTTP integration
app.post('/uplink', (req, res) => {
  const { deviceProfileName, data, fPort } = req.body;
  if (!isModel('milesight', deviceProfileName)) return res.status(422).end();
  res.json(decode('milesight', deviceProfileName, data, { encoding: 'base64', fPort }));
});
```

## What comes back

The plain call returns only readings: `Record<string, number | string | boolean>`.
Nothing else, no nesting, no metadata. Pass `detailed: true` for the rest:

```ts
const d = ellenex.pls2_l('01E80000D6000022', { fPort: 15, detailed: true });
```

```jsonc
{
  "telemetry":  { "level_raw": 214, "battery_voltage": 3.4 },
  "units":      { "level_raw": "raw", "battery_voltage": "V" },
  "history":    [],
  "attributes": { "header": "01e800" },
  "warnings": [
    { "code": "unscaled_value", "message": "level is a raw sensor count, reported on level_raw. …" }
  ]
}
```

- **units** — one entry per numeric key. States and events have none.
- **history** — buffered readings the device replayed after being offline,
  one record per device timestamp, oldest first. They never land in
  `telemetry`: stamping six hours of backlog with the receive time collapses
  it into a vertical line on the chart.
- **attributes** — device metadata: firmware version, serial number, Netvox
  multipliers, Ellenex header bytes. Not sensor data, so not telemetry.
- **warnings** — unknown channel, truncated frame, unscaled value, sensor
  fault, vendor quirk, duplicate key. The plain call is silent and returns
  what decoded; `strict: true` throws on the first warning instead.

```ts
milesight.em300_sld('20ce00105e5f01016501', { detailed: true }).history;
// [ { ts: '2020-09-13T12:26:40.000Z', temperature: 25.7, humidity: 50.5, leakage_status: 'leak' } ]
```

### Naming

Five rules, enforced by tests and documented in [docs/naming.md](docs/naming.md):

1. `snake_case`, lowercase ASCII.
2. The bare name is the device's own sensor; extra sensors of the same
   quantity get a suffix. `temperature` and `temperature_external` on a
   Dragino LHT65; `current_1`, `current_2`, `current_3` on a three-phase meter.
3. One key, one unit, forever. `tvoc` is µg/m³ and `tvoc_index` is an index;
   `pressure` is kPa and `barometric_pressure` is hPa.
4. Every key is in the shared vocabulary. A decoder that declares one outside
   it fails to register.
5. States and events are strings: `position: "tilt"`, `leakage_status: "leak"`.

## Per-vendor imports

```ts
import { netvox } from 'lorawan-decoders/netvox';
```

Pulls one vendor's decoders only. `lorawan-decoders/milesight`, `/netvox`,
`/ellenex`, `/dragino`.

## CLI

```bash
npx lorawan-decode -v milesight -m em400-tld -x 01755C0367010104824408050001

# milesight em400-tld
#
#   battery                    92 %
#   temperature                25.7 °C
#   distance                   2116 mm
#   position                   tilt

npx lorawan-decode -v milesight -m em400-tld -b AXVcA2cBAQSCRAgFAAE=   # base64
npx lorawan-decode -v ellenex -m pls2-l -x 01E80000D6000022 --json     # detailed shape
npx lorawan-decode --list netvox
```

## Design notes

The parts of this that were actually interesting to build.

### Unknown channels cannot be skipped

Milesight payloads have no length field: the width of each value is implied by
its `(channel_id, channel_type)` pair. Meet a pair you do not know and you have
lost the frame — you cannot find where the next channel starts. Milesight's own
decoder silently `break`s and returns a partial result. So does this one, because
there is no alternative, but it emits a warning naming the pair and how many
bytes were dropped. A missing reading with an explanation beats a missing reading.

### The same bytes mean different things on different models

`03/00` is the door magnet on a WS301 and the water-leak sensor on a WS303.
`05/00` is tilt on an EM400-TLD, leak on an EM300-SLD, and motion on an AM308L.
There is no universal Milesight channel map, so dispatch is per model and each
model's map is a data table — 16 models, one parsing loop. The model's
TypeScript return type is inferred from that table.

### One decoder, 33 model names

Netvox's R718N family differs only by current-transformer rating: an R718N17 is
a 75 A clamp, an R718N1100 a 1000 A one. Same DeviceType, same wire format, and
the reading is always milliamps. Writing twelve near-identical decoders would be
twelve places for a bug to hide, so the aliases are
[generated](src/vendors/netvox/models.ts) from the rating list, as literal
types, so `netvox.r718n1100e` still autocompletes.

### When the vendor's own decoder is inconsistent, say so

Milesight's EM500-UDL decoder divides distance by 10 on the alarm channel while
reporting raw millimetres on the normal channel — and their downlink threshold
config takes raw millimetres. Their documentation gives no unit for that channel
and no worked example, so there is no way to tell from the docs whether it is a
unit change or a bug.

This library follows their implementation, so values match what a ThingsBoard
install running the vendor codec shows, keeps the reading on its own key
(`distance_alarm_value`) so it can never be confused with `distance`, and
attaches a `vendor_quirk` warning.

### Refusing to invent engineering units

Ellenex's 16-bit reading is a raw count. The conversion depends on the sensor's
range and the liquid's density, and Ellenex supplies it per device alongside the
EUI — it is not on the wire. Their own published sample data is labelled
"pressure -1192 bar", which is physically impossible and shows exactly what
happens when you treat the count as a value.

So by default this decoder reports `level_raw` and warns; `level` is absent.
Give it a profile and it produces real units on the real key:

```ts
ellenex.pls2_l(bytes, { scaling: { profile: 'adc14', range: 10, density: 0.85 } });
// { level: -1.278, battery_voltage: 3.4 }        10 m sensor, diesel
```

### Bounds-checked reads

Every read validates length first and throws with the byte offset. Indexing
straight into the array yields `undefined`, which becomes `NaN` two lines later
and reaches the dashboard as a blank tile with no explanation. Truncated uplinks
are routine on LoRaWAN; they should fail at the point of truncation.

## Supported devices

See [docs/supported-devices.md](docs/supported-devices.md) — generated from the
registry by `npm run devices`, so it cannot drift from the code. For every model
it lists the name to pass, the accessor, the aliases, and the keys it emits.

## Documentation

| | |
|---|---|
| [docs/examples.md](docs/examples.md) | Worked examples with real payloads and outputs: webhooks, ThingsBoard, MQTT, history, errors |
| [docs/api.md](docs/api.md) | Every export, option, output field, warning code and error code |
| [docs/naming.md](docs/naming.md) | The naming rules and the full key-to-unit vocabulary |
| [docs/supported-devices.md](docs/supported-devices.md) | Every model: name to pass, accessor, aliases, keys |
| [docs/vendor-quirks.md](docs/vendor-quirks.md) | What is surprising or undocumented in each vendor's format, and what this library does about it |
| [docs/adding-a-decoder.md](docs/adding-a-decoder.md) | How to add a model or a vendor |
| [CHANGELOG.md](CHANGELOG.md) | What changed between versions |

## Adding a decoder

See [docs/adding-a-decoder.md](docs/adding-a-decoder.md). Short version: a
Milesight model is a table of channel specs; other vendors are a function. Every
decoder declares the keys it emits (checked against the vocabulary), names the
documentation it came from, and has at least one test using a payload from that
documentation with the values the vendor states.

## Provenance and licensing

This library is MIT. None of it is copied from vendor code, and that distinction
matters here:

- **Milesight** publish their decoders under **GPL-3.0**. Copying them into an
  MIT library would be a licence violation. The channel/type tables in their
  documentation are factual descriptions of a wire format; the implementation
  here is written from those tables.
- **Ellenex's** decoder repository has **no licence file at all**, which means
  all rights reserved. Their format was read as specification; the code is new.
  Test vectors come from the Apache-2.0 TTN Device Repository.
- **Netvox** formats come from their published product manuals and per-device
  entries in the TTN Device Repository, whose terms permit reuse of individual
  device information.
- **Dragino** formats come from their public user manuals and the Apache-2.0
  TTN Device Repository entries. Their own decoder repository is not used.

Every model definition carries a `source` field naming where its format came
from. See [NOTICE.md](NOTICE.md).

## Status

v0.2. The four vendors here are the ones I have worked with most; the
architecture is built for adding more. Issues and PRs welcome, particularly test
vectors captured from real hardware — several formats in here are verified
against vendor documentation but not against a device I own.

## Licence

MIT — see [LICENSE](LICENSE).
