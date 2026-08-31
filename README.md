# lorawan-decoders

Typed LoRaWAN payload decoders with one normalized output schema, for Milesight,
Netvox and Ellenex devices.

[![CI](https://github.com/MartinCouadeau/lorawan-decoders/actions/workflows/ci.yml/badge.svg)](https://github.com/MartinCouadeau/lorawan-decoders/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![License](https://img.shields.io/badge/license-MIT-green)

**31 decoders covering 130 model names across 3 vendors**, written clean-room
from public vendor documentation. No copied vendor code — see
[Provenance](#provenance-and-licensing).

## The problem

Every LoRaWAN vendor invents their own wire format, and none of them agree on
anything:

| | Milesight | Netvox | Ellenex |
|---|---|---|---|
| Structure | channel/type TLV, **no length field** | fixed 11-byte frame | fixed 8-byte frame, or CBOR |
| Endianness | little | **big** | **big** |
| Battery | percent, 1 byte | volts in 7 bits + a flag in bit 7 | volts × 0.1 |
| Scaling | per channel, in the docs | multiplier byte, encoded two different ways | **not on the wire at all** |

Decode each of them in its own bespoke way and you end up with a fleet where
`temperature` means `°C` on one device, tenths of a degree on another, and a raw
ADC count on a third — a problem that surfaces the day someone writes an alarm
rule across device types.

This library decodes each vendor's format faithfully, then normalizes: every
reading comes out as a `Measurement` with an explicit unit and a quantity kind.

```ts
import { decode } from 'lorawan-decoders';

decode({ vendor: 'Milesight', model: 'EM400-TLD', payload: '01755C0367010104824408050001' });
```

```jsonc
{
  "vendor": "Milesight",
  "model": "EM400-TLD",
  "measurements": [
    { "key": "battery",     "kind": "battery",     "value": 92,   "unit": "%",  "channel": "01/75" },
    { "key": "temperature", "kind": "temperature", "value": 25.7, "unit": "°C", "channel": "03/67" },
    { "key": "distance",    "kind": "distance",    "value": 2116, "unit": "mm", "channel": "04/82" },
    { "key": "position",    "kind": "state",       "value": "tilt", "code": 1,  "channel": "05/00" }
  ],
  "attributes": {},
  "warnings": [],
  "raw": "01755c0367010104824408050001"
}
```

`channel` is kept deliberately. When a value looks wrong at 2am, the first
question is always "which bytes produced this?"

## Install

```bash
npm install lorawan-decoders
```

## Use it in your network server

```ts
// ThingsBoard
import { decode } from 'lorawan-decoders';
import { toThingsBoard } from 'lorawan-decoders/adapters/thingsboard';

const uplink = decode({ vendor: 'Milesight', model: 'EM300-SLD', payload: bytes });
return toThingsBoard(uplink, { deviceName: metadata.deviceName });
```

Adapters ship for ThingsBoard, ChirpStack and The Things Stack. Each maps onto
that platform's actual contract rather than a lowest common denominator — TTN's
adapter, for instance, routes decode warnings into TTN's own `warnings` array so
they appear in the console next to the uplink.

### Buffered readings keep their own timestamps

Devices that have been offline replay their history when they reconnect. If you
stamp those with the receive time, six hours of data collapses into a vertical
line on the chart. Measurements carry an `at` field, and the ThingsBoard adapter
turns them into correctly-dated points:

```ts
toThingsBoard(uplink, { deviceName: 'tank-3' }).telemetry;
// [ { ts: 1600000000000, values: { temperature: 25.7 } },   // buffered
//   { ts: 1735689600000, values: { battery: 92 } } ]        // live
```

## CLI

```bash
npx lorawan-decode -v milesight -m EM400-TLD -x 01755C0367010104824408050001

# Milesight EM400-TLD   01755c0367010104824408050001
#
#   battery                    92 %
#   temperature                25.7 °C
#   distance                   2116 mm
#   position                   tilt

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
model's map is a data table — 14 models, one parsing loop.

### One decoder, 46 model names

Netvox's R718N family differs only by current-transformer rating: an R718N17 is
a 75 A clamp, an R718N1100 a 1000 A one. Same DeviceType, same wire format, and
the reading is always milliamps. Writing twelve near-identical decoders would be
twelve places for a bug to hide, so the aliases are
[generated](src/vendors/netvox/models.ts) from the rating list.

### When the vendor's own decoder is inconsistent, say so

Milesight's EM500-UDL decoder divides distance by 10 on the alarm channel while
reporting raw millimetres on the normal channel — and their downlink threshold
config takes raw millimetres. Their documentation gives no unit for that channel
and no worked example, so there is no way to tell from the docs whether it is a
unit change or a bug.

This library follows their implementation, so values match what a ThingsBoard
install running the vendor codec shows, and attaches a `vendor_quirk` warning
explaining the discrepancy. Silently picking one interpretation would make the
inconsistency someone else's 2am problem.

### Refusing to invent engineering units

Ellenex's 16-bit reading is a raw count. The conversion depends on the sensor's
range and the liquid's density, and Ellenex supplies it per device alongside the
EUI — it is not on the wire. Their own published sample data is labelled
"pressure -1192 bar", which is physically impossible and shows exactly what
happens when you treat the count as a value.

So by default this decoder reports `unit: 'raw'` and warns. Give it a profile and
it produces real units:

```ts
decode({
  vendor: 'Ellenex', model: 'PLS2-L', payload: bytes,
  scaling: { profile: 'adc14', range: 10, density: 0.85 },  // 10 m sensor, diesel
});
```

### Bounds-checked reads

Every read validates length first and throws with the byte offset. Indexing
straight into the array yields `undefined`, which becomes `NaN` two lines later
and reaches the dashboard as a blank tile with no explanation. Truncated uplinks
are routine on LoRaWAN; they should fail at the point of truncation.

## Supported devices

See [docs/supported-devices.md](docs/supported-devices.md) — generated from the
registry by `npm run devices`, so it cannot drift from the code.

Full details on each vendor's quirks: [docs/vendor-quirks.md](docs/vendor-quirks.md).

## Adding a decoder

See [docs/adding-a-decoder.md](docs/adding-a-decoder.md). Short version: a
Milesight model is a table of channel specs; other vendors are a function. Every
decoder needs a `source` naming the documentation it came from, and at least one
test using a payload from that documentation with the values the vendor states.

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

Every `ModelDefinition` carries a `source` field naming where its format came
from. See [NOTICE.md](NOTICE.md).

## Status

v0.1. The three vendors here are the ones I have worked with most; the
architecture is built for adding more. Issues and PRs welcome, particularly test
vectors captured from real hardware — several formats in here are verified
against vendor documentation but not against a device I own.

## Licence

MIT — see [LICENSE](LICENSE).
