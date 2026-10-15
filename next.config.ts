import type { NextConfig } from 'next';
const config: NextConfig = { poweredByHeader: false, agentRules:false, serverExternalPackages: ['ws'],outputFileTracingIncludes:{'/mcp':['./src/ui/player-result.html']} };
export default config;
