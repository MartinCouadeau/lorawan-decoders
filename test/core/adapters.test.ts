import { describe, expect, it } from 'vitest';
import { decode } from '../../src/index.js';
import { flatten } from '../../src/adapters/flatten.js';
import { toThingsBoard } from '../../src/adapters/thingsboard.js';
import { toChirpStack } from '../../src/adapters/chirpstack.js';
import { toTtn } from '../../src/adapters/ttn.js';

const tilt = decode({ vendor: 'Milesight', model: 'EM310-TILT', payload: '01755C03CF00000000282307' });
const withHistory = decode({
  vendor: 'Milesight', model: 'EM300-SLD',
  payload: '01755C' + '20ce' + '00105e5f' + '0101' + '65' + '00',
});

describe('flatten', () => {
  it('disambiguates indexed measurements by suffixing the index', () => {
    const { telemetry } = flatten(tilt);
    expect(telemetry['angle_x']).toBe(0);
    expect(telemetry['angle_z']).toBe(90);
    expect(telemetry['battery']).toBe(92);
  });

  it('separates buffered readings from live ones', () => {
    const { telemetry, history } = flatten(withHistory);
    expect(telemetry['battery']).toBe(92);
    expect(telemetry['temperature']).toBeUndefined();
    expect(history).toHaveLength(1);
    expect(history[0]?.values['temperature']).toBe(25.7);
  });
});

describe('ThingsBoard adapter', () => {
  it('keeps buffered readings on their own timestamps', () => {
    const tb = toThingsBoard(withHistory, { deviceName: 'sensor-1', ts: 1_700_000_000_000 });
    expect(tb.telemetry).toHaveLength(2);
    const [buffered, live] = tb.telemetry;
    expect(buffered!.ts).toBe(0x5f5e1000 * 1000);
    expect(buffered!.values['temperature']).toBe(25.7);
    expect(live!.ts).toBe(1_700_000_000_000);
    expect(live!.values['battery']).toBe(92);
  });

  it('carries vendor and model into attributes', () => {
    const tb = toThingsBoard(tilt, { deviceName: 'sensor-1' });
    expect(tb.attributes['vendor']).toBe('Milesight');
    expect(tb.deviceType).toBe('Milesight EM310-TILT');
  });

  it('can attach decode warnings while commissioning', () => {
    const unknown = decode({ vendor: 'Milesight', model: 'WS303', payload: '017564aabb' });
    const tb = toThingsBoard(unknown, { deviceName: 'x', includeWarnings: true });
    expect((tb.attributes['decode_warnings'] as string[])[0]).toContain('unknown_channel');
  });
});

describe('ChirpStack and TTN adapters', () => {
  it('ChirpStack returns a flat data object', () => {
    expect(toChirpStack(tilt).data['angle_z']).toBe(90);
  });

  it('TTN maps decode warnings onto its own warnings array', () => {
    const unknown = decode({ vendor: 'Milesight', model: 'WS303', payload: '017564aabb' });
    const out = toTtn(unknown);
    expect(out.warnings[0]).toContain('unknown channel');
    expect(out.errors).toEqual([]);
    expect(out.data['battery']).toBe(100);
  });
});
