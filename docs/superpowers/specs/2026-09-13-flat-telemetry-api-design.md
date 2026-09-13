# Flat telemetry API

Version 0.2.0. Breaking change to the public output shape; the package is not
yet published, so no migration path is needed.

## Goal

The library decodes sensor data and nothing else. A decode call returns one
flat object of readings with stable, vendor-independent key names. Everything
that is not a reading (units, buffered history, warnings, device attributes) is
available on request through a `detailed` option and is otherwise absent.

## Public API

```ts
import { decode, isModel, models, milesight, netvox, ellenex, dragino } from 'lorawan-decoders';
import { milesight } from 'lorawan-decoders/milesight'; // one vendor only, tree-shakeable

milesight.em310_tilt(payload, options?)          // Telemetry
milesight.em310_tilt(payload, { detailed: true })// Detailed
decode(vendor, model, payload, options?)         // same, dynamic strings
isModel(vendor, name)                            // boolean
models(vendor?)                                  // ModelInfo[]
```

### Namespaces

One exported object per vendor, generated from the registry at module load.
Each key is a model name or alias, normalized: lowercase, every run of
separators (`-`, `_`, space, `.`, `(`, `)`) replaced by one `_`. `EM310-TILT`
becomes `em310_tilt`; `R718N17` stays `r718n17`; `VS132-P` becomes `vs132_p`.
Alias keys point at the same function as the canonical one.

Each accessor is typed with that model's telemetry interface, so
`milesight.em400_tld(p).distance` is `number` and `.humidity` is a compile
error.

Subpath exports: `lorawan-decoders/milesight`, `/netvox`, `/ellenex`,
`/dragino`, each exporting only that vendor's namespace and `decode`-compatible
model list.

### Dynamic entry point

```ts
decode(vendor: string, model: string, payload: Payload, options?: Options): Telemetry
decode(vendor: string, model: string, payload: Payload, options: Options & { detailed: true }): Detailed
```

`vendor` and `model` are typed as the union of known literals so editors
autocomplete them, widened to `string` when a variable is passed. Lookup
normalizes both sides exactly as the registry does today: lowercase, strip
`-`, `_`, space, `.`, `(`, `)`. `EM310-TILT`, `EM310TILT`, `em310_tilt` and
`Em310 Tilt` resolve to the same decoder.

Unknown vendor or model throws `UnknownModel` (a `DecodeError` with
`code: 'unknown_model'`). The message includes the closest registered name
by Levenshtein distance over normalized names when the distance is at most 3:
`no decoder for milesight "EM400-TDL"; did you mean "EM400-TLD"?`

### Helpers

- `isModel(vendor, name): boolean`. Same normalization, no throw.
- `models(vendor?): ModelInfo[]` where
  `ModelInfo = { vendor, name, accessor, aliases, fPort?, description, keys: Record<string, Unit | null> }`.
  `keys` is the model's declared telemetry vocabulary; `null` means a
  unit-less state or event.

### Payload and options

```ts
type Payload = string | Uint8Array | number[];

interface Options {
  encoding?: 'hex' | 'base64';   // string payloads only; default 'hex'
  fPort?: number;
  strict?: boolean;              // any warning throws DecodeError
  scaling?: Record<string, number | string>;
  detailed?: boolean;
}
```

Hex strings accept the separators they do today. Base64 is decoded with
`Buffer.from(s, 'base64')` semantics; invalid input throws `bad_payload`.

## Output shapes

```ts
type Telemetry = Record<string, number | string | boolean>;

interface Detailed<T extends Telemetry = Telemetry> {
  telemetry: T;
  units: Partial<Record<keyof T, Unit>>;      // absent for states and events
  history: Array<{ ts: string } & Partial<T>>; // one entry per distinct timestamp, oldest first
  attributes: Record<string, string | number | boolean>;
  warnings: Warning[];
}

interface Warning {
  code: 'unknown_channel' | 'truncated_payload' | 'unscaled_value'
      | 'undocumented_field' | 'sensor_fault' | 'vendor_quirk' | 'duplicate_key';
  message: string;
  offset?: number;
  channel?: string;
}
```

Rules:

- Plain call returns `telemetry` only. Problems do not throw unless `strict`;
  the caller gets the readings that decoded.
- Enum states are strings (`position: "tilt"`). The raw wire code is not
  exposed.
- Buffered records (readings carrying a device timestamp) go to `history`,
  never to `telemetry`. A frame containing only history yields `telemetry: {}`.
- Device metadata (firmware and hardware versions, serial number, LoRaWAN
  class, Ellenex header bytes, Netvox multiplier, calibration data) goes to
  `attributes`, never to `telemetry`.
- Two live readings with the same key in one frame: last wins, plus a
  `duplicate_key` warning naming the key.
- `vendor`, `model`, `raw`, `fPort` are not returned. The caller passed them.

## Naming rules

Documented in `docs/naming.md` and enforced by tests.

1. Keys are `snake_case`, lowercase ASCII: `/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/`.
2. The bare name is the device's primary or built-in sensor for that quantity.
   Additional sensors of the same quantity take a `_<qualifier>` suffix:
   `_external`, `_1` `_2` `_3`, `_x` `_y` `_z`, `_in` `_out`, `_eq` `_max`,
   `_alarm_value`.
3. One key, one unit, forever. The same quantity in a different unit is a
   different key (`tvoc` in µg/m³, `tvoc_index` dimensionless).
4. A fixed cross-vendor vocabulary in `src/core/vocabulary.ts` maps every key
   to its unit or to `null` for states and events. Every decoder must emit
   keys from that table with that unit. Adding a key means adding a row.
5. States and events are strings. Booleans only for genuinely two-valued
   flags (`battery_low`).

### Renames from the current code

| Today | New key |
|---|---|
| `current` index 1..4 | `current_1` .. `current_4` |
| `current` no index | `current` |
| `channel` 1..3 (R718N360) | `current_1` .. `current_3` |
| `angle` x/y/z | `angle_x`, `angle_y`, `angle_z` |
| `angle_threshold` x/y/z | `angle_threshold_x`, `_y`, `_z` |
| `temperature` internal / external (LHT65) | `temperature`, `temperature_external` |
| `total_counter` in/out | `total_counter_in`, `total_counter_out` |
| `periodic_counter` in/out | `periodic_counter_in`, `periodic_counter_out` |
| `sound_level` current/equivalent/max | `sound_level`, `sound_level_eq`, `sound_level_max` |
| `tvoc` on `08/7d` (index) | `tvoc_index` |
| `tvoc` on `08/e6` (µg/m³) | `tvoc` |
| `distance` index alarm (EM500-UDL `83/e9`) | `distance_alarm_value` |
| `h2s` both resolutions | `h2s` |
| `*_status` enum with `code` | same key, string only |

Fixed vocabulary highlights: `battery` percent, `battery_voltage` volts,
`battery_low` boolean, `temperature` °C, `humidity` %RH, `distance` mm,
`level` m, `pressure` kPa, `co2` ppm, `illuminance` lx. The full table lives in
`vocabulary.ts` and is rendered into `docs/naming.md` by the docs script.

## Internals

- Decoders keep pushing internal readings, now shaped
  `{ key, value, unit?, at? }`. `index`, `kind`, `channel` and `code` are
  removed from the internal type. Decoders emit final keys.
- Attributes keep their own emit path (`emit.attribute`, `attributes` in
  `DecodeResult`).
- One `flatten(readings, attributes, warnings)` step in `src/core/flatten.ts`
  builds `Detailed`: readings without `at` go to `telemetry` and `units`;
  readings with `at` are grouped by timestamp into `history`, sorted
  ascending; duplicate live keys warn.
- The registry gains `resolveOrThrow` with the did-you-mean lookup, an
  `accessorName(model)` helper, and `namespace(vendor)` that builds the
  vendor object.
- `src/core/vocabulary.ts` exports `VOCABULARY: Record<string, Unit | null>`.
- Milesight channel-map builders carry their key as a type parameter so the
  model's telemetry type is inferred from the map. Function-style vendors
  (Netvox, Ellenex, Dragino) declare an explicit telemetry interface per model.
- CLI prints the flat object; `--json` prints `Detailed`.

## Removed

- `src/adapters/*` (ThingsBoard, ChirpStack, TTN) and the `./adapters/*`
  package exports. The flat object is what those platforms accept directly;
  history timestamps and units are in `Detailed` for callers who need them.
- Public types `Measurement`, `QuantityKind`, `DecodedUplink`, `DecodeRequest`.
- `createRegistry(...vendors)`; replaced by vendor subpath imports.

## Documentation

- `README.md` rewritten around the flat shape: namespace and dynamic examples,
  the `detailed` shape, model-name normalization explained with
  `EM310-TILT` / `EM310TILT` / `em310_tilt`, the `UnknownModel` did-you-mean.
- `docs/supported-devices.md` regenerated; per model: canonical name, the
  string to pass (`'em310-tilt'`), the accessor (`milesight.em310_tilt`),
  aliases, fPort, and the keys it emits with units.
- `docs/naming.md`: the five rules, the rename table above, and the
  vocabulary table generated from `vocabulary.ts`.
- `docs/adding-a-decoder.md` updated for the new internal reading shape and
  the vocabulary requirement.
- `docs/vendor-quirks.md` and `NOTICE.md` unchanged except key names.

## Testing

- Existing vendor tests rewritten to assert on the flat object and on
  `Detailed` where history, warnings or attributes matter. Same vendor
  payloads.
- New: namespace accessors resolve and are typed (`expectTypeOf`); `isModel`;
  did-you-mean; base64 with a known payload; vocabulary conformance (every key
  emitted across every test payload exists in `VOCABULARY` with a matching
  unit); history grouping by timestamp; `duplicate_key`; attributes never
  appear in telemetry; subpath imports expose one vendor.
- Coverage thresholds unchanged.

## Out of scope

Publishing to npm. Additional vendors or models.
