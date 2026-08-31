/** Raised when a payload cannot be decoded at all. Partial decodes emit warnings instead. */
export class DecodeError extends Error {
  readonly code: DecodeErrorCode;
  readonly context: Record<string, unknown>;

  constructor(code: DecodeErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DecodeError';
    this.code = code;
    this.context = context;
  }
}

export type DecodeErrorCode =
  | 'unknown_model'
  | 'empty_payload'
  | 'payload_too_short'
  | 'out_of_bounds'
  | 'bad_hex'
  | 'wrong_fport'
  | 'unsupported_report';
