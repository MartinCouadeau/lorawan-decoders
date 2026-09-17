import { ByteReader, round } from '../../core/reader.js';
import type { Attributes, DecodeContext, DecodeResult, Reading } from '../../core/types.js';
import { Unit } from '../../core/units.js';
import { isoFromUnix } from '../milesight/attributes.js';

/**
 * Dragino LHT52, 11 bytes, big-endian.
 * fPort 2 (live):
 *   0-1   SHT temperature, int16, 0.01 °C
 *   2-3   SHT humidity, uint16, 0.1 %
 *   4-5   external temperature, int16, 0.01 °C, 0x7FFF absent
 *   6     external sensor type (0x01 = AS-01 probe)
 *   7-10  unix timestamp of the sample → attributes.device_time
 * fPort 3 (datalog, one or more entries): external temperature, humidity,
 * SHT temperature, type, timestamp → history.
 */
export const LHT52_FRAME_LENGTH = 11;
const DATALOG_FPORT = 3;

export interface Lht52Telemetry {
  temperature?: number;
  humidity?: number;
  temperature_external?: number;
  temperature_external_status?: string;
}

export const LHT52_KEYS = {
  temperature: Unit.CELSIUS, humidity: Unit.PERCENT, temperature_external: Unit.CELSIUS, temperature_external_status: null,
} as const;

const PROBE_ABSENT = 0x7fff;
const EXT_NAMES: Record<number, string> = { 0x00: 'none', 0x01: 'ds18b20' };

export function decodeLht52(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  if (ctx.options.fPort === DATALOG_FPORT && bytes.length >= LHT52_FRAME_LENGTH) return decodeDatalog(bytes, ctx);

  if (bytes.length !== LHT52_FRAME_LENGTH) {
    ctx.warn({ code: 'truncated_payload', message: `LHT52 uplinks are exactly ${LHT52_FRAME_LENGTH} bytes; got ${bytes.length}` });
  }
  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
  const attributes: Attributes = {};

  readings.push({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16be() / 100, 2) });
  readings.push({ key: 'humidity', unit: Unit.PERCENT, value: round(r.u16be() / 10, 1) });

  if (r.remaining >= 2) probe(r.u16be(), readings);
  if (r.remaining >= 1) attributes['external_sensor'] = extName(r.u8());
  if (r.remaining >= 4) attributes['device_time'] = isoFromUnix(r.u32be());

  return { readings, attributes };
}

function decodeDatalog(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  if (bytes.length % LHT52_FRAME_LENGTH !== 0) {
    ctx.warn({ code: 'truncated_payload', message: `LHT52 datalog entries are ${LHT52_FRAME_LENGTH} bytes each; got ${bytes.length}` });
  }
  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
  const attributes: Attributes = {};
  let entries = 0;
  while (r.hasAtLeast(LHT52_FRAME_LENGTH)) {
    if (r.peek(LHT52_FRAME_LENGTH).every((b) => b === 0)) {
      r.skip(LHT52_FRAME_LENGTH);
      continue;
    }
    const entry: Reading[] = [];
    probe(r.u16be(), entry);
    entry.push({ key: 'humidity', unit: Unit.PERCENT, value: round(r.u16be() / 10, 1) });
    entry.push({ key: 'temperature', unit: Unit.CELSIUS, value: round(r.i16be() / 100, 2) });
    attributes['external_sensor'] = extName(r.u8());
    const at = isoFromUnix(r.u32be());
    for (const m of entry) readings.push({ ...m, at });
    entries++;
  }
  attributes['datalog_entries'] = entries;
  return { readings, attributes };
}

/** 0x7FFF = no probe attached. Device state, no warning. */
function probe(raw: number, readings: Reading[]): void {
  if (raw === PROBE_ABSENT) {
    readings.push({ key: 'temperature_external_status', value: 'not_connected' });
    return;
  }
  readings.push({ key: 'temperature_external', unit: Unit.CELSIUS, value: round(toInt16(raw) / 100, 2) });
}

function extName(ext: number): string {
  return EXT_NAMES[ext] ?? `unknown(0x${ext.toString(16)})`;
}

function toInt16(v: number): number {
  return v > 0x7fff ? v - 0x10000 : v;
}
