import { describe, expect, it } from 'vitest';
import { flatten } from '../../src/core/flatten.js';
import type { Warning } from '../../src/core/types.js';
import { Unit } from '../../src/core/units.js';

function collect() {
  const warnings: Warning[] = [];
  return { warnings, warn: (w: Warning) => warnings.push(w) };
}

describe('flatten', () => {
  it('separates live readings from buffered ones and records units only for live numeric keys', () => {
    const { warnings, warn } = collect();
    const d = flatten(
      [
        { key: 'battery', unit: Unit.PERCENT, value: 92 },
        { key: 'position', value: 'tilt' },
        { key: 'temperature', unit: Unit.CELSIUS, value: 25.7, at: '2020-09-13T12:26:40.000Z' },
        { key: 'humidity', unit: Unit.PERCENT, value: 50.5, at: '2020-09-13T12:26:40.000Z' },
        { key: 'temperature', unit: Unit.CELSIUS, value: 25.9, at: '2020-09-13T11:26:40.000Z' },
      ],
      { serial_number: 'abc' },
      warnings,
      warn,
    );
    expect(d.telemetry).toEqual({ battery: 92, position: 'tilt' });
    expect(d.units).toEqual({ battery: '%' });
    expect(d.history).toEqual([
      { ts: '2020-09-13T11:26:40.000Z', temperature: 25.9 },
      { ts: '2020-09-13T12:26:40.000Z', temperature: 25.7, humidity: 50.5 },
    ]);
    expect(d.attributes).toEqual({ serial_number: 'abc' });
    expect(d.warnings).toEqual([]);
  });

  it('keeps the last live value for a repeated key and warns', () => {
    const { warnings, warn } = collect();
    const d = flatten(
      [{ key: 'battery', unit: Unit.PERCENT, value: 1 }, { key: 'battery', unit: Unit.PERCENT, value: 2 }],
      {}, warnings, warn,
    );
    expect(d.telemetry).toEqual({ battery: 2 });
    expect(d.warnings).toEqual([expect.objectContaining({ code: 'duplicate_key' })]);
  });

  it('drops a stale unit when the same key is re-emitted without one', () => {
    const { warnings, warn } = collect();
    const d = flatten(
      [{ key: 'x', unit: Unit.PERCENT, value: 1 }, { key: 'x', value: 'gone' }],
      {}, warnings, warn,
    );
    expect(d.units).toEqual({});
  });

  it('returns the same warnings array it was given, so strict mode can throw first', () => {
    const { warnings, warn } = collect();
    warnings.push({ code: 'unknown_channel', message: 'x' });
    expect(flatten([], {}, warnings, warn).warnings).toBe(warnings);
  });
});
