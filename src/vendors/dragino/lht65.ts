import { ByteReader, round } from '../../core/reader.js';
import type { Attributes, DecodeContext, DecodeResult, Reading } from '../../core/types.js';
import { Unit } from '../../core/units.js';

/**
 * Dragino LHT65 / LHT65N, 11 bytes, big-endian:
 *   0-1   battery: bits 15-14 status, bits 13-0 mV
 *   2-3   SHT temperature, int16, 0.01 °C
 *   4-5   SHT humidity, uint16, 0.1 %
 *   6     external sensor type; bit 7 = configured but disconnected
 *   7-10  external data, layout per byte 6
 * Only type 0x01 (DS18B20) is verified by a vendor example.
 */
export const LHT65_FRAME_LENGTH = 11;

export interface Lht65Telemetry {
  battery_voltage?: number;
  battery_status?: string;
  temperature?: number;
  temperature_external?: number;
  humidity?: number;
  input_level?: string;
  interrupt?: string;
  illuminance?: number;
  input_voltage?: number;
  pulse_count?: number;
}

export const LHT65_KEYS = {
  battery_voltage: Unit.VOLT,
  battery_status: null,
  temperature: Unit.CELSIUS,
  temperature_external: Unit.CELSIUS,
  humidity: Unit.PERCENT,
  input_level: null,
  interrupt: null,
  illuminance: Unit.LUX,
  input_voltage: Unit.VOLT,
  pulse_count: Unit.COUNT,
} as const;

const BATTERY_STATUS: Record<number, string> = {
  0: 'ultra_low', 1: 'low', 2: 'ok', 3: 'good',
};

const EXT_NAMES: Record<number, string> = {
  0x00: 'none',
  0x01: 'ds18b20',
  0x04: 'interrupt',
  0x05: 'illumination',
  0x06: 'adc',
  0x07: 'counter16',
  0x08: 'counter32',
};

/** DS18B20 value when no probe is attached. */
const PROBE_ABSENT = 0x7fff;

export function decodeLht65(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  if (bytes.length !== LHT65_FRAME_LENGTH) {
    ctx.warn({
      code: 'truncated_payload',
      message: `LHT65 uplinks are exactly ${LHT65_FRAME_LENGTH} bytes; got ${bytes.length}`,
    });
  }

  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
  const attributes: Attributes = {};

  const bat = r.u16be();
  const status = bat >> 14;
  readings.push({ key: 'battery_voltage', unit: Unit.VOLT, value: round((bat & 0x3fff) / 1000, 3) });
  readings.push({ key: 'battery_status', value: BATTERY_STATUS[status]! });
  readings.push({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16be() / 100, 2) });
  readings.push({ key: 'humidity', unit: Unit.PERCENT, value: round(r.u16be() / 10, 1) });

  if (r.remaining === 0) return { readings, attributes };

  const extByte = r.u8();
  const extType = extByte & 0x7f;
  const disconnected = (extByte & 0x80) !== 0;
  attributes['external_sensor'] = EXT_NAMES[extType] ?? `unknown(0x${extType.toString(16)})`;

  if (disconnected) {
    ctx.warn({
      code: 'sensor_fault',
      offset: 6,
      message: 'external sensor configured but not connected (byte 6 bit 7)',
    });
  }

  if (r.remaining < 4) return { readings, attributes };

  switch (extType) {
    case 0x00:
      break;
    case 0x01: {
      const raw = r.i16be();
      if (raw === PROBE_ABSENT) {
        if (!disconnected) {
          ctx.warn({ code: 'sensor_fault', offset: 7, message: 'DS18B20 probe absent (0x7FFF)' });
        }
      } else if (!disconnected) {
        readings.push({ key: 'temperature_external', unit: Unit.CELSIUS, value: round(raw / 100, 2) });
      }
      break;
    }
    case 0x04: {
      const level = r.u8();
      const flag = r.u8();
      readings.push({ key: 'input_level', value: level === 1 ? 'high' : 'low' });
      readings.push({ key: 'interrupt', value: flag === 1 ? 'triggered' : 'none' });
      break;
    }
    case 0x05:
      readings.push({ key: 'illuminance', unit: Unit.LUX, value: r.u16be() });
      break;
    case 0x06:
      readings.push({ key: 'input_voltage', unit: Unit.VOLT, value: round(r.u16be() / 1000, 3) });
      break;
    case 0x07:
      readings.push({ key: 'pulse_count', unit: Unit.COUNT, value: r.u16be() });
      break;
    case 0x08:
      readings.push({ key: 'pulse_count', unit: Unit.COUNT, value: r.u32be() });
      break;
    default:
      ctx.warn({
        code: 'undocumented_field',
        offset: 6,
        message: `external sensor type 0x${extType.toString(16)} is not implemented; bytes 7-10 left raw`,
      });
      attributes['external_raw'] = r.hex(4);
  }

  return { readings, attributes };
}
