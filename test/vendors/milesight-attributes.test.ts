import { describe, expect, it } from 'vitest';
import { run } from '../helpers.js';

describe('Milesight attribute channels', () => {
  it('formats the version and identity channels', () => {
    const uplink = run(
      'Milesight', 'EM400-TLD',
      'ff0101' + 'ff090110' + 'ff0a0114' + 'ffff0105' + 'ff166614c39694870000' + 'ff0f00',
    );
    expect(uplink.attributes).toMatchObject({
      ipso_version: 'v0.1',
      hardware_version: 'v01.1',
      firmware_version: 'v01.14',
      tsl_version: 'v1.5',
      serial_number: '6614c39694870000',
      lorawan_class: 'Class A',
    });
  });

  it('reads the reset and device-status bytes that the vendor decoder hardcodes', () => {
    // Milesight's own decoder calls readResetEvent(1) — the literal 1 — so it
    // reports "reset" whatever the device sent. We read the byte.
    expect(run('Milesight', 'EM400-TLD', 'fffe00').attributes['reset_event']).toBe('normal');
    expect(run('Milesight', 'EM400-TLD', 'fffe01').attributes['reset_event']).toBe('reset');
    expect(run('Milesight', 'EM400-TLD', 'ff0b00').attributes['device_status']).toBe('off');
    expect(run('Milesight', 'EM400-TLD', 'ff0b01').attributes['device_status']).toBe('on');
  });

  it('labels an out-of-range LoRaWAN class rather than reporting undefined', () => {
    expect(run('Milesight', 'EM400-TLD', 'ff0f09').attributes['lorawan_class']).toBe('unknown(9)');
  });

  it('reads the 8-byte serial number, not the 2 bytes the vendor README claims', () => {
    const uplink = run('Milesight', 'AM308L', 'ff16' + '0011223344556677' + '01756e');
    expect(uplink.attributes['serial_number']).toBe('0011223344556677');
    // If the length were wrong, the battery channel after it would not decode.
    expect(uplink.measurements[0]?.value).toBe(110);
  });

  it('decodes the GS301 calibration result struct', () => {
    const uplink = run('Milesight', 'GS301', '07ea' + '01' + '01' + '6400' + '00');
    expect(uplink.attributes['calibration_sensor']).toBe('h2s');
    expect(uplink.attributes['calibration_type']).toBe('manual');
    expect(uplink.attributes['calibration_value']).toBe(0.1);
    expect(uplink.measurements[0]?.value).toBe('success');
  });
});
