import { ByteReader, round } from '../../core/reader.js';
import type { Attributes, DecodeContext, DecodeResult, Reading } from '../../core/types.js';
import { Unit } from '../../core/units.js';

/**
 * Dragino LDDS75, big-endian:
 *   0-1  battery mV (bits 13-0)
 *   2-3  distance mm; 0 = no ultrasonic sensor, 20 = below 280 mm minimum
 *   4    interrupt flag (firmware ≥ 1.1.4)
 *   5-6  DS18B20, int16, 0.1 °C, 0x7FFF absent
 *   7    ultrasonic sensor flag
 */
export interface Ldds75Telemetry {
  battery_voltage?: number;
  distance?: number;
  interrupt?: string;
  temperature?: number;
}

export const LDDS75_KEYS = {
  battery_voltage: Unit.VOLT, distance: Unit.MILLIMETRE, interrupt: null, temperature: Unit.CELSIUS,
} as const;

const NO_SENSOR = 0x0000;
const BELOW_MINIMUM = 0x0014;
const PROBE_ABSENT = 0x7fff;

export function decodeLdds75(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  if (bytes.length < 4) {
    ctx.warn({ code: 'truncated_payload', message: `LDDS75 uplinks are 4 to 8 bytes; got ${bytes.length}` });
  }
  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
  const attributes: Attributes = {};

  readings.push({ key: 'battery_voltage', unit: Unit.VOLT, value: round((r.u16be() & 0x3fff) / 1000, 3) });

  if (r.remaining < 2) return { readings, attributes };
  const distance = r.u16be();
  if (distance === NO_SENSOR) {
    ctx.warn({ code: 'sensor_fault', offset: 2, message: 'distance 0x0000: no ultrasonic sensor detected' });
  } else if (distance === BELOW_MINIMUM) {
    ctx.warn({ code: 'sensor_fault', offset: 2, message: 'distance 0x0014: object closer than the 280 mm minimum' });
  } else {
    readings.push({ key: 'distance', unit: Unit.MILLIMETRE, value: distance });
  }

  if (r.remaining >= 1) {
    readings.push({ key: 'interrupt', value: r.u8() & 0x01 ? 'triggered' : 'none' });
  }
  if (r.remaining >= 2) {
    const raw = r.u16be();
    if (raw === PROBE_ABSENT) {
      ctx.warn({ code: 'sensor_fault', offset: 5, message: 'DS18B20 probe absent (0x7FFF)' });
    } else {
      readings.push({ key: 'temperature', unit: Unit.CELSIUS, value: round(toInt16(raw) / 10, 1) });
    }
  }
  if (r.remaining >= 1) {
    attributes['ultrasonic_sensor'] = r.u8() === 1 ? 'detected' : 'missing';
  }

  return { readings, attributes };
}

function toInt16(v: number): number {
  return v > 0x7fff ? v - 0x10000 : v;
}
