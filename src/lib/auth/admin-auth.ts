import { createHash, timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison. Both sides are hashed to fixed length so
 * `timingSafeEqual` (which requires equal-length buffers) works regardless of
 * the input lengths, avoiding a length-leaking early return.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Validates whether the incoming request is authorized as an administrator.
 * Expects an Authorization header (Bearer token) or x-admin-key header
 * matching the ADMIN_SECRET environment variable.
 */
export function verifyAdminRequest(request: Request): boolean {
  const authHeader = request.headers.get('Authorization') || request.headers.get('x-admin-key');
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret) {
    console.warn('[Admin Auth] ADMIN_SECRET is not configured in environment. Rejecting admin request by default.');
    return false;
  }

  if (!authHeader) {
    return false;
  }

  // Support both "Bearer <token>" and direct "<token>"
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  // Audit fix: constant-time comparison (was a plain string === that leaks
  // length and is not constant-time).
  return safeEqual(token, adminSecret);
}
