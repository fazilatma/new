import path from 'node:path';

export function safePath(root, rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, rel || '.');
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Path outside workspace');
  }
  return target;
}

export function isDangerousCommand(command) {
  const x = String(command || '').toLowerCase();
  const patterns = [
    /\brm\s+-rf\s+\//,
    /\bmkfs\b/,
    /\bdd\s+if=.*\bof=\/dev\b/,
    /\bshutdown\b/,
    /\bpoweroff\b/,
    /\bhalt\b/,
    /\bkill\s+-9\b/,
    /\b(chown|chmod)\s+-R\b/,
    /\buseradd\b|\buserdel\b/,
    /\bmount\b|\bumount\b/,
    /\biptables\b|\bnft\b/,
    /\bpkill\b|\bkillall\b/,
    /\breboot\b/,
    /\bcurl\b[^\n|;&]*\|\s*(sh|bash)/,
    /\bwget\b[^\n|;&]*\|\s*(sh|bash)/
  ];
  if (/\b(rm|mv|cp)\b[^\n]*\s+\/etc\b|\b(rm|mv|cp)\b[^\n]*\s+\/home\b/.test(x)) return true;
  return patterns.some((pattern) => pattern.test(x));
}

export function securityMiddleware(req, res, next) {
  const token = process.env.AGENT_TOKEN;
  if (
    !token ||
    !req.path.startsWith('/api/') ||
    req.path === '/api/health'
  ) {
    return next();
  }

  const supplied = req.get('x-agent-token') || req.query.token;
  if (supplied !== token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
}
