import type { ByteReader } from '../../core/reader.js';
import { attribute, type ChannelMap } from './tlv.js';

const LORAWAN_CLASS: Record<number, string> = {
  0: 'Class A', 1: 'Class B', 2: 'Class C', 3: 'Class CtoB',
};

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

/**
 * 0xFF channels: versions, serial, status. Differs from the vendor decoder in
 * two places (docs/vendor-quirks.md): ff/fe and ff/0b read the byte instead of
 * a hardcoded 1; ff/16 is 8 bytes, not the 2 the README states.
 */
export const COMMON_ATTRIBUTES: ChannelMap = {
  'ff/01': attribute(1, 'ipso_version', (r) => {
    const b = r.u8();
    return `v${b >> 4}.${b & 0x0f}`;
  }),
  'ff/09': attribute(2, 'hardware_version', (r) => {
    const major = r.u8();
    const minor = r.u8();
    return `v${hex2(major)}.${minor >> 4}`;
  }),
  'ff/0a': attribute(2, 'firmware_version', (r) => `v${hex2(r.u8())}.${hex2(r.u8())}`),
  'ff/ff': attribute(2, 'tsl_version', (r) => `v${r.u8()}.${r.u8()}`),
  'ff/16': attribute(8, 'serial_number', (r) => r.hex(8)),
  'ff/0f': attribute(1, 'lorawan_class', (r) => {
    const v = r.u8();
    return LORAWAN_CLASS[v] ?? `unknown(${v})`;
  }),
  'ff/fe': attribute(1, 'reset_event', (r) => (r.u8() === 0 ? 'normal' : 'reset')),
  'ff/0b': attribute(1, 'device_status', (r) => (r.u8() === 0 ? 'off' : 'on')),
};

/** WS101 and WS301: 6-byte serial on ff/08. */
export const SHORT_SERIAL: ChannelMap = {
  'ff/08': attribute(6, 'serial_number', (r) => r.hex(6)),
};

/** VS132: versions are decimal bytes joined by dots (84 01 00 01 → "132.1.0.1"); protocol version is a plain byte. */
export const VS_ATTRIBUTES: ChannelMap = {
  'ff/01': attribute(1, 'protocol_version', (r) => r.u8()),
  'ff/16': attribute(8, 'serial_number', (r) => r.hex(8)),
  'ff/09': attribute(2, 'hardware_version', (r) => dottedVersion(r, 2)),
  'ff/1f': attribute(4, 'firmware_version', (r) => dottedVersion(r, 4)),
};

function dottedVersion(r: ByteReader, n: number): string {
  const parts: number[] = [];
  for (let i = 0; i < n; i++) parts.push(r.u8());
  return parts.join('.');
}

/** Unix seconds → ISO-8601. */
export function isoFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}
