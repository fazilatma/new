import path from 'node:path';
export function safePath(root,rel){const r=path.resolve(root,rel||'.'); if(r!==root&&!r.startsWith(root+path.sep))throw Error('Path outside workspace'); return r}
export function isDangerousCommand(command){const c=command.toLowerCase(); const blocked=[/\\brm\\s+-rf\\s+\\//,/\\bmkfs\\b/,/\\bdd\\s+if=.*\\bof=\\/dev\\b/,/\\bshutdown\\b/,/\\breboot\\b/,/\\b:>\\s*\\/etc\\b/,/\\bcurl\\b[^\\n|;&]*\\|\\s*(sh|bash)/,/\\bwget\\b[^\\n|;&]*\\|\\s*(sh|bash)/]; return blocked.some(r=>r.test(c))}
export function securityMiddleware(req,res,next){const token=process.env.AGENT_TOKEN; if(!token||req.path==='/api/health'||req.path==='/')return next(); const got=req.get('x-agent-token')||req.query.token; if(got!==token)return res.status(401).json({error:'Unauthorized'}); next()}
