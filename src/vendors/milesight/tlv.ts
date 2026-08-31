import { ByteReader, round } from '../../core/reader.js';
import type { DecodeContext, DecodeResult, Measurement, Attributes } from '../../core/types.js';
import type { QuantityKind, Unit } from '../../core/units.js';

/**
 * Milesight's wire format is a stream of `[channel_id, channel_type, data…]`
 * triples with **no length field**. The width of `data` is implied by the
 * (id, type) pair, so a parser must carry the full table for the model: an
 * unknown pair means you no longer know where the next channel starts, and
 * resynchronising is impossible.
 *
 * Milesight's own decoders `break` out of the loop there and return whatever
 * they had, silently discarding the rest of the payload. We do the same — you
 * cannot do better without a length field — but we emit a warning saying which
 * pair stopped us and how many bytes were dropped, so the gap shows up in logs
 * instead of as a mysteriously absent reading.
 */

export interface ChannelEmit {
  measurement(m: Measurement): void;
  attribute(key: string, value: string | number | boolean): void;
  warn(code: 'sensor_fault' | 'vendor_quirk' | 'undocumented_field', message: string): void;
  channel: string;
}

export interface ChannelSpec {
  /** Data bytes after the two header bytes. */
  length: number;
  read(r: ByteReader, emit: ChannelEmit): void;
}

export type ChannelMap = Record<string, ChannelSpec>;

/**
 * Builds the map key for a channel: `"03/67"` is channel id 0x03, channel type
 * 0x67. Two numbers because they are two separate bytes on the wire, and you
 * need both to identify a reading:
 *
 *   01 75 5C   03 67 01 01   04 82 44 08   05 00 01
 *   |  |  +- 92 %  |  |  +------ 25.7 C
 *   |  +----- type: what kind of quantity, and therefore how wide the
 *   |           data is and how it scales (0x67 is always int16 LE, tenths)
 *   +-------- id: which slot on the device
 *
 * Neither byte is sufficient alone:
 *
 *  - **id alone**: the same slot means different things on different models.
 *    `03/00` is the door magnet on a WS301 and the leak sensor on a WS303.
 *  - **type alone**: a device can report the same type on several slots. The
 *    AM308L puts PM2.5 on `0b/7d` and PM10 on `0c/7d`. And the reverse --
 *    `08/7d` is tVOC as an index while `08/e6` is tVOC in ug/m3, same slot,
 *    different unit.
 *
 * Two conventions worth knowing: an id with the high bit set is the alarm
 * variant of the same channel (`83/67` is `03/67` plus a trailing alarm byte),
 * and id `0xff` is a reserved namespace for device metadata rather than sensor
 * readings.
 *
 * Some type bytes line up with Cayenne LPP / IPSO -- 0x00 digital input, 0x67
 * temperature, 0x68 humidity, 0x73 barometer, 0x7d concentration, 0x82
 * distance. Others (0x75 battery, 0xce history, 0xcf tilt, 0xd2 counter) are
 * Milesight's own. Milesight does not document this correspondence anywhere;
 * it is an observed pattern, useful for guessing at an unfamiliar type byte
 * and not safe to rely on.
 */
export function channelKey(id: number, type: number): string {
  return `${id.toString(16).padStart(2, '0')}/${type.toString(16).padStart(2, '0')}`;
}

export function decodeTlv(bytes: Uint8Array, map: ChannelMap, ctx: DecodeContext): DecodeResult {
  const r = new ByteReader(bytes);
  const measurements: Measurement[] = [];
  const attributes: Attributes = {};

  while (r.remaining >= 2) {
    const id = r.u8();
    const type = r.u8();
    const key = channelKey(id, type);
    const spec = map[key];

    if (!spec) {
      const dropped = r.remaining;
      ctx.warn({
        code: 'unknown_channel',
        channel: key,
        offset: r.offset - 2,
        message:
          `unknown channel ${key} at offset ${r.offset - 2}; Milesight payloads carry no length ` +
          `field, so the remaining ${dropped} byte(s) cannot be skipped and were dropped`,
      });
      break;
    }

    if (!r.hasAtLeast(spec.length)) {
      ctx.warn({
        code: 'truncated_payload',
        channel: key,
        offset: r.offset,
        message: `channel ${key} needs ${spec.length} byte(s) but only ${r.remaining} remain`,
      });
      break;
    }

    const emit: ChannelEmit = {
      channel: key,
      measurement(m) {
        measurements.push({ channel: key, ...m });
      },
      attribute(k, v) {
        attributes[k] = v;
      },
      warn(code, message) {
        ctx.warn({ code, channel: key, offset: r.offset, message });
      },
    };

    const before = r.offset;
    spec.read(r, emit);
    // Defensive: a spec that reads the wrong number of bytes would desynchronise
    // everything after it, and the symptom would appear on an unrelated channel.
    const consumed = r.offset - before;
    if (consumed !== spec.length) {
      throw new Error(
        `decoder bug: channel ${key} declares length ${spec.length} but consumed ${consumed} bytes`,
      );
    }
  }

  if (r.remaining === 1) {
    ctx.warn({
      code: 'truncated_payload',
      offset: r.offset,
      message: 'trailing single byte: a channel header needs 2 bytes',
    });
  }

  return { measurements, attributes };
}

// ---------------------------------------------------------------------------
// Field builders. Model maps below are written in terms of these, so adding a
// model is a table entry rather than a new parsing loop.
// ---------------------------------------------------------------------------

type IntType = 'u8' | 'i8' | 'u16le' | 'i16le' | 'u32le' | 'i32le';

const WIDTH: Record<IntType, number> = {
  u8: 1, i8: 1, u16le: 2, i16le: 2, u32le: 4, i32le: 4,
};

function readInt(r: ByteReader, type: IntType): number {
  switch (type) {
    case 'u8': return r.u8();
    case 'i8': return r.i8();
    case 'u16le': return r.u16le();
    case 'i16le': return r.i16le();
    case 'u32le': return r.u32le();
    case 'i32le': return r.i32le();
  }
}

export interface NumericOptions {
  key: string;
  kind: QuantityKind;
  type: IntType;
  unit?: Unit;
  /** Wire value is divided by this. */
  divisor?: number;
  decimals?: number;
  index?: number | string;
  /** Raw values that mean "no reading", mapped to a fault label. */
  sentinels?: Record<number, string>;
}

export function numeric(opts: NumericOptions): ChannelSpec {
  const { key, kind, type, unit, divisor = 1, decimals = divisor === 1 ? 0 : 2, index, sentinels } = opts;
  return {
    length: WIDTH[type],
    read(r, emit) {
      const raw = readInt(r, type);
      const sentinel = sentinels?.[raw];
      if (sentinel !== undefined) {
        emit.warn('sensor_fault', `${key}: device reported sentinel 0x${raw.toString(16)} (${sentinel})`);
        emit.measurement({
          key: `${key}_status`, value: sentinel, kind: 'state', code: raw,
          ...(index !== undefined ? { index } : {}),
        });
        return;
      }
      emit.measurement({
        key, kind, value: round(raw / divisor, decimals),
        ...(unit ? { unit } : {}), ...(index !== undefined ? { index } : {}),
      });
    },
  };
}

export function enumState(
  key: string,
  values: Record<number, string>,
  kind: QuantityKind = 'state',
): ChannelSpec {
  return {
    length: 1,
    read(r, emit) {
      const raw = r.u8();
      emit.measurement({ key, kind, value: values[raw] ?? `unknown(${raw})`, code: raw });
    },
  };
}

/** Arbitrary multi-field payload. `length` must match what `read` consumes. */
export function struct(length: number, read: ChannelSpec['read']): ChannelSpec {
  return { length, read };
}

export function attribute(
  length: number,
  key: string,
  format: (r: ByteReader) => string | number | boolean,
): ChannelSpec {
  return {
    length,
    read(r, emit) {
      emit.attribute(key, format(r));
    },
  };
}
