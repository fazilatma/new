const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
for (const name of fs.readdirSync(__dirname).filter(n => n.endsWith('.cjs')).sort()) {
  console.log('\n▶ ' + name);
  const result = spawnSync(process.execPath, [__dirname + '/' + name], {stdio: 'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
