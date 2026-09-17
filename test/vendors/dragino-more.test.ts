import { describe, expect, it } from 'vitest';
import { run, unitOf, valueOf } from '../helpers.js';
import { dragino } from '../../src/index.js';

// Field values come from the worked examples in the Dragino manuals; frames
// that combine them are synthetic and say so.
describe('Dragino LDS02 / LWL02', () => {
  it('LDS02 decodes battery, door state, counts and duration (manual values, synthetic frame)', () => {
    const d = run('Dragino', 'LDS02', '0B88 01 000093 000025 00', { fPort: 10 });
    expect(d.telemetry).toEqual({
      battery_voltage: 2.952, magnet_status: 'close', open_count: 147, open_duration: 37, alarm: 'none',
    });
    expect(d.attributes).toEqual({ mode: 1 });
    expect(unitOf(d, 'open_duration')).toBe('min');
  });

  it('LDS02 reads the door bit and masks it out of the voltage', () => {
    const d = run('Dragino', 'LDS02', '8B88 01 000000 000000 00');
    expect(valueOf(d, 'magnet_status')).toBe('open');
    expect(valueOf(d, 'battery_voltage')).toBe(2.952);
  });

  it('LWL02 reads the leak bit and the alarm bit', () => {
    const d = run('Dragino', 'LWL02', '4B88 02 000093 000025 01');
    expect(d.telemetry).toEqual({
      battery_voltage: 2.952, leakage_status: 'leak', open_count: 147, open_duration: 37, alarm: 'alarm',
    });
    expect(dragino.lwl02('0B88').leakage_status).toBe('normal');
  });

  it('warns on a short frame and decodes what is present', () => {
    const d = run('Dragino', 'LDS02', '0B88');
    expect(d.telemetry).toEqual({ battery_voltage: 2.952, magnet_status: 'close' });
    expect(d.warnings[0]?.code).toBe('truncated_payload');
  });
});

describe('Dragino LDDS75', () => {
  it('decodes the manual values (synthetic frame)', () => {
    const d = run('Dragino', 'LDDS75', '0B45 0B05 00 0105 01', { fPort: 2 });
    expect(d.telemetry).toEqual({ battery_voltage: 2.885, distance: 2821, interrupt: 'none', temperature: 26.1 });
    expect(d.attributes).toEqual({ ultrasonic_sensor: 'detected' });
  });

  it('decodes a negative DS18B20 temperature per the manual example', () => {
    expect(valueOf(run('Dragino', 'LDDS75', '0B45 0B05 00 FF3F 01'), 'temperature')).toBe(-19.3);
  });

  it('0x0000 is a missing sensor (fault); 0x0014 is the blind zone and 0x7FFF an absent probe (states)', () => {
    const none = run('Dragino', 'LDDS75', '0B45 0000 00 7FFF 00');
    expect(none.telemetry).toEqual({
      battery_voltage: 2.885, distance_status: 'not_detected', interrupt: 'none', temperature_status: 'not_connected',
    });
    expect(none.warnings.map((w) => w.code)).toEqual(['sensor_fault']);
    expect(none.attributes['ultrasonic_sensor']).toBe('missing');

    const near = run('Dragino', 'LDDS75', '0B45 0014 01 7FFF 01');
    expect(near.telemetry).not.toHaveProperty('distance');
    expect(valueOf(near, 'distance_status')).toBe('below_minimum');
    expect(near.warnings).toEqual([]);
    expect(valueOf(near, 'interrupt')).toBe('triggered');
  });

  it('accepts the pre-1.1.4 four-byte frame', () => {
    const d = run('Dragino', 'LDDS75', '0B45 0B05');
    expect(d.telemetry).toEqual({ battery_voltage: 2.885, distance: 2821 });
    expect(d.warnings).toEqual([]);
  });
});

describe('Dragino LSE01', () => {
  it('decodes the manual values (synthetic frame)', () => {
    const d = run('Dragino', 'LSE01', '0B45 0000 05DC 0105 00C8 00', { fPort: 2 });
    expect(d.telemetry).toEqual({
      battery_voltage: 2.885, soil_moisture: 15, soil_temperature: 2.61, conductivity: 200, interrupt: 'none',
    });
    expect(d.attributes).toEqual({ reserved: '0000', mode: 0 });
  });

  it('decodes a negative soil temperature as two\'s complement', () => {
    expect(valueOf(run('Dragino', 'LSE01', '0B45 0000 05DC FF7E 00C8 01'), 'soil_temperature')).toBe(-1.3);
    expect(valueOf(run('Dragino', 'LSE01', '0B45 0000 05DC FF7E 00C8 01'), 'interrupt')).toBe('triggered');
  });
});

describe('Dragino LHT52', () => {
  it('decodes the manual example', () => {
    const d = run('Dragino', 'LHT52', '08CD 0220 7FFF 01 61CD4EDD', { fPort: 2 });
    expect(d.telemetry).toEqual({ temperature: 22.53, humidity: 54.4, temperature_external_status: 'not_connected' });
    expect(d.warnings).toEqual([]);
    expect(d.attributes).toEqual({ external_sensor: 'ds18b20', device_time: '2021-12-30T06:17:01.000Z' });
  });

  it('decodes a negative SHT temperature and an attached probe', () => {
    const d = run('Dragino', 'LHT52', 'F5C6 0220 09C4 01 61CD4EDD');
    expect(d.telemetry).toEqual({ temperature: -26.18, humidity: 54.4, temperature_external: 25 });
  });
});

describe('Dragino LSN50v2', () => {
  it('decodes MOD=1 with the manual field values (synthetic frame)', () => {
    const d = run('Dragino', 'LSN50v2', '0B45 0105 021F 00 0105 0220', { fPort: 2 });
    expect(d.telemetry).toEqual({
      battery_voltage: 2.885, temperature_external: 26.1, input_voltage: 0.543,
      interrupt: 'none', input_level: 'low', temperature: 26.1, humidity: 54.4,
    });
    expect(d.attributes).toEqual({ mode: 1, interrupt_pin: 'low' });
  });

  it('reads the byte-6 flags', () => {
    const d = run('Dragino', 'LSN50', '0B45 7FFF 0000 83 7FFF 7FFF');
    expect(d.telemetry).toEqual({
      battery_voltage: 2.885, temperature_external_status: 'not_connected', input_voltage: 0, interrupt: 'triggered', input_level: 'high',
      temperature_status: 'not_connected', humidity_status: 'not_connected',
    });
    expect(d.warnings).toEqual([]);
    expect(d.attributes['interrupt_pin']).toBe('high');
  });

  it('decodes only the battery and warns on other modes', () => {
    const d = run('Dragino', 'LSN50-V2', '0B45 0000 0000 04 0000 0000');
    expect(d.telemetry).toEqual({ battery_voltage: 2.885 });
    expect(d.attributes['mode']).toBe(2);
    expect(d.warnings[0]?.code).toBe('undocumented_field');
    expect(dragino.lsn50v2('0B45 0105 021F 00 0105 0220').temperature).toBe(26.1);
  });
});
