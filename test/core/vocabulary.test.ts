import { describe, expect, it } from 'vitest';
import { KEY_PATTERN, SENTINEL_LABELS, VOCABULARY, isFaultStatus, isVocabularyKey, vocabularyUnit } from '../../src/core/vocabulary.js';
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
        expect(isVocabularyKey(key), `${def.model} declares "${key}"`).toBe(true);
        expect(unit, `${def.model} unit for "${key}"`).toBe(vocabularyUnit(key));
      }
    }
  });

  it('derives <key>_status only from numeric keys', () => {
    expect(isVocabularyKey('distance_status')).toBe(true);
    expect(vocabularyUnit('distance_status')).toBeNull();
    expect(isVocabularyKey('pir_status')).toBe(false);
    expect(isVocabularyKey('nothing_status')).toBe(false);
    expect(SENTINEL_LABELS).toContain('collection_failed');
    expect(isFaultStatus('collection_failed')).toBe(true);
    expect(isFaultStatus('tilted')).toBe(false);
  });

  it('has no key that no model declares', () => {
    const declared = new Set<string>();
    for (const def of registry.list()) for (const key of Object.keys(def.keys)) declared.add(key);
    const orphans = Object.keys(VOCABULARY).filter((k) => !declared.has(k));
    expect(orphans).toEqual([]);
  });
});
