// Node-side GitHub API fetchers shared by the web server and the standalone
// cron entry (cron.ts must not import server.ts: it boots a web server).
import { githubApiHeaders } from '../worker-src/deployer-branches.js';
import { safeFetch } from './network.js';

export const githubApiFetch = (token?: unknown, version?: unknown) => (url: string) =>
  safeFetch(url, { apiMode: true, directRoute: true, headers: githubApiHeaders(token, version) }, 200000);

export const githubApiPut = (token?: unknown, version?: unknown) => (url: string, body: Record<string, unknown>) =>
  safeFetch(url, { apiMode: true, directRoute: true, method: 'PUT', headers: { ...githubApiHeaders(token, version), 'content-type': 'application/json' }, body: JSON.stringify(body) }, 200000);
