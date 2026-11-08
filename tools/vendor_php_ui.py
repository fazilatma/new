#!/usr/bin/env python3
"""Copy the exact final line-start HTML document from a verified PHP source.

Usage: python3 tools/vendor_php_ui.py /path/to/scraper4.php --commit <40hex>
No PHP execution or network calls. Review PHP slot/endpoint changes before use.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('--commit',required=True)
    args=parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}',args.commit):parser.error('Full verified source commit required')
    raw=args.source.read_bytes();match=re.search(rb'^<!DOCTYPE html>\r?$',raw,re.M)
    if not match:parser.error('No line-start HTML document boundary')
    client=raw[match.start():]
    if not client.rstrip().endswith(b'</html>'):parser.error('Unexpected document end')
    version=re.search(rb"const APP_VERSION = '([^']+)';",raw)
    if not version:parser.error('Missing PHP source version')
    target=Path(__file__).resolve().parents[1]/'pythonanywhere/scraper4/upstream'
    manifest=json.loads((target/'manifest.json').read_text())
    slots=[m.group().decode() for m in re.finditer(rb'<\?(?:php|=).*?\?>',client,re.S)]
    if slots!=manifest['php_slots']:parser.error('PHP output slots changed: review renderer before updating snapshot')
    manifest.update(source_commit=args.commit,source_version=version[1].decode(),source_sha256=hashlib.sha256(raw).hexdigest(),client_sha256=hashlib.sha256(client).hexdigest(),client_bytes=len(client))
    (target/'php-ui.html').write_bytes(client)
    (target/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(f'Vendored {len(client)} exact original client bytes / PHP {manifest["source_version"]}')


if __name__=='__main__':main()
