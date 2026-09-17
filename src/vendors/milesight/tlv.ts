import { ByteReader, round } from '../../core/reader.js';
import type {
  Attributes, DecodeContext, DecodeResult, KeySpec, Reading, Telemetry, TelemetryValue,
} from '../../core/types.js';
import type { Unit } from '../../core/units.js';
import { isFaultStatus } from '../../core/vocabulary.js';

/**
 * Milesight frames: repeated `[channel_id, channel_type, data…]`, no length
 * field. Data width comes from the (id, type) table, so an unknown pair ends
 * parsing (the next channel cannot be located). We stop like the vendor
 * decoder does, but warn with the pair and the bytes dropped.
 */

export interface ChannelEmit {
  reading(r: Reading): void;
  attribute(key: string, value: string | number | boolean): void;
  warn(code: 'sensor_fault' | 'vendor_quirk' | 'undocumented_field' | 'unscaled_value', message: string): void;
  channel: string;
}

/** Data bytes after the two header bytes. A function when the width depends on the data (VS351 history); it may only peek. */
export type ChannelLength = number | ((r: ByteReader) => number);

/** One channel: data length after the 2-byte header, keys it emits, reader. `T` carries the keys for type inference. */
export interface ChannelSpec<T extends object = Telemetry> {
  length: ChannelLength;
  keys: KeySpec<T>;
  read(r: ByteReader, emit: ChannelEmit): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChannelMap = Record<string, ChannelSpec<any>>;

type UnionToIntersection<U> =
  (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
type SpecTelemetry<S> = S extends ChannelSpec<infer T> ? T : never;

/** Union of every key a channel map can emit. */
export type TelemetryOf<M extends ChannelMap> =
  UnionToIntersection<SpecTelemetry<M[keyof M]>> extends infer R extends object ? R : never;

/**
 * Map key `"03/67"` = channel id 0x03, type 0x67. Both bytes are needed: the
 * same id means different things per model (`03/00` = magnet on WS301, leak on
 * WS303) and the same type appears on several ids. Id with bit 7 set is the
 * alarm variant (`83/67` = `03/67` + alarm byte); id `0xff` is metadata.
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
        message: `unknown channel ${key} at offset ${r.offset - 2}; no length field, so the remaining ${dropped} byte(s) cannot be skipped`,
      });
      break;
    }

    const length = typeof spec.length === 'number' ? spec.length : spec.length(r);
    if (!r.hasAtLeast(length)) {
      ctx.warn({
        code: 'truncated_payload',
        channel: key,
        offset: r.offset,
        message: `channel ${key} needs ${length} byte(s) but only ${r.remaining} remain`,
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
    // A spec consuming the wrong length would desync every later channel.
    const consumed = r.offset - before;
    if (consumed !== length) {
      throw new Error(
        `decoder bug: channel ${key} declares length ${length} but consumed ${consumed} bytes`,
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

/** Merged `keys` of every channel in the map. */
export function keysOf(map: ChannelMap): Record<string, Unit | null> {
  const out: Record<string, Unit | null> = {};
  for (const spec of Object.values(map)) Object.assign(out, spec.keys);
  return out;
}

// --- Channel builders ---------------------------------------------------------

export type IntType = 'u8' | 'i8' | 'u16le' | 'i16le' | 'u32le' | 'i32le';

const WIDTH: Record<IntType, number> = {
  u8: 1, i8: 1, u16le: 2, i16le: 2, u32le: 4, i32le: 4,
};

/** Reads one integer. `unsigned` is the wire pattern (for sentinel matching), `value` the signed interpretation. */
function readRaw(r: ByteReader, type: IntType): { unsigned: number; value: number } {
  switch (type) {
    case 'u8': { const u = r.u8(); return { unsigned: u, value: u }; }
    case 'i8': { const u = r.u8(); return { unsigned: u, value: u > 0x7f ? u - 0x100 : u }; }
    case 'u16le': { const u = r.u16le(); return { unsigned: u, value: u }; }
    case 'i16le': { const u = r.u16le(); return { unsigned: u, value: u > 0x7fff ? u - 0x10000 : u }; }
    case 'u32le': { const u = r.u32le(); return { unsigned: u, value: u }; }
    case 'i32le': { const u = r.u32le(); return { unsigned: u, value: u > 0x7fffffff ? u - 0x100000000 : u }; }
  }
}

/** Wire patterns that mean "no reading" → label on `<key>_status`. Fault labels also warn (vocabulary FAULT_STATUS). */
export type Sentinels = Record<number, string>;

export interface NumberField<K extends string = string> {
  key: K;
  type: IntType;
  unit: Unit;
  /** Wire value is divided by this. */
  divisor?: number;
  decimals?: number;
  sentinels?: Sentinels;
}

/**
 * Reads one numeric field and emits it, or its sentinel status. Sentinels are
 * matched on the unsigned wire pattern, so 0xFFFF on an int16 field is caught
 * before it becomes -1. Fault labels warn; state labels do not. Shared by
 * `numeric()` and the struct/history readers.
 */
export function readNumber(r: ByteReader, emit: Pick<ChannelEmit, 'reading' | 'warn'>, field: NumberField): void {
  const { key, type, unit, divisor = 1, decimals = divisor === 1 ? 0 : 2, sentinels } = field;
  const { unsigned, value } = readRaw(r, type);
  const sentinel = sentinels?.[unsigned];
  if (sentinel !== undefined) {
    if (isFaultStatus(sentinel)) {
      emit.warn('sensor_fault', `${key}: device reported 0x${unsigned.toString(16)} (${sentinel}); no reading`);
    }
    emit.reading({ key: `${key}_status`, value: sentinel });
    return;
  }
  emit.reading({ key, unit, value: round(value / divisor, decimals) });
}

export type NumericOptions<K extends string> = NumberField<K>;

type NumericT<K extends string> = { [P in K]?: number };
type StatusT<K extends string> = { [P in `${K}_status`]?: string };

export function numeric<K extends string>(
  opts: NumericOptions<K> & { sentinels: Sentinels },
): ChannelSpec<NumericT<K> & StatusT<K>>;
export function numeric<K extends string>(opts: NumericOptions<K>): ChannelSpec<NumericT<K>>;
export function numeric<K extends string>(opts: NumericOptions<K>): ChannelSpec<Telemetry> {
  const keys: Record<string, Unit | null> = { [opts.key]: opts.unit };
  if (opts.sentinels) keys[`${opts.key}_status`] = null;
  return {
    length: WIDTH[opts.type],
    keys,
    read(r, emit) {
      readNumber(r, emit, opts);
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
  length: ChannelLength,
  keys: KeySpec<T>,
  read: ChannelSpec['read'],
): ChannelSpec<T> {
  return { length, keys, read };
}

/** Metadata channel: emits an attribute, no telemetry. */
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
