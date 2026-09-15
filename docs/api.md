# API reference

Everything the package exports from `lorawan-decoders`, plus the per-vendor
subpaths. For worked examples with real payloads and outputs see
[examples.md](examples.md).

## Decoding

### Vendor namespaces

```ts
import { milesight, netvox, ellenex, dragino } from 'lorawan-decoders';
```

Each is a frozen object with one function per model name and alias. The
property name is the model name lowercased with every run of separators
(`-`, `_`, space, `.`, `(`, `)`) replaced by a single `_`:

| Model | Accessor |
|---|---|
| `EM310-TILT` | `milesight.em310_tilt` |
| `VS132-P` (alias of VS132) | `milesight.vs132_p` |
| `R718N1100E` (alias of R718N1) | `netvox.r718n1100e` |
| `PLS2-L` | `ellenex.pls2_l` |
| `LHT65N` (alias of LHT65) | `dragino.lht65n` |

Each accessor is a `ModelDecoder<T>`:

```ts
interface ModelDecoder<T> {
  (payload: Payload, options?: Options & { detailed?: false }): T;
  (payload: Payload, options: Options & { detailed: true }): Detailed<T>;
  readonly definition: ModelDefinition<T>;
}
```

`T` is that model's telemetry type. Every property is optional, because a
frame carries only the channels the device chose to send.

### `decode(vendor, model, payload, options?)`

```ts
import { decode } from 'lorawan-decoders';

decode('milesight', 'EM310-TILT', payload);                     // Telemetry
decode('milesight', 'EM310-TILT', payload, { detailed: true }); // Detailed
```

Dynamic entry point for when the model name arrives at runtime. `vendor` and
`model` are compared after lowercasing and stripping separators, so
`EM310-TILT`, `EM310TILT`, `em310_tilt` and `Em310 Tilt` are the same. Return
type is `Telemetry` (not model-specific).

Throws `DecodeError` with `code: 'unknown_model'` when nothing matches. The
message and `context.suggestion` carry the closest registered name (edit
distance ≤ 3, same vendor preferred).

### `Payload`

```ts
type Payload = string | Uint8Array | number[];
```

A string is hex unless `options.encoding` is `'base64'`. Hex accepts spaces,
colons, commas, dashes, underscores and `0x` prefixes. Base64 is validated
strictly (length multiple of 4, standard alphabet); an invalid string throws
`bad_payload` rather than decoding garbage.

### `Options`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `encoding` | `'hex' \| 'base64'` | `'hex'` | How to read a string payload. |
| `fPort` | `number` | — | Port the uplink arrived on. Warns (`vendor_quirk`) when it differs from the port the vendor documents. |
| `strict` | `boolean` | `false` | Throw `DecodeError` on the first warning instead of returning a partial result. |
| `scaling` | `Record<string, number \| string>` | — | Vendor-specific configuration; see below. |
| `detailed` | `boolean` | `false` | Return `Detailed` instead of the flat object. |

`scaling` keys in use:

| Vendor | Key | Meaning |
|---|---|---|
| Ellenex | `profile` | `'adc14'`, `'microamp'` or `'direct'`. Without it the reading is emitted on `<key>_raw`. |
| Ellenex | `range` | Full-scale range in the output unit (metres for level, kPa for pressure). Required by `adc14` and `microamp`. |
| Ellenex | `density` | Liquid density relative to water. Default 1. Also applied to V6 `level`. |
| Ellenex | `generation` | `'legacy'` or `'v6'` to override payload-shape detection. |
| Netvox | `multiplier2`, `multiplier3` | Current multipliers for phases 2 and 3 on ReportType 0x01, which cannot carry them. |

## Output shapes

### `Telemetry`

```ts
type Telemetry = Record<string, number | string | boolean>;
```

Flat. Keys come from the shared vocabulary ([naming.md](naming.md)). Numbers
are already scaled to the vocabulary's unit; states and events are strings;
`battery_low` is a boolean.

### `Detailed<T>`

```ts
interface Detailed<T = Telemetry> {
  telemetry: T;
  units: Partial<Record<keyof T, Unit>>;
  history: Array<{ ts: string } & Partial<T>>;
  attributes: Record<string, string | number | boolean>;
  warnings: Warning[];
}
```

- `units`: one entry per numeric key in `telemetry`; states and events are
  absent. Unit strings are the values of the `Unit` constant (`'°C'`, `'mm'`,
  `'kPa'`, `'V'`, `'raw'`, …).
- `history`: buffered records the device replayed, one per distinct device
  timestamp (ISO-8601), oldest first. Never merged into `telemetry`.
- `attributes`: device metadata such as `firmware_version`, `serial_number`,
  `current_multiplier`, `header`, `external_sensor`. Keys are vendor-specific
  and not part of the vocabulary.
- `warnings`: see below. Empty on a clean decode.

### `Warning`

```ts
interface Warning {
  code: WarningCode;
  message: string;
  offset?: number;   // byte offset, when meaningful
  channel?: string;  // vendor channel id, e.g. Milesight '03/67'
}
```

| `code` | Meaning |
|---|---|
| `unknown_channel` | A channel or key the model's table does not have. On Milesight the rest of the frame is dropped (no length field). |
| `truncated_payload` | Frame ended mid-field, or has the wrong fixed length. |
| `unscaled_value` | The reading is a raw count; its engineering conversion is configured out of band. |
| `undocumented_field` | Bytes nobody has documented changed value, or an unimplemented sub-format. |
| `sensor_fault` | Device reported a sentinel: probe absent, sensor warming up, hardware error. |
| `vendor_quirk` | Known inconsistency in the vendor's own decoder, or fPort mismatch, or DeviceType mismatch. |
| `duplicate_key` | Two live readings with the same key in one frame; the last value was kept. |

### `DecodeError`

Thrown when nothing usable can be produced. `error.code` is one of:

| `code` | When |
|---|---|
| `unknown_model` | No decoder for that vendor/model. `context.suggestion` may hold a did-you-mean. |
| `empty_payload` | Zero bytes after parsing. |
| `bad_hex` | Odd digit count or non-hex characters. |
| `bad_payload` | Invalid base64. |
| `payload_too_short` | Frame shorter than the vendor's fixed header. |
| `out_of_bounds` | A read ran past the end of the frame. `context.offset` says where. |
| `unsupported_report` | Unknown Netvox ReportType, Ellenex V6 top level not a map, a scaling profile missing its `range`, or any warning under `strict: true`. |

## Introspection

### `isModel(vendor, name)`

`true` when `decode(vendor, name, …)` would find a decoder. Same
normalization. Never throws.

### `models(vendor?)`

Returns `ModelInfo[]`, sorted by vendor then model, optionally filtered by
vendor (case-insensitive).

```ts
interface ModelInfo {
  vendor: string;        // 'Milesight'
  name: string;          // 'EM310-TILT'  — pass this (or any spelling) to decode()
  accessor: string;      // 'em310_tilt'  — property on the vendor namespace
  aliases: string[];
  fPort?: number;
  description: string;
  keys: Record<string, Unit | null>;   // every key it can emit; null = state/event
}
```

### `VOCABULARY`

`Record<string, Unit | null>`: the full key-to-unit table. `KEY_PATTERN` is
the regex every key satisfies.

### `Unit`

Constant object of unit strings: `Unit.CELSIUS` is `'°C'`, `Unit.MILLIMETRE`
is `'mm'`, and so on. Also exported as a type.

## Per-vendor subpaths

```ts
import { milesight } from 'lorawan-decoders/milesight';
import { netvox } from 'lorawan-decoders/netvox';
import { ellenex } from 'lorawan-decoders/ellenex';
import { dragino } from 'lorawan-decoders/dragino';
```

Each exports only that vendor's namespace, its model definitions
(`MILESIGHT_MODELS` etc.) and its telemetry types. Use these when bundle size
matters and you know which vendors you have.

## Per-model telemetry types

Exported for callers who want to annotate their own code:

- Milesight: inferred from each channel map; use `ReturnType<typeof milesight.em310_tilt>`.
- Netvox: `SinglePhaseTelemetry`, `ThreePhaseTelemetry`, `LightSinglePhaseTelemetry`, `LightThreePhaseTelemetry`, `CurrentInterfaceTelemetry`.
- Ellenex: `EllenexTelemetry` (one type for the whole line; the V6 map is self-describing), `EllenexScaling`, `ScalingProfile`.
- Dragino: `Lht65Telemetry`.

## Advanced

These are exported for building on top of the library, not for everyday use.

- `registry`: the preloaded `DecoderRegistry`. `registry.list()` returns every
  `ModelDefinition`; `registry.resolve(vendor, model)` returns one or
  `undefined`.
- `DecoderRegistry`, `namespace(defs)`, `accessor(def)`: build a registry or
  namespace from your own `ModelDefinition`s. Registration checks every
  declared key against `VOCABULARY` and throws on a mismatch.
- `ByteReader`, `parseHex`, `parseBase64`, `toBytes`, `toHex`, `round`:
  the byte-level helpers the decoders use. See
  [adding-a-decoder.md](adding-a-decoder.md).
- `MILESIGHT_MODELS`, `NETVOX_MODELS`, `ELLENEX_MODELS`, `DRAGINO_MODELS`:
  the definition arrays.

## CLI

```
lorawan-decode --vendor <name> --model <model> --hex <payload> [options]
lorawan-decode --vendor <name> --model <model> --base64 <payload> [options]
lorawan-decode --list [vendor]
```

| Flag | Meaning |
|---|---|
| `-v`, `--vendor` | `milesight`, `netvox`, `ellenex`, `dragino` |
| `-m`, `--model` | Any spelling of the model name |
| `-x`, `--hex` | Payload as hex; separators allowed |
| `-b`, `--base64` | Payload as base64 |
| `-p`, `--fport` | fPort |
| `--scaling` | JSON object, e.g. `'{"profile":"adc14","range":10}'` |
| `--strict` | Warnings become errors (exit 1) |
| `--json` | Print the `Detailed` shape as JSON |
| `--list [vendor]` | List models with their accessor names |

Exit codes: 0 decoded, 1 decode error, 2 usage error. Warnings go to stderr.
