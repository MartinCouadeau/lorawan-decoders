import { round } from '../../core/reader.js';
import { DecodeError } from '../../core/errors.js';
import type { DecodeContext, DecodeResult, Measurement } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import type { QuantityKind } from '../../core/units.js';
import { decodeCbor } from './cbor.js';

/**
 * Ellenex Version 6 payloads are a CBOR map with short text keys, so there are
 * no byte offsets to get wrong — but the key vocabulary is undocumented outside
 * their decoder sources, and it is case-sensitive in a way that will bite you:
 *
 *   `v` is battery voltage in millivolts.
 *   `V` is a raw voltage input channel, also in millivolts.
 *
 * One character apart, different meanings, both plausible on the same device.
 */

interface KeySpec {
  key: string;
  kind: QuantityKind;
  unit: Unit;
  /** Wire value divided by this. */
  divisor?: number;
  decimals?: number;
}

const KEYS: Record<string, KeySpec> = {
  v: { key: 'battery_voltage', kind: 'battery', unit: Unit.VOLT, divisor: 1000, decimals: 3 },
  P: { key: 'pressure', kind: 'pressure', unit: Unit.BAR, decimals: 4 },
  DP: { key: 'differential_pressure', kind: 'differential_pressure', unit: Unit.BAR, decimals: 4 },
  T: { key: 'temperature', kind: 'temperature', unit: Unit.CELSIUS, decimals: 2 },
  L: { key: 'level', kind: 'level', unit: Unit.METRE, decimals: 4 },
  D: { key: 'distance', kind: 'distance', unit: Unit.METRE, decimals: 4 },
  mA: { key: 'current', kind: 'current', unit: Unit.MILLIAMPERE, divisor: 1000, decimals: 3 },
  mA1: { key: 'current', kind: 'current', unit: Unit.MILLIAMPERE, divisor: 1000, decimals: 3 },
  mA2: { key: 'current', kind: 'current', unit: Unit.MILLIAMPERE, divisor: 1000, decimals: 3 },
  mA3: { key: 'current', kind: 'current', unit: Unit.MILLIAMPERE, divisor: 1000, decimals: 3 },
  mA4: { key: 'current', kind: 'current', unit: Unit.MILLIAMPERE, divisor: 1000, decimals: 3 },
  V: { key: 'input_voltage', kind: 'voltage', unit: Unit.VOLT, divisor: 1000, decimals: 3 },
  mV: { key: 'adc_raw', kind: 'unknown', unit: Unit.RAW },
  Pu: { key: 'pulse_count', kind: 'counter', unit: Unit.COUNT },
  DC: { key: 'dry_contact', kind: 'state', unit: Unit.INDEX },
};

const CHANNEL_INDEX: Record<string, number> = { mA1: 1, mA2: 2, mA3: 3, mA4: 4 };

export interface V6Options {
  /** Some models report DP in pascals rather than bar. */
  differentialPressureUnit?: Unit;
  /** Liquid density for level conversion; 1.0 water. */
  density?: number;
}

export function decodeV6(bytes: Uint8Array, ctx: DecodeContext, opts: V6Options = {}): DecodeResult {
  const decoded = decodeCbor(bytes);
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded) || decoded instanceof Uint8Array) {
    throw new DecodeError('unsupported_report', 'Ellenex V6 payload is not a CBOR map', {
      decoded: typeof decoded,
    });
  }

  const measurements: Measurement[] = [];
  const configuredDensity = ctx.options.scaling?.['density'];
  const density = opts.density ?? (typeof configuredDensity === 'number' ? configuredDensity : 1);

  for (const [wireKey, rawValue] of Object.entries(decoded)) {
    const spec = KEYS[wireKey];
    if (!spec) {
      ctx.warn({
        code: 'unknown_channel',
        message: `unknown Ellenex V6 key "${wireKey}"; value passed through unscaled`,
      });
      measurements.push({
        key: wireKey, kind: 'unknown', unit: Unit.RAW,
        value: typeof rawValue === 'number' || typeof rawValue === 'string' || typeof rawValue === 'boolean'
          ? rawValue : null,
      });
      continue;
    }

    if (typeof rawValue !== 'number') {
      ctx.warn({
        code: 'undocumented_field',
        message: `Ellenex V6 key "${wireKey}" carried a non-numeric CBOR value`,
      });
      continue;
    }

    let value = rawValue / (spec.divisor ?? 1);
    let unit = spec.unit;

    if (wireKey === 'DP' && opts.differentialPressureUnit) {
      unit = opts.differentialPressureUnit;
    }
    if (wireKey === 'L' && density !== 1) {
      value = value / density;
    }
    if (wireKey === 'DC') {
      measurements.push({
        key: spec.key, kind: 'state', value: rawValue === 0 ? 'closed' : 'open', code: rawValue,
      });
      continue;
    }

    measurements.push({
      key: spec.key, kind: spec.kind, unit,
      value: round(value, spec.decimals ?? 3),
      ...(CHANNEL_INDEX[wireKey] !== undefined ? { index: CHANNEL_INDEX[wireKey] } : {}),
    });
  }

  return { measurements, attributes: { payload_generation: 'v6' } };
}
