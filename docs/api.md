# API reference

Examples with real outputs: [examples.md](examples.md).

## Decoding

### Vendor namespaces

```ts
import { milesight, netvox, ellenex, dragino } from 'lorawan-decoders';
```

Frozen objects, one function per model name and alias. Property = name
lowercased, separator runs (`-`, `_`, space, `.`, `(`, `)`) → `_`.

| Model | Accessor |
|---|---|
| `EM310-TILT` | `milesight.em310_tilt` |
| `VS132-P` (alias of VS132) | `milesight.vs132_p` |
| `R718N1100E` (alias of R718N1) | `netvox.r718n1100e` |
| `PLS2-L` | `ellenex.pls2_l` |
| `LHT65N` (alias of LHT65) | `dragino.lht65n` |

```ts
interface ModelDecoder<T> {
  (payload: Payload, options?: Options & { detailed?: false }): T;
  (payload: Payload, options: Options & { detailed: true }): Detailed<T>;
  readonly definition: ModelDefinition<T>;
}
```

`T` is the model's telemetry type. All properties optional.

### `decode(vendor, model, payload, options?)`

```ts
decode('milesight', 'EM310-TILT', payload);                     // Telemetry
decode('milesight', 'EM310-TILT', payload, { detailed: true }); // Detailed
```

Vendor and model compared lowercased with separators stripped. Returns
`Telemetry` (not model-typed). Unknown name → `DecodeError`
`unknown_model`; `context.suggestion` holds the closest name (edit distance
≤ 3, same vendor first).

### `Payload`

```ts
type Payload = string | Uint8Array | number[];
```

String = hex unless `encoding: 'base64'`. Hex accepts spaces, `:`, `,`, `-`,
`_`, `0x`. Base64 must be a multiple of 4 in the standard alphabet; else
`bad_payload`.

### `Options`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `encoding` | `'hex' \| 'base64'` | `'hex'` | String payload format |
| `fPort` | `number` | — | Warns `vendor_quirk` if it differs from the documented port |
| `strict` | `boolean` | `false` | Throw on first warning |
| `scaling` | `Record<string, number \| string>` | — | Vendor options, below |
| `detailed` | `boolean` | `false` | Return `Detailed` |

`scaling` keys:

| Vendor | Key | Meaning |
|---|---|---|
| Ellenex | `profile` | Opt-in ADC conversion: `'adc14'`, `'microamp'`, `'direct'`. Not needed for the standard pressure/level models. |
| Ellenex | `range` | Full-scale range in the output unit (m or kPa). Required by `adc14`, `microamp`. |
| Ellenex | `density` | Relative to water, default 1. Also applied to V6 `level`. |
| Ellenex | `generation` | `'legacy'` or `'v6'`, overrides detection. |
| Netvox | `multiplier2`, `multiplier3` | Phase 2/3 multipliers for ReportType 0x01. |

## Output

### `Telemetry`

```ts
type Telemetry = Record<string, number | string | boolean>;
```

Keys from [naming.md](naming.md), values in the vocabulary unit.

### `Detailed<T>`

```ts
interface Detailed<T = Telemetry> {
  telemetry: T;
  units: Partial<Record<keyof T, Unit>>;      // numeric keys only
  history: Array<{ ts: string } & Partial<T>>; // one per device timestamp, oldest first
  attributes: Record<string, string | number | boolean>;
  warnings: Warning[];
}
```

`attributes` keys are vendor-specific (`firmware_version`, `serial_number`,
`current_multiplier`, `header`, `external_sensor`).

### `Warning`

```ts
interface Warning { code: WarningCode; message: string; offset?: number; channel?: string }
```

| `code` | Meaning |
|---|---|
| `unknown_channel` | Channel/key not in the model's table. Milesight: rest of frame dropped. |
| `truncated_payload` | Frame ended mid-field or has the wrong fixed length. |
| `unscaled_value` | Raw count; conversion configured out of band. |
| `undocumented_field` | Undocumented bytes changed, or unimplemented sub-format. |
| `sensor_fault` | Sentinel: probe absent, warming up, hardware error. |
| `vendor_quirk` | Known vendor-decoder inconsistency, fPort or DeviceType mismatch. |
| `duplicate_key` | Live key repeated in one frame; last value kept. |

### `DecodeError`

`error.code`:

| `code` | When |
|---|---|
| `unknown_model` | No decoder. `context.suggestion` may be set. |
| `empty_payload` | Zero bytes. |
| `bad_hex` | Odd length or non-hex characters. |
| `bad_payload` | Invalid base64. |
| `payload_too_short` | Shorter than the vendor's fixed header. |
| `out_of_bounds` | Read past end. `context.offset`. |
| `unsupported_report` | Unknown Netvox ReportType, V6 not a map, profile without `range`, or any warning under `strict`. |

## Introspection

### `isModel(vendor, name)` → `boolean`

Same normalization as `decode`. Never throws.

### `models(vendor?)` → `ModelInfo[]`

```ts
interface ModelInfo {
  vendor: string;        // 'Milesight'
  name: string;          // 'EM310-TILT'
  accessor: string;      // 'em310_tilt'
  aliases: string[];
  fPort?: number;
  description: string;
  keys: Record<string, Unit | null>;   // null = state/event
}
```

### `VOCABULARY`, `KEY_PATTERN`, `Unit`

Key → unit table; key regex; unit string constants (`Unit.CELSIUS` = `'°C'`).

## Subpaths

```ts
import { milesight } from 'lorawan-decoders/milesight';
import { netvox } from 'lorawan-decoders/netvox';
import { ellenex } from 'lorawan-decoders/ellenex';
import { dragino } from 'lorawan-decoders/dragino';
```

Each exports the namespace, `<VENDOR>_MODELS` and that vendor's telemetry
types.

## Telemetry types

- Milesight: `ReturnType<typeof milesight.em310_tilt>`.
- Netvox: `SinglePhaseTelemetry`, `ThreePhaseTelemetry`, `LightSinglePhaseTelemetry`, `LightThreePhaseTelemetry`, `CurrentInterfaceTelemetry`.
- Ellenex: `EllenexTelemetry`, `EllenexScaling`, `ScalingProfile`.
- Dragino: `Lht65Telemetry`.

## Advanced exports

- `registry`: preloaded `DecoderRegistry`. `list()`, `resolve(vendor, model)`.
- `DecoderRegistry`, `namespace(defs)`, `accessor(def)`: build your own from `ModelDefinition`s. Registration validates keys against `VOCABULARY`.
- `ByteReader`, `parseHex`, `parseBase64`, `toBytes`, `toHex`, `round`.
- `MILESIGHT_MODELS`, `NETVOX_MODELS`, `ELLENEX_MODELS`, `DRAGINO_MODELS`.

## CLI

```
lorawan-decode -v <vendor> -m <model> -x <hex> [options]
lorawan-decode -v <vendor> -m <model> -b <base64> [options]
lorawan-decode --list [vendor]
```

| Flag | Meaning |
|---|---|
| `-v`, `--vendor` | `milesight`, `netvox`, `ellenex`, `dragino` |
| `-m`, `--model` | Any spelling |
| `-x`, `--hex` / `-b`, `--base64` | Payload |
| `-p`, `--fport` | fPort |
| `--scaling` | JSON, e.g. `'{"profile":"adc14","range":10}'` |
| `--strict` | Warnings → exit 1 |
| `--json` | Print `Detailed` |
| `--list [vendor]` | Models and accessors |

Exit: 0 ok, 1 decode error, 2 usage. Warnings on stderr.
