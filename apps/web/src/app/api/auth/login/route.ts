import { NextResponse } from 'next/server';
import { authHeaders } from '../../../../lib/server/auth';
const origin = () => process.env.AUTH_SERVICE_URL ?? 'http://127.0.0.1:3005';
export async function POST(request: Request) {
  try {
    const upstream = await fetch(`${origin()}/auth/login`, { method: 'POST', headers: authHeaders(request), body: await request.text(), cache: 'no-store' });
    const body = await upstream.json();
    const response = NextResponse.json(body, { status: upstream.status });
    if (upstream.ok) response.cookies.set('saga_session', body.token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 604800 });
    return response;
  } catch {
    return NextResponse.json({ error: 'Authentication service is unavailable. Start Docker infrastructure, migrate auth-db, and run Auth Service on port 3005.' }, { status: 503 });
  }
}
