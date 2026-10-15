import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { commandSchema } from '@/lib/contracts';
import { continueJob, deleteEvent, readPlayer, submitCommand } from '@/server/service';
import { ServiceError } from '@/server/errors';
import { authenticateMcp, AuthorizationError, mcpResource, type McpPrincipal } from '@/server/auth';

export const PLAYER_RESOURCE_URI = 'ui://liferpg/player-result.html';
const scopes = ['life:read', 'life:write', 'life:delete'];

function toolResult(data: object) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: { ...data } };
}

function requireScope(principal: McpPrincipal, scope: string) {
  if (!principal.scopes.includes(scope)) throw new AuthorizationError(403, 'Insufficient OAuth scope');
}

function createServer(principal: McpPrincipal) {
  const server = new McpServer({ name: 'LifeRPG', version: '0.1.0' },{instructions:'Start each conversation with get_player_context. Show saved public scenes and small changes naturally and often; use only committed numbers/content, never invent rewards. A waiting job is accepted but unapplied. Check its predecessor, then explicitly call continue_life_job once the predecessor finishes; polling never starts paid work. On the next conversation, discover pending jobs from context and continue accepted work in order. If you cannot call the write tool, say it remains accepted and unapplied. Before repeating a real event, inspect events for candidates; use correct with the same event ID for added facts and ask when identity is uncertain. Never submit jokes, hypotheticals, plans, fiction or other people’s experiences as completed activities. Ask consent before registering a real task, preserve the actual task/conditions/recurrence, respect pauses/refusals and never mark a quest done from a click. Force-record and deletion are player rights independent of GM rewards; identify deletion targets without guessing. Keep ordinary conversation flowing, use the interactive result card and text/web fallback, and do not introduce separate fantasy movement/combat commands. GM rationale and secrets are never player content.'});
  const ui = { resourceUri: PLAYER_RESOURCE_URI };
  const security = (scope: string) => ({ ui, securitySchemes: [{ type: 'oauth2', scopes: [scope] }] });
  const invoke = async (scope: string, action: () => Promise<object>) => {
    try {
      requireScope(principal, scope);
      return toolResult(await action());
    } catch (error) {
      if (error instanceof AuthorizationError) return {
        isError: true,
        content: [{ type: 'text' as const, text: error.message }],
        _meta: { 'mcp/www_authenticate': [`Bearer error="insufficient_scope", scope="${scope}"`] },
      };
      if (error instanceof ServiceError) return {
        isError: true,
        content: [{ type: 'text' as const, text: `Request rejected: ${error.code}. Read the current saved state before retrying.` }],
        structuredContent: { error: error.code, status: error.status },
      };
      // Natural-language input and provider/DB details must not leak through errors.
      return { isError: true, content: [{ type: 'text' as const, text: 'The request could not be completed. Check the saved state before retrying.' }] };
    }
  };
  server.registerTool('get_player_context', {
    title: 'Read the adventure', description: 'Read the current player state, recent public results and pending work. Does not advance the world.',
    inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: security('life:read'),
  }, async () => invoke('life:read', () => readPlayer(principal.ownerId)));
  server.registerTool('submit_life_command', {
    title: 'Record an adventure event',
    description: 'Start only on explicit request, or submit confirmed real experiences, corrections, explicit force-record requests, consented quests, answers and appeals. Generate an opaque UUID requestKey for each new request, reuse that exact UUID only for transport replay, and never put names or facts in the key. Never treat plans, jokes, guesses or other people’s actions as completed experiences. Quest registration and button clicks are not completion evidence.',
    inputSchema: commandSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, _meta: security('life:write'),
  }, async input => invoke('life:write', () => submitCommand(principal.ownerId, commandSchema.parse(input))));
  server.registerTool('continue_life_job', {
    title: 'Continue a saved judgment', description: 'Explicitly continue or retry an already saved job after checking its current state; never create a new event to retry a result.',
    inputSchema: { jobId: z.string().min(1).max(160) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, _meta: security('life:write'),
  }, async ({ jobId }) => invoke('life:write', () => continueJob(principal.ownerId, jobId)));
  server.registerTool('delete_life_event', {
    title: 'Delete a real event', description: 'Delete a previously identified real event and its revealing derivatives only at the player’s explicit request. First confirm the target event ID; never guess it. Returns deletion scope and external retention limits.',
    inputSchema: { eventId: z.string().min(1).max(160) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, _meta: security('life:delete'),
  }, async ({ eventId }) => invoke('life:delete', () => deleteEvent(principal.ownerId, eventId)));
  server.registerResource('player-result', PLAYER_RESOURCE_URI, {
    title: 'LifeRPG adventure card', mimeType: 'text/html;profile=mcp-app',
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } },
  }, async () => ({ contents: [{ uri: PLAYER_RESOURCE_URI, mimeType: 'text/html;profile=mcp-app',
    text: await readFile(path.join(process.cwd(), 'src/ui/player-result.html'), 'utf8'),
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } },
  }] }));
  return server;
}

export function mcpAuthError(error: unknown): Response {
  const status = error instanceof AuthorizationError ? error.status : 503;
  let metadata = '';
  try { metadata = `, resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', mcpResource()).href}"`; } catch { /* Missing configuration stays closed. */ }
  const challenge = `Bearer${status === 401 ? ' error="invalid_token"' : status === 403 ? ' error="insufficient_scope"' : ''}${metadata}`;
  return Response.json({ error: status === 503 ? 'Authentication is not configured or unavailable' : 'OAuth authorization required' }, {
    status, headers: { 'Cache-Control': 'private, no-store', 'WWW-Authenticate': challenge },
  });
}

export async function handleMcp(request: Request): Promise<Response> {
  let principal: McpPrincipal;
  try { principal = await authenticateMcp(request); } catch (error) { return mcpAuthError(error); }
  // Each HTTP request owns its server and transport. No cross-user sessions or Redis.
  const server = createServer(principal);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } finally {
    await transport.close();
    await server.close();
  }
}

export const MCP_SCOPES = scopes;
