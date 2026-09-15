import { describe, expect, it } from 'vitest';
import { run, unitOf, valueOf } from '../helpers.js';
import { milesight } from '../../src/index.js';

// Payloads and expected values are the worked examples in the Milesight
// SensorDecoders READMEs unless the test name says otherwise.
describe('Milesight EM500 series (more)', () => {
  it('EM500-CO2 decodes the README example', () => {
    const d = run('Milesight', 'EM500-CO2', '017564 03671901 046873 057D6704 06736827');
    expect(d.telemetry).toEqual({ battery: 100, temperature: 28.1, humidity: 57.5, co2: 1127, barometric_pressure: 1008.8 });
  });

  it('EM500-CO2 history record order is co2, pressure, temperature, humidity (synthetic)', () => {
    const d = run('Milesight', 'EM500-CO2', '20ce' + '9E744663' + '6704' + '6827' + '1901' + '73');
    expect(d.history[0]).toEqual({
      ts: '2022-10-12T08:02:38.000Z', co2: 1127, barometric_pressure: 1008.8, temperature: 28.1, humidity: 57.5,
    });
  });

  it('EM500-CO2 decodes the 83/d7 temperature alarm with change (synthetic)', () => {
    const d = run('Milesight', 'EM500-CO2', '83d7' + '1901' + '0a00' + '01');
    expect(d.telemetry).toEqual({ temperature: 28.1, temperature_change: 1, temperature_alarm: 'threshold_alarm' });
  });

  it('EM500-SWL reports depth in metres', () => {
    const d = run('Milesight', 'EM500-SWL', '017564 03770200');
    expect(d.telemetry).toEqual({ battery: 100, level: 0.02 });
    expect(unitOf(d, 'level')).toBe('m');
    expect(run('Milesight', 'EM500-SWL', '20ce9E7446630200').history[0]?.level).toBe(0.02);
  });

  it('EM500-PT100 decodes the README example', () => {
    expect(run('Milesight', 'EM500-PT100', '017564 03671901').telemetry).toEqual({ battery: 100, temperature: 28.1 });
    expect(run('Milesight', 'EM500-PT100', '20ce9E7446631901').history[0]?.temperature).toBe(28.1);
  });

  it('EM500-LGT reads a 4-byte illuminance', () => {
    expect(run('Milesight', 'EM500-LGT', '017564 039450000000').telemetry).toEqual({ battery: 100, illuminance: 80 });
    expect(run('Milesight', 'EM500-LGT', '20ce9E74466350000000').history[0]?.illuminance).toBe(80);
  });

  it('EM500-SMTC decodes the README example', () => {
    const d = run('Milesight', 'EM500-SMTC', '017564 03671901 046873 057FF000');
    expect(d.telemetry).toEqual({ battery: 100, temperature: 28.1, soil_moisture: 57.5, conductivity: 240 });
    expect(unitOf(d, 'conductivity')).toBe('µS/cm');
  });

  it('EM500-SMTC reads the two-byte moisture channel and history at 1/100 (synthetic)', () => {
    expect(valueOf(run('Milesight', 'EM500-SMTC', '04ca7616'), 'soil_moisture')).toBe(57.5);
    const h = run('Milesight', 'EM500-SMTC', '20ce' + '9E744663' + 'F000' + '1901' + '7616').history[0];
    expect(h).toMatchObject({ conductivity: 240, temperature: 28.1, soil_moisture: 57.5 });
  });

  it('EM310-UDL decodes the README example', () => {
    expect(run('Milesight', 'EM310-UDL', '01755C 03824408 040001').telemetry)
      .toEqual({ battery: 92, distance: 2116, position: 'tilt' });
  });

  it('EM320-TH shares the EM300-TH map and decodes both README examples', () => {
    expect(run('Milesight', 'EM320-TH', '01755C 03673401 046865').telemetry)
      .toEqual({ battery: 92, temperature: 30.8, humidity: 50.5 });
    expect(run('Milesight', 'EM320-TH', '20CE9E74466310015D').history)
      .toEqual([{ ts: '2022-10-12T08:02:38.000Z', temperature: 27.2, humidity: 46.5 }]);
  });

  it('EM300-MCS decodes both README examples', () => {
    expect(run('Milesight', 'EM300-MCS', '01755C 03673401 046865 060001').telemetry)
      .toEqual({ battery: 92, temperature: 30.8, humidity: 50.5, magnet_status: 'open' });
    expect(run('Milesight', 'EM300-MCS', '20CE9E74466310015D01').history)
      .toEqual([{ ts: '2022-10-12T08:02:38.000Z', temperature: 27.2, humidity: 46.5, magnet_status: 'open' }]);
  });
});

describe('Milesight WS series (more)', () => {
  it('WS202 decodes the README example', () => {
    const d = run('Milesight', 'WS202', '017510 030001 040000');
    expect(d.telemetry).toEqual({ battery: 16, pir: 'trigger', daylight: 'dark' });
  });

  it('WS202 reads the 6-byte serial channel (synthetic)', () => {
    expect(run('Milesight', 'WS202', 'ff086614c3969487').attributes['serial_number']).toBe('6614c3969487');
  });

  it('WS523 decodes the README example with energy in kWh', () => {
    const d = run('Milesight', 'WS523', '087001 05812C 07C94A00 03743009 068309660000 048007000000');
    expect(d.telemetry).toEqual({
      socket_status: 'on', power_factor: 44, current: 74, voltage: 235.2, energy: 26.121, active_power: 7,
    });
    expect(unitOf(d, 'energy')).toBe('kWh');
    expect(milesight.ws525('087001').socket_status).toBe('on');
  });
});

describe('Milesight AM100 and AM319 series', () => {
  const AM104_HEX = '01755C 03673401 046865 056A4900 06651C0079001400';

  it('AM104 decodes the README example with the three illuminance readings', () => {
    expect(run('Milesight', 'AM104', AM104_HEX).telemetry).toEqual({
      battery: 92, temperature: 30.8, humidity: 50.5, activity: 73,
      illuminance: 28, illuminance_ir_visible: 121, illuminance_ir: 20,
    });
  });

  it('AM107 adds CO2, tVOC in ppb and barometric pressure', () => {
    const d = run('Milesight', 'AM107', AM104_HEX + '077DE704 087D0700 09733F27');
    expect(d.telemetry).toMatchObject({ co2: 1255, tvoc_ppb: 7, barometric_pressure: 1004.7 });
    expect(unitOf(d, 'tvoc_ppb')).toBe('ppb');
  });

  const AM319_BASE_HEX = '0367EE00 04687C 050001 06CB02 077DA803 087D2500 09736627 0B7D2000 0C7D3000';

  it('AM319-HCHO decodes the README example', () => {
    const d = run('Milesight', 'AM319-HCHO', AM319_BASE_HEX + ' 0A7D0700');
    expect(d.telemetry).toEqual({
      temperature: 23.8, humidity: 62, pir: 'trigger', light_level: 2, co2: 936, tvoc_index: 0.37,
      barometric_pressure: 1008.6, pm2_5: 32, pm10: 48, hcho: 0.07,
    });
    expect(unitOf(d, 'hcho')).toBe('mg/m³');
    expect(milesight.am319('0A7D0700')).toEqual({ hcho: 0.07 });
  });

  it('AM319-O3 decodes ozone on 0d/7d (synthetic value)', () => {
    const d = run('Milesight', 'AM319-O3', AM319_BASE_HEX + ' 0D7D0A00');
    expect(d.telemetry).toMatchObject({ o3: 0.1, pm10: 48 });
  });

  it('AM319 history records end with the extra gas (synthetic)', () => {
    const rec = '9E744663' + 'EE00' + '7C00' + '01' + '02' + 'A803' + '2500' + '6627' + '2000' + '3000' + '0700';
    expect(run('Milesight', 'AM319-HCHO', '20ce' + rec).history[0]).toMatchObject({ tvoc_index: 0.37, hcho: 0.07 });
    expect(run('Milesight', 'AM319-O3', '21ce' + rec).history[0]).toMatchObject({ tvoc: 37, o3: 0.07 });
  });
});
