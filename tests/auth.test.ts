import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { NextRequest } from 'next/server';

// Only this unit-test process replaces Clerk. Live verification uses the actual SDK.
const originalLoad = (Module as any)._load;
let session: any;
let token: any;
let verificationError = false;
let verified: any[] = [];
let middlewareCalls = 0;
const sdk = {
  auth: async (options: unknown) => { assert.deepEqual(options, { acceptsToken: 'session_token' }); return session; },
  clerkClient: async () => ({ idPOAuthAccessToken: { verify: async (...args: unknown[]) => {
    verified.push(args);
    if (verificationError) throw new Error('invalid token');
    return token;
  } } }),
  clerkMiddleware: () => { middlewareCalls++; return () => new Response(null, { status: 200 }); },
};
(Module as any)._load = function(id: string, ...args: any[]) {
  if (id === 'server-only') return {};
  if (id === '@clerk/nextjs/server') return sdk;
  return originalLoad.call(this, id, ...args);
};
const auth = require('../src/server/auth') as typeof import('../src/server/auth');
const proxy = require('../src/proxy').default as typeof import('../src/proxy').default;
(Module as any)._load = originalLoad;
const originalEnv = { ...process.env };
after(() => { process.env = originalEnv; });
beforeEach(() => {
  process.env.APP_URL = 'http://localhost:3000';
  process.env.CLERK_SECRET_KEY = 'sk_test_mock';
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from('mock.clerk.accounts.dev$').toString('base64')}`;
  process.env.CLERK_OAUTH_ISSUER = 'https://mock.clerk.accounts.dev';
  process.env.OWNER_CLERK_USER_ID = 'user_owner';
  process.env.MCP_ALLOWED_CLIENT_IDS = 'client_allowed';
  session = { userId: 'user_owner' };
  token = { subject: 'user_owner', clientId: 'client_allowed', type: 'oauth_token', scopes: ['life:read'], aud: ['http://localhost:3000/mcp'], expiration: Math.floor(Date.now() / 1000) + 600, revoked: false, expired: false };
  verified = []; verificationError = false; middlewareCalls = 0;
});
const bearer = (value = 'real-looking-opaque-token') => new Request('http://localhost:3000/mcp', { headers: { authorization: `Bearer ${value}` } });
const rejects = (operation: () => Promise<unknown>, status: number) => assert.rejects(operation, (error: any) => error instanceof auth.AuthorizationError && error.status === status);

test('web owner requires a session, matching owner and same-origin mutations', async () => {
  assert.equal(await auth.requireWebOwner(), 'user_owner');
  session = { userId: null }; await rejects(() => auth.requireWebOwner(), 401);
  session = { userId: 'other' }; await rejects(() => auth.requireWebOwner(), 403);
  session = { userId: 'user_owner' };
  await rejects(() => auth.requireWebOwner(new Request('http://localhost:3000/api/commands', { method: 'POST' })), 403);
  await rejects(() => auth.requireWebOwner(new Request('http://localhost:3000/api/commands', { method: 'POST', headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' } })), 403);
  assert.equal(await auth.requireWebOwner(new Request('http://localhost:3000/api/commands', { method: 'POST', headers: { origin: 'http://localhost:3000' } })), 'user_owner');
});
test('MCP delegates opaque verification with exact resource audience and enforces scope', async () => {
  assert.equal(await auth.requireMcpOwner(bearer(), 'life:read'), 'user_owner');
  assert.deepEqual(verified[0], ['real-looking-opaque-token', { audience: 'http://localhost:3000/mcp' }]);
  await rejects(() => auth.requireMcpOwner(bearer(), 'life:write'), 403);
  token.expiration = Date.now() + 600000;
  assert.equal((await auth.authenticateMcp(bearer())).ownerId, 'user_owner');
});
test('MCP rejects missing, malformed and unverified credentials', async () => {
  for (const header of ['', 'Basic abc', 'Bearer one two', 'Bearer one,two']) {
    await rejects(() => auth.authenticateMcp(new Request('http://localhost:3000/mcp', { headers: { authorization: header } })), 401);
  }
  assert.equal(verified.length, 0);
  verificationError = true; await rejects(() => auth.authenticateMcp(bearer()), 401);
});
test('MCP rejects revoked, expired, session, unbound and malformed OAuth tokens', async () => {
  const valid = { ...token };
  for (const patch of [{ revoked: true }, { expired: true }, { type: 'session_token' }, { expiration: 1 }, { expiration: null }, { expiration: Infinity }, { aud: undefined }, { aud: ['http://wrong/mcp'] }, { aud: 'http://localhost:3000/mcp' }, { scopes: null }, { scopes: [123] }]) {
    token = { ...valid, ...patch }; await rejects(() => auth.authenticateMcp(bearer()), 401);
  }
  for (const patch of [{ subject: 'another-user' }, { clientId: 'unapproved-client' }]) {
    token = { ...valid, ...patch }; await rejects(() => auth.authenticateMcp(bearer()), 403);
  }
});
test('missing auth configuration fails closed before calling Clerk', async () => {
  for (const key of ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'OWNER_CLERK_USER_ID']) {
    const value = process.env[key]; delete process.env[key];
    await rejects(() => auth.requireWebOwner(), 503); await rejects(() => auth.authenticateMcp(bearer()), 503);
    process.env[key] = value;
  }
  delete process.env.MCP_ALLOWED_CLIENT_IDS; await rejects(() => auth.authenticateMcp(bearer()), 503);
  assert.equal(verified.length, 0);
});
test('origin and issuer reject invalid URLs and mismatched instances', () => {
  for (const value of ['broken', 'https://example.com/path', 'http://example.com', 'https://user:pass@example.com', 'https://example.com?query=1']) {
    process.env.APP_URL = value; assert.throws(auth.appOrigin, { status: 503 });
  }
  for (const value of ['broken', 'http://mock.clerk.accounts.dev', 'https://different.clerk.accounts.dev', 'https://mock.clerk.accounts.dev/path']) {
    process.env.CLERK_OAUTH_ISSUER = value; assert.throws(auth.oauthIssuer, { status: 503 });
  }
});
test('proxy serves only demo without keys and closes private paths', async () => {
  delete process.env.CLERK_SECRET_KEY; delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  for (const path of ['/demo', '/demo/example']) assert.equal((await proxy(new NextRequest(`http://localhost:3000${path}`), {} as any))?.status, 200);
  for (const path of ['/', '/api/player', '/mcp', '/demography']) assert.equal((await proxy(new NextRequest(`http://localhost:3000${path}`), {} as any))?.status, 503);
  assert.equal(middlewareCalls, 0);
  process.env.CLERK_SECRET_KEY = 'mock'; process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'mock';
  await proxy(new NextRequest('http://localhost:3000/api/player'), {} as any);
  await proxy(new NextRequest('http://localhost:3000/demo'), {} as any);
  assert.equal(middlewareCalls, 2);
});
