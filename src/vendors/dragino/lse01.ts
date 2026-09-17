import { ByteReader, round } from '../../core/reader.js';
import type { Attributes, DecodeContext, DecodeResult, Reading } from '../../core/types.js';
import { Unit } from '../../core/units.js';

/**
 * Dragino LSE01, 11 bytes, big-endian:
 *   0-1   battery mV (bits 13-0)
 *   2-3   DS18B20 temperature; manual marks it "reserve, ignore now"
 *   4-5   soil moisture, uint16, 0.01 %
 *   6-7   soil temperature, int16, 0.01 °C
 *   8-9   soil conductivity, uint16, µS/cm
 *   10    bit 7 MOD (1 = raw AD values), bit 0 interrupt flag
 * MOD=1 (firmware ≥ 1.2.1) replaces bytes 4-9 with raw conductivity, raw
 * moisture and raw dielectric constant. Kept in attributes, not telemetry.
 */
export const LSE01_FRAME_LENGTH = 11;

export interface Lse01Telemetry {
  battery_voltage?: number;
  soil_moisture?: number;
  soil_temperature?: number;
  conductivity?: number;
  interrupt?: string;
}

export const LSE01_KEYS = {
  battery_voltage: Unit.VOLT, soil_moisture: Unit.PERCENT, soil_temperature: Unit.CELSIUS,
  conductivity: Unit.MICROSIEMENS_PER_CM, interrupt: null,
} as const;

export function decodeLse01(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  if (bytes.length !== LSE01_FRAME_LENGTH) {
    ctx.warn({ code: 'truncated_payload', message: `LSE01 uplinks are exactly ${LSE01_FRAME_LENGTH} bytes; got ${bytes.length}` });
  }
  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
  const attributes: Attributes = {};

  readings.push({ key: 'battery_voltage', unit: Unit.VOLT, value: round((r.u16be() & 0x3fff) / 1000, 3) });
  if (r.remaining < 8) return { readings, attributes };

  attributes['reserved'] = r.hex(2);
  const a = r.u16be();
  const b = r.u16be();
  const c = r.u16be();
  const flags = r.remaining >= 1 ? r.u8() : 0;
  const mode = (flags >> 7) & 0x01;
  attributes['mode'] = mode;

  if (mode === 1) {
    attributes['conductivity_raw'] = a;
    attributes['moisture_raw'] = b;
    attributes['dielectric_raw'] = c;
    ctx.warn({
      code: 'unscaled_value',
      offset: 10,
      message: 'LSE01 MOD=1 sends raw AD values; kept in attributes, no soil telemetry',
    });
  } else {
    readings.push({ key: 'soil_moisture', unit: Unit.PERCENT, value: round(a / 100, 2) });
    readings.push({ key: 'soil_temperature', unit: Unit.CELSIUS, value: round(toInt16(b) / 100, 2) });
    readings.push({ key: 'conductivity', unit: Unit.MICROSIEMENS_PER_CM, value: c });
  }
  readings.push({ key: 'interrupt', value: flags & 0x01 ? 'triggered' : 'none' });

  return { readings, attributes };
}

function toInt16(v: number): number {
  return v > 0x7fff ? v - 0x10000 : v;
}
