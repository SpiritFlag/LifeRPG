import 'server-only';
import { auth, clerkClient } from '@clerk/nextjs/server';

export class AuthorizationError extends Error {
  constructor(public readonly status: 401 | 403 | 503, message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export function appOrigin(): string {
  const value = process.env.APP_URL;
  if (!value) throw new AuthorizationError(503, 'Authentication is not configured');
  const url = configuredUrl(value, 'Invalid application origin');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new AuthorizationError(503, 'Invalid application origin');
  }
  return url.origin;
}

function configuredUrl(value: string, message: string): URL {
  try { return new URL(value); }
  catch { throw new AuthorizationError(503, message); }
}

function requireClerkConfiguration(): void {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    throw new AuthorizationError(503, 'Authentication is not configured');
  }
}

export function mcpResource(): string { return `${appOrigin()}/mcp`; }

export function oauthIssuer(): string {
  const issuer = process.env.CLERK_OAUTH_ISSUER;
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!issuer || !key) throw new AuthorizationError(503, 'OAuth is not configured');
  const url = configuredUrl(issuer, 'Invalid OAuth issuer');
  // The publishable key binds discovery to the same Clerk instance as the SDK.
  const domain = Buffer.from(key.split('_').slice(2).join('_'), 'base64').toString('utf8').replace(/\$$/, '');
  if (url.protocol !== 'https:' || url.host !== domain || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new AuthorizationError(503, 'OAuth issuer does not match the Clerk instance');
  }
  return url.origin;
}

function ownerId(): string {
  const id = process.env.OWNER_CLERK_USER_ID?.trim();
  if (!id) throw new AuthorizationError(503, 'Owner is not configured');
  return id;
}

export function assertWebOrigin(request: Request): void {
  if (request.headers.get('origin') !== appOrigin() || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new AuthorizationError(403, 'Invalid request origin');
  }
}

export async function requireWebOwner(request?: Request): Promise<string> {
  requireClerkConfiguration();
  const owner = ownerId();
  if (request && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) assertWebOrigin(request);
  const session = await auth({ acceptsToken: 'session_token' });
  if (!session.userId) throw new AuthorizationError(401, 'Sign in required');
  if (session.userId !== owner) throw new AuthorizationError(403, 'Owner access required');
  return owner;
}

export interface McpPrincipal { ownerId: string; clientId: string; scopes: string[]; }

export async function authenticateMcp(request: Request): Promise<McpPrincipal> {
  requireClerkConfiguration();
  const owner = ownerId();
  oauthIssuer();
  const resource = mcpResource();
  const clients = process.env.MCP_ALLOWED_CLIENT_IDS?.split(',').map(x => x.trim()).filter(Boolean) ?? [];
  if (!clients.length) throw new AuthorizationError(503, 'OAuth clients are not configured');
  const match = /^Bearer ([^\s,]+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) throw new AuthorizationError(401, 'OAuth bearer token required');
  let token;
  try {
    // Official Clerk verification supports opaque and JWT access tokens. Never decode
    // an unverified JWT or accept a web session as MCP authorization.
    token = await (await clerkClient()).idPOAuthAccessToken.verify(match[1], { audience: resource });
  } catch {
    throw new AuthorizationError(401, 'Invalid OAuth access token');
  }
  // BAPI expiration is seconds; some SDK JWT paths normalize it to milliseconds.
  const expirationMs = typeof token.expiration === 'number'
    ? token.expiration < 1e12 ? token.expiration * 1000 : token.expiration : 0;
  if (token.revoked || token.expired || token.type !== 'oauth_token' ||
      !Number.isFinite(expirationMs) || expirationMs <= Date.now() ||
      !Array.isArray(token.aud) || !token.aud.includes(resource) ||
      !Array.isArray(token.scopes) || !token.scopes.every(scope => typeof scope === 'string')) {
    throw new AuthorizationError(401, 'Invalid or unbound OAuth access token');
  }
  if (token.subject !== owner || !clients.includes(token.clientId)) throw new AuthorizationError(403, 'OAuth access denied');
  return { ownerId: owner, clientId: token.clientId, scopes: token.scopes };
}

export async function requireMcpOwner(request: Request, scope: string): Promise<string> {
  const principal = await authenticateMcp(request);
  if (!principal.scopes.includes(scope)) throw new AuthorizationError(403, 'Insufficient OAuth scope');
  return principal.ownerId;
}
