import { ByteReader, round } from '../../core/reader.js';
import type {
  Attributes, DecodeContext, DecodeResult, KeySpec, Reading, Telemetry, TelemetryValue,
} from '../../core/types.js';
import type { Unit } from '../../core/units.js';

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
  reading(r: Reading): void;
  attribute(key: string, value: string | number | boolean): void;
  warn(code: 'sensor_fault' | 'vendor_quirk' | 'undocumented_field', message: string): void;
  channel: string;
}

/**
 * One channel: how many data bytes follow the header, which telemetry keys it
 * can emit (with units, for the vocabulary check and the docs), and how to
 * read it. The type parameter carries the keys so a model's telemetry type is
 * inferred from its channel map.
 */
export interface ChannelSpec<T extends object = Telemetry> {
  /** Data bytes after the two header bytes. */
  length: number;
  keys: KeySpec<T>;
  read(r: ByteReader, emit: ChannelEmit): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChannelMap = Record<string, ChannelSpec<any>>;

type UnionToIntersection<U> =
  (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
type SpecTelemetry<S> = S extends ChannelSpec<infer T> ? T : never;

/** The telemetry type of a whole channel map: every key any channel can emit. */
export type TelemetryOf<M extends ChannelMap> =
  UnionToIntersection<SpecTelemetry<M[keyof M]>> extends infer R extends object ? R : never;

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
 */
export function channelKey(id: number, type: number): string {
  return `${id.toString(16).padStart(2, '0')}/${type.toString(16).padStart(2, '0')}`;
}

export function decodeTlv(bytes: Uint8Array, map: ChannelMap, ctx: DecodeContext): DecodeResult {
  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
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
      reading(m) {
        readings.push(m);
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

  return { readings, attributes };
}

/** Every key any channel in the map can emit, for `ModelDefinition.keys`. */
export function keysOf(map: ChannelMap): Record<string, Unit | null> {
  const out: Record<string, Unit | null> = {};
  for (const spec of Object.values(map)) Object.assign(out, spec.keys);
  return out;
}

// ---------------------------------------------------------------------------
// Field builders. Model maps are written in terms of these, so adding a model
// is a table entry rather than a new parsing loop.
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

export interface NumericOptions<K extends string> {
  key: K;
  type: IntType;
  unit: Unit;
  /** Wire value is divided by this. */
  divisor?: number;
  decimals?: number;
  /** Raw values that mean "no reading", mapped to a fault label on `<key>_status`. */
  sentinels?: Record<number, string>;
}

type NumericT<K extends string> = { [P in K]?: number };
type StatusT<K extends string> = { [P in `${K}_status`]?: string };

export function numeric<K extends string>(
  opts: NumericOptions<K> & { sentinels: Record<number, string> },
): ChannelSpec<NumericT<K> & StatusT<K>>;
export function numeric<K extends string>(opts: NumericOptions<K>): ChannelSpec<NumericT<K>>;
export function numeric<K extends string>(opts: NumericOptions<K>): ChannelSpec<Telemetry> {
  const { key, type, unit, divisor = 1, decimals = divisor === 1 ? 0 : 2, sentinels } = opts;
  const keys: Record<string, Unit | null> = { [key]: unit };
  if (sentinels) keys[`${key}_status`] = null;
  return {
    length: WIDTH[type],
    keys,
    read(r, emit) {
      const raw = readInt(r, type);
      const sentinel = sentinels?.[raw];
      if (sentinel !== undefined) {
        emit.warn('sensor_fault', `${key}: device reported sentinel 0x${raw.toString(16)} (${sentinel})`);
        emit.reading({ key: `${key}_status`, value: sentinel });
        return;
      }
      emit.reading({ key, unit, value: round(raw / divisor, decimals) });
    },
  };
}

export function enumState<K extends string>(
  key: K,
  values: Record<number, string>,
): ChannelSpec<{ [P in K]?: string }> {
  return {
    length: 1,
    keys: { [key]: null } as KeySpec<{ [P in K]?: string }>,
    read(r, emit) {
      const raw = r.u8();
      emit.reading({ key, value: values[raw] ?? `unknown(${raw})` });
    },
  };
}

/** Arbitrary multi-field payload. `length` must match what `read` consumes. */
export function struct<T extends object>(
  length: number,
  keys: KeySpec<T>,
  read: ChannelSpec['read'],
): ChannelSpec<T> {
  return { length, keys, read };
}

/** Device metadata channel: emits an attribute, never telemetry. */
export function attribute(
  length: number,
  key: string,
  format: (r: ByteReader) => TelemetryValue,
): ChannelSpec<Record<never, never>> {
  return {
    length,
    keys: {},
    read(r, emit) {
      emit.attribute(key, format(r));
    },
  };
}
