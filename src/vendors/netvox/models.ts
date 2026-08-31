import { DecodeError } from '../../core/errors.js';
import type { Attributes, DecodeContext, DecodeResult, Measurement, ModelDefinition } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import {
  NETVOX_UPLINK_FPORT, currentMeasurement, readBattery, readFrame, readVersionReport,
  scalingMultiplier, thresholdAlarms, unpackMultipliers,
} from './frame.js';

const SOURCE =
  'Netvox product manuals (11-byte NetvoxPayloadData structure) cross-checked against the ' +
  'TTN Device Repository per-device entries. Implemented from the documented byte layout.';

/**
 * Netvox model names encode the CT clamp rating in the suffix — R718N17 is a
 * 75 A clamp, R718N1100 a 1000 A one — and an `E` suffix means detachable
 * cables. Neither changes the wire format: the value is always milliamps and
 * the range is handled by the device's own scaling plus the multiplier byte.
 *
 * So one decoder serves the whole family. Rather than typing out 46 aliases,
 * we generate them, which is also self-documenting about *why* they collapse.
 */
function ctVariants(base: string, ratings: readonly string[], suffixes: readonly string[]): string[] {
  const out: string[] = [];
  for (const rating of ratings) {
    for (const suffix of suffixes) out.push(`${base}${rating}${suffix}`);
  }
  return out;
}

const RATINGS_1P = ['', '3', '7', '15', '25', '63', '100', '300'] as const;
const RATINGS_3P = ['', '3', '7', '15', '25', '63', '100', '300'] as const;

/** R718N1 — single-phase current meter. DeviceType 0x49. */
function decodeN1(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const { reportType, reader: r } = readFrame(bytes, 0x49, ctx);
  const measurements: Measurement[] = [];
  let attributes: Attributes = {};

  switch (reportType) {
    case 0x00:
      attributes = readVersionReport(r);
      break;
    case 0x01: {
      measurements.push(...readBattery(r));
      const raw = r.u16be();
      const multiplier = r.u8() || 1;
      measurements.push(currentMeasurement(raw, multiplier, 1, ctx));
      attributes['current_multiplier'] = multiplier;
      // The threshold-alarm byte exists only on the newer R718N1xxx(E)
      // firmware; older units document bytes 7..10 as reserved zeroes, which
      // decodes as "normal" and is harmless.
      measurements.push(...thresholdAlarms(r.u8(), 1));
      break;
    }
    default:
      unsupported(reportType, ctx);
  }
  return { measurements, attributes };
}

/** R718N3 — three-phase. DeviceType 0x4A. Four report types. */
function decodeN3(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const { reportType, reader: r } = readFrame(bytes, 0x4a, ctx);
  const measurements: Measurement[] = [];
  let attributes: Attributes = {};

  switch (reportType) {
    case 0x00:
      attributes = readVersionReport(r);
      break;
    case 0x01: {
      measurements.push(...readBattery(r));
      const raws = [r.u16be(), r.u16be(), r.u16be()];
      const m1 = r.u8() || 1;
      const multipliers = [m1, scalingMultiplier(ctx, 2), scalingMultiplier(ctx, 3)];
      raws.forEach((raw, i) => measurements.push(currentMeasurement(raw, multipliers[i], i + 1, ctx)));
      attributes['current_multiplier_1'] = m1;
      break;
    }
    case 0x02: {
      measurements.push(...readBattery(r));
      attributes['current_multiplier_2'] = r.u8() || 1;
      attributes['current_multiplier_3'] = r.u8() || 1;
      break;
    }
    case 0x03: {
      measurements.push(...readBattery(r));
      const raws = [r.u16be(), r.u16be(), r.u16be()];
      const multipliers = unpackMultipliers(r.u8());
      raws.forEach((raw, i) => measurements.push(currentMeasurement(raw, multipliers[i], i + 1, ctx)));
      multipliers.forEach((m, i) => { attributes[`current_multiplier_${i + 1}`] = m; });
      break;
    }
    case 0x04:
      measurements.push(...readBattery(r));
      measurements.push(...thresholdAlarms(r.u8(), 3));
      break;
    default:
      unsupported(reportType, ctx);
  }
  return { measurements, attributes };
}

/** R718NL1 — light sensor plus single-phase current. DeviceType 0x98. */
function decodeNL1(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const { reportType, reader: r } = readFrame(bytes, 0x98, ctx);
  const measurements: Measurement[] = [];
  let attributes: Attributes = {};

  switch (reportType) {
    case 0x00:
      attributes = readVersionReport(r);
      break;
    case 0x01: {
      measurements.push(...readBattery(r));
      const raw = r.u16be();
      const multiplier = r.u8() || 1;
      measurements.push(currentMeasurement(raw, multiplier, 1, ctx));
      attributes['current_multiplier'] = multiplier;
      measurements.push({ key: 'illuminance', kind: 'illuminance', unit: Unit.LUX, value: r.u32be() });
      break;
    }
    default:
      unsupported(reportType, ctx);
  }
  return { measurements, attributes };
}

/** R718NL3 — light sensor plus three-phase current. DeviceType 0x99. */
function decodeNL3(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const { reportType, reader: r } = readFrame(bytes, 0x99, ctx);
  const measurements: Measurement[] = [];
  let attributes: Attributes = {};

  switch (reportType) {
    case 0x00:
      attributes = readVersionReport(r);
      break;
    case 0x01: {
      measurements.push(...readBattery(r));
      const raws = [r.u16be(), r.u16be(), r.u16be()];
      const m1 = r.u8() || 1;
      const multipliers = [m1, scalingMultiplier(ctx, 2), scalingMultiplier(ctx, 3)];
      raws.forEach((raw, i) => measurements.push(currentMeasurement(raw, multipliers[i], i + 1, ctx)));
      attributes['current_multiplier_1'] = m1;
      break;
    }
    case 0x02: {
      measurements.push(...readBattery(r));
      attributes['current_multiplier_2'] = r.u8() || 1;
      attributes['current_multiplier_3'] = r.u8() || 1;
      measurements.push({ key: 'illuminance', kind: 'illuminance', unit: Unit.LUX, value: r.u32be() });
      break;
    }
    default:
      unsupported(reportType, ctx);
  }
  return { measurements, attributes };
}

/**
 * R718N360 — three-channel current *interface*. DeviceType 0xCA.
 * Note ReportType 0x02 has no battery byte: channels B and C consume all eight
 * payload bytes. Assuming a uniform "battery is always byte 3" would misread
 * the top half of channel B as a voltage.
 */
function decodeN360(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const { reportType, reader: r } = readFrame(bytes, 0xca, ctx);
  const measurements: Measurement[] = [];
  let attributes: Attributes = {};

  switch (reportType) {
    case 0x00:
      attributes = readVersionReport(r);
      break;
    case 0x01:
      measurements.push(...readBattery(r));
      measurements.push({ key: 'channel', kind: 'current', unit: Unit.RAW, value: r.u32be(), index: 'A' });
      break;
    case 0x02:
      measurements.push({ key: 'channel', kind: 'current', unit: Unit.RAW, value: r.u32be(), index: 'B' });
      measurements.push({ key: 'channel', kind: 'current', unit: Unit.RAW, value: r.u32be(), index: 'C' });
      break;
    default:
      unsupported(reportType, ctx);
  }
  return { measurements, attributes };
}

function unsupported(reportType: number, ctx: DecodeContext): never {
  throw new DecodeError(
    'unsupported_report',
    `${ctx.model}: unsupported ReportType 0x${reportType.toString(16).padStart(2, '0')}`,
    { reportType },
  );
}

export const NETVOX_MODELS: readonly ModelDefinition[] = [
  {
    vendor: 'Netvox', model: 'R718N1', source: SOURCE, fPort: NETVOX_UPLINK_FPORT,
    description: 'Single-phase current meter (all CT ratings, ±detachable cables)',
    aliases: ctVariants('R718N1', RATINGS_1P, ['', 'E']),
    decode: decodeN1,
  },
  {
    vendor: 'Netvox', model: 'R718N3', source: SOURCE, fPort: NETVOX_UPLINK_FPORT,
    description: 'Three-phase current meter (all CT ratings, ±detachable cables, ±D revision)',
    aliases: ctVariants('R718N3', RATINGS_3P, ['', 'E', 'D', 'DE']),
    decode: decodeN3,
  },
  {
    vendor: 'Netvox', model: 'R718NL1', source: SOURCE, fPort: NETVOX_UPLINK_FPORT,
    description: 'Light sensor + single-phase current meter',
    aliases: ctVariants('R718NL1', RATINGS_1P, ['', 'E']),
    decode: decodeNL1,
  },
  {
    vendor: 'Netvox', model: 'R718NL3', source: SOURCE, fPort: NETVOX_UPLINK_FPORT,
    description: 'Light sensor + three-phase current meter',
    aliases: ctVariants('R718NL3', RATINGS_3P, ['', 'E']),
    decode: decodeNL3,
  },
  {
    vendor: 'Netvox', model: 'R718N360', source: SOURCE, fPort: NETVOX_UPLINK_FPORT,
    description: 'Three-channel current interface (raw channel values, no battery byte on ReportType 0x02)',
    decode: decodeN360,
  },
];
