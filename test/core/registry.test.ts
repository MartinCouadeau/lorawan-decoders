import { describe, expect, it } from 'vitest';
import { DecoderRegistry, accessorName } from '../../src/core/registry.js';
import { DecodeError } from '../../src/core/errors.js';
import { decode, isModel, models, registry } from '../../src/index.js';
import type { ModelDefinition } from '../../src/core/types.js';
import { Unit } from '../../src/core/units.js';

const stub = (model: string, aliases?: string[]): ModelDefinition<{ battery?: number }, string> => ({
  vendor: 'Acme', model, description: 'test', source: 'test',
  ...(aliases ? { aliases } : {}),
  keys: { battery: Unit.PERCENT },
  decode: () => ({ readings: [{ key: 'battery', unit: Unit.PERCENT, value: 1 }] }),
});

describe('DecoderRegistry', () => {
  it('matches models regardless of case and separators', () => {
    const r = new DecoderRegistry().register(stub('EM400-TLD'));
    for (const spelling of ['EM400-TLD', 'em400tld', 'EM400 TLD', 'em400_tld', 'EM400.TLD']) {
      expect(r.resolve('acme', spelling)?.model, spelling).toBe('EM400-TLD');
    }
  });

  it('refuses to register two different models under one key', () => {
    const r = new DecoderRegistry().register(stub('A-1'));
    expect(() => r.register(stub('B-1', ['A1']))).toThrow(/collision/);
  });

  it('refuses a decoder whose declared keys are outside the vocabulary', () => {
    const bad = { ...stub('X-1'), keys: { bogus_thing: Unit.PERCENT } } as unknown as ModelDefinition;
    expect(() => new DecoderRegistry().register(bad)).toThrow(/vocabulary/);
    const wrongUnit = { ...stub('X-2'), keys: { battery: Unit.VOLT } } as unknown as ModelDefinition;
    expect(() => new DecoderRegistry().register(wrongUnit)).toThrow(/unit/);
  });

  it('names the failure and suggests the closest model when one is not registered', () => {
    try {
      decode('Milesight', 'EM400-TDL', '00');
      expect.unreachable();
    } catch (error) {
      const e = error as DecodeError;
      expect(e.code).toBe('unknown_model');
      expect(e.message).toContain('did you mean "EM400-TLD"');
      expect(e.context['suggestion']).toBe('EM400-TLD');
    }
  });

  it('gives no suggestion when nothing is close', () => {
    expect(() => decode('Milesight', 'ZZZZZZZZ', '00')).toThrow(/^no decoder for Milesight "ZZZZZZZZ"$/);
  });

  it('never suggests a model from another vendor when the vendor exists', () => {
    expect(() => decode('Netvox', 'WS303', '00')).not.toThrow(/did you mean "WS303"/);
  });

  it('rejects an empty payload', () => {
    expect(() => decode('Milesight', 'WS303', '')).toThrow(DecodeError);
  });

  it('accepts byte arrays and base64 as well as hex strings', () => {
    const fromHex = decode('Milesight', 'EM400-TLD', '01755C0367010104824408050001');
    expect(decode('Milesight', 'EM400-TLD', [0x01, 0x75, 0x5c])).toEqual({ battery: 92 });
    expect(decode('Milesight', 'EM400-TLD', Uint8Array.from([0x01, 0x75, 0x5c]))).toEqual({ battery: 92 });
    expect(decode('Milesight', 'EM400-TLD', 'AXVcA2cBAQSCRAgFAAE=', { encoding: 'base64' })).toEqual(fromHex);
  });

  it('rejects malformed base64 instead of guessing', () => {
    expect(() => decode('Milesight', 'EM400-TLD', 'AXVc!', { encoding: 'base64' })).toThrow(/base64/);
    expect(() => decode('Milesight', 'EM400-TLD', '', { encoding: 'base64' })).toThrow(/empty/);
  });

  it('ships every vendor in the default registry', () => {
    expect(registry.vendors()).toEqual(['Dragino', 'Ellenex', 'Milesight', 'Netvox']);
    expect(registry.list().length).toBeGreaterThan(25);
  });

  it('gives every registered model a documented source', () => {
    for (const def of registry.list()) {
      expect(def.source, def.model).toMatch(/documentation|Repository|manuals/i);
      expect(def.description.length, def.model).toBeGreaterThan(5);
    }
  });
});

describe('isModel and models', () => {
  it('answers with the same normalization as decode', () => {
    for (const spelling of ['EM310-TILT', 'EM310TILT', 'em310_tilt', 'Em310 Tilt']) {
      expect(isModel('milesight', spelling), spelling).toBe(true);
    }
    expect(isModel('milesight', 'EM310-TLT')).toBe(false);
    expect(isModel('acme', 'EM310-TILT')).toBe(false);
  });

  it('lists models with accessor names, aliases and declared keys', () => {
    const netvox = models('netvox');
    expect(netvox.map((m) => m.name)).toEqual(['R718N1', 'R718N3', 'R718N360', 'R718NL1', 'R718NL3']);
    const n3 = netvox.find((m) => m.name === 'R718N3')!;
    expect(n3.accessor).toBe('r718n3');
    expect(n3.aliases).toHaveLength(32);
    expect(n3.fPort).toBe(6);
    expect(n3.keys['current_1']).toBe('mA');
    expect(n3.keys['current_alarm_1']).toBeNull();
  });

  it('lists every vendor when unfiltered', () => {
    expect(new Set(models().map((m) => m.vendor))).toEqual(new Set(['Dragino', 'Ellenex', 'Milesight', 'Netvox']));
  });
});

describe('accessorName', () => {
  it('lowercases and turns separators into underscores', () => {
    expect(accessorName('EM310-TILT')).toBe('em310_tilt');
    expect(accessorName('VS132-P')).toBe('vs132_p');
    expect(accessorName('R718N17E')).toBe('r718n17e');
    expect(accessorName('PLS2-L')).toBe('pls2_l');
    expect(accessorName('  Weird (Name) ')).toBe('weird_name');
  });
});
