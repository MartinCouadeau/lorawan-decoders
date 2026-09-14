# Examples

Every output below was produced by running the code against the published
package. Payloads are vendor worked examples where the vendor publishes one.

## Decode one model you know

```ts
import { milesight } from 'lorawan-decoders';

const t = milesight.em400_tld('01755C0367010104824408050001');
```

```json
{ "battery": 92, "temperature": 25.7, "distance": 2116, "position": "tilt" }
```

`t.distance` is typed `number | undefined`; `t.humidity` does not compile.

## A three-phase meter

```ts
import { netvox } from 'lorawan-decoders/netvox';   // pulls Netvox only

netvox.r718n3('014A0324006400640064 36', { fPort: 6 });
```

```json
{ "battery_voltage": 3.6, "battery_low": false, "current_1": 1000, "current_2": 500, "current_3": 10000 }
```

Any clamp rating is the same decoder: `netvox.r718n317`, `netvox.r718n3100e`.

## A sensor whose scale is configured per device

```ts
import { ellenex } from 'lorawan-decoders';

ellenex.pls2_l('01E80000D6000022', { fPort: 15 });
```

```json
{ "level_raw": 214, "battery_voltage": 3.4 }
```

Ellenex ships the conversion with the device, not on the wire, so without it
the count is reported as `level_raw` and `level` is absent. With it:

```ts
ellenex.pls2_l('01E80000D6000022', {
  fPort: 15,
  scaling: { profile: 'adc14', range: 10, density: 0.85 },   // 10 m sensor, diesel
});
```

```json
{ "level": -1.278, "battery_voltage": 3.4 }
```

## An external probe

```ts
import { dragino } from 'lorawan-decoders';

dragino.lht65('CBF60B0D02250109C47FFF');
```

```json
{ "battery_voltage": 3.062, "battery_status": "good", "temperature": 28.29, "humidity": 54.9, "temperature_external": 25 }
```

`temperature` is the built-in sensor, `temperature_external` the DS18B20.
When the probe is configured but unplugged, `temperature_external` is absent
and `detailed` shows a `sensor_fault` warning.

## Everything the decode produced

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

The device was offline and replayed a buffered record. It arrives in `history`
with the timestamp the device recorded, never in `telemetry`. Store it at
`ts`, not at receive time, or six hours of backlog becomes a vertical line on
the chart.

## Partial decodes

```ts
milesight.ws303('017564aabb');
// { battery: 100 }

milesight.ws303('017564aabb', { detailed: true }).warnings;
// [ { code: 'unknown_channel', channel: 'aa/bb', offset: 3, message: 'unknown channel aa/bb at offset 3; …' } ]

milesight.ws303('017564aabb', { strict: true });
// throws DecodeError
```

The plain call returns what decoded and says nothing. Ask for `detailed` to
see why something is missing; pass `strict` when a partial result is worse
than none.

## Wrong model name

```ts
import { decode, isModel } from 'lorawan-decoders';

decode('milesight', 'EM310-TLT', payload);
// DecodeError: no decoder for milesight "EM310-TLT"; did you mean "EM310-TILT"?
//   error.code === 'unknown_model'
//   error.context.suggestion === 'EM310-TILT'

isModel('milesight', 'em310 tilt');   // true
isModel('milesight', 'em310-tlt');    // false
```

Spelling variants are not a problem, only different letters are:
`EM310-TILT`, `EM310TILT`, `em310_tilt` and `Em310 Tilt` all resolve.

## ChirpStack v4 HTTP integration

ChirpStack posts an uplink event with the payload in base64 and the device
profile name as a string. Point an HTTP integration at this route:

```ts
import express from 'express';
import { decode, isModel } from 'lorawan-decoders';

const app = express().use(express.json());

app.post('/uplink/chirpstack', (req, res) => {
  const { deviceInfo, data, fPort } = req.body;   // ChirpStack UplinkEvent
  const vendor = deviceInfo.tags?.vendor ?? 'milesight';
  const model = deviceInfo.deviceProfileName;      // e.g. "EM300-SLD"

  if (!isModel(vendor, model)) {
    return res.status(422).json({ error: `no decoder for ${vendor} ${model}` });
  }

  const d = decode(vendor, model, data, { encoding: 'base64', fPort, detailed: true });
  // d.telemetry  → live readings
  // d.history    → buffered readings with their own timestamps
  // d.warnings   → log these; they explain any missing key
  res.json(d);
});
```

A device profile tag named `vendor` keeps the vendor out of the model name.
Without it, hardcode the vendor per route.

## Forwarding to ThingsBoard

ThingsBoard's device HTTP API takes either a flat object or an array of
timestamped points. The flat object is exactly `telemetry`; history maps onto
the array form:

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

Firmware version, serial number and the like go to attributes, where
ThingsBoard expects device metadata, and never pollute the time series.

## The Things Stack webhook

TTN delivers `uplink_message.frm_payload` in base64 and `f_port` as a number:

```ts
app.post('/uplink/ttn', (req, res) => {
  const { end_device_ids, uplink_message } = req.body;
  const model = end_device_ids.device_id.split('-')[0];   // your naming scheme
  const t = decode('milesight', model, uplink_message.frm_payload, {
    encoding: 'base64',
    fPort: uplink_message.f_port,
  });
  res.json(t);
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

## Netvox frames that cannot carry all their scaling

A three-phase Netvox ReportType 0x01 frame holds phase 1's multiplier but not
phases 2 and 3. Those arrive in a separate ReportType 0x02 frame:

```ts
const d = netvox.r718n3('014A01240064006400640A', { detailed: true });
d.telemetry;    // { ..., current_1: 1000, current_2: 100, current_3: 100 }
d.warnings;     // two unscaled_value warnings naming current_2 and current_3
```

Cache the multipliers from the 0x02 frame per device and pass them back:

```ts
netvox.r718n3('014A01240064006400640A', { scaling: { multiplier2: 5, multiplier3: 100 } });
// { ..., current_1: 1000, current_2: 500, current_3: 10000 }      no warnings
```

## Batch-decoding a CSV of captures

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

## Building a device-profile picker

```ts
import { models } from 'lorawan-decoders';

for (const m of models('milesight')) {
  console.log(m.name, '→', Object.keys(m.keys).join(', '));
}
// AM103 → battery, temperature, humidity, light_level, co2
// AM308L → battery, temperature, humidity, pir, light_level, co2, tvoc_index, tvoc, barometric_pressure, pm2_5, pm10, buzzer_status
// …
```

`m.keys` maps each key to its unit (`null` for states), so a UI can show what
a model will produce before any uplink arrives.

## From the command line

```bash
npx lorawan-decode -v milesight -m em400-tld -x 01755C0367010104824408050001
npx lorawan-decode -v milesight -m em400-tld -b AXVcA2cBAQSCRAgFAAE=          # base64
npx lorawan-decode -v ellenex -m pls2-l -x 01E80000D6000022 -p 15 --json      # detailed shape
npx lorawan-decode -v netvox -m r718n3 -x 014A01240064006400640A --strict     # exit 1 on warnings
npx lorawan-decode --list ellenex
```
