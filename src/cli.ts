#!/usr/bin/env node
import { DecodeError } from './core/errors.js';
import { accessorName } from './core/registry.js';
import { decode, registry } from './index.js';

const USAGE = `lorawan-decode — decode a LoRaWAN payload from the command line

  lorawan-decode --vendor <name> --model <model> --hex <payload> [options]
  lorawan-decode --vendor <name> --model <model> --base64 <payload> [options]
  lorawan-decode --list [vendor]

Options:
  --vendor, -v     Vendor name (milesight, netvox, ellenex, dragino)
  --model,  -m     Model name; separators and case are ignored
  --hex,    -x     Payload as hex; spaces, colons and dashes allowed
  --base64, -b     Payload as base64 (what ChirpStack and TTN deliver)
  --fport,  -p     fPort the uplink arrived on
  --strict         Treat warnings as errors
  --scaling        JSON object of vendor scaling options
  --json           Machine-readable output (the detailed shape)
  --list           List supported models and exit
  --help,   -h     This message

Examples:
  lorawan-decode -v milesight -m em400-tld -x "01755C03670101048244080500 01"
  lorawan-decode -v netvox -m r718n17 -x 014901240E150100000000 -p 6
  lorawan-decode -v ellenex -m pls2-l -x 01E80000D6000022 -p 15 \\
      --scaling '{"profile":"adc14","range":10}'
`;

interface Args {
  [key: string]: string | boolean | undefined;
}

function parseArgs(argv: string[]): Args {
  const alias: Record<string, string> = {
    v: 'vendor', m: 'model', x: 'hex', b: 'base64', p: 'fport', h: 'help',
  };
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('-')) continue;
    const name = token.replace(/^-+/, '');
    const key = alias[name] ?? name;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function listModels(vendorFilter?: string): void {
  const defs = registry.list().filter(
    (d) => !vendorFilter || d.vendor.toLowerCase() === vendorFilter.toLowerCase(),
  );
  let currentVendor = '';
  for (const def of defs) {
    if (def.vendor !== currentVendor) {
      currentVendor = def.vendor;
      process.stdout.write(`\n${currentVendor}\n`);
    }
    const aliasCount = def.aliases?.length ?? 0;
    const suffix = aliasCount > 0 ? `  (+${aliasCount} model variants)` : '';
    const accessor = `${def.vendor.toLowerCase()}.${accessorName(def.model)}`;
    process.stdout.write(`  ${def.model.padEnd(12)} ${accessor.padEnd(24)} ${def.description}${suffix}\n`);
  }
  const vendorCount = new Set(defs.map((d) => d.vendor)).size;
  process.stdout.write(`\n${defs.length} decoders, ${vendorCount} vendor${vendorCount === 1 ? '' : 's'}\n`);
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));

  if (args['help'] || process.argv.length <= 2) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (args['list']) {
    listModels(typeof args['list'] === 'string' ? args['list'] : undefined);
    return 0;
  }

  const vendor = args['vendor'];
  const model = args['model'];
  const hex = args['hex'];
  const base64 = args['base64'];
  const payload = typeof base64 === 'string' ? base64 : hex;

  if (typeof vendor !== 'string' || typeof model !== 'string' || typeof payload !== 'string') {
    process.stderr.write('error: --vendor, --model and --hex (or --base64) are all required\n\n');
    process.stdout.write(USAGE);
    return 2;
  }

  let scaling: Record<string, string | number> | undefined;
  if (typeof args['scaling'] === 'string') {
    try {
      scaling = JSON.parse(args['scaling']) as Record<string, string | number>;
    } catch {
      process.stderr.write('error: --scaling must be valid JSON\n');
      return 2;
    }
  }

  try {
    const result = decode(vendor, model, payload, {
      detailed: true,
      ...(typeof base64 === 'string' ? { encoding: 'base64' as const } : {}),
      ...(typeof args['fport'] === 'string' ? { fPort: Number(args['fport']) } : {}),
      ...(args['strict'] ? { strict: true } : {}),
      ...(scaling ? { scaling } : {}),
    });

    if (args['json']) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }

    process.stdout.write(`${vendor} ${model}\n\n`);
    for (const [key, value] of Object.entries(result.telemetry)) {
      const unit = result.units[key];
      process.stdout.write(`  ${key.padEnd(26)} ${String(value)}${unit && unit !== 'raw' ? ` ${unit}` : ''}\n`);
    }
    for (const record of result.history) {
      const { ts, ...values } = record;
      process.stdout.write(`\n  history @ ${ts}\n`);
      for (const [key, value] of Object.entries(values)) {
        process.stdout.write(`    ${key.padEnd(24)} ${String(value)}\n`);
      }
    }
    const attrs = Object.entries(result.attributes);
    if (attrs.length > 0) {
      process.stdout.write('\n  attributes\n');
      for (const [k, v] of attrs) process.stdout.write(`    ${k.padEnd(24)} ${String(v)}\n`);
    }
    for (const w of result.warnings) {
      process.stderr.write(`\nwarning [${w.code}] ${w.message}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof DecodeError) {
      process.stderr.write(`decode error [${error.code}] ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = main();
