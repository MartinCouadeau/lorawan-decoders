import { DecodeError } from '../../core/errors.js';
import { ByteReader, round } from '../../core/reader.js';
import type { Attributes, DecodeContext, DecodeResult, ModelDefinition, Reading } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import {
  NETVOX_CONFIG_FPORT, NETVOX_UPLINK_FPORT, currentReading, readBattery, readFrame, readVersionReport,
  scalingMultiplier, thresholdAlarms, unpackMultipliers,
} from './frame.js';

const SOURCE =
  'Netvox product manuals (11-byte NetvoxPayloadData structure) cross-checked against the ' +
  'TTN Device Repository per-device entries. Implemented from the documented byte layout.';

/**
 * Model suffixes (CT rating digits, `E` detachable cables) do not change the
 * wire format, so one decoder serves the family. Aliases are generated, typed
 * as literals so the namespace autocompletes them.
 */
function ctVariants<B extends string, R extends string, S extends string>(
  base: B,
  ratings: readonly R[],
  suffixes: readonly S[],
): Array<`${B}${R}${S}`> {
  const out: Array<`${B}${R}${S}`> = [];
  for (const rating of ratings) {
    for (const suffix of suffixes) out.push(`${base}${rating}${suffix}`);
  }
  return out;
}

const RATINGS_1P = ['', '3', '7', '15', '25', '63', '100', '300'] as const;
const RATINGS_3P = ['', '3', '7', '15', '25', '63', '100', '300'] as const;

export interface SinglePhaseTelemetry {
  battery_voltage?: number;
  battery_low?: boolean;
  current?: number;
  current_alarm?: string;
}

export interface ThreePhaseTelemetry {
  battery_voltage?: number;
  battery_low?: boolean;
  current_1?: number;
  current_2?: number;
  current_3?: number;
  current_alarm_1?: string;
  current_alarm_2?: string;
  current_alarm_3?: string;
}

export interface LightSinglePhaseTelemetry extends SinglePhaseTelemetry {
  illuminance?: number;
}

export interface LightThreePhaseTelemetry extends ThreePhaseTelemetry {
  illuminance?: number;
}

export interface SmokeDetectorTelemetry {
  battery_voltage?: number;
  battery_low?: boolean;
  fire_alarm?: string;
  temperature_alarm?: string;
  temperature?: number;
}

export interface CurrentInterfaceTelemetry {
  battery_voltage?: number;
  battery_low?: boolean;
  channel_1?: number;
  channel_2?: number;
  channel_3?: number;
}

const BATTERY_KEYS = { battery_voltage: Unit.VOLT, battery_low: null } as const;
const SINGLE_PHASE_KEYS = { ...BATTERY_KEYS, current: Unit.MILLIAMPERE, current_alarm: null } as const;
const THREE_PHASE_KEYS = {
  ...BATTERY_KEYS,
  current_1: Unit.MILLIAMPERE, current_2: Unit.MILLIAMPERE, current_3: Unit.MILLIAMPERE,
  current_alarm_1: null, current_alarm_2: null, current_alarm_3: null,
} as const;

/** R718N1 — single-phase current meter. DeviceType 0x49. */
function decodeN1(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const { reportType, reader: r } = readFrame(bytes, 0x49, ctx);
  const readings: Reading[] = [];
  let attributes: Attributes = {};

  switch (reportType) {
    case 0x00:
      attributes = readVersionReport(r);
      break;
    case 0x01: {
      readings.push(...readBattery(r));
      const raw = r.u16be();
      const multiplier = r.u8() || 1;
      readings.push(currentReading(raw, multiplier, undefined, ctx));
      attributes['current_multiplier'] = multiplier;
      // Alarm byte exists on newer firmware only; older units send 0 → "normal".
      readings.push(...thresholdAlarms(r.u8(), 1));
      break;
    }
    default:
      unsupported(reportType, ctx);
  }
  return { readings, attributes };
}

/** R718N3 — three-phase. DeviceType 0x4A. Four report types. */
function decodeN3(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const { reportType, reader: r } = readFrame(bytes, 0x4a, ctx);
  const readings: Reading[] = [];
  let attributes: Attributes = {};

  switch (reportType) {
    case 0x00:
      attributes = readVersionReport(r);
      break;
    case 0x01: {
      readings.push(...readBattery(r));
      const raws = [r.u16be(), r.u16be(), r.u16be()];
      const m1 = r.u8() || 1;
      const multipliers = [m1, scalingMultiplier(ctx, 2), scalingMultiplier(ctx, 3)];
      raws.forEach((raw, i) => readings.push(currentReading(raw, multipliers[i], i + 1, ctx)));
      attributes['current_multiplier_1'] = m1;
      break;
    }
    case 0x02: {
      readings.push(...readBattery(r));
      attributes['current_multiplier_2'] = r.u8() || 1;
      attributes['current_multiplier_3'] = r.u8() || 1;
      break;
    }
    case 0x03: {
      readings.push(...readBattery(r));
      const raws = [r.u16be(), r.u16be(), r.u16be()];
      const multipliers = unpackMultipliers(r.u8());
      raws.forEach((raw, i) => readings.push(currentReading(raw, multipliers[i], i + 1, ctx)));
      multipliers.forEach((m, i) => { attributes[`current_multiplier_${i + 1}`] = m; });
      break;
    }
    case 0x04:
      readings.push(...readBattery(r));
      readings.push(...thresholdAlarms(r.u8(), 3));
      break;
    default:
      unsupported(reportType, ctx);
  }
  return { readings, attributes };
}

/** R718NL1 — light sensor plus single-phase current. DeviceType 0x98. */
function decodeNL1(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const { reportType, reader: r } = readFrame(bytes, 0x98, ctx);
  const readings: Reading[] = [];
  let attributes: Attributes = {};

  switch (reportType) {
    case 0x00:
      attributes = readVersionReport(r);
      break;
    case 0x01: {
      readings.push(...readBattery(r));
      const raw = r.u16be();
      const multiplier = r.u8() || 1;
      readings.push(currentReading(raw, multiplier, undefined, ctx));
      attributes['current_multiplier'] = multiplier;
      readings.push({ key: 'illuminance', unit: Unit.LUX, value: r.u32be() });
      break;
    }
    default:
      unsupported(reportType, ctx);
  }
  return { readings, attributes };
}

/** R718NL3 — light sensor plus three-phase current. DeviceType 0x99. */
function decodeNL3(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const { reportType, reader: r } = readFrame(bytes, 0x99, ctx);
  const readings: Reading[] = [];
  let attributes: Attributes = {};

  switch (reportType) {
    case 0x00:
      attributes = readVersionReport(r);
      break;
    case 0x01: {
      readings.push(...readBattery(r));
      const raws = [r.u16be(), r.u16be(), r.u16be()];
      const m1 = r.u8() || 1;
      const multipliers = [m1, scalingMultiplier(ctx, 2), scalingMultiplier(ctx, 3)];
      raws.forEach((raw, i) => readings.push(currentReading(raw, multipliers[i], i + 1, ctx)));
      attributes['current_multiplier_1'] = m1;
      break;
    }
    case 0x02: {
      readings.push(...readBattery(r));
      attributes['current_multiplier_2'] = r.u8() || 1;
      attributes['current_multiplier_3'] = r.u8() || 1;
      readings.push({ key: 'illuminance', unit: Unit.LUX, value: r.u32be() });
      break;
    }
    default:
      unsupported(reportType, ctx);
  }
  return { readings, attributes };
}

/**
 * R718N360 — three-channel current interface, DeviceType 0xCA. Values are raw
 * counts (`channel_1..3`, unit raw). ReportType 0x02 has no battery byte.
 */
function decodeN360(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const { reportType, reader: r } = readFrame(bytes, 0xca, ctx);
  const readings: Reading[] = [];
  let attributes: Attributes = {};

  switch (reportType) {
    case 0x00:
      attributes = readVersionReport(r);
      break;
    case 0x01:
      readings.push(...readBattery(r));
      readings.push({ key: 'channel_1', unit: Unit.RAW, value: r.u32be() });
      break;
    case 0x02:
      readings.push({ key: 'channel_2', unit: Unit.RAW, value: r.u32be() });
      readings.push({ key: 'channel_3', unit: Unit.RAW, value: r.u32be() });
      break;
    default:
      unsupported(reportType, ctx);
  }
  return { readings, attributes };
}

/**
 * RA02A — smoke detector with temperature. DeviceType 0x0A. ReportType 0x01:
 * battery, fire alarm byte, high-temperature alarm byte (fixed 60 °C),
 * temperature int16 0.1 °C, 3 reserved. Frames with bit 7 set in byte 0 are
 * fPort 7 configuration responses → attributes only.
 */
const RA02A_DEVICE_TYPE = 0x0a;

function decodeRa02a(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  if (bytes.length >= 3 && (bytes[0]! & 0x80) !== 0) return decodeRa02aConfig(bytes, ctx);

  const { reportType, reader: r } = readFrame(bytes, RA02A_DEVICE_TYPE, ctx);
  const readings: Reading[] = [];
  let attributes: Attributes = {};

  switch (reportType) {
    case 0x00:
      attributes = readVersionReport(r);
      break;
    case 0x01:
      readings.push(...readBattery(r));
      readings.push({ key: 'fire_alarm', value: r.u8() === 1 ? 'alarm' : 'none' });
      readings.push({ key: 'temperature_alarm', value: r.u8() === 1 ? 'high_temperature_alarm' : 'none' });
      readings.push({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16be() / 10, 1) });
      break;
    default:
      unsupported(reportType, ctx);
  }
  return { readings, attributes };
}

/** 0x81 ConfigReportRsp: status. 0x82 ReadConfigReportRsp: min/max report time (s), battery change (0.1 V). */
function decodeRa02aConfig(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const r = new ByteReader(bytes);
  const command = r.u8();
  const deviceType = r.u8();
  if (deviceType !== RA02A_DEVICE_TYPE) {
    ctx.warn({
      code: 'vendor_quirk',
      offset: 1,
      message: `DeviceType 0x${deviceType.toString(16)} does not match 0x0a expected for ${ctx.model}`,
    });
  }
  const attributes: Attributes = {};
  if (command === 0x81) {
    attributes['config_status'] = r.u8() === 0 ? 'success' : 'failed';
  } else if (command === 0x82 && r.hasAtLeast(5)) {
    attributes['min_time'] = r.u16be();
    attributes['max_time'] = r.u16be();
    attributes['battery_change'] = round(r.u8() / 10, 1);
  } else {
    ctx.warn({
      code: 'undocumented_field',
      offset: 0,
      message: `command response 0x${command.toString(16)} is not documented for ${ctx.model}`,
    });
  }
  return { readings: [], attributes };
}

function unsupported(reportType: number, ctx: DecodeContext): never {
  throw new DecodeError(
    'unsupported_report',
    `${ctx.model}: unsupported ReportType 0x${reportType.toString(16).padStart(2, '0')}`,
    { reportType },
  );
}

const R718N1: ModelDefinition<SinglePhaseTelemetry, 'R718N1' | `R718N1${(typeof RATINGS_1P)[number]}${'' | 'E'}`> = {
  vendor: 'Netvox', model: 'R718N1', source: SOURCE, fPort: NETVOX_UPLINK_FPORT,
  description: 'Single-phase current meter (all CT ratings, ±detachable cables)',
  aliases: ctVariants('R718N1', RATINGS_1P, ['', 'E']),
  keys: SINGLE_PHASE_KEYS,
  decode: decodeN1,
};

const R718N3: ModelDefinition<ThreePhaseTelemetry, 'R718N3' | `R718N3${(typeof RATINGS_3P)[number]}${'' | 'E' | 'D' | 'DE'}`> = {
  vendor: 'Netvox', model: 'R718N3', source: SOURCE, fPort: NETVOX_UPLINK_FPORT,
  description: 'Three-phase current meter (all CT ratings, ±detachable cables, ±D revision)',
  aliases: ctVariants('R718N3', RATINGS_3P, ['', 'E', 'D', 'DE']),
  keys: THREE_PHASE_KEYS,
  decode: decodeN3,
};

const R718NL1: ModelDefinition<LightSinglePhaseTelemetry, 'R718NL1' | `R718NL1${(typeof RATINGS_1P)[number]}${'' | 'E'}`> = {
  vendor: 'Netvox', model: 'R718NL1', source: SOURCE, fPort: NETVOX_UPLINK_FPORT,
  description: 'Light sensor + single-phase current meter',
  aliases: ctVariants('R718NL1', RATINGS_1P, ['', 'E']),
  keys: { ...SINGLE_PHASE_KEYS, illuminance: Unit.LUX },
  decode: decodeNL1,
};

const R718NL3: ModelDefinition<LightThreePhaseTelemetry, 'R718NL3' | `R718NL3${(typeof RATINGS_3P)[number]}${'' | 'E'}`> = {
  vendor: 'Netvox', model: 'R718NL3', source: SOURCE, fPort: NETVOX_UPLINK_FPORT,
  description: 'Light sensor + three-phase current meter',
  aliases: ctVariants('R718NL3', RATINGS_3P, ['', 'E']),
  keys: { ...THREE_PHASE_KEYS, illuminance: Unit.LUX },
  decode: decodeNL3,
};

const R718N360: ModelDefinition<CurrentInterfaceTelemetry, 'R718N360'> = {
  vendor: 'Netvox', model: 'R718N360', source: SOURCE, fPort: NETVOX_UPLINK_FPORT,
  description: 'Three-channel current interface (raw channel values, no battery byte on ReportType 0x02)',
  keys: { ...BATTERY_KEYS, channel_1: Unit.RAW, channel_2: Unit.RAW, channel_3: Unit.RAW },
  decode: decodeN360,
};

const RA02A: ModelDefinition<SmokeDetectorTelemetry, 'RA02A'> = {
  vendor: 'Netvox', model: 'RA02A', source: SOURCE, fPort: NETVOX_UPLINK_FPORT, otherFPorts: [NETVOX_CONFIG_FPORT],
  description: 'Smoke detector with temperature and fixed 60 °C high-temperature alarm',
  keys: { ...BATTERY_KEYS, fire_alarm: null, temperature_alarm: null, temperature: Unit.CELSIUS },
  decode: decodeRa02a,
};

export const NETVOX_MODELS = [R718N1, R718N3, R718NL1, R718NL3, R718N360, RA02A] as const;
