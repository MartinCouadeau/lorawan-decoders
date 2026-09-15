import { ByteReader, round } from '../../core/reader.js';
import type { Attributes, DecodeContext, DecodeResult, Reading } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import { isoFromUnix } from '../milesight/attributes.js';

/**
 * Dragino LHT52, 11 bytes, big-endian, fPort 2 (fPort 3 datalog uses the same record):
 *   0-1   SHT temperature, int16, 0.01 °C
 *   2-3   SHT humidity, uint16, 0.1 %
 *   4-5   DS18B20 temperature, int16, 0.01 °C, 0x7FFF absent
 *   6     external sensor type (0x01 = temperature probe)
 *   7-10  unix timestamp of the sample
 */
export const LHT52_FRAME_LENGTH = 11;

export interface Lht52Telemetry {
  temperature?: number;
  humidity?: number;
  temperature_external?: number;
}

export const LHT52_KEYS = {
  temperature: Unit.CELSIUS, humidity: Unit.PERCENT, temperature_external: Unit.CELSIUS,
} as const;

const PROBE_ABSENT = 0x7fff;
const EXT_NAMES: Record<number, string> = { 0x00: 'none', 0x01: 'ds18b20' };

export function decodeLht52(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  if (bytes.length !== LHT52_FRAME_LENGTH) {
    ctx.warn({ code: 'truncated_payload', message: `LHT52 uplinks are exactly ${LHT52_FRAME_LENGTH} bytes; got ${bytes.length}` });
  }
  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
  const attributes: Attributes = {};

  readings.push({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16be() / 100, 2) });
  readings.push({ key: 'humidity', unit: Unit.PERCENT, value: round(r.u16be() / 10, 1) });

  if (r.remaining >= 2) {
    const raw = r.u16be();
    if (raw !== PROBE_ABSENT) {
      readings.push({ key: 'temperature_external', unit: Unit.CELSIUS, value: round(toInt16(raw) / 100, 2) });
    }
  }
  if (r.remaining >= 1) {
    const ext = r.u8();
    attributes['external_sensor'] = EXT_NAMES[ext] ?? `unknown(0x${ext.toString(16)})`;
  }
  if (r.remaining >= 4) {
    attributes['device_time'] = isoFromUnix(r.u32be());
  }

  return { readings, attributes };
}

function toInt16(v: number): number {
  return v > 0x7fff ? v - 0x10000 : v;
}
