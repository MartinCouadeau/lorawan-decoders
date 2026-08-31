import { DecodeError } from '../../core/errors.js';

/**
 * Minimal CBOR reader (RFC 8949), enough for Ellenex Version 6 payloads.
 *
 * Supports what they actually emit: unsigned and negative integers, byte and
 * text strings, arrays, maps in both definite and indefinite form, the break
 * marker, booleans/null, and half-, single- and double-precision floats.
 *
 * Half-precision is the part people skip, and it is the part Ellenex uses most:
 * a 16-bit float costs three bytes on air including the header, which matters
 * at LoRaWAN payload sizes.
 */

export type CborValue =
  | number | string | boolean | null | Uint8Array
  | CborValue[] | { [key: string]: CborValue };

const BREAK = Symbol('cbor-break');

class CborReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  private require(n: number): void {
    if (this.offset + n > this.bytes.length) {
      throw new DecodeError('out_of_bounds', `CBOR payload ended early at offset ${this.offset}`, {
        offset: this.offset, needed: n,
      });
    }
  }

  private u8(): number {
    this.require(1);
    return this.bytes[this.offset++]!;
  }

  /** Reads the argument that follows an initial byte's additional-information field. */
  private argument(ai: number): number {
    switch (ai) {
      case 24: return this.u8();
      case 25: { this.require(2); const v = this.view.getUint16(this.offset); this.offset += 2; return v; }
      case 26: { this.require(4); const v = this.view.getUint32(this.offset); this.offset += 4; return v; }
      case 27: {
        this.require(8);
        const v = this.view.getBigUint64(this.offset);
        this.offset += 8;
        if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new DecodeError('out_of_bounds', 'CBOR integer exceeds Number.MAX_SAFE_INTEGER');
        }
        return Number(v);
      }
      default:
        if (ai < 24) return ai;
        throw new DecodeError('bad_hex', `reserved CBOR additional information ${ai}`);
    }
  }

  read(): CborValue | typeof BREAK {
    const initial = this.u8();
    const major = initial >> 5;
    const ai = initial & 0x1f;

    switch (major) {
      case 0: return this.argument(ai);
      case 1: return -1 - this.argument(ai);
      case 2: {
        const len = this.argument(ai);
        this.require(len);
        const out = this.bytes.slice(this.offset, this.offset + len);
        this.offset += len;
        return out;
      }
      case 3: {
        const len = this.argument(ai);
        this.require(len);
        const out = new TextDecoder().decode(this.bytes.subarray(this.offset, this.offset + len));
        this.offset += len;
        return out;
      }
      case 4: return this.readArray(ai);
      case 5: return this.readMap(ai);
      case 6: {
        this.argument(ai); // tag number: read and ignore, decode the tagged item
        const inner = this.read();
        if (inner === BREAK) throw new DecodeError('bad_hex', 'CBOR break inside a tag');
        return inner;
      }
      case 7: return this.readSimple(ai);
      default:
        throw new DecodeError('bad_hex', `unreachable CBOR major type ${major}`);
    }
  }

  private readArray(ai: number): CborValue[] {
    const out: CborValue[] = [];
    if (ai === 31) {
      for (;;) {
        const v = this.read();
        if (v === BREAK) break;
        out.push(v);
      }
      return out;
    }
    const len = this.argument(ai);
    for (let i = 0; i < len; i++) {
      const v = this.read();
      if (v === BREAK) throw new DecodeError('bad_hex', 'unexpected CBOR break in a definite-length array');
      out.push(v);
    }
    return out;
  }

  private readMap(ai: number): { [key: string]: CborValue } {
    const out: { [key: string]: CborValue } = {};
    const readPair = (): boolean => {
      const key = this.read();
      if (key === BREAK) return false;
      const value = this.read();
      if (value === BREAK) throw new DecodeError('bad_hex', 'CBOR break where a map value was expected');
      // Ellenex uses text-string keys throughout; integer keys are legal CBOR
      // and cheap to accept. Anything else has no sensible object-key form, so
      // reject it rather than stringifying it into "[object Object]".
      if (typeof key !== 'string' && typeof key !== 'number') {
        throw new DecodeError('bad_hex', `CBOR map key is neither a text string nor an integer (${typeof key})`);
      }
      out[String(key)] = value;
      return true;
    };
    if (ai === 31) {
      while (readPair()) { /* indefinite map, terminated by break */ }
      return out;
    }
    const len = this.argument(ai);
    for (let i = 0; i < len; i++) readPair();
    return out;
  }

  private readSimple(ai: number): CborValue | typeof BREAK {
    switch (ai) {
      case 20: return false;
      case 21: return true;
      case 22: return null;
      case 23: return null; // undefined
      case 25: { this.require(2); const v = float16(this.view.getUint16(this.offset)); this.offset += 2; return v; }
      case 26: { this.require(4); const v = this.view.getFloat32(this.offset); this.offset += 4; return v; }
      case 27: { this.require(8); const v = this.view.getFloat64(this.offset); this.offset += 8; return v; }
      case 31: return BREAK;
      default: return this.argument(ai);
    }
  }
}

/** IEEE 754 binary16 -> JS number. */
function float16(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

export function decodeCbor(bytes: Uint8Array): CborValue {
  const reader = new CborReader(bytes);
  const value = reader.read();
  if (typeof value === 'symbol') {
    throw new DecodeError('bad_hex', 'CBOR payload is a bare break marker');
  }
  return value;
}

/** Ellenex V6 payloads are a CBOR map; definite maps start 0xA0–0xB7, indefinite 0xBF. */
export function looksLikeCbor(bytes: Uint8Array): boolean {
  const first = bytes[0];
  if (first === undefined) return false;
  return first === 0xbf || (first >= 0xa0 && first <= 0xb7);
}
