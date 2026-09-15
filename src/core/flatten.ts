import type { Attributes, Detailed, Reading, Telemetry, Warning } from './types.js';
import type { Unit } from './units.js';

/**
 * Readings → Detailed. No `at` → telemetry; with `at` → history grouped by
 * timestamp, oldest first. A repeated live key keeps the last value and warns
 * `duplicate_key` through `warn` (so strict mode throws).
 */
export function flatten(
  readings: Reading[],
  attributes: Attributes,
  warnings: Warning[],
  warn: (w: Warning) => void,
): Detailed {
  const telemetry: Telemetry = {};
  const units: Record<string, Unit> = {};
  const byTimestamp = new Map<string, Telemetry>();

  for (const r of readings) {
    if (r.at === undefined) {
      if (r.key in telemetry) {
        warn({ code: 'duplicate_key', message: `"${r.key}" appeared twice in one frame; the later value was kept` });
      }
      telemetry[r.key] = r.value;
      if (r.unit !== undefined) units[r.key] = r.unit;
      else delete units[r.key];
      continue;
    }
    let bucket = byTimestamp.get(r.at);
    if (!bucket) {
      bucket = {};
      byTimestamp.set(r.at, bucket);
    }
    bucket[r.key] = r.value;
  }

  const history = [...byTimestamp.entries()]
    .sort(([a], [b]) => Date.parse(a) - Date.parse(b))
    .map(([ts, values]) => ({ ts, ...values }));

  return { telemetry, units, history, attributes, warnings };
}
