# lorawan-decoders

Typed LoRaWAN payload decoders. One flat telemetry object, same keys and units
for every vendor. Milesight, Netvox, Ellenex, Dragino.

[![CI](https://github.com/MartinCouadeau/lorawan-decoders/actions/workflows/ci.yml/badge.svg)](https://github.com/MartinCouadeau/lorawan-decoders/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![License](https://img.shields.io/badge/license-MIT-green)

54 decoders, 170 model names, 4 vendors. Written from public vendor
documentation; no vendor code copied. See [Provenance](#provenance-and-licensing).

```ts
import { milesight } from 'lorawan-decoders';

milesight.em400_tld('01755C0367010104824408050001');
// { battery: 92, temperature: 25.7, distance: 2116, position: 'tilt' }
```

That is the whole output. The library just decodes sensor data.

## Install

```bash
npm install lorawan-decoders
```

Node 20+. ESM only.

## Quick start

```ts
import { milesight, netvox, decode, isModel } from 'lorawan-decoders';

// Model known at compile time: typed accessor.
const t = milesight.em310_tilt('01755C03CF00000000282307');
// { battery: 92, angle_x: 0, angle_threshold_x: 'trigger', angle_y: 0, angle_threshold_y: 'trigger',
//   angle_z: 90, angle_threshold_z: 'trigger' }

// Model name from the network server at runtime.
const profile = 'R718N3';                       // r718n3, R718-N3, r718 n3 also work
if (isModel('netvox', profile)) {
  decode('netvox', profile, '014A0324006400640064 36', { fPort: 6 });
  // { battery_voltage: 3.6, battery_low: false, current_1: 1000, current_2: 500, current_3: 10000 }
}

// Base64 from ChirpStack/TTN, plus units, history, attributes and warnings.
const d = decode('milesight', 'EM300-SLD', 'AXVcIM4AEF5fAQFlAQ==', {
  encoding: 'base64', fPort: 85, detailed: true,
});
d.telemetry;   // { battery: 92 }
d.history;     // [ { ts: '2020-09-13T12:26:40.000Z', temperature: 25.7, humidity: 50.5, leakage_status: 'leak' } ]
d.warnings;    // []
```

More: [docs/examples.md](docs/examples.md). Reference: [docs/api.md](docs/api.md).

## Calling it

**Typed accessor.** Property = model name lowercased, separators → `_`.
Aliases included (`milesight.em310tilt`, `netvox.r718n17`). Return type is per
model.

```ts
const t = milesight.em310_tilt(payload);
t.angle_x        // number | undefined
t.humidity       // compile error
```

**Dynamic.** Vendor and model matched case- and separator-insensitively:
`EM310-TILT`, `EM310TILT`, `em310_tilt`, `Em310 Tilt` are the same.

```ts
decode('milesight', 'EM310-TILT', payload);
decode('milesight', 'EM310-TLT', payload);
// DecodeError: no decoder for milesight "EM310-TLT"; did you mean "EM310-TILT"?
```

`isModel(vendor, name)` → boolean. `models(vendor?)` → name, accessor,
aliases, fPort, keys per model.

**Payload:** hex string (separators allowed), `Uint8Array`, `number[]`, or
base64 with `{ encoding: 'base64' }`. Encoding is never guessed.

**Per-vendor import:** `import { netvox } from 'lorawan-decoders/netvox'`.
Also `/milesight`, `/ellenex`, `/dragino`.

## Output

Plain call: `Record<string, number | string | boolean>`, readings only.

`{ detailed: true }`:

```ts
ellenex.pls2_l('01E80000D6000022', { fPort: 15, detailed: true });
```

```jsonc
{
  "telemetry":  { "level_raw": 214, "battery_voltage": 3.4 },
  "units":      { "level_raw": "raw", "battery_voltage": "V" },
  "history":    [],
  "attributes": { "header": "01e800" },
  "warnings": [
    { "code": "unscaled_value", "message": "level is a raw sensor count, reported on level_raw; …" }
  ]
}
```

| Field | Content |
|---|---|
| `units` | Unit per numeric key. States and events absent. |
| `history` | Buffered records replayed by the device, one per device timestamp, oldest first. Never merged into `telemetry`. |
| `attributes` | Device metadata: firmware, serial, multipliers, header bytes. |
| `warnings` | Why something is missing or unscaled. Plain call is silent; `strict: true` throws instead. |

## Naming

Rules in [docs/naming.md](docs/naming.md), enforced by tests:

1. `snake_case`.
2. Bare name = built-in sensor; extras get a suffix (`temperature_external`, `current_1`).
3. One key, one unit (`tvoc` µg/m³, `tvoc_index`; `pressure` kPa, `barometric_pressure` hPa).
4. Every key is in the vocabulary; unknown keys fail to register.
5. States and events are strings.

## CLI

```bash
npx lorawan-decode -v milesight -m em400-tld -x 01755C0367010104824408050001
npx lorawan-decode -v milesight -m em400-tld -b AXVcA2cBAQSCRAgFAAE=   # base64
npx lorawan-decode -v ellenex -m pls2-l -x 01E80000D6000022 --json     # detailed
npx lorawan-decode --list netvox
```

## Vendor notes

- **Milesight**: channel/type TLV with no length field. An unknown channel ends
  parsing; a warning names it. Same channel id means different things per
  model, so each model has its own table.
- **Netvox**: fixed 11-byte frame. Clamp-rating suffixes share one decoder
  (`R718N1` … `R718N1100E`). Three-phase ReportType 0x01 cannot carry all
  multipliers; pass them via `scaling`.
- **Ellenex**: 8-byte legacy frame or CBOR (V6), detected by shape. Readings
  are raw counts unless you pass the per-device `scaling` profile; without it
  they go on `level_raw` / `pressure_raw`.
- **Dragino**: fixed frames per model. LHT65 byte 6 selects the external
  block; LSN50v2 is decoded in MOD=1 only; LDDS75 distance sentinels warn.

Details: [docs/vendor-quirks.md](docs/vendor-quirks.md).

## Documentation

| | |
|---|---|
| [docs/examples.md](docs/examples.md) | Real payloads and outputs; ChirpStack, TTN, ThingsBoard, MQTT |
| [docs/api.md](docs/api.md) | Exports, options, output fields, warning and error codes |
| [docs/naming.md](docs/naming.md) | Naming rules and the key → unit table |
| [docs/supported-devices.md](docs/supported-devices.md) | Every model: name to pass, accessor, aliases, keys |
| [docs/vendor-quirks.md](docs/vendor-quirks.md) | Undocumented or inconsistent vendor behaviour and how it is handled |
| [docs/adding-a-decoder.md](docs/adding-a-decoder.md) | Adding a model or vendor |
| [CHANGELOG.md](CHANGELOG.md) | Versions |

## Provenance and licensing

MIT. No vendor code is copied:

- **Milesight** decoders are GPL-3.0. Implemented from the channel tables in their READMEs.
- **Ellenex** decoder repo has no licence. Format read as specification; test vectors from the Apache-2.0 TTN Device Repository.
- **Netvox**: product manuals and TTN Device Repository per-device entries.
- **Dragino**: user manuals and TTN Device Repository entries.

Each model definition has a `source` field. See [NOTICE.md](NOTICE.md).

## Status

v0.3. Formats are verified against vendor documentation, not hardware.
Captures from real devices are welcome.

## Licence

MIT — see [LICENSE](LICENSE).
