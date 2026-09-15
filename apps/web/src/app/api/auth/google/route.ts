import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

const cookie = 'saga_google_oauth_state';

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: 'Google sign-in is not configured' }, { status: 503 });
  const state = randomBytes(32).toString('base64url');
  const callback = new URL('/api/auth/google/callback', request.url).href;
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.search = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' }).toString();
  const response = NextResponse.redirect(google);
  response.cookies.set(cookie, state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/google', maxAge: 600 });
  return response;
}
