import type { DecodedUplink } from '../core/types.js';
import { flatten } from './flatten.js';

/** ChirpStack v4 expects `{ data }` from `decodeUplink`. */
export interface ChirpStackUplink {
  data: Record<string, unknown>;
}

export function toChirpStack(uplink: DecodedUplink): ChirpStackUplink {
  const { telemetry, history } = flatten(uplink);
  return {
    data: {
      ...telemetry,
      ...(history.length > 0 ? { history } : {}),
      ...(uplink.warnings.length > 0
        ? { _warnings: uplink.warnings.map((w) => w.message) }
        : {}),
    },
  };
}
