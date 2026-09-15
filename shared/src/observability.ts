import { randomUUID } from 'node:crypto';
import type { LogSink } from './messaging/observability.js';

/** Small dependency-free Prometheus exposition for each process.
 * Labels intentionally use only method, route and status to avoid cardinality
 * explosions from order IDs, email addresses, and other customer data. */
export class ServiceMetrics {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, { count: number; total: number }>();
  constructor(private readonly service: string) {}

  observeHttp(method: string, pathname: string, status: number, durationMs: number) {
    const route = pathname.replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, ':id');
    const key = `${method}|${route}|${status}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    const duration = this.durations.get(key) ?? { count: 0, total: 0 };
    duration.count += 1; duration.total += durationMs;
    this.durations.set(key, duration);
  }

  render() {
    const esc = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const labels = (key: string) => {
      const [method, route, status] = key.split('|');
      return `service="${esc(this.service)}",method="${esc(method)}",route="${esc(route)}",status="${status}"`;
    };
    const lines = [
      '# HELP saga_http_requests_total Completed HTTP requests.',
      '# TYPE saga_http_requests_total counter',
      '# HELP saga_http_request_duration_ms HTTP request duration in milliseconds.',
      '# TYPE saga_http_request_duration_ms summary',
    ];
    for (const [key, count] of this.requests) lines.push(`saga_http_requests_total{${labels(key)}} ${count}`);
    for (const [key, value] of this.durations) {
      lines.push(`saga_http_request_duration_ms_count{${labels(key)}} ${value.count}`);
      lines.push(`saga_http_request_duration_ms_sum{${labels(key)}} ${value.total}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

export function instrumentHttp(service: string, metrics: ServiceMetrics, log: LogSink, handler: (request: Request) => Response | Promise<Response>) {
  return async (request: Request) => {
    const started = performance.now();
    const requestId = request.headers.get('x-request-id')?.slice(0, 128) || randomUUID();
    let response: Response;
    try { response = await handler(request); }
    catch (error) {
      const durationMs = Math.round(performance.now() - started);
      metrics.observeHttp(request.method, new URL(request.url).pathname, 500, durationMs);
      log({ event: 'http_request_failed', route: new URL(request.url).pathname, requestId, outcome: '500', durationMs });
      throw error;
    }
    const durationMs = Math.round(performance.now() - started);
    metrics.observeHttp(request.method, new URL(request.url).pathname, response.status, durationMs);
    log({ event: 'http_request_completed', route: new URL(request.url).pathname, requestId, outcome: String(response.status), durationMs });
    response.headers.set('X-Request-Id', requestId);
    return response;
  };
}
