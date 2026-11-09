#!/usr/bin/env python3
"""Inventory literal PHP request references; NOT a claim of endpoint parity.

Run against the exact pinned source; never executes PHP. The inventory includes
form fields and comments and cannot prove a literal is an executable handler.
"""
import argparse
import bisect
import hashlib
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def inventory(raw,manifest):
    digest=hashlib.sha256(raw).hexdigest()
    if digest!=manifest['source_sha256']:raise ValueError('Source hash does not match pinned PHP manifest')
    text=raw.decode('utf-8');lines=[i for i,c in enumerate(text) if c=='\n'];values={}
    pattern=r'''\$_(GET|POST|REQUEST)\s*\[\s*(['"])([^'"\r\n]+)\2\s*\]'''
    for m in re.finditer(pattern,text):
        row=values.setdefault(m[3],{'key':m[3],'methods':set(),'lines':set(),'references':0})
        row['methods'].add(m[1]);row['lines'].add(bisect.bisect_left(lines,m.start())+1);row['references']+=1
    return {'source_commit':manifest['source_commit'],'source_version':manifest['source_version'],'source_sha256':digest,
            'kind':'literal_request_reference_inventory','is_endpoint_count':False,'full_php_parity':False,
            'scope':'GET/POST/REQUEST literal references, including fields/comments; dynamic keys and dispatch values need semantic review',
            'unique_keys':len(values),'references':sum(r['references'] for r in values.values()),
            'entries':[{**r,'methods':sorted(r['methods']),'lines':sorted(r['lines']),'review_status':'requires_semantic_handler_review'} for _,r in sorted(values.items())]}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('--check',action='store_true');args=p.parse_args()
    folder=ROOT/'pythonanywhere/scraper4/upstream';result=inventory(args.source.read_bytes(),json.loads((folder/'manifest.json').read_text()))
    content=json.dumps(result,ensure_ascii=False,indent=2)+'\n';path=folder/'request-inventory.json'
    if args.check:
        if path.read_text()!=content:raise SystemExit('Request inventory is stale')
    else:path.write_text(content)
    print(f"{result['unique_keys']} literal keys / {result['references']} references; NOT an endpoint implementation count")


if __name__=='__main__':main()
