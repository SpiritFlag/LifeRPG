import { mcpResource, oauthIssuer } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
export function GET() {
  try {
    return Response.json({ resource: mcpResource(), authorization_servers: [oauthIssuer()], scopes_supported: ['life:read', 'life:write', 'life:delete'], bearer_methods_supported: ['header'] }, { headers });
  } catch {
    return Response.json({ error: 'OAuth is not configured' }, { status: 503, headers });
  }
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
}
