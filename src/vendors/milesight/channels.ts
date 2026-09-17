import { round, type ByteReader } from '../../core/reader.js';
import type { KeySpec } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import {
  enumState, numeric, readNumber, struct,
  type ChannelEmit, type ChannelMap, type ChannelSpec, type Sentinels,
} from './tlv.js';
import { isoFromUnix } from './attributes.js';

// --- Sentinels ---------------------------------------------------------------
// EM500 user guides: "fails to collect the sensor data → all ff; outside the
// measuring range → fffd". Matched on the wire pattern, so int16 0xFFFF is a
// sentinel, not -0.1 (docs/vendor-quirks.md).

/** 2-byte EM500 fields: collection failed and out of range. */
export const EM500_SENTINELS: Sentinels = { 0xffff: 'collection_failed', 0xfffd: 'out_of_range' };
/** 4-byte EM500 fields (EM500-LGT illuminance). */
export const EM500_SENTINELS_32: Sentinels = { 0xffffffff: 'collection_failed', 0xfffffffd: 'out_of_range' };
/** 2-byte fields on models whose guide documents only "all ff". */
export const FAILED_16: Sentinels = { 0xffff: 'collection_failed' };
/** 1-byte fields (humidity, moisture). */
export const FAILED_8: Sentinels = { 0xff: 'collection_failed' };
/** GS301 gas channels (README): 0xfffe polarizing, 0xffff error. */
export const GAS_SENTINELS: Sentinels = { 0xfffe: 'polarizing', 0xffff: 'collection_failed' };
/** EM400-TLD/MUD: 65000 when the target is out of range or the device is tilted (relabelled `tilted` by the model when position says so). Field report, not in vendor docs. */
export const EM400_DISTANCE_SENTINELS: Sentinels = { 65000: 'out_of_range' };
/** EM310-UDL user guide: distance ≥ 4.5 m is reported as 0. */
export const EM310_DISTANCE_SENTINELS: Sentinels = { 0: 'out_of_range' };

// --- Shared channels ---------------------------------------------------------

export const battery = () => numeric({ key: 'battery', type: 'u8', unit: Unit.PERCENT });

export function temperatureC(): ChannelSpec<{ temperature?: number }>;
export function temperatureC(sentinels: Sentinels): ChannelSpec<{ temperature?: number; temperature_status?: string }>;
export function temperatureC(sentinels?: Sentinels) {
  return sentinels
    ? numeric({ key: 'temperature', type: 'i16le', unit: Unit.CELSIUS, divisor: 10, decimals: 1, sentinels })
    : numeric({ key: 'temperature', type: 'i16le', unit: Unit.CELSIUS, divisor: 10, decimals: 1 });
}

/** One byte, 0.5 % steps. */
export function humidityPct(): ChannelSpec<{ humidity?: number }>;
export function humidityPct(sentinels: Sentinels): ChannelSpec<{ humidity?: number; humidity_status?: string }>;
export function humidityPct(sentinels?: Sentinels) {
  return sentinels
    ? numeric({ key: 'humidity', type: 'u8', unit: Unit.PERCENT, divisor: 2, decimals: 1, sentinels })
    : numeric({ key: 'humidity', type: 'u8', unit: Unit.PERCENT, divisor: 2, decimals: 1 });
}

export function distanceMm(): ChannelSpec<{ distance?: number }>;
export function distanceMm(sentinels: Sentinels): ChannelSpec<{ distance?: number; distance_status?: string }>;
export function distanceMm(sentinels?: Sentinels) {
  return sentinels
    ? numeric({ key: 'distance', type: 'u16le', unit: Unit.MILLIMETRE, sentinels })
    : numeric({ key: 'distance', type: 'u16le', unit: Unit.MILLIMETRE });
}

export function co2Ppm(): ChannelSpec<{ co2?: number }>;
export function co2Ppm(sentinels: Sentinels): ChannelSpec<{ co2?: number; co2_status?: string }>;
export function co2Ppm(sentinels?: Sentinels) {
  return sentinels
    ? numeric({ key: 'co2', type: 'u16le', unit: Unit.PPM, sentinels })
    : numeric({ key: 'co2', type: 'u16le', unit: Unit.PPM });
}

export const lightLevel = () => numeric({ key: 'light_level', type: 'u8', unit: Unit.INDEX });

export function barometric(): ChannelSpec<{ barometric_pressure?: number }>;
export function barometric(sentinels: Sentinels): ChannelSpec<{ barometric_pressure?: number; barometric_pressure_status?: string }>;
export function barometric(sentinels?: Sentinels) {
  return sentinels
    ? numeric({ key: 'barometric_pressure', type: 'u16le', unit: Unit.HECTOPASCAL, divisor: 10, decimals: 1, sentinels })
    : numeric({ key: 'barometric_pressure', type: 'u16le', unit: Unit.HECTOPASCAL, divisor: 10, decimals: 1 });
}

export const pir = () => enumState('pir', { 0: 'idle', 1: 'trigger' });

/** 83/d7 on the EM500 series: temperature, change since last report, alarm byte. */
export function temperatureAlarmChange() {
  const ALARM: Record<number, string> = {
    0: 'threshold_alarm_release', 1: 'threshold_alarm', 2: 'mutation_alarm',
  };
  return struct<{ temperature?: number; temperature_status?: string; temperature_change?: number; temperature_alarm?: string }>(
    5,
    { temperature: Unit.CELSIUS, temperature_status: null, temperature_change: Unit.CELSIUS, temperature_alarm: null },
    (r, emit) => {
      readNumber(r, emit, { key: 'temperature', type: 'i16le', unit: Unit.CELSIUS, divisor: 10, decimals: 1, sentinels: EM500_SENTINELS });
      emit.reading({ key: 'temperature_change', unit: Unit.CELSIUS, value: round(r.i16le() / 10, 1) });
      const code = r.u8();
      emit.reading({ key: 'temperature_alarm', value: ALARM[code] ?? `unknown(${code})` });
    },
  );
}

/** AM104/AM107 06/65: visible, infrared+visible, infrared, uint16 lux each. */
export function illuminationTriple() {
  return struct<{ illuminance?: number; illuminance_ir_visible?: number; illuminance_ir?: number }>(
    6,
    { illuminance: Unit.LUX, illuminance_ir_visible: Unit.LUX, illuminance_ir: Unit.LUX },
    (r, emit) => {
      emit.reading({ key: 'illuminance', unit: Unit.LUX, value: r.u16le() });
      emit.reading({ key: 'illuminance_ir_visible', unit: Unit.LUX, value: r.u16le() });
      emit.reading({ key: 'illuminance_ir', unit: Unit.LUX, value: r.u16le() });
    },
  );
}

const THRESHOLD_ALARM: Record<number, string> = {
  0: 'threshold_alarm_release',
  1: 'threshold_alarm',
};

/** EM400 alarm channels: value plus a trailing alarm byte. */
export function alarmTemperature() {
  return struct<{ temperature?: number; temperature_alarm?: string }>(
    3,
    { temperature: Unit.CELSIUS, temperature_alarm: null },
    (r, emit) => {
      emit.reading({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16le() / 10, 1) });
      const code = r.u8();
      emit.reading({ key: 'temperature_alarm', value: THRESHOLD_ALARM[code] ?? `unknown(${code})` });
    },
  );
}

export function alarmDistance() {
  return struct<{ distance?: number; distance_status?: string; distance_alarm?: string }>(
    3,
    { distance: Unit.MILLIMETRE, distance_status: null, distance_alarm: null },
    (r, emit) => {
      readNumber(r, emit, { key: 'distance', type: 'u16le', unit: Unit.MILLIMETRE, sentinels: EM400_DISTANCE_SENTINELS });
      const code = r.u8();
      emit.reading({ key: 'distance_alarm', value: THRESHOLD_ALARM[code] ?? `unknown(${code})` });
    },
  );
}

/**
 * EM500-UDL 83/e9 per the user guide: distance mm, shift since last report mm,
 * alarm byte. The vendor decoder divides both by 10; the guide says mm with no
 * factor. Guide wins, with a warning until a capture settles it.
 */
export function udlDistanceAlarm() {
  const ALARM: Record<number, string> = {
    0: 'normal', 1: 'threshold_alarm', 2: 'mutation_alarm',
  };
  return struct<{ distance?: number; distance_status?: string; distance_change?: number; distance_alarm?: string }>(
    5,
    { distance: Unit.MILLIMETRE, distance_status: null, distance_change: Unit.MILLIMETRE, distance_alarm: null },
    (r, emit) => {
      emit.warn('vendor_quirk', 'EM500-UDL 83/e9: user guide says mm, vendor decoder divides by 10; mm used, unverified on hardware');
      readNumber(r, emit, { key: 'distance', type: 'u16le', unit: Unit.MILLIMETRE, sentinels: EM500_SENTINELS });
      emit.reading({ key: 'distance_change', unit: Unit.MILLIMETRE, value: r.u16le() });
      const code = r.u8();
      emit.reading({ key: 'distance_alarm', value: ALARM[code] ?? `unknown(${code})` });
    },
  );
}

/** EM310-TILT: three int16 angles in 0.01°, then a per-axis threshold bitfield. */
export function tiltAngles() {
  type T = {
    angle_x?: number; angle_y?: number; angle_z?: number;
    angle_threshold_x?: string; angle_threshold_y?: string; angle_threshold_z?: string;
  };
  return struct<T>(
    7,
    {
      angle_x: Unit.DEGREE, angle_y: Unit.DEGREE, angle_z: Unit.DEGREE,
      angle_threshold_x: null, angle_threshold_y: null, angle_threshold_z: null,
    },
    (r, emit) => {
      const axes = ['x', 'y', 'z'] as const;
      const values = [r.i16le(), r.i16le(), r.i16le()];
      const flags = r.u8();
      axes.forEach((axis, i) => {
        emit.reading({ key: `angle_${axis}`, unit: Unit.DEGREE, value: round(values[i]! / 100, 2) });
        const bit = (flags >> i) & 0x01;
        emit.reading({ key: `angle_threshold_${axis}`, value: bit === 1 ? 'trigger' : 'normal' });
      });
    },
  );
}

/**
 * WS302: weighting byte, then three int16 levels in 0.1 dB (user guide). The
 * vendor decoder derives key names from the weighting (LAF/LZS…); we use fixed
 * keys and put the weighting in attributes.
 */
export function soundLevels() {
  const FREQ: Record<number, string> = { 0: 'Z', 1: 'A', 2: 'C' };
  const TIME: Record<number, string> = { 0: 'I', 1: 'F', 2: 'S' };
  return struct<{ sound_level?: number; sound_level_eq?: number; sound_level_max?: number }>(
    7,
    { sound_level: Unit.DECIBEL, sound_level_eq: Unit.DECIBEL, sound_level_max: Unit.DECIBEL },
    (r, emit) => {
      const w = r.u8();
      const freq = FREQ[w & 0x03] ?? `unknown(${w & 0x03})`;
      const time = TIME[(w >> 2) & 0x03] ?? `unknown(${(w >> 2) & 0x03})`;
      emit.attribute('frequency_weighting', freq);
      emit.attribute('time_weighting', time);
      for (const key of ['sound_level', 'sound_level_eq', 'sound_level_max'] as const) {
        emit.reading({ key, unit: Unit.DECIBEL, value: round(r.i16le() / 10, 1) });
      }
    },
  );
}

/** Buffered record: uint32 unix timestamp, then fields. Readings get `at` and go to history. */
export function history<T extends object>(
  length: number,
  keys: KeySpec<T>,
  read: (r: ByteReader, emit: ChannelEmitAt) => void,
): ChannelSpec<T> {
  return struct<T>(length, keys, (r, emit) => {
    const at = isoFromUnix(r.u32le());
    read(r, {
      reading: (m) => emit.reading({ ...m, at }),
      warn: (code, message) => emit.warn(code, message),
    });
  });
}

export type ChannelEmitAt = Pick<ChannelEmit, 'reading' | 'warn'>;

export function mergeChannels<A extends ChannelMap, B extends ChannelMap>(a: A, b: B): A & B {
  return { ...a, ...b };
}

export { enumState, numeric, readNumber, struct };
