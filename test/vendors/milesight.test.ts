import { describe, expect, it } from 'vitest';
import { run, unitOf, valueOf } from '../helpers.js';
import { milesight } from '../../src/index.js';

/**
 * Every payload here is a worked example from Milesight's own published
 * documentation, with the expected values they state. If a refactor changes a
 * scaling factor, these fail.
 */
describe('Milesight EM400-TLD', () => {
  const uplink = run('Milesight', 'EM400-TLD', '01755C 0367010104824408050001');

  it('decodes battery, temperature, distance and position into one flat object', () => {
    expect(uplink.telemetry).toEqual({ battery: 92, temperature: 25.7, distance: 2116, position: 'tilt' });
  });

  it('reports units per key, none for states', () => {
    expect(uplink.units).toEqual({ battery: '%', temperature: '°C', distance: 'mm' });
  });

  it('is the same through the namespace accessor', () => {
    expect(milesight.em400_tld('01755C0367010104824408050001')).toEqual(uplink.telemetry);
    expect(milesight.em400tld('01755C0367010104824408050001')).toEqual(uplink.telemetry);
  });

  it('decodes negative temperatures', () => {
    // -0.1 °C is 0xFFFF little-endian signed.
    expect(valueOf(run('Milesight', 'EM400-TLD', '0367ffff'), 'temperature')).toBe(-0.1);
  });

  it('decodes the alarm channels with their trailing alarm byte', () => {
    const alarm = run('Milesight', 'EM400-TLD', '8367010101' + '8482440801');
    expect(alarm.telemetry).toEqual({
      temperature: 25.7, temperature_alarm: 'threshold_alarm',
      distance: 2116, distance_alarm: 'threshold_alarm',
    });
  });

  it('shares its wire format with EM400-MUD', () => {
    const mud = run('Milesight', 'EM400-MUD', '01755C0367010104824408050001');
    expect(mud.telemetry).toEqual(uplink.telemetry);
  });

  it('matches the model name however it is spelled', () => {
    for (const spelling of ['EM400-TLD', 'em400tld', 'EM400 TLD', 'Em400_Tld']) {
      expect(run('milesight', spelling, '01755C').telemetry).toEqual({ battery: 92 });
    }
  });
});

describe('Milesight EM300-SLD', () => {
  const uplink = run('Milesight', 'EM300-SLD', '01755C03673401046865050000');

  it('applies the half-percent humidity step', () => {
    expect(uplink.telemetry).toEqual({ battery: 92, temperature: 30.8, humidity: 50.5, leakage_status: 'normal' });
  });

  it('routes buffered history records to history, each with its own timestamp', () => {
    // history: ts=0x5F5E1000, temp 25.7, humidity 50.5, leak
    const d = run('Milesight', 'EM300-SLD', '01755C' + '20ce' + '00105e5f' + '0101' + '65' + '01');
    expect(d.telemetry).toEqual({ battery: 92 });
    expect(d.history).toEqual([
      { ts: new Date(0x5f5e1000 * 1000).toISOString(), temperature: 25.7, humidity: 50.5, leakage_status: 'leak' },
    ]);
  });

  it('orders several history records oldest first', () => {
    const d = run('Milesight', 'EM300-SLD', '20ce' + '01105e5f' + '0101' + '65' + '00' + '20ce' + '00105e5f' + '0201' + '65' + '00');
    expect(d.history.map((h) => h.temperature)).toEqual([25.8, 25.7]);
  });
});

describe('Milesight EM300-TH', () => {
  // Milesight README worked example: battery 92 %, 30.8 °C, 50.5 % RH.
  it('decodes the vendor worked example', () => {
    const d = run('Milesight', 'EM300-TH', '01755C 036734 01 046865');
    expect(d.telemetry).toEqual({ battery: 92, temperature: 30.8, humidity: 50.5 });
    expect(d.warnings).toEqual([]);
  });

  it('decodes negative temperatures', () => {
    expect(valueOf(run('Milesight', 'EM300-TH', '0367F9FF'), 'temperature')).toBe(-0.7);
  });

  it('timestamps history records', () => {
    const d = run('Milesight', 'EM300-TH', '20ce' + '00105e5f' + '0101' + '65');
    expect(d.history[0]).toEqual({ ts: new Date(0x5f5e1000 * 1000).toISOString(), temperature: 25.7, humidity: 50.5 });
  });
});

describe('Milesight AM103', () => {
  it('decodes temperature, humidity and CO2', () => {
    const d = run('Milesight', 'AM103', '017564 03671001 046865 077DA406');
    expect(d.telemetry).toEqual({ battery: 100, temperature: 27.2, humidity: 50.5, co2: 1700 });
    expect(unitOf(d, 'co2')).toBe('ppm');
  });

  it('reads the CO2 word little-endian', () => {
    // Same convention as the EM500-CO2 vendor example (7D6704 -> 1127 ppm).
    expect(valueOf(run('Milesight', 'AM103', '077D6704'), 'co2')).toBe(1127);
  });

  it('accepts AM103L and decodes its light level channel', () => {
    expect(run('Milesight', 'AM103L', '06cb03').telemetry).toEqual({ light_level: 3 });
    expect(milesight.am103l('06cb03')).toEqual({ light_level: 3 });
  });

  it('decodes history records with CO2', () => {
    const d = run('Milesight', 'AM103', '20ce' + '00105e5f' + '0101' + '65' + 'A406');
    expect(d.history[0]?.co2).toBe(1700);
  });
});

describe('Milesight EM310-TILT', () => {
  const uplink = run('Milesight', 'EM310-TILT', '03CF00000000282307');

  it('reads three signed axes at 1/100 degree onto suffixed keys', () => {
    expect(uplink.telemetry).toMatchObject({ angle_x: 0, angle_y: 0, angle_z: 90 });
    expect(unitOf(uplink, 'angle_z')).toBe('°');
  });

  it('unpacks the per-axis threshold bitfield', () => {
    expect(uplink.telemetry).toMatchObject({
      angle_threshold_x: 'trigger', angle_threshold_y: 'trigger', angle_threshold_z: 'trigger',
    });
    const quiet = run('Milesight', 'EM310-TILT', '03CF00000000282300');
    expect(valueOf(quiet, 'angle_threshold_z')).toBe('normal');
  });

  it('handles negative angles', () => {
    // -90.00° = -9000 = 0xDCD8 little-endian
    expect(valueOf(run('Milesight', 'EM310-TILT', '03CFd8dc0000000000'), 'angle_x')).toBe(-90);
  });
});

describe('Milesight EM500 series', () => {
  it('EM500-PP reports signed, unscaled kilopascals', () => {
    const uplink = run('Milesight', 'EM500-PP', '017564037B0A00');
    expect(valueOf(uplink, 'pressure')).toBe(10);
    expect(unitOf(uplink, 'pressure')).toBe('kPa');
    expect(valueOf(run('Milesight', 'EM500-PP', '037bf6ff'), 'pressure')).toBe(-10);
  });

  it('EM500-UDL keeps the alarm-channel distance on its own key and warns about the vendor factor of ten', () => {
    const uplink = run('Milesight', 'EM500-UDL', '83e9' + '6400' + '0a00' + '01');
    expect(uplink.telemetry).toEqual({
      distance_alarm_value: 10, distance_mutation: 1, distance_alarm: 'threshold_alarm',
    });
    expect(uplink.warnings.some((w) => w.code === 'vendor_quirk')).toBe(true);
  });

  it('EM500-UDL reports raw millimetres on the plain channel', () => {
    expect(valueOf(run('Milesight', 'EM500-UDL', '03826400'), 'distance')).toBe(100);
  });
});

describe('Milesight WS series', () => {
  it('WS101 finds the button event in the 0xFF namespace', () => {
    const uplink = run('Milesight', 'WS101', '017510FF2E01');
    expect(uplink.telemetry).toEqual({ battery: 16, button_event: 'short_press' });
  });

  it('WS101 reads the 6-byte serial number channel into attributes', () => {
    const uplink = run('Milesight', 'WS101', 'ff08' + '6614c3969487');
    expect(uplink.attributes['serial_number']).toBe('6614c3969487');
    expect(uplink.telemetry).toEqual({});
  });

  it('WS201 reports distance and remaining fill', () => {
    expect(run('Milesight', 'WS201', '01756403823E0004D645').telemetry)
      .toEqual({ battery: 100, distance: 62, remaining: 69 });
  });

  it('WS301 decodes magnet and tamper state', () => {
    const uplink = run('Milesight', 'WS301', '017564030001040001');
    expect(valueOf(uplink, 'magnet_status')).toBe('open');
    // 1 means "attention" on both channels, but the words invert: the magnet
    // reads "open" and the tamper switch reads "uninstalled".
    expect(valueOf(uplink, 'tamper_status')).toBe('uninstalled');
    expect(valueOf(run('Milesight', 'WS301', '040000'), 'tamper_status')).toBe('installed');
  });

  it('WS303 uses 03/00 for leakage where WS301 uses it for the magnet', () => {
    expect(valueOf(run('Milesight', 'WS303', '017564030001'), 'leakage_status')).toBe('leak');
    expect(valueOf(run('Milesight', 'WS301', '017564030001'), 'magnet_status')).toBe('open');
  });

  it('WS302 keeps stable keys and moves the weighting into attributes', () => {
    const uplink = run('Milesight', 'WS302', '017564055B053F02DA016A02');
    expect(uplink.attributes).toEqual({ frequency_weighting: 'A', time_weighting: 'F' });
    expect(uplink.telemetry).toEqual({ battery: 100, sound_level: 57.5, sound_level_eq: 47.4, sound_level_max: 61.8 });
  });

  it('WS302 key names do not change when the weighting changes', () => {
    const z = run('Milesight', 'WS302', '055B003F02DA016A02');
    expect(z.attributes['frequency_weighting']).toBe('Z');
    expect(z.attributes['time_weighting']).toBe('I');
    expect(valueOf(z, 'sound_level')).toBe(57.5);
  });
});

describe('Milesight AM308L', () => {
  const uplink = run(
    'Milesight', 'AM308L',
    '0367EE0004687C050001' + '06CB02077DA803087D2500' + '09736627' + '0B7D20000C7D3000',
  );

  it('decodes the full air-quality channel set', () => {
    expect(uplink.telemetry).toEqual({
      temperature: 23.8, humidity: 62, pir: 'trigger', light_level: 2, co2: 936,
      tvoc_index: 0.37, barometric_pressure: 1008.6, pm2_5: 32, pm10: 48,
    });
  });

  it('gives the two tVOC encodings different keys, because they are different units', () => {
    expect(run('Milesight', 'AM308L', '087d2500').telemetry).toEqual({ tvoc_index: 0.37 });
    const mass = run('Milesight', 'AM308L', '08e62500');
    expect(mass.telemetry).toEqual({ tvoc: 37 });
    expect(unitOf(mass, 'tvoc')).toBe('µg/m³');
  });

  it('reads humidity as two bytes inside history records', () => {
    const d = run('Milesight', 'AM308L', '20ce' + '00105e5f' + '0101' + '7c00' + '01' + '02' + 'a803' + '2500' + '6627' + '2000' + '3000');
    expect(d.telemetry).toEqual({});
    expect(d.history[0]).toMatchObject({ humidity: 62, tvoc_index: 0.37, barometric_pressure: 1008.6 });
    const mass = run('Milesight', 'AM308L', '21ce' + '00105e5f' + '0101' + '7c00' + '01' + '02' + 'a803' + '2500' + '6627' + '2000' + '3000');
    expect(mass.history[0]).toMatchObject({ tvoc: 37 });
  });
});

describe('Milesight GS301', () => {
  it('uses shifted channel ids relative to AM308L', () => {
    const uplink = run('Milesight', 'GS301', '01756402671C01036864047D0000057D0100');
    expect(uplink.telemetry).toEqual({ battery: 100, temperature: 28.4, humidity: 50, nh3: 0, h2s: 0.01 });
  });

  it('reports sensor sentinels as a status rather than a concentration of 65534', () => {
    const warming = run('Milesight', 'GS301', '047dfeff');
    expect(warming.telemetry).toEqual({ nh3_status: 'polarizing' });
    expect(warming.warnings.some((w) => w.code === 'sensor_fault')).toBe(true);

    const broken = run('Milesight', 'GS301', '057dffff');
    expect(valueOf(broken, 'h2s_status')).toBe('device_error');
  });

  it('decodes the high-resolution H2S channel at 1/1000 ppm onto the same key', () => {
    expect(valueOf(run('Milesight', 'GS301', '067d0a00'), 'h2s')).toBe(0.01);
  });
});

describe('Milesight VS132', () => {
  const uplink = run(
    'Milesight', 'VS132',
    'FF0101FF166614C39694870000FF090102FF1F84010001' + '03D2BE00000004D23101000005CC00000000',
  );

  it('decodes cumulative and periodic counters onto _in/_out keys', () => {
    expect(uplink.telemetry).toEqual({
      total_counter_in: 190, total_counter_out: 305, periodic_counter_in: 0, periodic_counter_out: 0,
    });
  });

  it('uses the VS-specific version format, not the EM/WS one', () => {
    expect(uplink.attributes).toEqual({
      protocol_version: 1, hardware_version: '1.2', firmware_version: '132.1.0.1', serial_number: '6614c39694870000',
    });
  });
});

describe('unknown channels', () => {
  it('warns and stops, because the format has no length field to skip with', () => {
    const uplink = run('Milesight', 'WS303', '017564' + 'aabb' + '030001');
    expect(uplink.telemetry).toEqual({ battery: 100 });
    const warning = uplink.warnings.find((w) => w.code === 'unknown_channel');
    expect(warning?.channel).toBe('aa/bb');
    expect(warning?.message).toContain('cannot be skipped');
  });

  it('stays silent on the plain call', () => {
    expect(milesight.ws303('017564aabb')).toEqual({ battery: 100 });
  });

  it('throws in strict mode instead of returning a partial reading', () => {
    expect(() => run('Milesight', 'WS303', '017564aabb', { strict: true })).toThrow();
  });

  it('warns when a channel is cut short mid-field', () => {
    const uplink = run('Milesight', 'EM400-TLD', '0367' + '01');
    expect(uplink.warnings.some((w) => w.code === 'truncated_payload')).toBe(true);
  });
});
