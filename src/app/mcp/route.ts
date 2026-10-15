import { handleMcp } from '@/server/mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = handleMcp;
export const GET = handleMcp;
export const DELETE = handleMcp;
