import { describe, expect, it } from 'vitest';
import { ByteReader, parseHex, round, toHex } from '../../src/core/reader.js';
import { DecodeError } from '../../src/core/errors.js';

describe('parseHex', () => {
  it('accepts the separator styles that turn up in the wild', () => {
    const expected = Uint8Array.from([0x01, 0x75, 0x5c]);
    for (const input of ['01755c', '01 75 5C', '01:75:5c', '0x01,0x75,0x5C', '01-75-5c']) {
      expect(parseHex(input), input).toEqual(expected);
    }
  });

  it('rejects odd-length and non-hex input rather than guessing', () => {
    expect(() => parseHex('0175c')).toThrow(DecodeError);
    expect(() => parseHex('01zz')).toThrow(DecodeError);
    expect(() => parseHex('')).toThrow(DecodeError);
  });
});

describe('ByteReader', () => {
  it('reads little- and big-endian integers with correct sign', () => {
    const r = new ByteReader(parseHex('0101' + '0101' + 'ffff' + 'ffff'));
    expect(r.u16le()).toBe(257);
    expect(r.u16be()).toBe(257);
    expect(r.i16le()).toBe(-1);
    expect(r.i16be()).toBe(-1);
  });

  it('sign-extends 8-bit values', () => {
    const r = new ByteReader(parseHex('7f80ff'));
    expect(r.i8()).toBe(127);
    expect(r.i8()).toBe(-128);
    expect(r.i8()).toBe(-1);
  });

  it('reads 32-bit values in both endiannesses', () => {
    expect(new ByteReader(parseHex('be000000')).u32le()).toBe(190);
    expect(new ByteReader(parseHex('000000be')).u32be()).toBe(190);
    expect(new ByteReader(parseHex('ffffffff')).i32le()).toBe(-1);
  });

  it('throws with position context instead of returning NaN past the end', () => {
    const r = new ByteReader(parseHex('0175'));
    r.u16le();
    try {
      r.u8();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DecodeError);
      const e = error as DecodeError;
      expect(e.code).toBe('out_of_bounds');
      expect(e.context['offset']).toBe(2);
    }
  });

  it('tracks remaining bytes and trims trailing NULs from ASCII', () => {
    const r = new ByteReader(parseHex('414243000000'));
    expect(r.remaining).toBe(6);
    expect(r.ascii(6)).toBe('ABC');
    expect(r.remaining).toBe(0);
  });
});

describe('round', () => {
  it('avoids float dust', () => {
    expect(round(257 / 10, 1)).toBe(25.7);
    expect(round(1.005, 2)).toBe(1.01);
  });
});

describe('toHex', () => {
  it('round-trips with parseHex', () => {
    expect(toHex(parseHex('00ff7a'))).toBe('00ff7a');
  });
});
