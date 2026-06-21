import { randomUUID } from 'node:crypto';

/**
 * Wide-event logger. Pattern dari https://loggingsucks.com/:
 * - Satu JSON event per request, emitted sekali di finally block.
 * - Field-field di-accumulate sepanjang request lifecycle.
 * - "Log what happened to this request" — bukan apa yang code lagi lakukan.
 *
 * Pakai:
 *   const evt = newEvent('/api/scan');
 *   try {
 *     evt.set('user_id', user.id);
 *     // ...
 *     return done(evt, 201, body);
 *   } finally { evt.emit(); }
 */

type LogValue = unknown;

export class RequestEvent {
  private fields: Record<string, LogValue>;
  private startMs: number;
  private warnings: string[] = [];

  constructor(initial: Record<string, LogValue>) {
    this.startMs = Date.now();
    this.fields = {
      request_id: randomUUID(),
      ts: new Date().toISOString(),
      ...initial,
    };
  }

  set(key: string, value: LogValue): this {
    this.fields[key] = value;
    return this;
  }

  merge(obj: Record<string, LogValue>): this {
    Object.assign(this.fields, obj);
    return this;
  }

  warn(message: string): this {
    this.warnings.push(message);
    return this;
  }

  error(err: unknown): this {
    if (err instanceof Error) {
      this.fields.error = {
        name: err.name,
        message: err.message,
        stack: err.stack?.split('\n').slice(0, 6).join('\n'),
      };
    } else {
      this.fields.error = { message: String(err) };
    }
    return this;
  }

  emit(): void {
    const event = {
      ...this.fields,
      duration_ms: Date.now() - this.startMs,
      ...(this.warnings.length > 0 ? { warnings: this.warnings } : {}),
    };
    // Vercel + most aggregators parse stdout as JSON if it looks like JSON
    console.log(JSON.stringify(event));
  }
}

export function newEvent(route: string, extra: Record<string, LogValue> = {}): RequestEvent {
  return new RequestEvent({ route, ...extra });
}

/**
 * Convenience: tag the event with HTTP status, then return NextResponse-style result.
 * Caller still wraps the route in try/finally to emit().
 */
export function tagStatus(evt: RequestEvent, status: number): void {
  evt.set('status', status);
}
