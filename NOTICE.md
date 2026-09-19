# Provenance

This library implements published wire formats. No vendor code is copied. A
wire format ("channel 0x03 type 0x67 is int16 LE tenths of °C") is a factual
description; a decoder implementation is copyrightable work. Everything here
is written from the former.

## Milesight

Source: payload tables and hex examples in the READMEs of
[Milesight-IoT/SensorDecoders](https://github.com/Milesight-IoT/SensorDecoders),
and the product user guides (resource.milesight.com) for sentinel values and
channels the READMEs omit.

That repository is GPL-3.0. This implementation shares no code with it:
declarative channel maps over one TLV engine, and a flat output keyed by a
cross-vendor vocabulary.

Deliberate differences from vendor behaviour (docs/vendor-quirks.md):

- `ff/fe` and `ff/0b` read the byte; vendor code hardcodes 1.
- `ff/16` serial number is 8 bytes; READMEs say 2, vendor code reads 8.

## Netvox

Source: Netvox product manuals (11-byte NetvoxPayloadData) cross-checked
against per-device entries in the
[TTN Device Repository](https://github.com/TheThingsNetwork/lorawan-devices).
That repository permits reuse of individual device information; only
per-device information is used.

## Ellenex

Source: [ellenex/lorawan-payload-decoders](https://github.com/ellenex/lorawan-payload-decoders)
read as specification, plus Apache-2.0 codecs and test vectors in the TTN
Device Repository.

The Ellenex repository has no licence file (all rights reserved). The format
was read; the implementation is new. Test vectors come from the TTN entries.
Bytes 0–2 of the legacy frame are undocumented in every source consulted and
are exposed as an attribute.

## Dragino

Source: LHT65/LHT65N user manuals on wiki.dragino.com and the Apache-2.0 TTN
Device Repository entries. Dragino's decoder repository was not consulted.

## Test vectors

Where a vendor publishes a payload with its decoded values, that pair is a
test case. `test/vendors/captures.test.ts` adds reference uplinks recorded
from real hardware (payload and fPort only; no device identifiers). Formats verified against documentation only are listed in
docs/vendor-quirks.md.
