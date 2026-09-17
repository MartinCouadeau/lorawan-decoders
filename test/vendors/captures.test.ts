import { describe, expect, it } from 'vitest';
import { run } from '../helpers.js';

/**
 * Uplinks captured from production devices through ThingPark (DevEUI_uplink
 * payload_hex and FPort). Expected values are what the platform's own decoders
 * reported for the same frames. These are the only hardware-verified vectors
 * in the suite.
 */
describe('field captures: Milesight', () => {
  it('EM300-SLD live and buffered frames', () => {
    expect(run('Milesight', 'EM300-SLD', '03671001046871050001', { fPort: 2 }).telemetry)
      .toEqual({ temperature: 27.2, humidity: 56.5, leakage_status: 'leak' });
    expect(run('Milesight', 'EM300-SLD', '20ce0d755b6308015700', { fPort: 2 }).history)
      .toEqual([{ ts: '2022-10-28T06:22:05.000Z', temperature: 26.4, humidity: 43.5, leakage_status: 'normal' }]);
  });

  it('AM307', () => {
    expect(run('Milesight', 'AM307', '0367ea0004688a05000106cb01077dcd04087d5e0109735127', { fPort: 85 }).telemetry).toEqual({
      temperature: 23.4, humidity: 69, pir: 'trigger', light_level: 1, co2: 1229, tvoc_index: 3.5, barometric_pressure: 1006.5,
    });
  });

  it('AM308 and AM308L, live, buffered and with battery', () => {
    expect(run('Milesight', 'AM308', '0367da0004688105000106cb03077dfb01087d64000973ab270b7d03000c7d0300017515', { fPort: 85 }).telemetry).toEqual({
      temperature: 21.8, humidity: 64.5, pir: 'trigger', light_level: 3, co2: 507, tvoc_index: 1,
      barometric_pressure: 1015.5, pm2_5: 3, pm10: 3, battery: 21,
    });
    expect(run('Milesight', 'AM308L', '0367df0004683e05000106cb03077da402087d64000973f1270b7d05000c7d050001752d', { fPort: 85 }).telemetry).toEqual({
      temperature: 22.3, humidity: 31, pir: 'trigger', light_level: 3, co2: 676, tvoc_index: 1,
      barometric_pressure: 1022.5, pm2_5: 5, pm10: 5, battery: 45,
    });
    expect(run('Milesight', 'AM308L', '20ce56991a63ff0073000000f8026400912722002600', { fPort: 85 }).history).toEqual([{
      ts: '2022-09-09T01:39:34.000Z', temperature: 25.5, humidity: 57.5, pir: 'idle', light_level: 0,
      co2: 760, tvoc_index: 1, barometric_pressure: 1012.9, pm2_5: 34, pm10: 38,
    }]);
  });

  it('AM319-HCHO', () => {
    expect(run('Milesight', 'AM319-HCHO', '0367ea0004688a05000106cb01077dcd04087d5e01097351270a7d07000b7d3b000c7d4300', { fPort: 85 }).telemetry).toEqual({
      temperature: 23.4, humidity: 69, pir: 'trigger', light_level: 1, co2: 1229, tvoc_index: 3.5,
      barometric_pressure: 1006.5, hcho: 0.07, pm2_5: 59, pm10: 67,
    });
  });

  it('AM308 downlink response channels are reported as unknown, not guessed', () => {
    const d = run('Milesight', 'AM308L', 'ff2e02ff3e00', { fPort: 85 });
    expect(d.telemetry).toEqual({});
    expect(d.warnings[0]?.code).toBe('unknown_channel');
  });

  it('CT103 total and instantaneous current', () => {
    expect(run('Milesight', 'CT103', '039707a61b000498e506', { fPort: 85 }).telemetry)
      .toEqual({ total_current: 18119.75, current: 17650 });        // platform showed 17.65 A
  });

  it('VS351 status and counter frames', () => {
    expect(run('Milesight', 'VS351', '01756403670C01', { fPort: 85 }).telemetry)
      .toEqual({ battery: 100, temperature: 26.8 });
    expect(run('Milesight', 'VS351', '04CC1200160005CC13001400', { fPort: 85 }).telemetry).toEqual({
      total_counter_in: 18, total_counter_out: 22, periodic_counter_in: 19, periodic_counter_out: 20,
    });
  });

  it('WS301', () => {
    expect(run('Milesight', 'WS301', '017564030000040001', { fPort: 2 }).telemetry)
      .toEqual({ battery: 100, magnet_status: 'close', tamper_status: 'uninstalled' });
  });
});

describe('field captures: Dragino', () => {
  it('LHT65N with a configured but absent probe', () => {
    const d = run('Dragino', 'LHT65N', 'CBA40ABB025C017FFF7FFF', { fPort: 2 });
    expect(d.telemetry).toEqual({
      battery_voltage: 2.98, battery_status: 'good', temperature: 27.47, humidity: 60.4, temperature_external_status: 'not_connected',
    });
    expect(d.warnings).toEqual([]);
  });

  it('LHT65N below zero on both sensors', () => {
    expect(run('Dragino', 'LHT65N', 'cbbdf5c6022e01f54f7fff', { fPort: 2 }).telemetry).toEqual({
      battery_voltage: 3.005, battery_status: 'good', temperature: -26.18, humidity: 55.8, temperature_external: -27.37,
    });
  });
});

describe('field captures: Ellenex', () => {
  it('V6 PLS2-L, PTS2-L and PDS2-L', () => {
    expect(run('Ellenex', 'PLS2-L', 'BF614CFA3FCEC8C86176190CF8FF', { fPort: 15 }).telemetry)
      .toEqual({ level: 1.6155, battery_voltage: 3.32 });
    expect(run('Ellenex', 'PTS2-L', 'BF6150FA3FD8A5C86176190CF4FF', { fPort: 15 }).telemetry)
      .toEqual({ pressure: 169.26, battery_voltage: 3.316 });
    expect(run('Ellenex', 'PDS2-L', 'BF624450FA3F4EAEC96176190CF8FF', { fPort: 15 }).telemetry)
      .toEqual({ differential_pressure: 80.74, battery_voltage: 3.32 });
  });

  it('legacy PTS2-L, PLS2-L and PDS2-L carry engineering units on the wire', () => {
    expect(run('Ellenex', 'PTS2-L', '0b1f000002000023', { fPort: 15 }).telemetry)
      .toEqual({ pressure: 0.2, battery_voltage: 3.5 });
    expect(run('Ellenex', 'PLS2-L', '0b1f00064f000022', { fPort: 15 }).telemetry)
      .toEqual({ level: 1.615, battery_voltage: 3.4 });
    expect(run('Ellenex', 'PDS2-L', '1d4700015c000022', { fPort: 15 }).telemetry)
      .toEqual({ differential_pressure: 34.8, battery_voltage: 3.4 });
  });

  it('legacy configuration echoes', () => {
    for (const hex of ['1dc216018021', '1d830101007822', '1d8301100100785d']) {
      const d = run('Ellenex', 'PDS2-L', hex, { fPort: 15 });
      expect(d.telemetry).toEqual({});
      expect(d.attributes['data_type']).toBeGreaterThan(0);
      expect(d.warnings[0]?.code).toBe('undocumented_field');
    }
  });
});

describe('field captures: Netvox', () => {
  it('RA02A data report with the low-battery bit set', () => {
    expect(run('Netvox', 'RA02A', '010A019F00000104000000', { fPort: 6 }).telemetry).toEqual({
      battery_voltage: 3.1, battery_low: true, fire_alarm: 'none', temperature_alarm: 'none', temperature: 26,
    });
  });

  it('RA02A configuration responses on fPort 7 carry attributes only', () => {
    const read = run('Netvox', 'RA02A', '820A0E100E100100000000', { fPort: 7 });
    expect(read.telemetry).toEqual({});
    expect(read.attributes).toEqual({ min_time: 3600, max_time: 3600, battery_change: 0.1 });
    expect(read.warnings).toEqual([]);                          // fPort 7 is documented, strict stays quiet
    expect(run('Netvox', 'RA02A', '810A000000000000000000', { fPort: 7 }).attributes).toEqual({ config_status: 'success' });
  });
});
