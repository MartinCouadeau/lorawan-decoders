import { ByteReader, round } from '../../core/reader.js';
import type { Attributes, DecodeContext, DecodeResult, Reading } from '../../core/types.js';
import { Unit } from '../../core/units.js';

/**
 * Dragino LDS02 (door) and LWL02 (water leak), 10 bytes, big-endian, fPort 10:
 *   0-1  bit 15 door open (LDS02), bit 14 leak (LWL02), bits 13-0 mV
 *   2    MOD: 0x01 door, 0x02 leak
 *   3-5  total events, uint24
 *   6-8  last event duration, uint24, minutes
 *   9    bit 0 alarm
 * EDC mode (fPort 7), 5 bytes: bit 15 counted event (1 open, 0 close),
 * bits 13-0 mV, then uint24 event count.
 */
export const CONTACT_FRAME_LENGTH = 10;
export const EDC_FRAME_LENGTH = 5;

export interface Lds02Telemetry {
  battery_voltage?: number;
  magnet_status?: string;
  open_count?: number;
  open_duration?: number;
  alarm?: string;
  event_count?: number;
}

export interface Lwl02Telemetry {
  battery_voltage?: number;
  leakage_status?: string;
  open_count?: number;
  open_duration?: number;
  alarm?: string;
  event_count?: number;
}

export const LDS02_KEYS = {
  battery_voltage: Unit.VOLT, magnet_status: null, open_count: Unit.COUNT, open_duration: Unit.MINUTE, alarm: null,
  event_count: Unit.COUNT,
} as const;

export const LWL02_KEYS = {
  battery_voltage: Unit.VOLT, leakage_status: null, open_count: Unit.COUNT, open_duration: Unit.MINUTE, alarm: null,
  event_count: Unit.COUNT,
} as const;

function decodeContact(bytes: Uint8Array, ctx: DecodeContext, kind: 'door' | 'leak'): DecodeResult {
  if (bytes.length === EDC_FRAME_LENGTH) return decodeEdc(bytes);

  if (bytes.length !== CONTACT_FRAME_LENGTH) {
    ctx.warn({
      code: 'truncated_payload',
      message: `${ctx.model} uplinks are exactly ${CONTACT_FRAME_LENGTH} bytes; got ${bytes.length}`,
    });
  }
  const r = new ByteReader(bytes);
  const readings: Reading[] = [];
  const attributes: Attributes = {};

  const head = r.u16be();
  readings.push({ key: 'battery_voltage', unit: Unit.VOLT, value: round((head & 0x3fff) / 1000, 3) });
  if (kind === 'door') {
    readings.push({ key: 'magnet_status', value: head & 0x8000 ? 'open' : 'close' });
  } else {
    readings.push({ key: 'leakage_status', value: head & 0x4000 ? 'leak' : 'normal' });
  }

  if (r.remaining === 0) return { readings, attributes };
  attributes['mode'] = r.u8();

  if (r.remaining < 7) return { readings, attributes };
  readings.push({ key: 'open_count', unit: Unit.COUNT, value: u24(r) });
  readings.push({ key: 'open_duration', unit: Unit.MINUTE, value: u24(r) });
  readings.push({ key: 'alarm', value: r.u8() & 0x01 ? 'alarm' : 'none' });

  return { readings, attributes };
}

/** EDC (event count) packet: battery plus the number of counted open or close events. */
function decodeEdc(bytes: Uint8Array): DecodeResult {
  const r = new ByteReader(bytes);
  const head = r.u16be();
  return {
    readings: [
      { key: 'battery_voltage', unit: Unit.VOLT, value: round((head & 0x3fff) / 1000, 3) },
      { key: 'event_count', unit: Unit.COUNT, value: u24(r) },
    ],
    attributes: { mode: 'edc', edc_event: head & 0x8000 ? 'open' : 'close' },
  };
}

function u24(r: ByteReader): number {
  return (r.u8() << 16) | (r.u8() << 8) | r.u8();
}

export function decodeLds02(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  return decodeContact(bytes, ctx, 'door');
}

export function decodeLwl02(bytes: Uint8Array, ctx: DecodeContext): DecodeResult {
  return decodeContact(bytes, ctx, 'leak');
}
