import { NextResponse } from 'next/server';

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
  return token === adminSecret;
}
