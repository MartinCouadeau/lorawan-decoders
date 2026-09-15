# Provenance

This library implements published LoRaWAN wire formats. It contains no code
copied from any vendor. This file records where each format came from and why
the distinction matters.

A wire format — "channel 0x03 type 0x67 carries a signed 16-bit little-endian
temperature in tenths of a degree" — is a factual description of an interface.
An implementation of a decoder is expressive work and carries its licence with
it. Everything here is written from the former.

## Milesight

**Format source:** payload definition tables in the READMEs of
[Milesight-IoT/SensorDecoders](https://github.com/Milesight-IoT/SensorDecoders),
and the worked hex examples published alongside them.

**Why this matters:** that repository is licensed **GPL-3.0**. Copying those
decoders into an MIT-licensed library would violate their licence. This
implementation shares no code with theirs — it uses a different architecture
(declarative channel maps over a shared TLV engine, versus a per-model switch
statement) and a different output schema: one flat object keyed by a shared
cross-vendor vocabulary.

Two places where this library deliberately differs from Milesight's published
behaviour, both documented in [docs/vendor-quirks.md](docs/vendor-quirks.md):

- `ff/fe` (reset event) and `ff/0b` (device status) are hardcoded in their
  decoder — `readResetEvent(1)` — and always report "reset" and "on" regardless
  of the byte received. This library reads the byte.
- Their READMEs give the serial number channel `ff/16` a length of 2 bytes while
  their own code reads 8. This library uses 8.

## Netvox

**Format source:** Netvox product manuals documenting the 11-byte
NetvoxPayloadData structure, cross-checked against per-device entries in the
[TTN Device Repository](https://github.com/TheThingsNetwork/lorawan-devices).

That repository asserts a database right permitting reuse of information about
an individual end device while prohibiting bulk extraction of the repository.
This library uses per-device information only.

## Ellenex

**Format source:** [ellenex/lorawan-payload-decoders](https://github.com/ellenex/lorawan-payload-decoders)
read as specification, plus the Apache-2.0 codecs and test vectors in the TTN
Device Repository.

**Why this matters:** Ellenex's repository has **no licence file**, which under
default copyright means all rights reserved. Their code could not be copied even
if this library were GPL. The format was read; the implementation is new. The
test vectors used here come from the Apache-2.0 TTN entries.

Bytes 0–2 of the Ellenex legacy frame are undocumented in every source
consulted — their repository's full commit history, the TTN entries, and their
datasheets. This library surfaces them as an attribute rather than guessing at
their meaning.

## Dragino

**Format source:** the LHT65 and LHT65N user manuals published on
wiki.dragino.com, which document the 11-byte frame byte by byte, plus the
Apache-2.0 codec and examples in the TTN Device Repository.

Dragino also publish a decoder repository on GitHub. It was not consulted; the
byte layout in the manual is sufficient and the implementation here is new.

## Test vectors

Where a vendor publishes a worked example — a hex payload with the values they
say it decodes to — that example is used as a test case. Those tests are the
reason a refactor cannot quietly change a scaling factor.

Formats verified against documentation but **not** against hardware are noted in
[docs/vendor-quirks.md](docs/vendor-quirks.md). Captures from real devices are
the most useful contribution this project can receive.
