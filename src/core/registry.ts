import { DecodeError } from './errors.js';
import { flatten } from './flatten.js';
import { toBytes } from './reader.js';
import type {
  DecodeContext,
  Detailed,
  ModelDecoder,
  ModelDefinition,
  ModelInfo,
  Options,
  Payload,
  Telemetry,
  Warning,
} from './types.js';
import { assertVocabulary } from './vocabulary.js';

/** Lookup key: lowercase, separators stripped. `EM400-TLD`, `em400tld`, `EM400_TLD` → same key. */
export function normalizeModelKey(vendor: string, model: string): string {
  return `${simplify(vendor)}/${simplify(model)}`;
}

const SEPARATORS = /[\s\-_.()]+/g;

function simplify(s: string): string {
  return s.toLowerCase().replace(SEPARATORS, '');
}

/** `EM310-TILT` → `em310_tilt`: the property name on a vendor namespace. */
export function accessorName(model: string): string {
  return model.toLowerCase().replace(SEPARATORS, '_').replace(/^_+|_+$/g, '');
}

// Type-erased definition; the registry does not keep per-model types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModelDefinition = ModelDefinition<any, string>;

export class DecoderRegistry {
  private readonly byKey = new Map<string, AnyModelDefinition>();
  private readonly definitions: AnyModelDefinition[] = [];

  register(def: AnyModelDefinition): this {
    assertVocabulary(`${def.vendor} ${def.model}`, def.keys);
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

  registerAll(defs: readonly AnyModelDefinition[]): this {
    for (const def of defs) this.register(def);
    return this;
  }

  resolve(vendor: string, model: string): AnyModelDefinition | undefined {
    return this.byKey.get(normalizeModelKey(vendor, model));
  }

  /** Like `resolve`, but throws `unknown_model` with a did-you-mean hint. */
  resolveOrThrow(vendor: string, model: string): AnyModelDefinition {
    const def = this.resolve(vendor, model);
    if (def) return def;
    const suggestion = this.closest(vendor, model);
    throw new DecodeError(
      'unknown_model',
      `no decoder for ${vendor} "${model}"` + (suggestion ? `; did you mean "${suggestion}"?` : ''),
      { vendor, model, ...(suggestion ? { suggestion } : {}), hint: 'call models() for supported names' },
    );
  }

  isModel(vendor: string, model: string): boolean {
    return this.resolve(vendor, model) !== undefined;
  }

  /** Every registered model, sorted for stable documentation output. */
  list(): AnyModelDefinition[] {
    return [...this.definitions].sort(
      (a, b) => a.vendor.localeCompare(b.vendor) || a.model.localeCompare(b.model),
    );
  }

  vendors(): string[] {
    return [...new Set(this.definitions.map((d) => d.vendor))].sort();
  }

  models(vendor?: string): ModelInfo[] {
    return this.list()
      .filter((d) => vendor === undefined || simplify(d.vendor) === simplify(vendor))
      .map((d) => ({
        vendor: d.vendor,
        name: d.model,
        accessor: accessorName(d.model),
        aliases: [...(d.aliases ?? [])],
        ...(d.fPort !== undefined ? { fPort: d.fPort } : {}),
        description: d.description,
        keys: { ...d.keys },
      }));
  }

  decode(vendor: string, model: string, payload: Payload, options?: Options & { detailed?: false }): Telemetry;
  decode(vendor: string, model: string, payload: Payload, options: Options & { detailed: true }): Detailed;
  decode(vendor: string, model: string, payload: Payload, options?: Options): Telemetry | Detailed;
  decode(vendor: string, model: string, payload: Payload, options: Options = {}): Telemetry | Detailed {
    const def = this.resolveOrThrow(vendor, model);
    return runDefinition(def, payload, options);
  }

  /** Closest registered name (edit distance ≤ 3), same vendor first. */
  private closest(vendor: string, model: string): string | undefined {
    const sameVendor = this.definitions.filter((d) => simplify(d.vendor) === simplify(vendor));
    const pool = sameVendor.length > 0 ? sameVendor : this.definitions;
    const target = simplify(model);
    let best: { name: string; distance: number } | undefined;
    for (const def of pool) {
      for (const name of [def.model, ...(def.aliases ?? [])]) {
        const distance = levenshtein(target, simplify(name));
        if (distance <= 3 && (!best || distance < best.distance)) best = { name, distance };
      }
    }
    return best?.name;
  }
}

/** Decode with one definition. Used by the registry and the namespaces. */
export function runDefinition(def: AnyModelDefinition, payload: Payload, options: Options): Telemetry | Detailed {
  const bytes = toBytes(payload, options.encoding);
  if (bytes.length === 0) {
    throw new DecodeError('empty_payload', 'payload is empty', { vendor: def.vendor, model: def.model });
  }

  const warnings: Warning[] = [];
  const warn = (warning: Warning): void => {
    if (options.strict) {
      throw new DecodeError('unsupported_report', warning.message, {
        ...warning, vendor: def.vendor, model: def.model,
      });
    }
    warnings.push(warning);
  };
  const ctx: DecodeContext = { model: def.model, options, warn };

  if (def.fPort !== undefined && options.fPort !== undefined && options.fPort !== def.fPort) {
    warn({
      code: 'vendor_quirk',
      message: `uplink arrived on fPort ${options.fPort}; ${def.vendor} documents fPort ${def.fPort} for ${def.model}`,
    });
  }

  const result = def.decode(bytes, ctx);
  const detailed = flatten(result.readings, result.attributes ?? {}, warnings, warn);
  return options.detailed ? detailed : detailed.telemetry;
}

/** Build one accessor function for a definition. */
export function accessor<T extends object>(def: ModelDefinition<T>): ModelDecoder<T> {
  const fn = ((payload: Payload, options: Options = {}) => runDefinition(def, payload, options)) as ModelDecoder<T>;
  Object.defineProperty(fn, 'definition', { value: def, enumerable: false });
  return fn;
}

type SeparatorChar = '-' | '_' | ' ' | '.' | '(' | ')';

/** Type-level `accessorName`. */
export type Accessor<S extends string> = ReplaceSeparators<Lowercase<S>>;
type ReplaceSeparators<S extends string> =
  S extends `${infer Head}${SeparatorChar}${infer Tail}` ? `${Head}_${ReplaceSeparators<Tail>}` : S;

type TelemetryOf<D> = D extends ModelDefinition<infer T, string> ? T : never;
type NamesOf<D> = D extends ModelDefinition<object, infer A> ? A : never;

/** `{ em400_tld: ModelDecoder<…>, em400tld: ModelDecoder<…>, … }` for a vendor. */
export type Namespace<Defs extends readonly AnyModelDefinition[]> = {
  readonly [D in Defs[number] as Accessor<NamesOf<D>>]: ModelDecoder<TelemetryOf<D>>;
};

export function namespace<const Defs extends readonly AnyModelDefinition[]>(defs: Defs): Namespace<Defs> {
  const out: Record<string, ModelDecoder<object>> = {};
  for (const def of defs) {
    const fn: ModelDecoder<object> = accessor(def as ModelDefinition<object>);
    for (const name of [def.model, ...(def.aliases ?? [])]) out[accessorName(name)] = fn;
  }
  return Object.freeze(out) as Namespace<Defs>;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let left = i;
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      const cur = Math.min(prev[j]! + 1, left + 1, sub);
      prev[j - 1] = left;
      left = cur;
    }
    prev[b.length] = left;
  }
  return prev[b.length]!;
}
