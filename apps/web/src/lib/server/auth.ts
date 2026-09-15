export function authHeaders(request: Request, json = true) {
  const headers = new Headers();
  if (json) headers.set('content-type', 'application/json');
  const origin = request.headers.get('origin');
  if (origin) headers.set('origin', origin);
  const token = process.env.AUTH_PROXY_TOKEN;
  if (token) headers.set('authorization', `Bearer ${token}`);
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor && token) headers.set('x-forwarded-for', forwardedFor);
  return headers;
}
