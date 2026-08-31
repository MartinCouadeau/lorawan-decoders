import { DecodeError } from './errors.js';

/**
 * Bounds-checked cursor over a payload.
 *
 * Every read validates length first. The alternative — indexing straight into
 * the array — yields `undefined`, which silently becomes `NaN` two lines later
 * and reaches your dashboard as a blank tile with no explanation. A truncated
 * uplink is a real and frequent event on LoRaWAN; it should fail loudly at the
 * point of truncation.
 */
export class ByteReader {
  private readonly bytes: Uint8Array;
  private cursor = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get offset(): number {
    return this.cursor;
  }

  get remaining(): number {
    return this.bytes.length - this.cursor;
  }

  get length(): number {
    return this.bytes.length;
  }

  hasAtLeast(n: number): boolean {
    return this.remaining >= n;
  }

  seek(offset: number): void {
    this.require(offset - this.cursor);
    this.cursor = offset;
  }

  skip(n: number): void {
    this.require(n);
    this.cursor += n;
  }

  private require(n: number): void {
    if (n < 0 || this.cursor + n > this.bytes.length) {
      throw new DecodeError(
        'out_of_bounds',
        `payload ended early: needed ${n} byte(s) at offset ${this.cursor}, ${this.remaining} available`,
        { offset: this.cursor, needed: n, remaining: this.remaining },
      );
    }
  }

  /** Read `n` bytes without advancing. */
  peek(n: number): Uint8Array {
    this.require(n);
    return this.bytes.subarray(this.cursor, this.cursor + n);
  }

  take(n: number): Uint8Array {
    this.require(n);
    const slice = this.bytes.subarray(this.cursor, this.cursor + n);
    this.cursor += n;
    return slice;
  }

  u8(): number {
    this.require(1);
    return this.bytes[this.cursor++]!;
  }

  i8(): number {
    const v = this.u8();
    return v > 0x7f ? v - 0x100 : v;
  }

  u16le(): number {
    this.require(2);
    const v = this.bytes[this.cursor]! | (this.bytes[this.cursor + 1]! << 8);
    this.cursor += 2;
    return v >>> 0;
  }

  i16le(): number {
    const v = this.u16le();
    return v > 0x7fff ? v - 0x10000 : v;
  }

  u16be(): number {
    this.require(2);
    const v = (this.bytes[this.cursor]! << 8) | this.bytes[this.cursor + 1]!;
    this.cursor += 2;
    return v >>> 0;
  }

  i16be(): number {
    const v = this.u16be();
    return v > 0x7fff ? v - 0x10000 : v;
  }

  u32le(): number {
    this.require(4);
    const b = this.bytes;
    const i = this.cursor;
    const v = (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
    this.cursor += 4;
    return v;
  }

  i32le(): number {
    const v = this.u32le();
    return v > 0x7fffffff ? v - 0x100000000 : v;
  }

  u32be(): number {
    this.require(4);
    const b = this.bytes;
    const i = this.cursor;
    const v = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    this.cursor += 4;
    return v;
  }

  /** Lowercase hex of the next `n` bytes. */
  hex(n: number): string {
    return toHex(this.take(n));
  }

  /** ASCII string of the next `n` bytes, trailing NULs trimmed. */
  ascii(n: number): string {
    return new TextDecoder('ascii').decode(this.take(n)).replace(/\0+$/, '');
  }
}

const HEX_SEPARATORS = /[\s:,\-_]|0x/gi;

/** Accepts `01 75 5c`, `0x01,0x75`, `01755c`. */
export function parseHex(input: string): Uint8Array {
  const cleaned = input.replace(HEX_SEPARATORS, '');
  if (cleaned.length === 0) {
    throw new DecodeError('empty_payload', 'payload is empty');
  }
  if (cleaned.length % 2 !== 0) {
    throw new DecodeError('bad_hex', `hex payload has an odd number of digits (${cleaned.length})`);
  }
  if (!/^[0-9a-f]+$/i.test(cleaned)) {
    throw new DecodeError('bad_hex', 'payload contains non-hexadecimal characters');
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function toBytes(payload: string | Uint8Array | number[]): Uint8Array {
  if (typeof payload === 'string') return parseHex(payload);
  if (payload instanceof Uint8Array) return payload;
  return Uint8Array.from(payload);
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Round to a fixed number of decimals without the float dust that makes
 * `25.700000000000003` show up on a dashboard.
 */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
