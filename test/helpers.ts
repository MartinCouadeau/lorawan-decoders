import { expect } from 'vitest';
import { decode } from '../src/index.js';
import type { Detailed, Options, TelemetryValue } from '../src/core/types.js';
import { KEY_PATTERN, VOCABULARY } from '../src/core/vocabulary.js';

/**
 * Decode with `detailed: true` and assert vocabulary conformance on the way
 * out: every telemetry and history key must exist in VOCABULARY with exactly
 * the unit the vocabulary says. Running this on every test payload is what
 * enforces "one key, one unit" across vendors.
 */
export function run(
  vendor: string,
  model: string,
  hex: string,
  options: Omit<Options, 'detailed'> = {},
): Detailed {
  const d = decode(vendor, model, hex, { ...options, detailed: true });
  for (const [key, unit] of Object.entries(d.units)) {
    expect(key in d.telemetry, `units has "${key}" but telemetry does not`).toBe(true);
    expect(unit, `unit of "${key}"`).toBe(VOCABULARY[key]);
  }
  for (const key of Object.keys(d.telemetry)) checkKey(key, d.units[key] ?? null);
  for (const record of d.history) {
    for (const key of Object.keys(record)) {
      if (key !== 'ts') expect(key in VOCABULARY, `history key "${key}" not in vocabulary`).toBe(true);
    }
  }
  return d;
}

function checkKey(key: string, unit: string | null): void {
  expect(key, `key "${key}" must be snake_case`).toMatch(KEY_PATTERN);
  expect(key in VOCABULARY, `key "${key}" not in vocabulary`).toBe(true);
  expect(unit, `unit of "${key}"`).toBe(VOCABULARY[key]);
}

export function valueOf(d: Detailed, key: string): TelemetryValue | undefined {
  return d.telemetry[key];
}

export function unitOf(d: Detailed, key: string): string | undefined {
  return d.units[key];
}
