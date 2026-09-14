import { ByteReader, round } from '../../core/reader.js';
import type { Attributes, DecodeContext, DecodeResult, Measurement } from '../../core/types.js';
import { Unit } from '../../core/units.js';

/**
 * Dragino LHT65 / LHT65N: fixed 11-byte frame, big-endian throughout.
 *
 *   bytes 0-1   battery: bits 15-14 status, bits 13-0 millivolts
 *   bytes 2-3   built-in SHT temperature, int16, 1/100 C
 *   bytes 4-5   built-in SHT humidity, uint16, 1/10 %
 *   byte 6      external sensor type; bit 7 set = probe configured but not
 *               connected (firmware 1.8 and later)
 *   bytes 7-10  external sensor data, layout depends on byte 6
 *
 * The external block is where the format forks. Type 0x01 (DS18B20 probe) is
 * the one Dragino ships in the box and the one verified by a worked example;
 * the others are implemented from the manual and not verified against hardware.
 */
export const LHT65_FRAME_LENGTH = 11;

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

/** DS18B20 reports 0x7FFF when no probe is attached. */
const PROBE_ABSENT = 0x7fff;

export function decodeLht65(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  if (bytes.length !== LHT65_FRAME_LENGTH) {
    ctx.warn({
      code: 'truncated_payload',
      message: `LHT65 uplinks are exactly ${LHT65_FRAME_LENGTH} bytes; got ${bytes.length}`,
    });
  }

  const r = new ByteReader(bytes);
  const measurements: Measurement[] = [];
  const attributes: Attributes = {};

  const bat = r.u16be();
  const status = bat >> 14;
  measurements.push({
    key: 'battery_voltage', kind: 'battery', unit: Unit.VOLT,
    value: round((bat & 0x3fff) / 1000, 3), channel: 'bytes 0-1',
  });
  measurements.push({
    key: 'battery_status', kind: 'state', value: BATTERY_STATUS[status]!, code: status, channel: 'bytes 0-1',
  });
  measurements.push({
    key: 'temperature', kind: 'temperature', unit: Unit.CELSIUS, index: 'internal',
    value: round(r.i16be() / 100, 2), channel: 'bytes 2-3',
  });
  measurements.push({
    key: 'humidity', kind: 'humidity', unit: Unit.PERCENT,
    value: round(r.u16be() / 10, 1), channel: 'bytes 4-5',
  });

  if (r.remaining === 0) return { measurements, attributes };

  const extByte = r.u8();
  const extType = extByte & 0x7f;
  const disconnected = (extByte & 0x80) !== 0;
  attributes['external_sensor'] = EXT_NAMES[extType] ?? `unknown(0x${extType.toString(16)})`;

  if (disconnected) {
    ctx.warn({
      code: 'sensor_fault',
      offset: 6,
      message: 'external sensor configured but reports not connected (bit 7 of byte 6 set)',
    });
  }

  if (r.remaining < 4) return { measurements, attributes };

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
        measurements.push({
          key: 'temperature', kind: 'temperature', unit: Unit.CELSIUS, index: 'external',
          value: round(raw / 100, 2), channel: 'bytes 7-8',
        });
      }
      break;
    }
    case 0x04: {
      const level = r.u8();
      const flag = r.u8();
      measurements.push({
        key: 'input_level', kind: 'state', value: level === 1 ? 'high' : 'low', code: level, channel: 'byte 7',
      });
      measurements.push({
        key: 'interrupt', kind: 'event', value: flag === 1 ? 'triggered' : 'none', code: flag, channel: 'byte 8',
      });
      break;
    }
    case 0x05:
      measurements.push({
        key: 'illuminance', kind: 'illuminance', unit: Unit.LUX, value: r.u16be(), channel: 'bytes 7-8',
      });
      break;
    case 0x06:
      measurements.push({
        key: 'adc_voltage', kind: 'voltage', unit: Unit.MILLIVOLT, value: r.u16be(), channel: 'bytes 7-8',
      });
      break;
    case 0x07:
      measurements.push({
        key: 'count', kind: 'counter', unit: Unit.COUNT, value: r.u16be(), channel: 'bytes 7-8',
      });
      break;
    case 0x08:
      measurements.push({
        key: 'count', kind: 'counter', unit: Unit.COUNT, value: r.u32be(), channel: 'bytes 7-10',
      });
      break;
    default:
      ctx.warn({
        code: 'undocumented_field',
        offset: 6,
        message: `external sensor type 0x${extType.toString(16)} is not implemented; bytes 7-10 left raw`,
      });
      attributes['external_raw'] = r.hex(4);
  }

  return { measurements, attributes };
}
