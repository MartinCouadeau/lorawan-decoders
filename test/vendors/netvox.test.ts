import { describe, expect, it } from 'vitest';
import { pick, run, valueOf } from '../helpers.js';
import { unpackMultipliers } from '../../src/vendors/netvox/frame.js';
import { registry } from '../../src/index.js';

describe('Netvox R718N1 (single phase)', () => {
  // From the Netvox manual: 3.6 V, 3605 mA, multiplier 1.
  const uplink = run('Netvox', 'R718N1', '0149012 40E15 01 00 00 00 00', { fPort: 6 });

  it('decodes the manual worked example', () => {
    expect(valueOf(uplink, 'battery_voltage')).toBe(3.6);
    expect(valueOf(uplink, 'current', 1)).toBe(3605);
    expect(uplink.attributes['current_multiplier']).toBe(1);
  });

  it('separates the low-battery flag from the voltage bits', () => {
    // 0xA4 = flag set + 0x24 (3.6 V). Reading the byte plain would give 16.4 V.
    const low = run('Netvox', 'R718N1', '01490 1A4 0E15 01 00 00000000');
    expect(valueOf(low, 'battery_voltage')).toBe(3.6);
    expect(valueOf(low, 'battery_low')).toBe(true);
    expect(valueOf(uplink, 'battery_low')).toBe(false);
  });

  it('applies the multiplier to the raw milliamp reading', () => {
    const scaled = run('Netvox', 'R718N1', '014901 24 0E15 0A 00 00000000');
    expect(valueOf(scaled, 'current', 1)).toBe(36050);
  });

  it('reads the threshold alarm bits', () => {
    expect(valueOf(run('Netvox', 'R718N1', '01490124 0E15 01 02 00000000'), 'current_alarm', 1))
      .toBe('high_current');
    expect(valueOf(run('Netvox', 'R718N1', '01490124 0E15 01 01 00000000'), 'current_alarm', 1))
      .toBe('low_current');
  });

  it('decodes the version report', () => {
    const version = run('Netvox', 'R718N1', '01 49 00 0A 01 20201224 00 00');
    expect(version.attributes['software_version']).toBe('v1');
    expect(version.attributes['date_code']).toBe('20201224');
  });

  it('warns when the DeviceType does not match the configured model', () => {
    const wrong = run('Netvox', 'R718N1', '014A0124 0E15 01 00 00000000');
    expect(wrong.warnings.some((w) => w.message.includes('does not match'))).toBe(true);
  });

  it('warns when the uplink arrives on the wrong fPort', () => {
    const uplink7 = run('Netvox', 'R718N1', '0149012 40E15 01 00 00 00 00', { fPort: 7 });
    expect(uplink7.warnings.some((w) => w.message.includes('fPort'))).toBe(true);
  });
});

describe('Netvox R718N3 (three phase)', () => {
  it('unpacks the 2-bit multiplier field on ReportType 0x03', () => {
    expect(unpackMultipliers(0x36)).toEqual([10, 5, 100]);
    expect(unpackMultipliers(0x00)).toEqual([1, 1, 1]);
  });

  it('scales all three phases from the packed byte', () => {
    const uplink = run('Netvox', 'R718N3', '014A03 24 0064 0064 0064 36');
    expect(valueOf(uplink, 'current', 1)).toBe(1000); // 100 x 10
    expect(valueOf(uplink, 'current', 2)).toBe(500);  // 100 x 5
    expect(valueOf(uplink, 'current', 3)).toBe(10000); // 100 x 100
    expect(uplink.warnings).toHaveLength(0);
  });

  it('warns rather than guessing when ReportType 0x01 lacks multipliers 2 and 3', () => {
    const uplink = run('Netvox', 'R718N3', '014A01 24 0064 0064 0064 0A');
    expect(valueOf(uplink, 'current', 1)).toBe(1000); // multiplier 1 is present
    expect(valueOf(uplink, 'current', 2)).toBe(100);  // raw, unscaled
    const unscaled = uplink.warnings.filter((w) => w.code === 'unscaled_value');
    expect(unscaled).toHaveLength(2);
    expect(unscaled[0]?.message).toContain('ReportType 0x02');
  });

  it('accepts the missing multipliers from the caller', () => {
    const uplink = run('Netvox', 'R718N3', '014A01 24 0064 0064 0064 0A', {
      scaling: { multiplier2: 5, multiplier3: 100 },
    });
    expect(valueOf(uplink, 'current', 2)).toBe(500);
    expect(valueOf(uplink, 'current', 3)).toBe(10000);
    expect(uplink.warnings).toHaveLength(0);
  });

  it('reads multipliers 2 and 3 from a ReportType 0x02 frame', () => {
    const uplink = run('Netvox', 'R718N3', '014A02 24 05 64 00000000 00');
    expect(uplink.attributes['current_multiplier_2']).toBe(5);
    expect(uplink.attributes['current_multiplier_3']).toBe(100);
  });

  it('decodes per-phase threshold alarms on ReportType 0x04', () => {
    // 0b010001 -> phase 1 low, phase 3 low... bits: 0=low1,1=high1,2=low2,3=high2,4=low3,5=high3
    const uplink = run('Netvox', 'R718N3', '014A04 24 11 000000000000'.replace(/\s/g, '').slice(0, 22));
    expect(valueOf(uplink, 'current_alarm', 1)).toBe('low_current');
    expect(valueOf(uplink, 'current_alarm', 3)).toBe('low_current');
    expect(valueOf(uplink, 'current_alarm', 2)).toBe('normal');
  });
});

describe('Netvox light + current variants', () => {
  it('R718NL1 reads a 4-byte big-endian illuminance', () => {
    const uplink = run('Netvox', 'R718NL1', '019801 24 0E15 01 0000FFFF');
    expect(valueOf(uplink, 'current', 1)).toBe(3605);
    expect(valueOf(uplink, 'illuminance')).toBe(65535);
    expect(pick(uplink, 'illuminance').unit).toBe('lx');
  });

  it('R718NL3 carries illuminance on ReportType 0x02', () => {
    const uplink = run('Netvox', 'R718NL3', '019902 24 05 64 000003E8 00');
    expect(valueOf(uplink, 'illuminance')).toBe(1000);
    expect(uplink.attributes['current_multiplier_3']).toBe(100);
  });
});

describe('Netvox R718N360', () => {
  it('does not assume a battery byte on ReportType 0x02', () => {
    const rt1 = run('Netvox', 'R718N360', '01CA01 24 000003E8 000000');
    expect(valueOf(rt1, 'battery_voltage')).toBe(3.6);
    expect(valueOf(rt1, 'channel', 'A')).toBe(1000);

    const rt2 = run('Netvox', 'R718N360', '01CA02 000003E8 000007D0');
    expect(rt2.measurements.find((m) => m.key === 'battery_voltage')).toBeUndefined();
    expect(valueOf(rt2, 'channel', 'B')).toBe(1000);
    expect(valueOf(rt2, 'channel', 'C')).toBe(2000);
  });
});

describe('the model families collapse', () => {
  it('routes every CT rating and cable variant to one decoder', () => {
    const singlePhase = [
      'R718N1', 'R718N1E', 'R718N17', 'R718N17E', 'R718N115', 'R718N115E',
      'R718N125', 'R718N125E', 'R718N163', 'R718N163E', 'R718N1100', 'R718N1100E',
    ];
    for (const name of singlePhase) {
      expect(registry.resolve('Netvox', name)?.model, name).toBe('R718N1');
    }
  });

  it('routes the three-phase D and E revisions to the three-phase decoder', () => {
    for (const name of ['R718N3', 'R718N37', 'R718N315D', 'R718N363DE', 'R718N3100E']) {
      expect(registry.resolve('Netvox', name)?.model, name).toBe('R718N3');
    }
  });

  it('keeps the light-sensor variants separate — they have their own DeviceType', () => {
    expect(registry.resolve('Netvox', 'R718NL1')?.model).toBe('R718NL1');
    expect(registry.resolve('Netvox', 'R718NL325')?.model).toBe('R718NL3');
  });

  it('rejects an unsupported report type instead of returning empty data', () => {
    expect(() => run('Netvox', 'R718N1', '0149FF 24 0E15 01 00 00000000')).toThrow(/ReportType/);
  });
});
