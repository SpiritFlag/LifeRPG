import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest, NextFetchEvent } from 'next/server';

// Adapter helpers enforce owner and token type. Discovery and sign-in must stay
// public; MCP authentication failures must reach its JSON challenge handler.
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    // The static demo must work in a fresh checkout without Clerk credentials.
    if (request.nextUrl.pathname === '/demo' || request.nextUrl.pathname.startsWith('/demo/')) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Authentication is not configured' }, { status: 503 });
  }
  return clerkMiddleware(async () => NextResponse.next())(request, event);
}

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)', '/(api|trpc)(.*)'],
};
