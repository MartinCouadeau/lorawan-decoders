import { expect } from 'vitest';
import { decode } from '../src/index.js';
import type { DecodeOptions, DecodedUplink, Measurement } from '../src/core/types.js';

export function run(
  vendor: string,
  model: string,
  hex: string,
  options: DecodeOptions = {},
): DecodedUplink {
  return decode({ vendor, model, payload: hex, ...options });
}

/** Find one measurement by key, optionally disambiguated by index. */
export function pick(
  uplink: DecodedUplink,
  key: string,
  index?: number | string,
): Measurement {
  const found = uplink.measurements.find(
    (m) => m.key === key && (index === undefined || m.index === index),
  );
  expect(found, `no measurement "${key}"${index !== undefined ? `[${index}]` : ''} in ${JSON.stringify(uplink.measurements)}`).toBeDefined();
  return found!;
}

export function valueOf(uplink: DecodedUplink, key: string, index?: number | string): unknown {
  return pick(uplink, key, index).value;
}
