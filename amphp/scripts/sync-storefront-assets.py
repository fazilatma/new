#!/usr/bin/env python3
"""Synchronize the built storefront with disk and single-file plugin deployments.

Run after `cd storefront-react && npm ci && npm run build`.
"""
import base64
import gzip
import hashlib
import re
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
build = root / 'asset/js/storefront'
files = ('storefront.js', 'storefront.css')
payload = {name: base64.b64encode(gzip.compress((build / name).read_bytes(), mtime=0)).decode('ascii') for name in files}
for folder in ('includes/storefront', 'deploy/asset/js/storefront', 'deploy/includes/storefront'):
    for name in files:
        shutil.copyfile(build / name, root / folder / name)

pack_path = root / 'includes/storefront/embedded-assets.php'
pack = pack_path.read_text()
for name in files:
    pattern = r"('" + re.escape(name) + r"'\s*=>\s*array\([^\n]*?'gz'\s*=>\s*')[^']*(')"
    pack, count = re.subn(pattern, lambda m: m.group(1) + payload[name] + m.group(2), pack)
    if count != 1:
        raise RuntimeError(f'Unexpected external pack format: {name}')
pack = re.sub(r"('hash'\s*=>\s*')[^']*(')", lambda m: m.group(1) + hashlib.md5((build / 'storefront.js').read_bytes()).hexdigest()[:10] + m.group(2), pack, count=1)
pack_path.write_text(pack)
shutil.copyfile(pack_path, root / 'deploy/includes/storefront/embedded-assets.php')

for plugin in (root / 'agent.php', root / 'deploy/agent.php'):
    text = plugin.read_text()
    for name in files:
        pattern = r"('" + re.escape(name) + r"'\s*=>\s*array\(\s*'mime'\s*=>\s*'[^']*',\s*'gz'\s*=>\s*')[^']*(')"
        text, count = re.subn(pattern, lambda m: m.group(1) + payload[name] + m.group(2), text)
        if count != 1:
            raise RuntimeError(f'Unexpected inline pack format: {plugin} {name}')
    plugin.write_text(text)
