import { describe, expect, it } from 'vitest';
import { decodeCbor } from '../../src/vendors/ellenex/cbor.js';
import { DecodeError } from '../../src/core/errors.js';

const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b);

describe('CBOR major types', () => {
  it('reads unsigned integers at every argument width', () => {
    expect(decodeCbor(bytes(0x0a))).toBe(10);              // inline
    expect(decodeCbor(bytes(0x18, 0x64))).toBe(100);       // 1 byte
    expect(decodeCbor(bytes(0x19, 0x01, 0x00))).toBe(256); // 2 bytes
    expect(decodeCbor(bytes(0x1a, 0, 0, 0x01, 0))).toBe(256);            // 4 bytes
    expect(decodeCbor(bytes(0x1b, 0, 0, 0, 0, 0, 0, 0x01, 0))).toBe(256); // 8 bytes
  });

  it('reads negative integers as -1 - argument', () => {
    expect(decodeCbor(bytes(0x20))).toBe(-1);
    expect(decodeCbor(bytes(0x38, 0x63))).toBe(-100);
    expect(decodeCbor(bytes(0x39, 0x01, 0x00))).toBe(-257);
  });

  it('reads byte and text strings', () => {
    expect(decodeCbor(bytes(0x42, 0x01, 0x02))).toEqual(bytes(0x01, 0x02));
    expect(decodeCbor(bytes(0x63, 0x61, 0x62, 0x63))).toBe('abc');
  });

  it('decodes the item inside a tag and discards the tag number', () => {
    expect(decodeCbor(bytes(0xc1, 0x0a))).toBe(10);
  });

  it('reads the simple values', () => {
    expect(decodeCbor(bytes(0xf4))).toBe(false);
    expect(decodeCbor(bytes(0xf5))).toBe(true);
    expect(decodeCbor(bytes(0xf6))).toBe(null);
    expect(decodeCbor(bytes(0xf7))).toBe(null); // undefined
    expect(decodeCbor(bytes(0xf8, 0xff))).toBe(255); // one-byte simple value
  });
});

describe('CBOR half-precision floats', () => {
  it('handles subnormals, infinity and NaN', () => {
    expect(decodeCbor(bytes(0xf9, 0x00, 0x01))).toBeCloseTo(5.96e-8, 10); // subnormal
    expect(decodeCbor(bytes(0xf9, 0x00, 0x00))).toBe(0);
    expect(decodeCbor(bytes(0xf9, 0x7c, 0x00))).toBe(Number.POSITIVE_INFINITY);
    expect(decodeCbor(bytes(0xf9, 0xfc, 0x00))).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(decodeCbor(bytes(0xf9, 0x7e, 0x00)) as number)).toBe(true);
  });
});

describe('CBOR rejects malformed input rather than guessing', () => {
  it('rejects a reserved additional-information value', () => {
    expect(() => decodeCbor(bytes(0x1c))).toThrow(/reserved/);
  });

  it('rejects an integer larger than Number.MAX_SAFE_INTEGER', () => {
    expect(() => decodeCbor(bytes(0x1b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff)))
      .toThrow(/MAX_SAFE_INTEGER/);
  });

  it('rejects a bare break marker', () => {
    expect(() => decodeCbor(bytes(0xff))).toThrow(/bare break/);
  });

  it('rejects a break inside a definite-length array', () => {
    expect(() => decodeCbor(bytes(0x81, 0xff))).toThrow(/definite-length array/);
  });

  it('rejects a break where a map value was expected', () => {
    expect(() => decodeCbor(bytes(0xa1, 0x61, 0x61, 0xff))).toThrow(/map value/);
  });

  it('rejects a break inside a tag', () => {
    expect(() => decodeCbor(bytes(0xc1, 0xff))).toThrow(/inside a tag/);
  });

  it('rejects a map key that is neither text nor integer', () => {
    // key is an array — no sensible object-key form, so we refuse rather than
    // stringify it into "[object Object]".
    expect(() => decodeCbor(bytes(0xa1, 0x81, 0x01, 0x01))).toThrow(/text string nor an integer/);
  });

  it('accepts an integer map key', () => {
    expect(decodeCbor(bytes(0xa1, 0x01, 0x02))).toEqual({ '1': 2 });
  });

  it('reports the offset when the payload ends mid-value', () => {
    try {
      decodeCbor(bytes(0x19, 0x01));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DecodeError);
      expect((error as DecodeError).code).toBe('out_of_bounds');
    }
  });
});
