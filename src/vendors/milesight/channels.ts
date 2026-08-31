import { round } from '../../core/reader.js';
import { Unit } from '../../core/units.js';
import { enumState, numeric, struct, type ChannelMap, type ChannelSpec } from './tlv.js';
import { isoFromUnix } from './attributes.js';

/** Channels that mean the same thing on every model that has them. */
export const battery = (): ChannelSpec =>
  numeric({ key: 'battery', kind: 'battery', type: 'u8', unit: Unit.PERCENT });

export const temperatureC = (): ChannelSpec =>
  numeric({ key: 'temperature', kind: 'temperature', type: 'i16le', unit: Unit.CELSIUS, divisor: 10, decimals: 1 });

/** Milesight humidity is a half-percent step in one byte: raw/2. */
export const humidityPct = (): ChannelSpec =>
  numeric({ key: 'humidity', kind: 'humidity', type: 'u8', unit: Unit.PERCENT, divisor: 2, decimals: 1 });

export const distanceMm = (): ChannelSpec =>
  numeric({ key: 'distance', kind: 'distance', type: 'u16le', unit: Unit.MILLIMETRE });

const THRESHOLD_ALARM: Record<number, string> = {
  0: 'threshold_alarm_release',
  1: 'threshold_alarm',
};

/** EM400 alarm channels: value plus a trailing alarm byte. */
export function alarmTemperature(): ChannelSpec {
  return struct(3, (r, emit) => {
    emit.measurement({
      key: 'temperature', kind: 'temperature', unit: Unit.CELSIUS,
      value: round(r.i16le() / 10, 1),
    });
    const code = r.u8();
    emit.measurement({
      key: 'temperature_alarm', kind: 'event', value: THRESHOLD_ALARM[code] ?? `unknown(${code})`, code,
    });
  });
}

export function alarmDistance(): ChannelSpec {
  return struct(3, (r, emit) => {
    emit.measurement({
      key: 'distance', kind: 'distance', unit: Unit.MILLIMETRE, value: r.u16le(),
    });
    const code = r.u8();
    emit.measurement({
      key: 'distance_alarm', kind: 'event', value: THRESHOLD_ALARM[code] ?? `unknown(${code})`, code,
    });
  });
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
 * running the vendor codec would show) and attach a warning, because a silent
 * factor-of-ten discrepancy between two channels of the same device is exactly
 * the kind of thing that gets discovered during a customer escalation.
 */
export function udlDistanceAlarm(): ChannelSpec {
  const ALARM: Record<number, string> = {
    0: 'normal', 1: 'threshold_alarm', 2: 'mutation_alarm',
  };
  return struct(5, (r, emit) => {
    const distance = round(r.u16le() / 10, 1);
    const mutation = round(r.u16le() / 10, 1);
    const code = r.u8();
    emit.warn(
      'vendor_quirk',
      'EM500-UDL channel 83/e9 divides distance by 10 while channel 03/82 reports raw millimetres; ' +
        'the vendor documents no unit here. Verify against hardware before trusting the magnitude.',
    );
    emit.measurement({ key: 'distance', kind: 'distance', value: distance, unit: Unit.MILLIMETRE, index: 'alarm' });
    emit.measurement({ key: 'distance_mutation', kind: 'distance', value: mutation, unit: Unit.MILLIMETRE });
    emit.measurement({ key: 'distance_alarm', kind: 'event', value: ALARM[code] ?? `unknown(${code})`, code });
  });
}

/** EM310-TILT: three signed angles at 1/100°, plus a per-axis threshold bitfield. */
export function tiltAngles(): ChannelSpec {
  return struct(7, (r, emit) => {
    const axes = ['x', 'y', 'z'] as const;
    const values = [r.i16le(), r.i16le(), r.i16le()];
    const flags = r.u8();
    axes.forEach((axis, i) => {
      emit.measurement({
        key: 'angle', kind: 'angle', unit: Unit.DEGREE, index: axis,
        value: round(values[i]! / 100, 2),
      });
      const bit = (flags >> i) & 0x01;
      emit.measurement({
        key: 'angle_threshold', kind: 'event', index: axis,
        value: bit === 1 ? 'trigger' : 'normal', code: bit,
      });
    });
  });
}

/**
 * WS302 sound levels.
 *
 * The first byte selects frequency and time weighting, and Milesight's decoder
 * renames its own output keys from it — `LAF`/`LAeq`/`LAFmax` under one setting,
 * `LZS`/`LZeq`/`LZSmax` under another. Dynamic keys are hostile to storage: your
 * time-series schema changes when someone reconfigures a device.
 *
 * We emit stable keys (`sound_level` indexed current/equivalent/max) and put the
 * weighting in attributes, where a configuration value belongs.
 */
export function soundLevels(): ChannelSpec {
  const FREQ: Record<number, string> = { 0: 'Z', 1: 'A', 2: 'C' };
  const TIME: Record<number, string> = { 0: 'I', 1: 'F', 2: 'S' };
  return struct(7, (r, emit) => {
    const w = r.u8();
    const freq = FREQ[w & 0x03] ?? `unknown(${w & 0x03})`;
    const time = TIME[(w >> 2) & 0x03] ?? `unknown(${(w >> 2) & 0x03})`;
    emit.attribute('frequency_weighting', freq);
    emit.attribute('time_weighting', time);
    const readings = [
      ['current', r.u16le()],
      ['equivalent', r.u16le()],
      ['max', r.u16le()],
    ] as const;
    for (const [index, raw] of readings) {
      emit.measurement({
        key: 'sound_level', kind: 'sound_level', unit: Unit.DECIBEL, index,
        value: round(raw / 10, 1),
      });
    }
  });
}

/** History channels replay buffered readings; each record carries its own timestamp. */
export function history(length: number, read: (r: Parameters<ChannelSpec['read']>[0], at: string, emit: Parameters<ChannelSpec['read']>[1]) => void): ChannelSpec {
  return struct(length, (r, emit) => {
    const at = isoFromUnix(r.u32le());
    read(r, at, emit);
  });
}

export const GAS_SENTINELS: Record<number, string> = {
  0xfffe: 'polarizing',
  0xffff: 'device_error',
};

export function mergeChannels(...maps: ChannelMap[]): ChannelMap {
  return Object.assign({}, ...maps) as ChannelMap;
}

export { enumState, numeric, struct };
