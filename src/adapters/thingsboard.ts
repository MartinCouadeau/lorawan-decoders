import type { DecodedUplink } from '../core/types.js';
import { flatten, type FlatRecord } from './flatten.js';

/**
 * ThingsBoard's uplink converter contract.
 *
 * The `telemetry` array form is used rather than a bare object so that buffered
 * readings keep their own timestamps: a device that has been offline for six
 * hours and replays its history should produce six hours of correctly-dated
 * points, not six identical points stamped with the moment the gateway
 * reconnected. That distinction is invisible until someone looks at a chart and
 * finds a vertical line where a day of data should be.
 */
export interface ThingsBoardUplink {
  deviceName: string;
  deviceType: string;
  attributes: Record<string, unknown>;
  telemetry: Array<{ ts: number; values: FlatRecord }>;
}

export interface ThingsBoardOptions {
  deviceName: string;
  deviceType?: string;
  /** Receive time in epoch milliseconds. Defaults to now. */
  ts?: number;
  /** Include decode warnings as an attribute. Useful while commissioning. */
  includeWarnings?: boolean;
}

export function toThingsBoard(uplink: DecodedUplink, opts: ThingsBoardOptions): ThingsBoardUplink {
  const { telemetry, history } = flatten(uplink);
  const ts = opts.ts ?? Date.now();

  const points = [...history];
  if (Object.keys(telemetry).length > 0) {
    points.push({ ts, values: telemetry });
  }

  const attributes: Record<string, unknown> = {
    ...uplink.attributes,
    vendor: uplink.vendor,
    model: uplink.model,
  };
  if (opts.includeWarnings && uplink.warnings.length > 0) {
    attributes['decode_warnings'] = uplink.warnings.map((w) => `${w.code}: ${w.message}`);
  }

  return {
    deviceName: opts.deviceName,
    deviceType: opts.deviceType ?? `${uplink.vendor} ${uplink.model}`,
    attributes,
    telemetry: points.sort((a, b) => a.ts - b.ts),
  };
}
