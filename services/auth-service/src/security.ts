export function clientIp(request: Request, proxyToken?: string) {
  const trusted = !!proxyToken && request.headers.get('authorization') === `Bearer ${proxyToken}`;
  return (trusted ? request.headers.get('x-forwarded-for')?.split(',')[0] : undefined)?.trim() || 'unknown';
}

export function mutationError(request: Request, publicUrl: string, production: boolean) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
  if (new URL(request.url).pathname !== '/auth/logout' && !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
    return { status: 415, error: 'Content-Type must be application/json' };
  if (production && request.headers.get('origin') !== publicUrl)
    return { status: 403, error: 'Cross-site request blocked' };
}

export function cleanupSql(retentionDays: number) {
  return `
    DELETE FROM sessions WHERE expires_at <= now() - interval '30 days';
    DELETE FROM email_verification_tokens WHERE expires_at <= now() OR (consumed_at IS NOT NULL AND consumed_at <= now() - interval '1 day');
    DELETE FROM password_reset_tokens WHERE expires_at <= now() OR (consumed_at IS NOT NULL AND consumed_at <= now() - interval '1 day');
    DELETE FROM auth_rate_limits WHERE window_started_at <= now() - interval '30 days';
    DELETE FROM auth_audit_logs WHERE created_at <= now() - make_interval(days => ${retentionDays});
  `;
}
