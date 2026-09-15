import { describe, expect, it } from 'vitest';
import { KEY_PATTERN, VOCABULARY } from '../../src/core/vocabulary.js';
import { Unit } from '../../src/core/units.js';
import { registry } from '../../src/index.js';

describe('telemetry vocabulary', () => {
  it('uses snake_case ASCII keys only', () => {
    for (const key of Object.keys(VOCABULARY)) expect(key).toMatch(KEY_PATTERN);
  });

  it('maps every key to a known unit or to null', () => {
    const units = new Set<string>(Object.values(Unit));
    for (const [key, unit] of Object.entries(VOCABULARY)) {
      expect(unit === null || units.has(unit), key).toBe(true);
    }
  });

  it('reserves raw for _raw keys and a few documented raw-count channels', () => {
    const allowedRaw = new Set(['adc_raw', 'sensor_reading', 'channel_1', 'channel_2', 'channel_3']);
    for (const [key, unit] of Object.entries(VOCABULARY)) {
      if (unit === Unit.RAW) expect(key.endsWith('_raw') || allowedRaw.has(key), key).toBe(true);
    }
  });

  it('is fully declared by every registered model', () => {
    for (const def of registry.list()) {
      for (const [key, unit] of Object.entries(def.keys)) {
        expect(key in VOCABULARY, `${def.model} declares "${key}"`).toBe(true);
        expect(unit, `${def.model} unit for "${key}"`).toBe(VOCABULARY[key]);
      }
    }
  });

  it('has no key that no model declares', () => {
    const declared = new Set<string>();
    for (const def of registry.list()) for (const key of Object.keys(def.keys)) declared.add(key);
    const orphans = Object.keys(VOCABULARY).filter((k) => !declared.has(k));
    expect(orphans).toEqual([]);
  });
});
