import { describe, expect, it } from 'vitest';
import { run, unitOf, valueOf } from '../helpers.js';
import { decodeCbor, looksLikeCbor } from '../../src/vendors/ellenex/cbor.js';
import { ellenex } from '../../src/index.js';

/**
 * Legacy vectors are the published TTN test vectors for PTS2-L and PLS2-L.
 * V6 vectors come from the Ellenex V6 codec test data.
 */
describe('Ellenex legacy 8-byte frame', () => {
  it('decodes the published negative-reading vector as a raw count', () => {
    const uplink = run('Ellenex', 'PTS2-L', '01E800FB58000022', { fPort: 15 });
    expect(uplink.telemetry).toEqual({ pressure_raw: -1192, battery_voltage: 3.4 });
  });

  it('decodes the published positive-reading vector', () => {
    expect(valueOf(run('Ellenex', 'PTS2-L', '01E80000D6000022'), 'pressure_raw')).toBe(214);
  });

  it('treats byte 7 as unsigned — 0xFF is 25.5 V, not -0.1 V', () => {
    expect(valueOf(run('Ellenex', 'PTS2-L', '01E80000D60000FF'), 'battery_voltage')).toBe(25.5);
  });

  it('treats the secondary reading as signed and reports it raw', () => {
    const uplink = run('Ellenex', 'PTD2-L', '01E80000D6FFFF22');
    expect(valueOf(uplink, 'temperature_raw')).toBe(-1);
    expect(uplink.telemetry).not.toHaveProperty('temperature');
  });

  it('never puts a raw count on the engineering key', () => {
    const uplink = run('Ellenex', 'PLS2-L', '01E80000D6000022');
    expect(uplink.telemetry).toEqual({ level_raw: 214, battery_voltage: 3.4 });
    expect(unitOf(uplink, 'level_raw')).toBe('raw');
    const warning = uplink.warnings.find((w) => w.code === 'unscaled_value');
    expect(warning?.message).toContain('raw sensor count');
  });

  it('produces real units on the engineering key once given a scaling profile', () => {
    const uplink = run('Ellenex', 'PLS2-L', '01E80000D6000022', {
      scaling: { profile: 'adc14', range: 10 },
    });
    expect(unitOf(uplink, 'level')).toBe('m');
    // (214 - 1638.3) * 10 / 13106.4 = -1.087
    expect(Number(valueOf(uplink, 'level'))).toBeCloseTo(-1.087, 3);
    expect(uplink.telemetry).not.toHaveProperty('level_raw');
    expect(uplink.warnings.some((w) => w.code === 'unscaled_value')).toBe(false);
  });

  it('applies liquid density on the microamp profile', () => {
    const water = ellenex.pls2_l('01E8002EE0000022', { scaling: { profile: 'microamp', range: 10, density: 1 } });
    const diesel = ellenex.pls2_l('01E8002EE0000022', { scaling: { profile: 'microamp', range: 10, density: 0.85 } });
    expect(diesel.level).toBeCloseTo(water.level! / 0.85, 3);
  });

  it('demands a range for profiles that need one rather than silently using zero', () => {
    expect(() => run('Ellenex', 'PLS2-L', '01E80000D6000022', { scaling: { profile: 'adc14' } }))
      .toThrow(/range/);
  });

  it('surfaces the undocumented header bytes as an attribute, not telemetry', () => {
    const uplink = run('Ellenex', 'PTS2-L', '01E80000D6000022');
    expect(uplink.attributes).toEqual({ header: '01e800' });
    expect(uplink.telemetry).not.toHaveProperty('header');
  });

  it('stays quiet on the observed header but warns when byte 0 changes', () => {
    const normal = run('Ellenex', 'PTS2-L', '01E80000D6000022');
    expect(normal.warnings.some((w) => w.code === 'undocumented_field')).toBe(false);

    const odd = run('Ellenex', 'PTS2-L', '80E80000D6000022');
    const warning = odd.warnings.find((w) => w.code === 'undocumented_field');
    expect(warning?.message).toContain('FMS2-L');
  });

  it('rejects a frame that is not 8 bytes and points at the likely cause', () => {
    expect(() => run('Ellenex', 'PTS2-L', '01E80000D60000')).toThrow(/8 bytes/);
  });
});

describe('Ellenex Version 6 (CBOR)', () => {
  // BF 61 4C FA 3F CE C8 C8 61 76 19 0C F8 FF
  const VECTOR = 'BF614CFA3FCEC8C8617619 0CF8FF';

  it('decodes the published V6 vector', () => {
    const uplink = run('Ellenex', 'PLS2-L', VECTOR);
    expect(Number(valueOf(uplink, 'level'))).toBeCloseTo(1.6155, 4);
    expect(valueOf(uplink, 'battery_voltage')).toBe(3.32);
    expect(uplink.attributes['payload_generation']).toBe('v6');
  });

  it('detects the generation from the payload shape, without being told', () => {
    expect(looksLikeCbor(Uint8Array.from([0xbf]))).toBe(true);
    expect(looksLikeCbor(Uint8Array.from([0xa2]))).toBe(true);
    expect(looksLikeCbor(Uint8Array.from([0x01]))).toBe(false);
  });

  it('does not confuse `v` (battery, mV) with `V` (input voltage, mV)', () => {
    // {"v": 3320, "V": 5000}
    const uplink = run('Ellenex', 'RS1-L', 'A2' + '6176' + '190CF8' + '6156' + '191388');
    expect(uplink.telemetry).toEqual({ battery_voltage: 3.32, input_voltage: 5 });
  });

  it('converts bar to kilopascals so pressure means the same thing as on Milesight', () => {
    // {"P": 1.5}  half float 0x3E00
    const uplink = run('Ellenex', 'PTS2-L', 'A1' + '6150' + 'F93E00');
    expect(valueOf(uplink, 'pressure')).toBe(150);
    expect(unitOf(uplink, 'pressure')).toBe('kPa');
  });

  it('converts PDT2-L differential pressure from pascals, other models from bar', () => {
    // {"DP": 1500}
    expect(run('Ellenex', 'PDT2-L', 'A1' + '624450' + '1905DC').telemetry.differential_pressure).toBe(1.5);
    expect(run('Ellenex', 'PDS2-L', 'A1' + '624450' + '02').telemetry.differential_pressure).toBe(200);
  });

  it('reports V6 distance in millimetres', () => {
    // {"D": 2.0} half float 0x4000
    expect(run('Ellenex', 'PLS2-L', 'A1' + '6144' + 'F94000').telemetry).toEqual({ distance: 2000 });
  });

  it('ignores unknown keys with a warning that carries the value', () => {
    // {"XX": 7}
    const uplink = run('Ellenex', 'PTS2-L', 'A1' + '625858' + '07');
    expect(uplink.telemetry).toEqual({});
    const warning = uplink.warnings.find((w) => w.code === 'unknown_channel');
    expect(warning?.message).toContain('"XX"');
    expect(warning?.message).toContain('7');
  });

  it('decodes dry contact as a state, not a number', () => {
    // {"DC": 1}
    expect(run('Ellenex', 'RS1-L', 'A1' + '624443' + '01').telemetry).toEqual({ dry_contact: 'open' });
  });
});

describe('CBOR reader', () => {
  it('handles half-, single- and double-precision floats', () => {
    expect(decodeCbor(Uint8Array.from([0xf9, 0x3c, 0x00]))).toBe(1);      // half 1.0
    expect(decodeCbor(Uint8Array.from([0xf9, 0xc0, 0x00]))).toBe(-2);     // half -2.0
    expect(Number(decodeCbor(Uint8Array.from([0xfa, 0x3f, 0xce, 0xc8, 0xc8])))).toBeCloseTo(1.6155, 4);
    expect(decodeCbor(Uint8Array.from([0xfb, 0x40, 0, 0, 0, 0, 0, 0, 0]))).toBe(2);
  });

  it('handles definite and indefinite maps, arrays and negatives', () => {
    expect(decodeCbor(Uint8Array.from([0xa1, 0x61, 0x61, 0x01]))).toEqual({ a: 1 });
    expect(decodeCbor(Uint8Array.from([0xbf, 0x61, 0x61, 0x01, 0xff]))).toEqual({ a: 1 });
    expect(decodeCbor(Uint8Array.from([0x82, 0x01, 0x20]))).toEqual([1, -1]);
    expect(decodeCbor(Uint8Array.from([0x9f, 0x01, 0x02, 0xff]))).toEqual([1, 2]);
  });

  it('throws on a payload that ends mid-value', () => {
    expect(() => decodeCbor(Uint8Array.from([0xf9, 0x3c]))).toThrow();
  });
});
