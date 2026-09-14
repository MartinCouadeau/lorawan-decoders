import { describe, expect, it } from 'vitest';
import { pick, run, valueOf } from '../helpers.js';

/**
 * Every payload here is a worked example from Milesight's own published
 * documentation, with the expected values they state. If a refactor changes a
 * scaling factor, these fail.
 */
describe('Milesight EM400-TLD', () => {
  const uplink = run('Milesight', 'EM400-TLD', '01755C 0367010104824408050001');

  it('decodes battery, temperature, distance and position', () => {
    expect(valueOf(uplink, 'battery')).toBe(92);
    expect(valueOf(uplink, 'temperature')).toBe(25.7);
    expect(valueOf(uplink, 'distance')).toBe(2116);
    expect(valueOf(uplink, 'position')).toBe('tilt');
  });

  it('reports units and provenance for every reading', () => {
    expect(pick(uplink, 'temperature').unit).toBe('°C');
    expect(pick(uplink, 'distance').unit).toBe('mm');
    expect(pick(uplink, 'temperature').channel).toBe('03/67');
  });

  it('decodes negative temperatures', () => {
    // -0.1 °C is 0xFFFF little-endian signed.
    expect(valueOf(run('Milesight', 'EM400-TLD', '0367ffff'), 'temperature')).toBe(-0.1);
  });

  it('decodes the alarm channels with their trailing alarm byte', () => {
    const alarm = run('Milesight', 'EM400-TLD', '8367010101' + '8482440801');
    expect(valueOf(alarm, 'temperature')).toBe(25.7);
    expect(valueOf(alarm, 'temperature_alarm')).toBe('threshold_alarm');
    expect(valueOf(alarm, 'distance')).toBe(2116);
    expect(valueOf(alarm, 'distance_alarm')).toBe('threshold_alarm');
  });

  it('shares its wire format with EM400-MUD', () => {
    const mud = run('Milesight', 'EM400-MUD', '01755C0367010104824408050001');
    expect(mud.measurements).toEqual(uplink.measurements);
  });

  it('matches the model name however it is spelled', () => {
    for (const spelling of ['EM400-TLD', 'em400tld', 'EM400 TLD', 'Em400_Tld']) {
      expect(run('milesight', spelling, '01755C').model).toBe('EM400-TLD');
    }
  });
});

describe('Milesight EM300-SLD', () => {
  const uplink = run('Milesight', 'EM300-SLD', '01755C03673401046865050000');

  it('applies the half-percent humidity step', () => {
    expect(valueOf(uplink, 'battery')).toBe(92);
    expect(valueOf(uplink, 'temperature')).toBe(30.8);
    expect(valueOf(uplink, 'humidity')).toBe(50.5); // 0x65 = 101, /2
    expect(valueOf(uplink, 'leakage_status')).toBe('normal');
  });

  it('timestamps buffered history records instead of collapsing them to now', () => {
    // history: ts=0x5F5E1000, temp 25.7, humidity 50.5, leak
    const history = run('Milesight', 'EM300-SLD', '20ce' + '00105e5f' + '0101' + '65' + '01');
    const temperature = pick(history, 'temperature');
    expect(temperature.value).toBe(25.7);
    expect(temperature.at).toBe(new Date(0x5f5e1000 * 1000).toISOString());
    expect(valueOf(history, 'leakage_status')).toBe('leak');
  });
});

describe('Milesight EM300-TH', () => {
  // Milesight README worked example: battery 92 %, 30.8 °C, 50.5 % RH.
  const uplink = run('Milesight', 'EM300-TH', '01755C 036734 01 046865');

  it('decodes the vendor worked example', () => {
    expect(valueOf(uplink, 'battery')).toBe(92);
    expect(valueOf(uplink, 'temperature')).toBe(30.8);
    expect(valueOf(uplink, 'humidity')).toBe(50.5);
    expect(uplink.warnings).toEqual([]);
  });

  it('decodes negative temperatures', () => {
    expect(valueOf(run('Milesight', 'EM300-TH', '0367F9FF'), 'temperature')).toBe(-0.7);
  });

  it('timestamps history records', () => {
    const history = run('Milesight', 'EM300-TH', '20ce' + '00105e5f' + '0101' + '65');
    expect(pick(history, 'temperature').at).toBe(new Date(0x5f5e1000 * 1000).toISOString());
    expect(valueOf(history, 'humidity')).toBe(50.5);
  });
});

describe('Milesight AM103', () => {
  const uplink = run('Milesight', 'AM103', '017564 03671001 046865 077DA406');

  it('decodes temperature, humidity and CO2', () => {
    expect(valueOf(uplink, 'battery')).toBe(100);
    expect(valueOf(uplink, 'temperature')).toBe(27.2);
    expect(valueOf(uplink, 'humidity')).toBe(50.5);
    expect(valueOf(uplink, 'co2')).toBe(1700);
    expect(pick(uplink, 'co2').unit).toBe('ppm');
  });

  it('reads the CO2 word little-endian', () => {
    // Same convention as the EM500-CO2 vendor example (7D6704 -> 1127 ppm).
    expect(valueOf(run('Milesight', 'AM103', '077D6704'), 'co2')).toBe(1127);
  });

  it('accepts AM103L and decodes its light level channel', () => {
    const l = run('Milesight', 'AM103L', '06cb03');
    expect(l.model).toBe('AM103');
    expect(valueOf(l, 'light_level')).toBe(3);
  });

  it('decodes history records with CO2', () => {
    const history = run('Milesight', 'AM103', '20ce' + '00105e5f' + '0101' + '65' + 'A406');
    expect(valueOf(history, 'co2')).toBe(1700);
    expect(pick(history, 'co2').at).toBe(new Date(0x5f5e1000 * 1000).toISOString());
  });
});

describe('Milesight EM310-TILT', () => {
  const uplink = run('Milesight', 'EM310-TILT', '03CF00000000282307');

  it('reads three signed axes at 1/100 degree', () => {
    expect(valueOf(uplink, 'angle', 'x')).toBe(0);
    expect(valueOf(uplink, 'angle', 'y')).toBe(0);
    expect(valueOf(uplink, 'angle', 'z')).toBe(90);
  });

  it('unpacks the per-axis threshold bitfield', () => {
    for (const axis of ['x', 'y', 'z']) {
      expect(valueOf(uplink, 'angle_threshold', axis)).toBe('trigger');
    }
    const quiet = run('Milesight', 'EM310-TILT', '03CF00000000282300');
    expect(valueOf(quiet, 'angle_threshold', 'z')).toBe('normal');
  });

  it('handles negative angles', () => {
    // -90.00° = -9000 = 0xDCD8 little-endian
    expect(valueOf(run('Milesight', 'EM310-TILT', '03CFd8dc0000000000'), 'angle', 'x')).toBe(-90);
  });
});

describe('Milesight EM500 series', () => {
  it('EM500-PP reports signed, unscaled kilopascals', () => {
    const uplink = run('Milesight', 'EM500-PP', '017564037B0A00');
    expect(valueOf(uplink, 'pressure')).toBe(10);
    expect(pick(uplink, 'pressure').unit).toBe('kPa');
    expect(valueOf(run('Milesight', 'EM500-PP', '037bf6ff'), 'pressure')).toBe(-10);
  });

  it('EM500-UDL warns about the vendor factor-of-ten inconsistency', () => {
    const uplink = run('Milesight', 'EM500-UDL', '83e9' + '6400' + '0a00' + '01');
    expect(valueOf(uplink, 'distance', 'alarm')).toBe(10); // 100/10, per the vendor decoder
    expect(valueOf(uplink, 'distance_alarm')).toBe('threshold_alarm');
    expect(uplink.warnings.some((w) => w.code === 'vendor_quirk')).toBe(true);
  });

  it('EM500-UDL reports raw millimetres on the plain channel', () => {
    expect(valueOf(run('Milesight', 'EM500-UDL', '03826400'), 'distance')).toBe(100);
  });
});

describe('Milesight WS series', () => {
  it('WS101 finds the button event in the 0xFF namespace', () => {
    const uplink = run('Milesight', 'WS101', '017510FF2E01');
    expect(valueOf(uplink, 'battery')).toBe(16);
    expect(valueOf(uplink, 'button_event')).toBe('short_press');
    expect(pick(uplink, 'button_event').kind).toBe('event');
  });

  it('WS101 reads the 6-byte serial number channel', () => {
    const uplink = run('Milesight', 'WS101', 'ff08' + '6614c3969487');
    expect(uplink.attributes['serial_number']).toBe('6614c3969487');
  });

  it('WS201 reports distance and remaining fill', () => {
    const uplink = run('Milesight', 'WS201', '01756403823E0004D645');
    expect(valueOf(uplink, 'distance')).toBe(62);
    expect(valueOf(uplink, 'remaining')).toBe(69);
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
    expect(uplink.attributes['frequency_weighting']).toBe('A');
    expect(uplink.attributes['time_weighting']).toBe('F');
    expect(valueOf(uplink, 'sound_level', 'current')).toBe(57.5);
    expect(valueOf(uplink, 'sound_level', 'equivalent')).toBe(47.4);
    expect(valueOf(uplink, 'sound_level', 'max')).toBe(61.8);
  });

  it('WS302 key names do not change when the weighting changes', () => {
    const z = run('Milesight', 'WS302', '055B003F02DA016A02');
    expect(z.attributes['frequency_weighting']).toBe('Z');
    expect(z.attributes['time_weighting']).toBe('I');
    expect(valueOf(z, 'sound_level', 'current')).toBe(57.5);
  });
});

describe('Milesight AM308L', () => {
  const uplink = run(
    'Milesight', 'AM308L',
    '0367EE0004687C050001' + '06CB02077DA803087D2500' + '09736627' + '0B7D20000C7D3000',
  );

  it('decodes the full air-quality channel set', () => {
    expect(valueOf(uplink, 'temperature')).toBe(23.8);
    expect(valueOf(uplink, 'humidity')).toBe(62);
    expect(valueOf(uplink, 'pir')).toBe('trigger');
    expect(valueOf(uplink, 'light_level')).toBe(2);
    expect(valueOf(uplink, 'co2')).toBe(936);
    expect(valueOf(uplink, 'tvoc')).toBe(0.37);
    expect(valueOf(uplink, 'pressure')).toBe(1008.6);
    expect(valueOf(uplink, 'pm2_5')).toBe(32);
    expect(valueOf(uplink, 'pm10')).toBe(48);
  });

  it('distinguishes the two tVOC encodings by their type byte', () => {
    const iaq = run('Milesight', 'AM308L', '087d2500');
    const mass = run('Milesight', 'AM308L', '08e62500');
    expect(valueOf(iaq, 'tvoc')).toBe(0.37);
    expect(pick(iaq, 'tvoc').unit).toBe('index');
    expect(valueOf(mass, 'tvoc')).toBe(37);
    expect(pick(mass, 'tvoc').unit).toBe('µg/m³');
  });

  it('reads humidity as two bytes inside history records', () => {
    const history = run('Milesight', 'AM308L', '20ce' + '00105e5f' + '0101' + '7c00' + '01' + '02' + 'a803' + '2500' + '6627' + '2000' + '3000');
    expect(valueOf(history, 'humidity')).toBe(62);
    expect(pick(history, 'humidity').at).toBeDefined();
  });
});

describe('Milesight GS301', () => {
  it('uses shifted channel ids relative to AM308L', () => {
    const uplink = run('Milesight', 'GS301', '01756402671C01036864047D0000057D0100');
    expect(valueOf(uplink, 'temperature')).toBe(28.4);
    expect(valueOf(uplink, 'humidity')).toBe(50);
    expect(valueOf(uplink, 'nh3')).toBe(0);
    expect(valueOf(uplink, 'h2s')).toBe(0.01);
    expect(pick(uplink, 'temperature').channel).toBe('02/67');
  });

  it('reports sensor sentinels as a status rather than a concentration of 65534', () => {
    const warming = run('Milesight', 'GS301', '047dfeff');
    expect(valueOf(warming, 'nh3_status')).toBe('polarizing');
    expect(warming.measurements.find((m) => m.key === 'nh3')).toBeUndefined();
    expect(warming.warnings.some((w) => w.code === 'sensor_fault')).toBe(true);

    const broken = run('Milesight', 'GS301', '057dffff');
    expect(valueOf(broken, 'h2s_status')).toBe('device_error');
  });

  it('decodes the high-resolution H2S channel at 1/1000 ppm', () => {
    expect(valueOf(run('Milesight', 'GS301', '067d0a00'), 'h2s')).toBe(0.01);
  });
});

describe('Milesight VS132', () => {
  const uplink = run(
    'Milesight', 'VS132',
    'FF0101FF166614C39694870000FF090102FF1F84010001' + '03D2BE00000004D23101000005CC00000000',
  );

  it('decodes cumulative and periodic counters', () => {
    expect(valueOf(uplink, 'total_counter', 'in')).toBe(190);
    expect(valueOf(uplink, 'total_counter', 'out')).toBe(305);
    expect(valueOf(uplink, 'periodic_counter', 'in')).toBe(0);
    expect(valueOf(uplink, 'periodic_counter', 'out')).toBe(0);
  });

  it('uses the VS-specific version format, not the EM/WS one', () => {
    expect(uplink.attributes['protocol_version']).toBe(1);
    expect(uplink.attributes['hardware_version']).toBe('1.2');
    expect(uplink.attributes['firmware_version']).toBe('132.1.0.1');
    expect(uplink.attributes['serial_number']).toBe('6614c39694870000');
  });
});

describe('unknown channels', () => {
  it('warns and stops, because the format has no length field to skip with', () => {
    const uplink = run('Milesight', 'WS303', '017564' + 'aabb' + '030001');
    expect(valueOf(uplink, 'battery')).toBe(100);
    expect(uplink.measurements.find((m) => m.key === 'leakage_status')).toBeUndefined();
    const warning = uplink.warnings.find((w) => w.code === 'unknown_channel');
    expect(warning?.channel).toBe('aa/bb');
    expect(warning?.message).toContain('cannot be skipped');
  });

  it('throws in strict mode instead of returning a partial reading', () => {
    expect(() => run('Milesight', 'WS303', '017564aabb', { strict: true })).toThrow();
  });

  it('warns when a channel is cut short mid-field', () => {
    const uplink = run('Milesight', 'EM400-TLD', '0367' + '01');
    expect(uplink.warnings.some((w) => w.code === 'truncated_payload')).toBe(true);
  });
});
