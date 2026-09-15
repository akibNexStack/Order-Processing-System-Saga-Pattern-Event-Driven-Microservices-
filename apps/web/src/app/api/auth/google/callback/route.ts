import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const callbackError = (request: Request, message: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = (await cookies()).get('saga_google_oauth_state')?.value;
  if (!code || !state || !expected || state !== expected) return callbackError(request, 'Google sign-in could not be verified');
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const authOrigin = process.env.AUTH_SERVICE_URL;
  const proxyToken = process.env.AUTH_PROXY_TOKEN;
  if (!clientId || !clientSecret || !authOrigin || !proxyToken) return callbackError(request, 'Google sign-in is not configured');
  try {
    const redirectUri = new URL('/api/auth/google/callback', request.url).href;
    const token = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }), cache: 'no-store' });
    const tokenBody = await token.json() as { access_token?: string };
    if (!token.ok || !tokenBody.access_token) return callbackError(request, 'Google sign-in was declined');
    const identity = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokenBody.access_token}` }, cache: 'no-store' });
    const profile = await identity.json() as { sub?: string; email?: string; email_verified?: boolean };
    if (!identity.ok || !profile.sub || !profile.email || profile.email_verified !== true) return callbackError(request, 'A verified Google email is required');
    const session = await fetch(`${authOrigin}/auth/google`, { method: 'POST', headers: { authorization: `Bearer ${proxyToken}`, origin: new URL(request.url).origin, 'content-type': 'application/json' }, body: JSON.stringify({ subject: profile.sub, email: profile.email }), cache: 'no-store' });
    const body = await session.json() as { token?: string };
    if (!session.ok || !body.token) return callbackError(request, 'Google sign-in is temporarily unavailable');
    const response = NextResponse.redirect(new URL('/', request.url));
    response.cookies.set('saga_session', body.token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 604800 });
    response.cookies.set('saga_google_oauth_state', '', { httpOnly: true, path: '/api/auth/google', maxAge: 0 });
    return response;
  } catch { return callbackError(request, 'Google sign-in is temporarily unavailable'); }
}
