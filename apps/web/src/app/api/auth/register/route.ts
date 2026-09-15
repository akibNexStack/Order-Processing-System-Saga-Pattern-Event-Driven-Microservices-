import { NextResponse } from 'next/server';
const origin = () => process.env.AUTH_SERVICE_URL ?? 'http://127.0.0.1:3005';
export async function POST(request: Request) {
  try {
    const headers = new Headers({ 'content-type': 'application/json' });
    // The auth service receives this server-to-server request, so preserve the
    // address supplied by a trusted reverse proxy for per-client throttling.
    const forwardedFor = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);
    const upstream = await fetch(`${origin()}/auth/register`, { method: 'POST', headers, body: await request.text(), cache: 'no-store' });
    const body = await upstream.json();
    const response = NextResponse.json(body, { status: upstream.status });
    if (upstream.ok) response.cookies.set('saga_session', body.token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 604800 });
    return response;
  } catch {
    return NextResponse.json({ error: 'Authentication service is unavailable. Start Docker infrastructure, migrate auth-db, and run Auth Service on port 3005.' }, { status: 503 });
  }
}
