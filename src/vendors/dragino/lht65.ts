import { ByteReader, round } from '../../core/reader.js';
import type { Attributes, DecodeContext, DecodeResult, Reading } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import { isoFromUnix } from '../milesight/attributes.js';

/**
 * Dragino LHT65 / LHT65N, 11 bytes, big-endian, fPort 2:
 *   0-1   battery: bits 15-14 status, bits 13-0 mV
 *   2-3   SHT temperature, int16, 0.01 °C
 *   4-5   SHT humidity, uint16, 0.1 %
 *   6     bits 3-0 external sensor type; bits 7-4 status flags (no-ACK,
 *         poll reply, time synced, time request)
 *   7-10  external data, layout per type
 *
 * Timestamp layout (type 9 or 10 on fPort 2, and every fPort 3 datalog entry):
 *   0-1   external data (DS18B20/TMP117 0.01 °C, 0x7FFF absent)
 *   2-3   SHT temperature
 *   4-5   bits 15-14 battery status, bits 11-0 humidity 0.1 %
 *   6     status & type
 *   7-10  unix timestamp
 * fPort 3 carries one or more 11-byte entries → history.
 */
export const LHT65_FRAME_LENGTH = 11;

export interface Lht65Telemetry {
  battery_voltage?: number;
  battery_status?: string;
  temperature?: number;
  temperature_external?: number;
  temperature_external_status?: string;
  humidity?: number;
  humidity_external?: number;
  input_level?: string;
  interrupt?: string;
  illuminance?: number;
  input_voltage?: number;
  pulse_count?: number;
}

export const LHT65_KEYS = {
  battery_voltage: Unit.VOLT,
  battery_status: null,
  temperature: Unit.CELSIUS,
  temperature_external: Unit.CELSIUS,
  temperature_external_status: null,
  humidity: Unit.PERCENT,
  humidity_external: Unit.PERCENT,
  input_level: null,
  interrupt: null,
  illuminance: Unit.LUX,
  input_voltage: Unit.VOLT,
  pulse_count: Unit.COUNT,
} as const;

const BATTERY_STATUS: Record<number, string> = {
  0: 'ultra_low', 1: 'low', 2: 'ok', 3: 'good',
};

const EXT = {
  NONE: 0x00, DS18B20: 0x01, TMP117: 0x02, INTERRUPT: 0x04, ILLUMINATION: 0x05, ADC: 0x06,
  COUNTER16: 0x07, COUNTER32: 0x08, DS18B20_TIMESTAMP: 0x09, TMP117_TIMESTAMP: 0x0a, SHT31: 0x0b,
  COUNTER: 0x0e,
} as const;

const EXT_NAMES: Record<number, string> = {
  [EXT.NONE]: 'none',
  [EXT.DS18B20]: 'ds18b20',
  [EXT.TMP117]: 'tmp117',
  [EXT.INTERRUPT]: 'interrupt',
  [EXT.ILLUMINATION]: 'illumination',
  [EXT.ADC]: 'adc',
  [EXT.COUNTER16]: 'counter16',
  [EXT.COUNTER32]: 'counter32',
  [EXT.DS18B20_TIMESTAMP]: 'ds18b20_timestamp',
  [EXT.TMP117_TIMESTAMP]: 'tmp117_timestamp',
  [EXT.SHT31]: 'sht31',
  [EXT.COUNTER]: 'counter32',
};

const TEMPERATURE_PROBES = new Set<number>([EXT.DS18B20, EXT.TMP117, EXT.DS18B20_TIMESTAMP, EXT.TMP117_TIMESTAMP, EXT.SHT31]);
const TIMESTAMP_TYPES = new Set<number>([EXT.DS18B20_TIMESTAMP, EXT.TMP117_TIMESTAMP]);
const DATALOG_FPORT = 3;

/** Probe value when no sensor is attached. */
const PROBE_ABSENT = 0x7fff;

export function decodeLht65(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const extByte = bytes.length > 6 ? bytes[6]! : 0;
  const extType = extByte & 0x0f;
  const isDatalog = ctx.options.fPort === DATALOG_FPORT && bytes.length >= LHT65_FRAME_LENGTH;
  if (isDatalog) return decodeDatalog(bytes, ctx);
  if (TIMESTAMP_TYPES.has(extType) && bytes.length === LHT65_FRAME_LENGTH) return decodeTimestampFrame(bytes, ctx);
  return decodeLive(bytes, ctx);
}

function decodeLive(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  if (bytes.length !== LHT65_FRAME_LENGTH) {
    ctx.warn({
      code: 'truncated_payload',
      message: `LHT65 uplinks are exactly ${LHT65_FRAME_LENGTH} bytes; got ${bytes.length}`,
    });
  }

  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
  const attributes: Attributes = {};

  const bat = r.u16be();
  readings.push({ key: 'battery_voltage', unit: Unit.VOLT, value: round((bat & 0x3fff) / 1000, 3) });
  readings.push({ key: 'battery_status', value: BATTERY_STATUS[bat >> 14]! });
  readings.push({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16be() / 100, 2) });
  readings.push({ key: 'humidity', unit: Unit.PERCENT, value: round(r.u16be() / 10, 1) });

  if (r.remaining === 0) return { readings, attributes };

  const extByte = r.u8();
  const extType = extByte & 0x0f;
  attributes['external_sensor'] = EXT_NAMES[extType] ?? `unknown(0x${extType.toString(16)})`;
  Object.assign(attributes, statusFlags(extByte));

  if (r.remaining < 4) return { readings, attributes };

  switch (extType) {
    case EXT.NONE:
      break;
    case EXT.DS18B20:
    case EXT.TMP117:
      probeTemperature(r.i16be(), readings);
      break;
    case EXT.INTERRUPT: {
      const level = r.u8();
      const flag = r.u8();
      readings.push({ key: 'input_level', value: level === 1 ? 'high' : 'low' });
      readings.push({ key: 'interrupt', value: flag === 1 ? 'triggered' : 'none' });
      break;
    }
    case EXT.ILLUMINATION:
      readings.push({ key: 'illuminance', unit: Unit.LUX, value: r.u16be() });
      break;
    case EXT.ADC:
      readings.push({ key: 'input_voltage', unit: Unit.VOLT, value: round(r.u16be() / 1000, 3) });
      break;
    case EXT.COUNTER16:
      readings.push({ key: 'pulse_count', unit: Unit.COUNT, value: r.u16be() });
      break;
    case EXT.COUNTER32:
    case EXT.COUNTER:
      readings.push({ key: 'pulse_count', unit: Unit.COUNT, value: r.u32be() });
      break;
    case EXT.SHT31:
      probeTemperature(r.i16be(), readings);
      readings.push({ key: 'humidity_external', unit: Unit.PERCENT, value: round((r.u16be() & 0x0fff) / 10, 1) });
      break;
    default:
      ctx.warn({
        code: 'undocumented_field',
        offset: 6,
        message: `external sensor type 0x${extType.toString(16)} is not implemented; bytes 7-10 left raw`,
      });
      attributes['external_raw'] = r.hex(4);
  }

  return { readings, attributes };
}

/** Type 9/10 on fPort 2: one timestamped sample, reported live with `device_time`. */
function decodeTimestampFrame(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
  const attributes: Attributes = {};
  const entry = readTimestampEntry(r, ctx, 0);
  readings.push(...entry.readings);
  readings.push({ key: 'battery_status', value: entry.batteryStatus });
  attributes['external_sensor'] = entry.sensor;
  attributes['device_time'] = entry.at;
  Object.assign(attributes, entry.flags);
  return { readings, attributes };
}

/** fPort 3: one or more 11-byte entries → history. All-zero entries mean "no data in range". */
function decodeDatalog(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  if (bytes.length % LHT65_FRAME_LENGTH !== 0) {
    ctx.warn({
      code: 'truncated_payload',
      message: `LHT65 datalog entries are ${LHT65_FRAME_LENGTH} bytes each; got ${bytes.length}`,
    });
  }
  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
  const attributes: Attributes = {};
  let entries = 0;
  while (r.hasAtLeast(LHT65_FRAME_LENGTH)) {
    const offset = r.offset;
    if (r.peek(LHT65_FRAME_LENGTH).every((b) => b === 0)) {
      r.skip(LHT65_FRAME_LENGTH);
      continue;
    }
    const entry = readTimestampEntry(r, ctx, offset);
    for (const m of entry.readings) readings.push({ ...m, at: entry.at });
    attributes['external_sensor'] = entry.sensor;
    entries++;
  }
  attributes['datalog_entries'] = entries;
  return { readings, attributes };
}

interface TimestampEntry {
  readings: Reading[];
  batteryStatus: string;
  sensor: string;
  at: string;
  flags: Attributes;
}

function readTimestampEntry(r: ByteReader, ctx: DecodeContext, offset: number): TimestampEntry {
  const extRaw = r.u16be();
  const temperature = round(r.i16be() / 100, 2);
  const packed = r.u16be();
  const extByte = r.u8();
  const at = isoFromUnix(r.u32be());
  const extType = extByte & 0x0f;
  const readings: Reading[] = [];

  if (TEMPERATURE_PROBES.has(extType)) {
    probeTemperature(extRaw > 0x7fff ? extRaw - 0x10000 : extRaw, readings);
  } else if (extType === EXT.ADC) {
    readings.push({ key: 'input_voltage', unit: Unit.VOLT, value: round(extRaw / 1000, 3) });
  } else if (extType === EXT.INTERRUPT) {
    readings.push({ key: 'input_level', value: extRaw >> 8 === 1 ? 'high' : 'low' });
    readings.push({ key: 'interrupt', value: (extRaw & 0xff) === 1 ? 'triggered' : 'none' });
  } else if (extType === EXT.COUNTER16 || extType === EXT.COUNTER32 || extType === EXT.COUNTER) {
    readings.push({ key: 'pulse_count', unit: Unit.COUNT, value: extRaw });
  } else if (extType !== EXT.NONE) {
    ctx.warn({
      code: 'undocumented_field',
      offset,
      message: `datalog entry with external sensor type 0x${extType.toString(16)} is not implemented; external value dropped`,
    });
  }
  readings.push({ key: 'temperature', unit: Unit.CELSIUS, value: temperature });
  readings.push({ key: 'humidity', unit: Unit.PERCENT, value: round((packed & 0x0fff) / 10, 1) });

  return {
    readings,
    batteryStatus: BATTERY_STATUS[packed >> 14]!,
    sensor: EXT_NAMES[extType] ?? `unknown(0x${extType.toString(16)})`,
    at,
    flags: statusFlags(extByte),
  };
}

/** 0x7FFF = probe type configured, nothing attached. Documented device state, no warning. */
function probeTemperature(raw: number, readings: Reading[]): void {
  if (raw === PROBE_ABSENT) {
    readings.push({ key: 'temperature_external_status', value: 'not_connected' });
    return;
  }
  readings.push({ key: 'temperature_external', unit: Unit.CELSIUS, value: round(raw / 100, 2) });
}

/** Byte 6 bits 7-4. Only set flags are reported. */
function statusFlags(extByte: number): Attributes {
  const out: Attributes = {};
  if (extByte & 0x80) out['no_ack'] = true;
  if (extByte & 0x40) out['poll_reply'] = true;
  if (extByte & 0x20) out['time_synced'] = true;
  if (extByte & 0x10) out['time_request'] = true;
  return out;
}
