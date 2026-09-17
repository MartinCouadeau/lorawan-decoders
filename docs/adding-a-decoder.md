# Adding a decoder

Every emitted key must be in `src/core/vocabulary.ts` with that unit
([naming.md](naming.md)). Add the row first if the quantity is new.

## Milesight: a channel map

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

Telemetry type and `keys` are derived from the map. Builders in `channels.ts`:

| Builder | Use |
|---|---|
| `numeric({ key, type, unit, divisor, decimals, sentinels })` | one scalar |
| `enumState(key, { 0: 'normal', 1: 'alarm' })` | status byte → string |
| `struct<T>(length, keys, (r, emit) => …)` | multi-field; `keys` declares what `read` emits |
| `history<T>(length, keys, (r, emit) => …)` | uint32 timestamp + fields → `history` |
| `attribute(length, key, format)` | metadata → `attributes` |

`length` = data bytes after the 2-byte header. The engine throws if `read`
consumes a different count. When the width depends on the data, pass a
function that peeks (VS351 history: `(r) => r.peek(5)[4] === 1 ? 13 : 9`).

`sentinels` maps a wire pattern to a status label; inside `struct`/`history`
use `readNumber(r, emit, { …, sentinels })`. Shared sets are in `channels.ts`
(`EM500_SENTINELS`, `FAILED_16`, `FAILED_8`).

## Other vendors: a function

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

Reading: `{ key, value, unit?, at? }`. Set `at` (ISO-8601) on buffered
records. `ctx.warn(...)` for recoverable problems. Use `ByteReader`, not
array indexing. The second type parameter lists every name as literals; that
is what types `acme.x1` and `acme.x_1`.

## Rules

1. Keys and units from the vocabulary. Convert on the way in (bar → kPa) or
   use a distinct key (`tvoc_index`).
2. Unscaled counts go on `<key>_raw` with `Unit.RAW` and an `unscaled_value`
   warning.
3. `source` names the documentation used.
4. No vendor code copied. Milesight is GPL-3.0; Ellenex has no licence. See
   [NOTICE.md](../NOTICE.md).
5. One test per model with a vendor-published payload and the vendor's
   stated values:

   ```ts
   it('decodes the vendor worked example', () => {
     expect(run('Milesight', 'EM320-TH', '01755C03673401046865').telemetry)
       .toEqual({ battery: 92, temperature: 30.8, humidity: 50.5 });
   });
   ```

   `run()` in `test/helpers.ts` returns `Detailed` and checks every key
   against the vocabulary. No vendor example: say so in the test name and in
   [vendor-quirks.md](vendor-quirks.md).
6. Warn, do not throw, on recoverable problems. `strict: true` is the caller's
   choice.
7. Metadata → attributes, not telemetry.
8. Read the user guide, not only the payload table, for "no reading" values.
   Never emit one as a number: emit `<key>_status` instead. Fault labels
   (`collection_failed`, `not_detected`) also warn `sensor_fault`; intended
   states (`out_of_range`, `below_minimum`, `polarizing`, `tilted`,
   `not_connected`) do not. Labels are in `src/core/vocabulary.ts`.
9. `fPort` is the main uplink port; list other documented ports (datalog,
   configuration responses) in `otherFPorts` so they do not warn.
8. `npm run docs` and commit the output.

## Checklist

```bash
npm run typecheck
npm test
npm run coverage    # 95% lines, 88% branches
npm run docs
```
