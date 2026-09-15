# Adding a decoder

Two shapes, depending on the vendor. Either way, every key you emit must be in
the vocabulary ([naming.md](naming.md), source of truth
`src/core/vocabulary.ts`). Add the row there first if the quantity is new.

## A Milesight model is a table

Milesight devices share one TLV engine, so a new model is a channel map plus a
registry entry. No parsing loop. The model's telemetry type and its declared
`keys` are both derived from the map.

```ts
// src/vendors/milesight/models.ts
const EM320_TH = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
};

export const MILESIGHT_MODELS = [
  // …
  model('EM320-TH', 'Temperature and humidity sensor', EM320_TH, { aliases: ['EM320TH'] }),
] as const;
```

The builders in `channels.ts` cover most channels:

| Builder | For |
|---|---|
| `numeric({ key, type, unit, divisor, decimals, sentinels })` | a single scalar |
| `enumState(key, { 0: 'normal', 1: 'alarm' })` | a status byte, emitted as a string |
| `struct<T>(length, keys, (r, emit) => …)` | multi-field channels; `keys` declares what `read` emits |
| `history<T>(length, keys, (r, emit) => …)` | buffered records with a leading timestamp; readings go to `history` |
| `attribute(length, key, format)` | device metadata; goes to `attributes`, never telemetry |

`length` is the data length **excluding** the two header bytes, and it must
match what the reader consumes. The engine asserts this and throws a decoder-bug
error rather than letting a wrong length silently desynchronise everything after
it.

## Other vendors are a function

```ts
export interface XTelemetry {
  temperature?: number;
  battery_voltage?: number;
}

function decodeX(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const r = new ByteReader(bytes);
  return {
    readings: [
      { key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16be() / 10, 1) },
      { key: 'battery_voltage', unit: Unit.VOLT, value: round(r.u8() / 10, 1) },
    ],
    attributes: {},
  };
}

const X1: ModelDefinition<XTelemetry, 'X1' | 'X-1'> = {
  vendor: 'Acme', model: 'X1', aliases: ['X-1'], fPort: 2, source: '…', description: '…',
  keys: { temperature: Unit.CELSIUS, battery_voltage: Unit.VOLT },
  decode: decodeX,
};
```

A reading is `{ key, value, unit?, at? }`. Set `at` (ISO-8601) on buffered
records so they land in `history`. Use `ctx.warn(...)` for anything recoverable.
Always use `ByteReader` rather than indexing the array: it bounds-checks and
throws with the byte offset.

The second type parameter is the union of every name the model answers to, as
literal types. That is what makes `acme.x1` and `acme.x_1` autocomplete.

## Rules

**1. Every key is in the vocabulary, with the vocabulary's unit.** The registry
refuses to load a definition that disagrees, and the test helper checks every
emitted reading. If a quantity arrives in a different unit than the vocabulary
says, convert it (Ellenex bar → kPa) or give it its own key (`tvoc_index`).

**2. Never put an unscaled count on an engineering key.** If the conversion is
supplied out of band, emit `<key>_raw` with `Unit.RAW` and an `unscaled_value`
warning. A number with a confidently wrong unit is worse than a number labelled
raw.

**3. Every model needs a `source`.** Name the documentation the format came
from. It is printed in the generated device table, and it is what lets the next
person check your work.

**4. Never copy vendor code.** Read the documented format and implement it.
Milesight's decoders are GPL-3.0; Ellenex's have no licence at all. See
[NOTICE.md](../NOTICE.md).

**5. Every model needs a test using a payload from that documentation**, with
the values the vendor says it decodes to:

```ts
it('decodes the vendor worked example', () => {
  expect(run('Milesight', 'EM320-TH', '01755C03673401046865').telemetry)
    .toEqual({ battery: 92, temperature: 30.8, humidity: 50.5 });
});
```

`run()` in `test/helpers.ts` returns the detailed shape and asserts vocabulary
conformance on the way out. If the vendor publishes no example, say so in the
test name and in [vendor-quirks.md](vendor-quirks.md).

**6. Warn, do not throw, on recoverable problems.** In production, six good
readings plus a warning beats an exception that drops the whole uplink. Callers
who disagree pass `strict: true`.

**7. Metadata is an attribute, not telemetry.** Firmware versions, serial
numbers, multipliers, undocumented header bytes: `emit.attribute(...)` or the
`attributes` field of the result.

**8. Regenerate the docs** with `npm run docs` and commit them.

## Checklist

```bash
npm run typecheck   # strict, with noUncheckedIndexedAccess
npm test
npm run coverage    # thresholds: 95% lines, 88% branches
npm run docs        # regenerate docs/supported-devices.md and docs/naming.md
```
