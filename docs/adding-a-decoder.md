# Adding a decoder

Two shapes, depending on the vendor.

## A Milesight model is a table

Milesight devices share one TLV engine, so a new model is a channel map plus a
registry entry. No parsing loop.

```ts
// src/vendors/milesight/models.ts
const EM320_TH: ChannelMap = {
  '01/75': battery(),
  '03/67': temperatureC(),
  '04/68': humidityPct(),
};

export const MILESIGHT_MODELS = [
  // …
  model('EM320-TH', 'Temperature and humidity sensor', EM320_TH, { aliases: ['EM320TH'] }),
];
```

The builders in `channels.ts` cover most channels:

| Builder | For |
|---|---|
| `numeric({ key, kind, type, unit, divisor, decimals, sentinels })` | a single scalar |
| `enumState(key, { 0: 'normal', 1: 'alarm' })` | a status byte |
| `struct(length, (r, emit) => …)` | multi-field channels |
| `history(length, (r, at, emit) => …)` | buffered records with a leading timestamp |
| `attribute(length, key, format)` | device metadata |

`length` is the data length **excluding** the two header bytes, and it must
match what the reader consumes. The engine asserts this and throws a decoder-bug
error rather than letting a wrong length silently desynchronise everything after
it.

## Other vendors are a function

```ts
function decodeX(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const r = new ByteReader(bytes);
  return {
    measurements: [
      { key: 'temperature', kind: 'temperature', unit: Unit.CELSIUS, value: round(r.i16be() / 10, 1) },
    ],
    attributes: {},
  };
}
```

Register it with a `ModelDefinition`. Always use `ByteReader` rather than
indexing the array: it bounds-checks and throws with the byte offset.

## Rules

**1. Every model needs a `source`.** Name the documentation the format came
from. It is printed in the generated device table, and it is what lets the next
person check your work.

**2. Never copy vendor code.** Read the documented format and implement it.
Milesight's decoders are GPL-3.0; Ellenex's have no licence at all. See
[NOTICE.md](../NOTICE.md).

**3. Every model needs a test using a payload from that documentation**, with
the values the vendor says it decodes to. Those tests are the only thing
stopping a refactor from quietly changing a scaling factor:

```ts
it('decodes the vendor worked example', () => {
  const uplink = run('Milesight', 'EM320-TH', '01755C03673401046865');
  expect(valueOf(uplink, 'temperature')).toBe(30.8);
});
```

If the vendor publishes no example, say so in the test name and in
[vendor-quirks.md](vendor-quirks.md).

**4. Do not invent units.** If a device reports a raw count whose conversion is
supplied out of band, emit `Unit.RAW` and an `unscaled_value` warning. A number
with a confidently wrong unit is worse than a number labelled unknown.

**5. Warn, do not throw, on recoverable problems.** In production, six good
readings plus a warning beats an exception that drops the whole uplink. Callers
who disagree pass `strict: true`.

**6. Prefer stable output keys.** No key that changes with device configuration.

**7. Regenerate the device table** with `npm run devices` and commit it.

## Checklist

```bash
npm run typecheck   # strict, with noUncheckedIndexedAccess
npm test
npm run coverage    # thresholds: 85% lines, 80% branches
npm run devices     # regenerate docs/supported-devices.md
```
