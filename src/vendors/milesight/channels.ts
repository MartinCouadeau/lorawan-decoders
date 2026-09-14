import { round } from '../../core/reader.js';
import type { KeySpec } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import { enumState, numeric, struct, type ChannelMap, type ChannelSpec } from './tlv.js';
import { isoFromUnix } from './attributes.js';

/** Channels that mean the same thing on every model that has them. */
export const battery = () => numeric({ key: 'battery', type: 'u8', unit: Unit.PERCENT });

export const temperatureC = () =>
  numeric({ key: 'temperature', type: 'i16le', unit: Unit.CELSIUS, divisor: 10, decimals: 1 });

/** Milesight humidity is a half-percent step in one byte: raw/2. */
export const humidityPct = () =>
  numeric({ key: 'humidity', type: 'u8', unit: Unit.PERCENT, divisor: 2, decimals: 1 });

export const distanceMm = () => numeric({ key: 'distance', type: 'u16le', unit: Unit.MILLIMETRE });

export const co2Ppm = () => numeric({ key: 'co2', type: 'u16le', unit: Unit.PPM });

export const lightLevel = () => numeric({ key: 'light_level', type: 'u8', unit: Unit.INDEX });

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
  return struct<{ distance?: number; distance_alarm?: string }>(
    3,
    { distance: Unit.MILLIMETRE, distance_alarm: null },
    (r, emit) => {
      emit.reading({ key: 'distance', unit: Unit.MILLIMETRE, value: r.u16le() });
      const code = r.u8();
      emit.reading({ key: 'distance_alarm', value: THRESHOLD_ALARM[code] ?? `unknown(${code})` });
    },
  );
}

/**
 * EM500-UDL alarm channel.
 *
 * Milesight's published decoder divides distance by 10 here while decoding the
 * very same quantity raw in millimetres on channel 03/82 and in history
 * records — and their downlink threshold config takes raw millimetres. Their
 * README gives no unit for this channel and no worked example, so there is no
 * way to tell from the documentation whether the /10 is a real unit change or a
 * bug in their decoder.
 *
 * We follow their implementation (so values match what a ThingsBoard install
 * running the vendor codec would show), keep it on its own key so it can never
 * be confused with the live `distance`, and attach a warning.
 */
export function udlDistanceAlarm() {
  const ALARM: Record<number, string> = {
    0: 'normal', 1: 'threshold_alarm', 2: 'mutation_alarm',
  };
  return struct<{ distance_alarm_value?: number; distance_mutation?: number; distance_alarm?: string }>(
    5,
    { distance_alarm_value: Unit.MILLIMETRE, distance_mutation: Unit.MILLIMETRE, distance_alarm: null },
    (r, emit) => {
      const distance = round(r.u16le() / 10, 1);
      const mutation = round(r.u16le() / 10, 1);
      const code = r.u8();
      emit.warn(
        'vendor_quirk',
        'EM500-UDL channel 83/e9 divides distance by 10 while channel 03/82 reports raw millimetres; ' +
          'the vendor documents no unit here. Verify against hardware before trusting the magnitude.',
      );
      emit.reading({ key: 'distance_alarm_value', unit: Unit.MILLIMETRE, value: distance });
      emit.reading({ key: 'distance_mutation', unit: Unit.MILLIMETRE, value: mutation });
      emit.reading({ key: 'distance_alarm', value: ALARM[code] ?? `unknown(${code})` });
    },
  );
}

/** EM310-TILT: three signed angles at 1/100°, plus a per-axis threshold bitfield. */
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
 * WS302 sound levels.
 *
 * The first byte selects frequency and time weighting, and Milesight's decoder
 * renames its own output keys from it — `LAF`/`LAeq`/`LAFmax` under one setting,
 * `LZS`/`LZeq`/`LZSmax` under another. Dynamic keys are hostile to storage: your
 * time-series schema changes when someone reconfigures a device.
 *
 * We emit stable keys (`sound_level`, `sound_level_eq`, `sound_level_max`) and
 * put the weighting in attributes, where a configuration value belongs.
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
        emit.reading({ key, unit: Unit.DECIBEL, value: round(r.u16le() / 10, 1) });
      }
    },
  );
}

/**
 * History channels replay buffered readings; each record carries its own
 * timestamp. Readings emitted through `emit` get `at` stamped on them and land
 * in `history`, not `telemetry`.
 */
export function history<T extends object>(
  length: number,
  keys: KeySpec<T>,
  read: (r: Parameters<ChannelSpec['read']>[0], emit: ChannelEmitAt) => void,
): ChannelSpec<T> {
  return struct<T>(length, keys, (r, emit) => {
    const at = isoFromUnix(r.u32le());
    read(r, {
      reading: (m) => emit.reading({ ...m, at }),
    });
  });
}

export interface ChannelEmitAt {
  reading(m: { key: string; value: number | string | boolean; unit?: Unit }): void;
}

export const GAS_SENTINELS: Record<number, string> = {
  0xfffe: 'polarizing',
  0xffff: 'device_error',
};

export function mergeChannels<A extends ChannelMap, B extends ChannelMap>(a: A, b: B): A & B {
  return { ...a, ...b };
}

export { enumState, numeric, struct };
