#!/usr/bin/env python3
"""Publish a short-lived PUBLIC signed release approval after an app-code push.

The private key is local, gitignored and never printed. Relay the resulting URL
with the network tool, then verify /healthz matches commit+version. Do not call
this a successful live deployment until that separate verification succeeds.
"""
import base64
import json
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlencode

from cryptography.hazmat.primitives import serialization

ROOT = Path(__file__).resolve().parents[1]
BRANCH = 'arena/f3d5d2a0-new'


def git(*args, capture=True):
    result = subprocess.run(['git', *args], cwd=ROOT, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def main():
    if git('branch', '--show-current') != BRANCH:
        raise SystemExit('Refusing to deploy from a different branch')
    if git('status', '--porcelain'):
        raise SystemExit('Commit and push code changes first; the working tree must be clean')
    if git('rev-parse', 'HEAD') != git('ls-remote', 'origin', 'refs/heads/'+BRANCH).split()[0]:
        raise SystemExit('Push the code commit before publishing a release proof')
    keyfile = ROOT / '.deployment/signing-key.pem'
    if not keyfile.is_file():
        raise SystemExit('Local signing key is missing. Rotate the authority via a manual install; never request credentials in chat.')
    if stat.S_IMODE(keyfile.stat().st_mode) & 0o077:
        raise SystemExit('Private signing key permissions must be 0600')
    git('check-ignore', '--quiet', str(keyfile.relative_to(ROOT)))
    key = serialization.load_pem_private_key(keyfile.read_bytes(), password=None)
    trusted = json.loads((ROOT/'pythonanywhere/scraper4/deploy_authority.json').read_text())
    public = base64.b64encode(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    if public != trusted['public_key']:
        raise SystemExit('Local signing key does not match the installed public authority')
    issued = int(time.time())
    proof = {'protocol':'scraper4-code-deploy-v1', 'host':trusted['host'],
             'tree':git('rev-parse','HEAD:pythonanywhere'), 'nonce':uuid.uuid4().hex,
             'issued':issued, 'expires':issued+900}
    canonical = json.dumps(proof, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()
    proof['signature'] = base64.b64encode(key.sign(canonical)).decode()
    manifest = ROOT/'.github/scraper4-deploy.json'
    manifest.write_text(json.dumps(proof, indent=2)+'\n')
    git('add', str(manifest.relative_to(ROOT)))
    git('commit', '-m', 'Authorize signed deployment of current Python app source tree', capture=False)
    git('push', 'origin', BRANCH, capture=False)
    encoded = base64.urlsafe_b64encode(json.dumps(proof, separators=(',', ':')).encode()).decode().rstrip('=')
    installed_commit = git('rev-parse','HEAD')
    result = {'url':'https://'+trusted['host']+'/api/deploy/run?'+urlencode({'proof':encoded}),
              'commit':installed_commit, 'tree':proof['tree'],
              'expires':proof['expires'], 'verify_url':'https://'+trusted['host']+'/healthz?build='+installed_commit}
    output = ROOT/'.deployment/last-request.json'
    output.write_text(json.dumps(result))
    output.chmod(0o600)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
