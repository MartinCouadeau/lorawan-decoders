import type { DecodedUplink } from '../core/types.js';
import { flatten } from './flatten.js';

/**
 * The Things Stack payload formatter contract. Warnings map onto TTN's own
 * `warnings` array, which surfaces them in the console next to the uplink —
 * the right place for "this device sent a channel I do not recognise".
 */
export interface TtnUplink {
  data: Record<string, unknown>;
  warnings: string[];
  errors: string[];
}

export function toTtn(uplink: DecodedUplink): TtnUplink {
  const { telemetry, history } = flatten(uplink);
  return {
    data: { ...telemetry, ...(history.length > 0 ? { history } : {}) },
    warnings: uplink.warnings.map((w) => w.message),
    errors: [],
  };
}
