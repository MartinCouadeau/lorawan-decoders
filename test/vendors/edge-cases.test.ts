import { describe, expect, it } from 'vitest';
import { run, valueOf } from '../helpers.js';
import { registry } from '../../src/index.js';
import { ByteReader, parseHex } from '../../src/core/reader.js';

describe('Netvox version reports and unsupported types', () => {
  const cases = [
    ['R718N3', '4a'], ['R718NL1', '98'], ['R718NL3', '99'], ['R718N360', 'ca'],
  ] as const;

  it.each(cases)('%s decodes ReportType 0x00', (model, deviceType) => {
    const uplink = run('Netvox', model, `01${deviceType}00` + '0A' + '01' + '20201224' + '0000');
    expect(uplink.attributes['software_version']).toBe('v1');
    expect(uplink.attributes['hardware_version']).toBe('v1');
    expect(uplink.attributes['date_code']).toBe('20201224');
  });

  it.each(cases)('%s rejects an unknown ReportType', (model, deviceType) => {
    expect(() => run('Netvox', model, `01${deviceType}FE` + '00'.repeat(8))).toThrow(/ReportType/);
  });

  it('R718NL3 scales phase 1 and warns for the other two on ReportType 0x01', () => {
    const uplink = run('Netvox', 'R718NL3', '019901 24 0064 0064 0064 0A');
    expect(valueOf(uplink, 'current_1')).toBe(1000);
    expect(uplink.warnings.filter((w) => w.code === 'unscaled_value')).toHaveLength(2);
  });

  it('treats a zero multiplier byte as 1 rather than zeroing the reading', () => {
    // A device that has not been configured sends 0x00 here. Multiplying by it
    // would report 0 A on a live circuit, which reads as a dead sensor.
    expect(valueOf(run('Netvox', 'R718N1', '01490124 0E15 00 00 00000000'), 'current')).toBe(3605);
  });

  it('rejects a frame too short to hold even a header', () => {
    expect(() => run('Netvox', 'R718N1', '0149')).toThrow(/11 bytes/);
  });
});

describe('Milesight enum and alarm edge cases', () => {
  it('labels an unrecognised enum value instead of returning undefined', () => {
    expect(valueOf(run('Milesight', 'EM400-TLD', '050009'), 'position')).toBe('unknown(9)');
  });

  it('labels an unrecognised alarm code on both EM400 alarm channels', () => {
    expect(valueOf(run('Milesight', 'EM400-TLD', '8367010109'), 'temperature_alarm')).toBe('unknown(9)');
    expect(valueOf(run('Milesight', 'EM400-TLD', '8482440809'), 'distance_alarm')).toBe('unknown(9)');
  });

  it('labels an unrecognised EM500-UDL alarm code', () => {
    expect(valueOf(run('Milesight', 'EM500-UDL', '83e9 6400 0a00 09'), 'distance_alarm')).toBe('unknown(9)');
  });

  it('labels unrecognised WS302 weighting codes', () => {
    const uplink = run('Milesight', 'WS302', '055B0F3F02DA016A02');
    expect(uplink.attributes['frequency_weighting']).toBe('unknown(3)');
    expect(uplink.attributes['time_weighting']).toBe('unknown(3)');
  });

  it('warns about a trailing byte too short to be a channel header', () => {
    const uplink = run('Milesight', 'WS303', '017564' + 'aa');
    expect(valueOf(uplink, 'battery')).toBe(100);
    expect(uplink.warnings.some((w) => w.code === 'truncated_payload')).toBe(true);
  });

  it('decodes the GS301 sensor id string channel', () => {
    const id = 'A'.repeat(43);
    const hex = [...id].map((c) => c.charCodeAt(0).toString(16)).join('');
    expect(run('Milesight', 'GS301', 'ff7c' + hex).attributes['sensor_id']).toBe(id);
  });

  it('labels an unknown GS301 calibration sensor and failure result', () => {
    const uplink = run('Milesight', 'GS301', '07ea' + '09' + '00' + '6400' + '02');
    expect(uplink.attributes['calibration_sensor']).toBe('unknown(9)');
    expect(uplink.attributes['calibration_type']).toBe('factory');
    expect(valueOf(uplink, 'calibration_result')).toBe('i2c_communication_error');
  });

  it('routes VS132-P to the VS132 decoder', () => {
    expect(registry.resolve('Milesight', 'VS132-P')?.model).toBe('VS132');
  });

  it('keeps the last value and warns when a live key repeats in one frame', () => {
    const uplink = run('Milesight', 'WS303', '017564' + '017565');
    expect(uplink.telemetry).toEqual({ battery: 101 });
    expect(uplink.warnings.map((w) => w.code)).toEqual(['duplicate_key']);
  });
});

describe('Ellenex scaling and generation edge cases', () => {
  it('demands a range for the microamp profile too', () => {
    expect(() => run('Ellenex', 'PLS2-L', '01E80000D6000022', { scaling: { profile: 'microamp' } }))
      .toThrow(/range/);
  });

  it('applies the direct profile with density only', () => {
    const uplink = run('Ellenex', 'PLS2-L', '01E80000D6000022', {
      scaling: { profile: 'direct', density: 2 },
    });
    expect(valueOf(uplink, 'level')).toBe(107); // 214 / 2
  });

  it('can be forced to the legacy layout when the bytes look like CBOR', () => {
    const uplink = run('Ellenex', 'PTS2-L', 'A1E80000D6000022', { scaling: { generation: 'legacy' } });
    expect(valueOf(uplink, 'battery_voltage')).toBe(3.4);
  });

  it('rejects a V6 payload whose top level is not a map', () => {
    expect(() => run('Ellenex', 'PTS2-L', '01', { scaling: { generation: 'v6' } }))
      .toThrow(/not a CBOR map/);
  });

  it('skips a known V6 key carrying a non-numeric value, with a warning', () => {
    // {"T": "hot"}
    const uplink = run('Ellenex', 'PTD2-L', 'A1' + '6154' + '63686f74');
    expect(uplink.telemetry).toEqual({});
    expect(uplink.warnings.some((w) => w.code === 'undocumented_field')).toBe(true);
  });

  it('applies density to a V6 level reading', () => {
    // {"L": 2.0} as a half float, density 2 -> 1.0
    const uplink = run('Ellenex', 'PLS2-L', 'A1' + '614C' + 'F94000', { scaling: { density: 2 } });
    expect(valueOf(uplink, 'level')).toBe(1);
  });

  it('decodes a closed dry contact', () => {
    expect(valueOf(run('Ellenex', 'RS1-L', 'A1' + '624443' + '00'), 'dry_contact')).toBe('closed');
  });

  it('decodes the pulse counter and numbered 4-20 mA channels', () => {
    // {"Pu": 42, "mA1": 12000, "mA2": 8000}
    const uplink = run('Ellenex', 'RS1-L', 'A3' + '62507518 2A' + '636D413119 2EE0' + '636D413219 1F40');
    expect(uplink.telemetry).toEqual({ pulse_count: 42, current_1: 12, current_2: 8 });
  });

  it('reports the RS1-L primary input as a raw sensor reading', () => {
    expect(run('Ellenex', 'RS1-L', '01E80000D6000022').telemetry).toMatchObject({ sensor_reading: 214 });
  });
});

describe('ByteReader navigation', () => {
  it('supports peek, skip, seek and hasAtLeast without consuming twice', () => {
    const r = new ByteReader(parseHex('0102030405'));
    expect(r.length).toBe(5);
    expect(r.hasAtLeast(5)).toBe(true);
    expect(r.hasAtLeast(6)).toBe(false);
    expect([...r.peek(2)]).toEqual([1, 2]);
    expect(r.offset).toBe(0);
    r.skip(2);
    expect(r.offset).toBe(2);
    expect(r.hex(2)).toBe('0304');
    r.seek(1); // backwards
    expect(r.u8()).toBe(2);
    r.seek(r.length);
    expect(r.remaining).toBe(0);
  });

  it('refuses to seek or skip past the end', () => {
    const r = new ByteReader(parseHex('0102'));
    expect(() => r.skip(3)).toThrow(/ended early/);
    expect(() => r.seek(9)).toThrow(/cannot seek to offset 9/);
    expect(() => r.seek(-1)).toThrow(/cannot seek to offset -1/);
  });
});
