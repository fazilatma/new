// One shared GitHub branch/version scan for every runtime. The dashboard CSP
// (connect-src 'self') forbids the browser from calling api.github.com, so the
// server scans and caches instead and the dashboard renders the same-origin
// reply. Both runtimes inject their own safeFetch; the logic stays single-source.
export type BranchFetcher = (url: string) => Promise<Response>;
export type BranchVersionStatus = 'newer' | 'equal' | 'older' | 'unknown';
export interface DeployerBranch {
  name: string;
  version: string;
  status: BranchVersionStatus;
}
export interface DeployerBranchScan {
  ok: true;
  running: string;
  cached: boolean;
  branches: DeployerBranch[];
}
export type DeployerBranchStage = 'list' | 'manifest';
export type DeployerBranchError = 'RATE_LIMIT' | 'UNREACHABLE' | 'INVALID';
export interface DeployerBranchFailure {
  ok: false;
  stage: DeployerBranchStage;
  error: DeployerBranchError;
  detail: string;
}
const DEPLOYER_BRANCHES_TTL_MS = 5 * 60 * 1000;
const MANIFEST_PATH = 'cloudflare-scraper4/package.json';
let deployerBranchCache: { at: number; branches: { name: string; version: string }[] } | null = null;

export function clearDeployerBranchCache(): void {
  deployerBranchCache = null;
}

function numericCore(value: string): [number, number, number] | null {
  const m = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function branchVersionStatus(version: string, running: string): BranchVersionStatus {
  const a = numericCore(version);
  const b = numericCore(running);
  if (!a || !b) return 'unknown';
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 'newer' : 'older';
  }
  return 'equal';
}

function versionFromJsonText(text: string): string {
  const m = String(text || '').match(/"version"\s*:\s*"([^"]+)"/);
  return m ? m[1] : '';
}

function decodeBase64ToBinary(b64: string): string {
  const clean = String(b64 || '').replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') return Buffer.from(clean, 'base64').toString('binary');
  return atob(clean);
}

async function fetchManifestVersion(fetcher: BranchFetcher, branch: string): Promise<string> {
  const ref = encodeURIComponent(branch);
  try {
    const raw = await fetcher(`https://raw.githubusercontent.com/fazilatma/new/${ref}/${MANIFEST_PATH}`);
    if (raw && raw.ok) {
      const body = (await raw.json()) as { version?: unknown };
      if (body && body.version) return String(body.version);
    }
  } catch {
    // Fall through to the Contents API below.
  }
  try {
    const viaApi = await fetcher(`https://api.github.com/repos/fazilatma/new/contents/${MANIFEST_PATH}?ref=${ref}`);
    if (viaApi && viaApi.ok) {
      const body = (await viaApi.json()) as { content?: unknown };
      const content = body && typeof body.content === 'string' ? body.content : '';
      if (content) return versionFromJsonText(decodeBase64ToBinary(content));
    }
  } catch {
    // Unknown version; the row still renders.
  }
  return '';
}

function scanFailure(stage: DeployerBranchStage, error: DeployerBranchError, detail: string): DeployerBranchFailure {
  return { ok: false, stage, error, detail };
}

export async function scanDeployerBranches(fetcher: BranchFetcher, running: string): Promise<DeployerBranchScan | DeployerBranchFailure> {
  const now = Date.now();
  if (deployerBranchCache && now - deployerBranchCache.at < DEPLOYER_BRANCHES_TTL_MS) {
    return {
      ok: true,
      running,
      cached: true,
      branches: deployerBranchCache.branches.map(b => ({ name: b.name, version: b.version, status: branchVersionStatus(b.version, running) })),
    };
  }
  let list: unknown;
  try {
    const response = await fetcher('https://api.github.com/repos/fazilatma/new/branches?per_page=100');
    if (!response) return scanFailure('list', 'UNREACHABLE', 'empty response');
    if (response.status === 403 || response.status === 429) return scanFailure('list', 'RATE_LIMIT', `HTTP ${response.status}`);
    if (!response.ok) return scanFailure('list', 'UNREACHABLE', `HTTP ${response.status}`);
    list = await response.json();
  } catch (error) {
    return scanFailure('list', 'UNREACHABLE', error instanceof Error ? error.message : String(error));
  }
  if (!Array.isArray(list)) return scanFailure('list', 'INVALID', 'expected a branch array');
  const names: string[] = [];
  for (const entry of list) {
    if (entry && typeof entry === 'object' && 'name' in entry) {
      const name = String((entry as { name: unknown }).name || '');
      if (name) names.push(name);
    }
  }
  const versions = await Promise.all(names.map(async name => ({ name, version: await fetchManifestVersion(fetcher, name) })));
  deployerBranchCache = { at: now, branches: versions.map(v => ({ name: v.name, version: v.version })) };
  return {
    ok: true,
    running,
    cached: false,
    branches: versions.map(v => ({ name: v.name, version: v.version, status: branchVersionStatus(v.version, running) })),
  };
}
