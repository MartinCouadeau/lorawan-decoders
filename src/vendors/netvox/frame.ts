import { ByteReader, round } from '../../core/reader.js';
import { DecodeError } from '../../core/errors.js';
import type { Attributes, DecodeContext, Measurement } from '../../core/types.js';
import { Unit } from '../../core/units.js';

/**
 * Netvox uses one fixed 11-byte frame across their entire catalogue:
 *
 *   byte 0  Version  (0x01)
 *   byte 1  DeviceType
 *   byte 2  ReportType
 *   bytes 3..10  payload, zero-padded
 *
 * Uplinks are on fPort 6; fPort 7 is configuration, where byte 0 is a command
 * id rather than a version. This module handles fPort 6.
 */
export const NETVOX_FRAME_LENGTH = 11;
export const NETVOX_UPLINK_FPORT = 6;
export const NETVOX_CONFIG_FPORT = 7;

export interface NetvoxFrame {
  version: number;
  deviceType: number;
  reportType: number;
  reader: ByteReader;
}

export function readFrame(bytes: Uint8Array, expectedDeviceType: number, ctx: DecodeContext): NetvoxFrame {
  if (bytes.length !== NETVOX_FRAME_LENGTH) {
    if (bytes.length < 3) {
      throw new DecodeError('payload_too_short', `Netvox frames are ${NETVOX_FRAME_LENGTH} bytes; got ${bytes.length}`, {
        length: bytes.length,
      });
    }
    ctx.warn({
      code: 'truncated_payload',
      message: `Netvox frames are exactly ${NETVOX_FRAME_LENGTH} bytes; got ${bytes.length}`,
    });
  }

  const r = new ByteReader(bytes);
  const version = r.u8();
  const deviceType = r.u8();
  const reportType = r.u8();

  if (deviceType !== expectedDeviceType) {
    ctx.warn({
      code: 'vendor_quirk',
      offset: 1,
      message:
        `DeviceType 0x${deviceType.toString(16)} does not match 0x${expectedDeviceType.toString(16)} ` +
        `expected for ${ctx.model}. The device profile is probably pointed at the wrong model.`,
    });
  }

  return { version, deviceType, reportType, reader: r };
}

/**
 * Battery: low seven bits are tenths of a volt, bit 7 is the low-battery flag
 * (Netvox's threshold is 3.2 V). Reading the byte as a plain integer — an easy
 * mistake — gives you 17.8 V on a flagged 3.0 V cell.
 */
export function readBattery(r: ByteReader): Measurement[] {
  const raw = r.u8();
  const volts = round((raw & 0x7f) / 10, 1);
  const low = (raw & 0x80) !== 0;
  return [
    { key: 'battery_voltage', kind: 'battery', unit: Unit.VOLT, value: volts },
    { key: 'battery_low', kind: 'state', value: low, code: low ? 1 : 0 },
  ];
}

export function currentMeasurement(
  raw: number,
  multiplier: number | undefined,
  index: number,
  ctx: DecodeContext,
): Measurement {
  if (multiplier === undefined) {
    ctx.warn({
      code: 'unscaled_value',
      message:
        `current ${index} has no multiplier in this frame. Netvox splits the three-phase multipliers ` +
        `across ReportType 0x01 and 0x02, so a single uplink cannot carry them all. The value below is ` +
        `the raw wire reading in mA; multiply it by the multiplier from the matching ReportType 0x02 frame, ` +
        `or supply it via options.scaling.multiplier${index}.`,
    });
    return { key: 'current', kind: 'current', unit: Unit.MILLIAMPERE, value: raw, index };
  }
  return {
    key: 'current', kind: 'current', unit: Unit.MILLIAMPERE, value: raw * multiplier, index,
  };
}

/**
 * ReportType 0x03 packs all three multipliers into one byte, two bits each,
 * through a lookup table — while ReportTypes 0x01 and 0x02 carry the multiplier
 * as a literal value in its own byte. Same field, same device, two encodings.
 */
const PACKED_MULTIPLIERS: Record<number, number> = { 0: 1, 1: 5, 2: 10, 3: 100 };

export function unpackMultipliers(b: number): [number, number, number] {
  return [
    PACKED_MULTIPLIERS[b & 0x03]!,
    PACKED_MULTIPLIERS[(b >> 2) & 0x03]!,
    PACKED_MULTIPLIERS[(b >> 4) & 0x03]!,
  ];
}

/** ReportType 0x00 is a version report and is identical across the catalogue. */
export function readVersionReport(r: ByteReader): Attributes {
  const software = round(r.u8() / 10, 1);
  const hardware = r.u8();
  const date = [r.u8(), r.u8(), r.u8(), r.u8()]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return {
    software_version: `v${software}`,
    hardware_version: `v${hardware}`,
    date_code: date,
  };
}

export function thresholdAlarms(flags: number, phases: number): Measurement[] {
  const out: Measurement[] = [];
  for (let i = 0; i < phases; i++) {
    const low = (flags >> (i * 2)) & 0x01;
    const high = (flags >> (i * 2 + 1)) & 0x01;
    out.push({
      key: 'current_alarm', kind: 'event', index: i + 1,
      value: high ? 'high_current' : low ? 'low_current' : 'normal',
      code: (high << 1) | low,
    });
  }
  return out;
}

export function scalingMultiplier(ctx: DecodeContext, index: number): number | undefined {
  const v = ctx.options.scaling?.[`multiplier${index}`];
  return typeof v === 'number' ? v : undefined;
}
