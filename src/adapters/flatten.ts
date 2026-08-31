import type { DecodedUplink, Measurement } from '../core/types.js';

/**
 * Network servers and time-series databases want flat key/value pairs, not an
 * array of measurement objects. Indexed measurements need disambiguating names:
 * three phases of current become `current_1`, `current_2`, `current_3`, and the
 * tilt axes become `angle_x`/`angle_y`/`angle_z`.
 */
export function flattenKey(m: Measurement): string {
  return m.index === undefined ? m.key : `${m.key}_${m.index}`;
}

export type FlatRecord = Record<string, number | string | boolean | null>;

export interface FlattenResult {
  /** Live readings, flattened. */
  telemetry: FlatRecord;
  /** Buffered readings the device replayed, each with its own timestamp. */
  history: Array<{ ts: number; values: FlatRecord }>;
}

export function flatten(uplink: DecodedUplink): FlattenResult {
  const telemetry: FlatRecord = {};
  const byTimestamp = new Map<string, FlatRecord>();

  for (const m of uplink.measurements) {
    const key = flattenKey(m);
    if (m.at === undefined) {
      telemetry[key] = m.value;
      continue;
    }
    let bucket = byTimestamp.get(m.at);
    if (!bucket) {
      bucket = {};
      byTimestamp.set(m.at, bucket);
    }
    bucket[key] = m.value;
  }

  const history = [...byTimestamp.entries()]
    .map(([at, values]) => ({ ts: Date.parse(at), values }))
    .sort((a, b) => a.ts - b.ts);

  return { telemetry, history };
}
