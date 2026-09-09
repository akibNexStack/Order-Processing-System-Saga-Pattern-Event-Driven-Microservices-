import { createHash, timingSafeEqual } from 'node:crypto';

/** Deployment-boundary credential, never a browser credential. */
export function protectService(
  handler: (request: Request) => Response | Promise<Response>,
  env: Record<string, string | undefined> = process.env,
) {
  const token = env.BACKEND_API_TOKEN;
  if ((env.REQUIRE_SERVICE_AUTH === '1' || env.RENDER === 'true') && !token)
    throw new Error('BACKEND_API_TOKEN is required for hosted services');
  if (token && (token.length < 32 || /\s/.test(token)))
    throw new Error('BACKEND_API_TOKEN must contain at least 32 non-whitespace characters');
  const expected = token ? createHash('sha256').update(`Bearer ${token}`).digest() : null;
  return async (request: Request) => {
    // Liveness contains no business data and is needed by the hosting platform.
    if (expected && !(request.method === 'GET' && new URL(request.url).pathname === '/health')) {
      const supplied = createHash('sha256').update(request.headers.get('authorization') ?? '').digest();
      if (!timingSafeEqual(supplied, expected))
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    return handler(request);
  };
}
