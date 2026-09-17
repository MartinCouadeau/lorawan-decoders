import { ByteReader, round } from '../../core/reader.js';
import type { Attributes, DecodeContext, DecodeResult, Reading } from '../../core/types.js';
import { Unit } from '../../core/units.js';

/**
 * Dragino LSN50 / LSN50v2, MOD=1, 11 bytes, big-endian:
 *   0-1   battery mV (bits 13-0)
 *   2-3   DS18B20, int16, 0.1 °C, 0x7FFF absent
 *   4-5   ADC on PA0, mV
 *   6     bit 0 interrupt flag, bit 1 PA12 digital input, bits 2-6 MOD-1, bit 7 PB14 level
 *   7-8   SHT temperature, int16, 0.1 °C, 0x7FFF absent
 *   9-10  SHT humidity, uint16, 0.1 %
 * Other MOD values change bytes 2-10 and are not decoded.
 */
export const LSN50_FRAME_LENGTH = 11;

export interface Lsn50Telemetry {
  battery_voltage?: number;
  temperature?: number;
  temperature_status?: string;
  humidity?: number;
  humidity_status?: string;
  temperature_external?: number;
  temperature_external_status?: string;
  input_voltage?: number;
  input_level?: string;
  interrupt?: string;
}

export const LSN50_KEYS = {
  battery_voltage: Unit.VOLT, temperature: Unit.CELSIUS, temperature_status: null, humidity: Unit.PERCENT, humidity_status: null,
  temperature_external: Unit.CELSIUS, temperature_external_status: null, input_voltage: Unit.VOLT, input_level: null, interrupt: null,
} as const;

const ABSENT = 0x7fff;

export function decodeLsn50(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  if (bytes.length !== LSN50_FRAME_LENGTH) {
    ctx.warn({ code: 'truncated_payload', message: `LSN50 MOD=1 uplinks are exactly ${LSN50_FRAME_LENGTH} bytes; got ${bytes.length}` });
  }
  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
  const attributes: Attributes = {};

  readings.push({ key: 'battery_voltage', unit: Unit.VOLT, value: round((r.u16be() & 0x3fff) / 1000, 3) });
  if (r.remaining < 5) return { readings, attributes };

  const ds = r.u16be();
  const adc = r.u16be();
  const flags = r.u8();
  const mode = ((flags & 0x7c) >> 2) + 1;
  attributes['mode'] = mode;

  if (mode !== 1) {
    ctx.warn({
      code: 'undocumented_field',
      offset: 6,
      message: `LSN50 MOD=${mode} is not implemented; only battery decoded`,
    });
    return { readings, attributes };
  }

  // 0x7FFF = sensor not connected. Device state, no warning.
  if (ds === ABSENT) readings.push({ key: 'temperature_external_status', value: 'not_connected' });
  else readings.push({ key: 'temperature_external', unit: Unit.CELSIUS, value: round(toInt16(ds) / 10, 1) });
  readings.push({ key: 'input_voltage', unit: Unit.VOLT, value: round(adc / 1000, 3) });
  readings.push({ key: 'interrupt', value: flags & 0x01 ? 'triggered' : 'none' });
  readings.push({ key: 'input_level', value: flags & 0x02 ? 'high' : 'low' });
  attributes['interrupt_pin'] = flags & 0x80 ? 'high' : 'low';

  if (r.remaining >= 2) {
    const t = r.u16be();
    if (t === ABSENT) readings.push({ key: 'temperature_status', value: 'not_connected' });
    else readings.push({ key: 'temperature', unit: Unit.CELSIUS, value: round(toInt16(t) / 10, 1) });
  }
  if (r.remaining >= 2) {
    const h = r.u16be();
    if (h === ABSENT) readings.push({ key: 'humidity_status', value: 'not_connected' });
    else readings.push({ key: 'humidity', unit: Unit.PERCENT, value: round(h / 10, 1) });
  }

  return { readings, attributes };
}

function toInt16(v: number): number {
  return v > 0x7fff ? v - 0x10000 : v;
}
