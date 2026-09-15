import { describe, expect, expectTypeOf, it } from 'vitest';
import { decode, dragino, ellenex, milesight, models, netvox } from '../../src/index.js';
import { milesight as milesightOnly } from '../../src/milesight.js';
import { netvox as netvoxOnly } from '../../src/netvox.js';
import { ellenex as ellenexOnly } from '../../src/ellenex.js';
import { dragino as draginoOnly } from '../../src/dragino.js';
import type { Detailed } from '../../src/core/types.js';

const EM400 = '01755C0367010104824408050001';

describe('vendor namespaces', () => {
  it('expose one accessor per model name and alias', () => {
    for (const info of models()) {
      const ns = { Milesight: milesight, Netvox: netvox, Ellenex: ellenex, Dragino: dragino }[info.vendor] as
        Record<string, unknown>;
      expect(typeof ns[info.accessor], `${info.vendor}.${info.accessor}`).toBe('function');
      for (const alias of info.aliases) {
        expect(ns[alias.toLowerCase().replace(/[-_. ()]+/g, '_')], alias).toBe(ns[info.accessor]);
      }
    }
  });

  it('return exactly what the dynamic call returns', () => {
    expect(milesight.em400_tld(EM400)).toEqual(decode('milesight', 'EM400-TLD', EM400));
    expect(milesight.em400_tld(EM400, { detailed: true })).toEqual(decode('milesight', 'EM400-TLD', EM400, { detailed: true }));
  });

  it('are frozen', () => {
    expect(Object.isFrozen(milesight)).toBe(true);
  });

  it('carry the model definition for introspection', () => {
    expect(milesight.em400_tld.definition.model).toBe('EM400-TLD');
    expect(netvox.r718n17.definition.model).toBe('R718N1');
  });

  it('are typed per model', () => {
    const t = milesight.em400_tld(EM400);
    expectTypeOf(t).toHaveProperty('distance');
    expectTypeOf(t.distance).toEqualTypeOf<number | undefined>();
    expectTypeOf(t.position).toEqualTypeOf<string | undefined>();
    expectTypeOf(t).not.toHaveProperty('humidity');

    const d = milesight.em400_tld(EM400, { detailed: true });
    expectTypeOf(d).toMatchTypeOf<Detailed>();
    expectTypeOf(d.history).items.toMatchTypeOf<{ ts: string; distance?: number }>();

    expectTypeOf(netvox.r718n3('014A03240064006400643 6').current_2).toEqualTypeOf<number | undefined>();
    expectTypeOf(dragino.lht65n('CBF60B0D02250109C47FFF').temperature_external).toEqualTypeOf<number | undefined>();
    expectTypeOf(ellenex.pls2_l('01E80000D6000022').level).toEqualTypeOf<number | undefined>();
    expectTypeOf(milesight).not.toHaveProperty('em400_tdl');
  });
});

describe('subpath entry points', () => {
  it('expose the same namespaces as the root', () => {
    expect(milesightOnly.em400_tld(EM400)).toEqual(milesight.em400_tld(EM400));
    expect(Object.keys(netvoxOnly).sort()).toEqual(Object.keys(netvox).sort());
    expect(Object.keys(ellenexOnly).sort()).toEqual(Object.keys(ellenex).sort());
    expect(Object.keys(draginoOnly).sort()).toEqual(Object.keys(dragino).sort());
  });
});

describe('decode', () => {
  it('returns the flat object by default and Detailed on request', () => {
    expect(decode('milesight', 'em400-tld', EM400)).toEqual({ battery: 92, temperature: 25.7, distance: 2116, position: 'tilt' });
    const d = decode('milesight', 'em400-tld', EM400, { detailed: true });
    expect(Object.keys(d).sort()).toEqual(['attributes', 'history', 'telemetry', 'units', 'warnings']);
  });

  it('never leaks attributes into telemetry', () => {
    for (const info of models()) {
      // A frame of version attributes on a Milesight model, a version report on Netvox.
      if (info.vendor !== 'Milesight') continue;
      const d = decode('milesight', info.name, 'ff0a0114', { detailed: true });
      expect(d.telemetry, info.name).toEqual({});
    }
  });
});
