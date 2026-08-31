import { DecodeError } from './errors.js';
import { toBytes, toHex } from './reader.js';
import type {
  DecodeContext,
  DecodeRequest,
  DecodeWarning,
  DecodedUplink,
  ModelDefinition,
} from './types.js';

/**
 * Model keys are normalized before lookup: lowercased, with separators removed.
 * `EM400-TLD`, `em400tld` and `EM400 TLD` are the same device, and in real
 * fleets you will receive all three spellings from different integrations.
 */
export function normalizeModelKey(vendor: string, model: string): string {
  return `${simplify(vendor)}/${simplify(model)}`;
}

function simplify(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.()]/g, '');
}

export class DecoderRegistry {
  private readonly byKey = new Map<string, ModelDefinition>();
  private readonly definitions: ModelDefinition[] = [];

  register(def: ModelDefinition): this {
    const keys = [def.model, ...(def.aliases ?? [])];
    for (const key of keys) {
      const k = normalizeModelKey(def.vendor, key);
      const existing = this.byKey.get(k);
      if (existing && existing.model !== def.model) {
        throw new Error(
          `decoder key collision: "${k}" is claimed by both ${existing.vendor} ${existing.model} and ${def.vendor} ${def.model}`,
        );
      }
      this.byKey.set(k, def);
    }
    this.definitions.push(def);
    return this;
  }

  registerAll(defs: readonly ModelDefinition[]): this {
    for (const def of defs) this.register(def);
    return this;
  }

  resolve(vendor: string, model: string): ModelDefinition | undefined {
    return this.byKey.get(normalizeModelKey(vendor, model));
  }

  /** Every registered model, sorted for stable documentation output. */
  list(): ModelDefinition[] {
    return [...this.definitions].sort(
      (a, b) => a.vendor.localeCompare(b.vendor) || a.model.localeCompare(b.model),
    );
  }

  vendors(): string[] {
    return [...new Set(this.definitions.map((d) => d.vendor))].sort();
  }

  decode(request: DecodeRequest): DecodedUplink {
    const { vendor, model, payload, ...options } = request;
    const def = this.resolve(vendor, model);
    if (!def) {
      throw new DecodeError('unknown_model', `no decoder registered for ${vendor} ${model}`, {
        vendor,
        model,
        hint: 'call registry.list() for supported models',
      });
    }

    const bytes = toBytes(payload);
    if (bytes.length === 0) {
      throw new DecodeError('empty_payload', 'payload is empty', { vendor, model });
    }

    const warnings: DecodeWarning[] = [];
    const ctx: DecodeContext = {
      model: def.model,
      options,
      warn(warning) {
        if (options.strict) {
          throw new DecodeError('unsupported_report', warning.message, { ...warning, vendor, model });
        }
        warnings.push(warning);
      },
    };

    if (def.fPort !== undefined && options.fPort !== undefined && options.fPort !== def.fPort) {
      ctx.warn({
        code: 'vendor_quirk',
        message: `uplink arrived on fPort ${options.fPort}; ${def.vendor} documents fPort ${def.fPort} for ${def.model}`,
      });
    }

    const result = def.decode(bytes, ctx);

    return {
      vendor: def.vendor,
      model: def.model,
      measurements: result.measurements,
      attributes: result.attributes ?? {},
      warnings,
      raw: toHex(bytes),
      ...(options.fPort !== undefined ? { fPort: options.fPort } : {}),
    };
  }
}
