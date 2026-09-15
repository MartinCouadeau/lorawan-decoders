import { describe, expect, it } from 'vitest';
import { run, unitOf, valueOf } from '../helpers.js';
import { dragino } from '../../src/index.js';

/**
 * Payloads follow the byte layout in Dragino's LHT65 user manual:
 *   0-1 battery (status in bits 15-14, mV in bits 13-0)
 *   2-3 SHT temperature int16 BE /100     4-5 SHT humidity uint16 BE /10
 *   6   external sensor type (bit 7 = configured but disconnected)
 *   7-8 DS18B20 temperature int16 BE /100 (0x7FFF = absent)
 */
describe('Dragino LHT65', () => {
  const uplink = run('Dragino', 'LHT65', 'CBF6 0B0D 0225 01 09C4 7FFF', { fPort: 2 });

  it('decodes battery, internal temperature, humidity and the DS18B20 probe', () => {
    expect(uplink.telemetry).toEqual({
      battery_voltage: 3.062, battery_status: 'good', temperature: 28.29, humidity: 54.9,
      temperature_external: 25,
    });
    expect(uplink.attributes).toEqual({ external_sensor: 'ds18b20' });
    expect(uplink.warnings).toEqual([]);
  });

  it('reports units per key', () => {
    expect(unitOf(uplink, 'battery_voltage')).toBe('V');
    expect(unitOf(uplink, 'temperature_external')).toBe('°C');
    expect(unitOf(uplink, 'battery_status')).toBeUndefined();
  });

  it('is typed through the namespace', () => {
    const t = dragino.lht65('CBF60B0D02250109C47FFF');
    expect(t.temperature_external).toBe(25);
    expect(dragino.lht65n('CBF60B0D02250109C47FFF')).toEqual(t);
  });

  it('masks the battery status bits out of the voltage', () => {
    // 0x4BF6: status 01 (low), same 3062 mV.
    const low = run('Dragino', 'LHT65', '4BF60B0D0225007FFF7FFF');
    expect(valueOf(low, 'battery_voltage')).toBe(3.062);
    expect(valueOf(low, 'battery_status')).toBe('low');
  });

  it('decodes negative internal temperatures', () => {
    expect(valueOf(run('Dragino', 'LHT65', 'CBF6FF9C02250009C47FFF'), 'temperature')).toBe(-1);
  });

  it('omits the external reading when no probe is configured', () => {
    const none = run('Dragino', 'LHT65', 'CBF60B0D0225007FFF7FFF');
    expect(none.telemetry).not.toHaveProperty('temperature_external');
    expect(none.attributes['external_sensor']).toBe('none');
  });

  it('warns when the probe is configured but disconnected, and does not emit 0x7FFF as a reading', () => {
    const off = run('Dragino', 'LHT65', 'CBF60B0D0225817FFF7FFF');
    expect(off.telemetry).not.toHaveProperty('temperature_external');
    expect(off.warnings.map((w) => w.code)).toEqual(['sensor_fault']);
    expect(off.warnings[0]!.message).toContain('not connected');
  });

  it('warns when the probe type is set but the value is the absent sentinel', () => {
    const absent = run('Dragino', 'LHT65', 'CBF60B0D0225017FFF7FFF');
    expect(absent.telemetry).not.toHaveProperty('temperature_external');
    expect(absent.warnings[0]!.message).toContain('0x7FFF');
  });

  it('decodes the other documented external sensor types onto vocabulary keys', () => {
    expect(valueOf(run('Dragino', 'LHT65', 'CBF60B0D0225 04 01 01 0000'), 'input_level')).toBe('high');
    expect(valueOf(run('Dragino', 'LHT65', 'CBF60B0D0225 04 00 01 0000'), 'interrupt')).toBe('triggered');
    expect(valueOf(run('Dragino', 'LHT65', 'CBF60B0D0225 05 03E8 0000'), 'illuminance')).toBe(1000);
    expect(valueOf(run('Dragino', 'LHT65', 'CBF60B0D0225 06 0CE4 0000'), 'input_voltage')).toBe(3.3);
    expect(valueOf(run('Dragino', 'LHT65', 'CBF60B0D0225 07 0102 0000'), 'pulse_count')).toBe(258);
    expect(valueOf(run('Dragino', 'LHT65', 'CBF60B0D0225 08 00010203'), 'pulse_count')).toBe(0x00010203);
  });

  it('leaves an unknown external type raw in attributes and warns', () => {
    const odd = run('Dragino', 'LHT65', 'CBF60B0D0225 0A DEADBEEF');
    expect(odd.attributes).toEqual({ external_sensor: 'unknown(0xa)', external_raw: 'deadbeef' });
    expect(odd.warnings[0]!.code).toBe('undocumented_field');
  });

  it('warns on a wrong-length frame but still decodes what is there', () => {
    const short = run('Dragino', 'LHT65', 'CBF60B0D0225');
    expect(valueOf(short, 'humidity')).toBe(54.9);
    expect(short.warnings[0]!.code).toBe('truncated_payload');
    const headerOnly = run('Dragino', 'LHT65', 'CBF60B0D022501');
    expect(headerOnly.attributes['external_sensor']).toBe('ds18b20');
    expect(headerOnly.telemetry).not.toHaveProperty('temperature_external');
  });

  it('warns when the uplink arrives on a port other than 2', () => {
    const wrong = run('Dragino', 'LHT65', 'CBF60B0D0225007FFF7FFF', { fPort: 5 });
    expect(wrong.warnings.some((w) => w.message.includes('fPort'))).toBe(true);
  });
});
