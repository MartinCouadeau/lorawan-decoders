import { describe, expect, it } from 'vitest';
import { run, valueOf } from '../helpers.js';
import { isFaultStatus } from '../../src/core/vocabulary.js';

/**
 * Sentinel values: wire patterns the vendor documents as "no reading". Each
 * lands on `<key>_status`, never on `<key>`. Fault labels (device could not
 * measure) also warn sensor_fault; state labels (device reports a condition on
 * purpose: out of range, tilted, probe not connected) do not.
 * Sources: Milesight user guides (EM500 series, GS301, EM310-UDL), field
 * reports (EM400 65000), Dragino manuals.
 */
function status(vendor: string, model: string, hex: string, key: string, options = {}) {
  const d = run(vendor, model, hex, options);
  expect(d.telemetry, `${model} ${hex} must not emit ${key}`).not.toHaveProperty(key);
  const label = String(valueOf(d, `${key}_status`));
  const warned = d.warnings.some((w) => w.code === 'sensor_fault');
  expect(warned, `${model} ${hex}: ${label} ${isFaultStatus(label) ? 'must' : 'must not'} warn`).toBe(isFaultStatus(label));
  return label;
}

describe('Milesight EM500 series sentinels (user guides: ffff = collection failed, fffd = out of range)', () => {
  it('EM500-UDL distance, live and history', () => {
    expect(status('Milesight', 'EM500-UDL', '0382ffff', 'distance')).toBe('collection_failed');
    expect(status('Milesight', 'EM500-UDL', '0382fdff', 'distance')).toBe('out_of_range');
    expect(status('Milesight', 'EM500-UDL', '83e9 ffff 0000 01', 'distance')).toBe('collection_failed');
    const h = run('Milesight', 'EM500-UDL', '20ce 9E744663 fdff');
    expect(h.history[0]).toEqual({ ts: '2022-10-12T08:02:38.000Z', distance_status: 'out_of_range' });
  });

  it('EM500-SWL level', () => {
    expect(status('Milesight', 'EM500-SWL', '0377ffff', 'level')).toBe('collection_failed');
    expect(run('Milesight', 'EM500-SWL', '20ce 9E744663 fdff').history[0]?.level_status).toBe('out_of_range');
  });

  it('EM500-PT100 temperature: 0xffff is the sentinel, not -0.1 °C', () => {
    expect(status('Milesight', 'EM500-PT100', '0367ffff', 'temperature')).toBe('collection_failed');
    expect(status('Milesight', 'EM500-PT100', '0367fdff', 'temperature')).toBe('out_of_range');
    expect(valueOf(run('Milesight', 'EM500-PT100', '0367feff'), 'temperature')).toBe(-0.2);
    expect(run('Milesight', 'EM500-PT100', '20ce 9E744663 ffff').history[0]?.temperature_status).toBe('collection_failed');
    expect(status('Milesight', 'EM500-PT100', '83d7 ffff 0a00 01', 'temperature')).toBe('collection_failed');
  });

  it('EM500-PP pressure', () => {
    expect(status('Milesight', 'EM500-PP', '037bffff', 'pressure')).toBe('collection_failed');
    expect(run('Milesight', 'EM500-PP', '20ce 9E744663 fdff').history[0]?.pressure_status).toBe('out_of_range');
  });

  it('EM500-LGT uses the 4-byte forms', () => {
    expect(status('Milesight', 'EM500-LGT', '0394ffffffff', 'illuminance')).toBe('collection_failed');
    expect(status('Milesight', 'EM500-LGT', '0394fdffffff', 'illuminance')).toBe('out_of_range');
    expect(run('Milesight', 'EM500-LGT', '20ce 9E744663 ffffffff').history[0]?.illuminance_status).toBe('collection_failed');
  });

  it('EM500-SMTC on every soil channel, one- and two-byte moisture, and history', () => {
    expect(status('Milesight', 'EM500-SMTC', '0367ffff', 'temperature')).toBe('collection_failed');
    expect(status('Milesight', 'EM500-SMTC', '0468ff', 'soil_moisture')).toBe('collection_failed');
    expect(status('Milesight', 'EM500-SMTC', '04cafdff', 'soil_moisture')).toBe('out_of_range');
    expect(status('Milesight', 'EM500-SMTC', '057fffff', 'conductivity')).toBe('collection_failed');
    const h = run('Milesight', 'EM500-SMTC', '20ce 9E744663 ffff 1901 fdff').history[0];
    expect(h).toEqual({
      ts: '2022-10-12T08:02:38.000Z', conductivity_status: 'collection_failed', temperature: 28.1, soil_moisture_status: 'out_of_range',
    });
  });

  it('EM500-CO2 documents only "all ff"', () => {
    expect(status('Milesight', 'EM500-CO2', '0367ffff', 'temperature')).toBe('collection_failed');
    expect(status('Milesight', 'EM500-CO2', '0468ff', 'humidity')).toBe('collection_failed');
    expect(status('Milesight', 'EM500-CO2', '057dffff', 'co2')).toBe('collection_failed');
    expect(status('Milesight', 'EM500-CO2', '0673ffff', 'barometric_pressure')).toBe('collection_failed');
    expect(valueOf(run('Milesight', 'EM500-CO2', '0367fdff'), 'temperature')).toBe(-0.3);
    const h = run('Milesight', 'EM500-CO2', '20ce 9E744663 ffff 6827 1901 ff').history[0];
    expect(h).toEqual({
      ts: '2022-10-12T08:02:38.000Z', co2_status: 'collection_failed', barometric_pressure: 1008.8, temperature: 28.1, humidity_status: 'collection_failed',
    });
  });
});

describe('Milesight distance sentinels on other series', () => {
  it('EM400-TLD/MUD report 65000 when out of range or tilted (field report)', () => {
    expect(status('Milesight', 'EM400-TLD', '0482e8fd', 'distance')).toBe('out_of_range');
    expect(status('Milesight', 'EM400-MUD', '0482e8fd', 'distance')).toBe('out_of_range');
    const alarm = run('Milesight', 'EM400-TLD', '8482e8fd01');
    expect(alarm.telemetry).toEqual({ distance_status: 'out_of_range', distance_alarm: 'threshold_alarm' });
    expect(valueOf(run('Milesight', 'EM400-TLD', '0482e7fd'), 'distance')).toBe(64999);
  });

  it('EM400 relabels 65000 as tilted when the same frame reports position tilt, with no warning', () => {
    const d = run('Milesight', 'EM400-TLD', '01755c 0482e8fd 050001');
    expect(d.telemetry).toEqual({ battery: 92, distance_status: 'tilted', position: 'tilt' });
    expect(d.warnings).toEqual([]);
    expect(valueOf(run('Milesight', 'EM400-MUD', '050001 8482e8fd01'), 'distance_status')).toBe('tilted');
    expect(valueOf(run('Milesight', 'EM400-TLD', '0482e8fd 050000'), 'distance_status')).toBe('out_of_range');
  });

  it('EM310-UDL reports 0 beyond 4.5 m and clamps to 30 mm below the blind zone', () => {
    expect(status('Milesight', 'EM310-UDL', '03820000', 'distance')).toBe('out_of_range');
    expect(valueOf(run('Milesight', 'EM310-UDL', '03821e00'), 'distance')).toBe(30);
  });
});

describe('Milesight CT10x sentinels (user guide: current ffff = collection failure; temperature fffd = over range)', () => {
  it('current and temperature, live and in the alarm channels', () => {
    expect(status('Milesight', 'CT103', '0498ffff', 'current')).toBe('collection_failed');
    expect(status('Milesight', 'CT103', '0967ffff', 'temperature')).toBe('collection_failed');
    expect(status('Milesight', 'CT103', '0967fdff', 'temperature')).toBe('out_of_range');
    expect(status('Milesight', 'CT103', '8498 B80B D007 ffff 01', 'current')).toBe('collection_failed');
    expect(status('Milesight', 'CT103', '8967fdff01', 'temperature')).toBe('out_of_range');
  });
});

describe('Milesight GS301 sentinels (user guide: ffff or ff = collection error, fffe = polarizing)', () => {
  it('applies to temperature and humidity as well as the gas channels', () => {
    expect(status('Milesight', 'GS301', '0267ffff', 'temperature')).toBe('collection_failed');
    expect(status('Milesight', 'GS301', '0368ff', 'humidity')).toBe('collection_failed');
    expect(status('Milesight', 'GS301', '067dffff', 'h2s')).toBe('collection_failed');
    expect(status('Milesight', 'GS301', '067dfeff', 'h2s')).toBe('polarizing');
  });
});

describe('Milesight WS302 sound levels are int16 per the user guide', () => {
  it('reads a negative level', () => {
    expect(valueOf(run('Milesight', 'WS302', '055B 00 f6ff 3f02 6a02'), 'sound_level')).toBe(-1);
  });
});

describe('Dragino LHT65N external sensor types and datalog', () => {
  it('TMP117 (type 2) decodes like the DS18B20', () => {
    expect(valueOf(run('Dragino', 'LHT65N', 'CBF60B0D0225 02 09C4 7FFF'), 'temperature_external')).toBe(25);
    expect(run('Dragino', 'LHT65N', 'CBF60B0D0225 02 09C4 7FFF').attributes['external_sensor']).toBe('tmp117');
  });

  it('SHT31 (type 11) adds an external humidity', () => {
    const d = run('Dragino', 'LHT65N', 'CBF60B0D0225 0B 09C4 0295');
    expect(d.telemetry).toMatchObject({ temperature_external: 25, humidity_external: 66.1 });
  });

  it('timestamp mode (type 9) is a different 11-byte layout, reported live with the sample time', () => {
    // ext 0x09C4, sht temp 0x0898, bat status good + hum 0x146, flags none, ts 0x60065F97
    const d = run('Dragino', 'LHT65N', '09C4 0898 C146 09 60065F97', { fPort: 2 });
    expect(d.telemetry).toEqual({ temperature_external: 25, temperature: 22, humidity: 32.6, battery_status: 'good' });
    expect(d.attributes).toEqual({ external_sensor: 'ds18b20_timestamp', device_time: '2021-01-19T04:27:03.000Z' });
    expect(d.history).toEqual([]);
  });

  it('fPort 3 datalog entries go to history, oldest first, skipping all-zero entries (manual example)', () => {
    const d = run('Dragino', 'LHT65N', '7FFF089801464160065F97' + '7FFF088E014B4160066009' + '0000000000000000000000', { fPort: 3 });
    expect(d.telemetry).toEqual({});
    expect(d.history).toEqual([
      { ts: '2021-01-19T04:27:03.000Z', temperature_external_status: 'not_connected', temperature: 22, humidity: 32.6 },
      { ts: '2021-01-19T04:28:57.000Z', temperature_external_status: 'not_connected', temperature: 21.9, humidity: 33.1 },
    ]);
    expect(d.attributes).toEqual({ external_sensor: 'ds18b20', datalog_entries: 2 });
    expect(d.warnings.filter((w) => w.code === 'sensor_fault')).toHaveLength(0);
  });
});

describe('Dragino LHT65N datalog entries with other external types (synthetic)', () => {
  it('ADC, interrupt and counter types decode from the two external bytes', () => {
    const adc = run('Dragino', 'LHT65N', '0CE4 0898 0146 06 60065F97', { fPort: 3 });
    expect(adc.history[0]).toMatchObject({ input_voltage: 3.3 });
    const irq = run('Dragino', 'LHT65N', '0101 0898 0146 04 60065F97', { fPort: 3 });
    expect(irq.history[0]).toMatchObject({ input_level: 'high', interrupt: 'triggered' });
    const cnt = run('Dragino', 'LHT65N', '0102 0898 0146 08 60065F97', { fPort: 3 });
    expect(cnt.history[0]).toMatchObject({ pulse_count: 258 });
    const none = run('Dragino', 'LHT65N', '0000 0898 0146 00 60065F97', { fPort: 3 });
    expect(none.history[0]).toEqual({ ts: '2021-01-19T04:27:03.000Z', temperature: 22, humidity: 32.6 });
  });

  it('warns on an unknown type and on a length that is not a multiple of 11', () => {
    const odd = run('Dragino', 'LHT65N', '0102 0898 0146 0D 60065F97 FF', { fPort: 3 });
    expect(odd.warnings.map((w) => w.code)).toEqual(['truncated_payload', 'undocumented_field']);
    expect(odd.history[0]).toEqual({ ts: '2021-01-19T04:27:03.000Z', temperature: 22, humidity: 32.6 });
  });

  it('type 9 in a frame of the wrong length falls back to the live layout with a warning', () => {
    const d = run('Dragino', 'LHT65N', 'CBF60B0D0225 09', { fPort: 2 });
    expect(d.warnings[0]?.code).toBe('truncated_payload');
    expect(d.telemetry).toMatchObject({ humidity: 54.9 });
  });
});

describe('Dragino LHT52 fPort 3 datalog', () => {
  it('warns on a length that is not a multiple of 11 and on a short live frame', () => {
    const d = run('Dragino', 'LHT52', '09C4 0220 08CD 01 61CD4EDD' + 'FF', { fPort: 3 });
    expect(d.warnings.some((w) => w.code === 'truncated_payload')).toBe(true);
    expect(d.history).toHaveLength(1);
    const short = run('Dragino', 'LHT52', '08CD 0220', { fPort: 2 });
    expect(short.telemetry).toEqual({ temperature: 22.53, humidity: 54.4 });
    expect(short.attributes).toEqual({});
  });

  it('uses the external-first field order and lands in history', () => {
    // ext 0x09C4, hum 0x0220, sht 0x08CD, type 1, ts
    const d = run('Dragino', 'LHT52', '09C4 0220 08CD 01 61CD4EDD' + '7FFF 0220 F5C6 01 61CD4EE0', { fPort: 3 });
    expect(d.telemetry).toEqual({});
    expect(d.history).toEqual([
      { ts: '2021-12-30T06:17:01.000Z', temperature_external: 25, humidity: 54.4, temperature: 22.53 },
      { ts: '2021-12-30T06:17:04.000Z', temperature_external_status: 'not_connected', humidity: 54.4, temperature: -26.18 },
    ]);
    expect(d.attributes['datalog_entries']).toBe(2);
  });
});

describe('Dragino LSE01 MOD bit', () => {
  it('a frame without the flags byte decodes as MOD=0', () => {
    const d = run('Dragino', 'LSE01', '0B45 0000 05DC 0105 00C8');
    expect(d.telemetry).toMatchObject({ soil_moisture: 15, interrupt: 'none' });
    expect(d.attributes['mode']).toBe(0);
  });

  it('MOD=1 raw AD values stay out of telemetry', () => {
    const d = run('Dragino', 'LSE01', '0B45 0000 00C8 05DC 0102 81');
    expect(d.telemetry).toEqual({ battery_voltage: 2.885, interrupt: 'triggered' });
    expect(d.attributes).toEqual({ reserved: '0000', mode: 1, conductivity_raw: 200, moisture_raw: 1500, dielectric_raw: 258 });
    expect(d.warnings[0]?.code).toBe('unscaled_value');
  });
});

describe('Dragino LDS02 EDC packet', () => {
  it('five-byte frame carries battery and the counted events (manual values)', () => {
    const open = run('Dragino', 'LDS02', '8C60 00000A', { fPort: 7 });
    expect(open.telemetry).toEqual({ battery_voltage: 3.168, event_count: 10 });
    expect(open.attributes).toEqual({ mode: 'edc', edc_event: 'open' });
    const close = run('Dragino', 'LDS02', '0C60 000014', { fPort: 7 });
    expect(close.telemetry.event_count).toBe(20);
    expect(close.attributes['edc_event']).toBe('close');
    expect(close.warnings).toEqual([]);                        // fPort 7 is a documented port
  });
});
