# Examples

Outputs below were produced by running the code. Payloads are vendor
examples where the vendor publishes one.

## One model

```ts
import { milesight } from 'lorawan-decoders';

milesight.em400_tld('01755C0367010104824408050001');
```

```json
{ "battery": 92, "temperature": 25.7, "distance": 2116, "position": "tilt" }
```

## Three-phase meter

```ts
import { netvox } from 'lorawan-decoders/netvox';

netvox.r718n3('014A0324006400640064 36', { fPort: 6 });
```

```json
{ "battery_voltage": 3.6, "battery_low": false, "current_1": 1000, "current_2": 500, "current_3": 10000 }
```

Any rating: `netvox.r718n317`, `netvox.r718n3100e`.

## Ellenex, legacy and CBOR

```ts
import { ellenex } from 'lorawan-decoders';

ellenex.pls2_l('0b1f00064f000022', { fPort: 15 });            // legacy, field capture
// { level: 1.615, battery_voltage: 3.4 }

ellenex.pls2_l('BF614CFA3FCEC8C86176190CF8FF', { fPort: 15 }); // V6 CBOR, same model
// { level: 1.6155, battery_voltage: 3.32 }
```

Same keys and units from both generations. Configuration echoes on the
legacy frame land in `attributes` with a warning, never in telemetry.

## External probe (Dragino)

```ts
import { dragino } from 'lorawan-decoders';

dragino.lht65('CBF60B0D02250109C47FFF');
```

```json
{ "battery_voltage": 3.062, "battery_status": "good", "temperature": 28.29, "humidity": 54.9, "temperature_external": 25 }
```

Probe configured but unplugged: no `temperature_external`, `sensor_fault`
warning in `detailed`.

## Detailed output

```ts
milesight.em300_sld('01755C20ce00105e5f01016501', { detailed: true });
```

```json
{
  "telemetry":  { "battery": 92 },
  "units":      { "battery": "%" },
  "history": [
    { "ts": "2020-09-13T12:26:40.000Z", "temperature": 25.7, "humidity": 50.5, "leakage_status": "leak" }
  ],
  "attributes": {},
  "warnings":   []
}
```

Buffered records go to `history` with the device timestamp. Store them at
`ts`, not at receive time.

## Partial decodes

```ts
milesight.ws303('017564aabb');
// { battery: 100 }

milesight.ws303('017564aabb', { detailed: true }).warnings;
// [ { code: 'unknown_channel', channel: 'aa/bb', offset: 3, message: 'unknown channel aa/bb at offset 3; …' } ]

milesight.ws303('017564aabb', { strict: true });
// throws DecodeError
```

## Wrong model name

```ts
import { decode, isModel } from 'lorawan-decoders';

decode('milesight', 'EM310-TLT', payload);
// DecodeError: no decoder for milesight "EM310-TLT"; did you mean "EM310-TILT"?
//   error.code === 'unknown_model', error.context.suggestion === 'EM310-TILT'

isModel('milesight', 'em310 tilt');   // true
isModel('milesight', 'em310-tlt');    // false
```

## ChirpStack v4 HTTP integration

```ts
import express from 'express';
import { decode, isModel } from 'lorawan-decoders';

const app = express().use(express.json());

app.post('/uplink/chirpstack', (req, res) => {
  const { deviceInfo, data, fPort } = req.body;
  const vendor = deviceInfo.tags?.vendor ?? 'milesight';   // device profile tag
  const model = deviceInfo.deviceProfileName;               // "EM300-SLD"

  if (!isModel(vendor, model)) {
    return res.status(422).json({ error: `no decoder for ${vendor} ${model}` });
  }

  res.json(decode(vendor, model, data, { encoding: 'base64', fPort, detailed: true }));
});
```

## Forwarding to ThingsBoard

```ts
import { decode } from 'lorawan-decoders';

async function forward(token: string, vendor: string, model: string, data: string, fPort: number) {
  const d = decode(vendor, model, data, { encoding: 'base64', fPort, detailed: true });

  const points = d.history.map(({ ts, ...values }) => ({ ts: Date.parse(ts), values }));
  if (Object.keys(d.telemetry).length > 0) points.push({ ts: Date.now(), values: d.telemetry });

  await fetch(`https://thingsboard.example/api/v1/${token}/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(points),
  });

  if (Object.keys(d.attributes).length > 0) {
    await fetch(`https://thingsboard.example/api/v1/${token}/attributes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(d.attributes),
    });
  }
}
```

## ThingPark HTTP integration

ThingPark posts a `DevEUI_uplink` document. The payload is hex in
`payload_hex`; radio fields arrive as numbers or, on older releases, as
strings. The device model is not in the envelope, so map it yourself (a
`model:` tag in `CustomerData.tags`, or a DevEUI table).

```ts
app.post('/uplink/thingpark', (req, res) => {
  const up = req.body.DevEUI_uplink;
  if (!up?.payload_hex) return res.status(204).end();            // joins, acks

  const tag = (up.CustomerData?.tags ?? []).find((t: string) => t.startsWith('model:'));
  const model = tag?.slice(6) ?? lookup(up.DevEUI);              // "em300-sld"

  res.json(decode('milesight', model, up.payload_hex, { fPort: Number(up.FPort), detailed: true }));
});
```

A real EM300-SLD event, trimmed:

```json
{ "DevEUI_uplink": { "Time": "2024-12-04T19:55:56.328+00:00", "DevEUI": "A84041…",
    "FPort": 2, "payload_hex": "03671001046871050001", "LrrRSSI": -105.2, "LrrSNR": -0.75,
    "CustomerData": { "tags": ["model:em300-sld", "ct:…"] } } }
```

```json
{ "telemetry": { "temperature": 27.2, "humidity": 56.5, "leakage_status": "leak" },
  "units": { "temperature": "°C", "humidity": "%" }, "history": [], "attributes": {}, "warnings": [] }
```

## The Things Stack webhook

```ts
app.post('/uplink/ttn', (req, res) => {
  const { end_device_ids, uplink_message } = req.body;
  const model = end_device_ids.device_id.split('-')[0];
  res.json(decode('milesight', model, uplink_message.frm_payload, {
    encoding: 'base64',
    fPort: uplink_message.f_port,
  }));
});
```

## ChirpStack over MQTT

```ts
import mqtt from 'mqtt';
import { decode } from 'lorawan-decoders';

const client = mqtt.connect('mqtt://chirpstack:1883');
client.subscribe('application/+/device/+/event/up');

client.on('message', (_topic, buf) => {
  const event = JSON.parse(buf.toString());
  const t = decode('netvox', event.deviceInfo.deviceProfileName, event.data, {
    encoding: 'base64',
    fPort: event.fPort,
  });
  console.log(event.deviceInfo.devEui, t);
});
```

## Netvox multipliers

ReportType 0x01 carries multiplier 1 only; 2 and 3 arrive in ReportType 0x02.

```ts
const d = netvox.r718n3('014A01240064006400640A', { detailed: true });
d.telemetry;    // { ..., current_1: 1000, current_2: 100, current_3: 100 }
d.warnings;     // unscaled_value for current_2 and current_3

netvox.r718n3('014A01240064006400640A', { scaling: { multiplier2: 5, multiplier3: 100 } });
// { ..., current_1: 1000, current_2: 500, current_3: 10000 }
```

Cache the 0x02 values per device and pass them back.

## Batch from CSV

```ts
import { readFileSync } from 'node:fs';
import { decode } from 'lorawan-decoders';

for (const line of readFileSync('captures.csv', 'utf8').trim().split('\n').slice(1)) {
  const [vendor, model, hex, fPort] = line.split(',');
  try {
    console.log(vendor, model, decode(vendor, model, hex, { fPort: Number(fPort) }));
  } catch (e) {
    console.error(vendor, model, hex, (e as Error).message);
  }
}
```

## Device-profile picker

```ts
import { models } from 'lorawan-decoders';

for (const m of models('milesight')) console.log(m.name, '→', Object.keys(m.keys).join(', '));
// AM103 → battery, temperature, humidity, light_level, co2
// AM308L → battery, temperature, humidity, pir, light_level, co2, tvoc_index, tvoc, barometric_pressure, pm2_5, pm10, buzzer_status
```

## CLI

```bash
npx lorawan-decode -v milesight -m em400-tld -x 01755C0367010104824408050001
npx lorawan-decode -v milesight -m em400-tld -b AXVcA2cBAQSCRAgFAAE=
npx lorawan-decode -v ellenex -m pls2-l -x 01E80000D6000022 -p 15 --json
npx lorawan-decode -v netvox -m r718n3 -x 014A01240064006400640A --strict
npx lorawan-decode --list ellenex
```
