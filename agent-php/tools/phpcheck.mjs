#!/usr/bin/env node
/**
 * Static cross-checker: verifies that every `Class::method()`, `new Class()`,
 * `$this->method()` and `$this->prop` reference resolves to something that
 * actually exists, with a compatible argument count.
 *
 *   node tools/phpcheck.mjs app bin public
 */
import fs from 'fs';
import path from 'path';
import Engine from 'php-parser';

const roots = process.argv.slice(2);
if (!roots.length) roots.push(path.join(path.dirname(new URL(import.meta.url).pathname), '..'));

const parser = new Engine({ parser: { extractDoc: false }, ast: { withPositions: true } });
const SKIP = new Set(['node_modules', '.git', 'vendor', 'storage', 'data']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out); }
    else if (e.name.endsWith('.php')) out.push(p);
  }
  return out;
}

let files = [];
for (const r of roots) {
  const st = fs.statSync(r);
  files = files.concat(st.isDirectory() ? walk(r) : [r]);
}

const classes = new Map();
const errors = [];

function idOf(n) {
  if (!n) return '';
  if (typeof n === 'string') return n;
  if (typeof n.name === 'string') return n.name;
  if (n.name && typeof n.name.name === 'string') return n.name.name;
  return '';
}

function collect(node, file) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => collect(n, file)); return; }
  if (node.kind === 'class' || node.kind === 'interface' || node.kind === 'trait') {
    const name = idOf(node);
    const info = { methods: new Map(), consts: new Set(), props: new Set(), parent: idOf(node.extends), file };
    for (const b of node.body || []) {
      if (b.kind === 'method') {
        const args = b.arguments || [];
        info.methods.set(idOf(b), {
          req: args.filter(a => !a.value && !a.variadic).length,
          max: args.some(a => a.variadic) ? Infinity : args.length,
          static: !!b.isStatic,
        });
        if (idOf(b) === '__construct') for (const a of args) if (a.flags) info.props.add(idOf(a));
      } else if (b.kind === 'classconstant') {
        for (const c of b.constants || []) info.consts.add(idOf(c));
      } else if (b.kind === 'propertystatement') {
        for (const pr of b.properties || []) info.props.add(idOf(pr));
      }
    }
    classes.set(name, info);
  }
  for (const k of Object.keys(node)) if (k !== 'loc') collect(node[k], file);
}

const asts = [];
for (const f of files) {
  const ast = parser.parseCode(fs.readFileSync(f, 'utf8'), f);
  asts.push([f, ast]);
  collect(ast, f);
}

const climb = (cls, pick) => {
  let c = classes.get(cls);
  while (c) { const hit = pick(c); if (hit) return hit; c = c.parent ? classes.get(c.parent) : null; }
  return null;
};
const lookup = (cls, m) => climb(cls, c => c.methods.get(m));
const hasConst = (cls, n) => !!climb(cls, c => (c.consts.has(n) ? true : null));
const hasProp = (cls, n) => !!climb(cls, c => (c.props.has(n) ? true : null));

const callTargets = new WeakSet();

function check(node, file, ctx) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => check(n, file, ctx)); return; }
  if (node.kind === 'class') ctx = { ...ctx, cls: idOf(node) };

  if (node.kind === 'call') {
    const w = node.what;
    if (w && w.kind === 'staticlookup') {
      callTargets.add(w);
      const cls = idOf(w.what), m = idOf(w.offset);
      if (classes.has(cls) && m) {
        const sig = lookup(cls, m);
        if (!sig) errors.push(`${file}: ${cls}::${m}() does not exist`);
        else {
          const n = (node.arguments || []).length;
          const spread = (node.arguments || []).some(a => a.kind === 'variadic');
          if (!spread && (n < sig.req || n > sig.max)) {
            errors.push(`${file}: ${cls}::${m}() called with ${n} arg(s), expects ${sig.req}..${sig.max}`);
          }
        }
      }
    }
    if (w && w.kind === 'propertylookup' && w.what && w.what.kind === 'variable'
        && idOf(w.what) === 'this' && ctx.cls) {
      const m = idOf(w.offset);
      // a callable stored in a property is legal too
      if (m && !lookup(ctx.cls, m) && !hasProp(ctx.cls, m)) {
        errors.push(`${file}: $this->${m}() is neither a method nor a callable property of ${ctx.cls}`);
      }
    }
  }

  if (node.kind === 'new') {
    const cls = idOf(node.what);
    if (classes.has(cls)) {
      const sig = lookup(cls, '__construct');
      const n = (node.arguments || []).length;
      if (sig && !(node.arguments || []).some(a => a.kind === 'variadic') && (n < sig.req || n > sig.max)) {
        errors.push(`${file}: new ${cls}() with ${n} arg(s), constructor expects ${sig.req}..${sig.max}`);
      }
    }
  }

  if (node.kind === 'staticlookup' && !callTargets.has(node)) {
    const cls = idOf(node.what), c = idOf(node.offset);
    const isStaticProp = node.offset && node.offset.kind === 'variable';
    if (classes.has(cls) && c && c !== 'class' && !isStaticProp && !hasConst(cls, c) && !lookup(cls, c)) {
      errors.push(`${file}: ${cls}::${c} constant is not defined`);
    }
  }

  if (node.kind === 'propertylookup' && node.what && node.what.kind === 'variable'
      && idOf(node.what) === 'this' && ctx.cls) {
    const p = idOf(node.offset);
    if (p && !hasProp(ctx.cls, p) && !lookup(ctx.cls, p)) {
      errors.push(`${file}: $this->${p} is not a declared property of ${ctx.cls}`);
    }
  }

  for (const k of Object.keys(node)) if (k !== 'loc') check(node[k], file, ctx);
}

for (const [f, ast] of asts) check(ast, f, { cls: null });

if (errors.length) {
  errors.forEach(e => console.log('\u2717 ' + e));
  console.log(`\n${errors.length} problem(s)`);
  process.exit(1);
}
console.log(`\u2713 ${files.length} files, ${classes.size} classes \u2014 all static calls resolve`);
