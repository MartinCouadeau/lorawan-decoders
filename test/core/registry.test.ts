import { describe, expect, it } from 'vitest';
import { DecoderRegistry } from '../../src/core/registry.js';
import { DecodeError } from '../../src/core/errors.js';
import { createRegistry, registry } from '../../src/index.js';
import type { ModelDefinition } from '../../src/core/types.js';

const stub = (model: string, aliases?: string[]): ModelDefinition => ({
  vendor: 'Acme', model, description: 'test', source: 'test',
  ...(aliases ? { aliases } : {}),
  decode: () => ({ measurements: [{ key: 'x', kind: 'unknown', value: 1 }] }),
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

  it('names the failure when a model is not registered', () => {
    try {
      registry.decode({ vendor: 'Acme', model: 'Nope', payload: '00' });
      expect.unreachable();
    } catch (error) {
      expect((error as DecodeError).code).toBe('unknown_model');
      expect((error as DecodeError).context['hint']).toContain('registry.list()');
    }
  });

  it('rejects an empty payload', () => {
    expect(() => registry.decode({ vendor: 'Milesight', model: 'WS303', payload: '' }))
      .toThrow(DecodeError);
  });

  it('accepts byte arrays as well as hex strings', () => {
    const fromHex = registry.decode({ vendor: 'Milesight', model: 'WS303', payload: '017564' });
    const fromBytes = registry.decode({ vendor: 'Milesight', model: 'WS303', payload: [0x01, 0x75, 0x64] });
    expect(fromBytes.measurements).toEqual(fromHex.measurements);
    expect(fromBytes.raw).toBe('017564');
  });

  it('can be built with a subset of vendors to keep bundles small', () => {
    const small = createRegistry('milesight');
    expect(small.vendors()).toEqual(['Milesight']);
    expect(small.resolve('Netvox', 'R718N1')).toBeUndefined();
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
