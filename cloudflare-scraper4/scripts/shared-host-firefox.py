#!/usr/bin/env python3
"""Opt-in Firefox download for EL8 shared-host without npm/pip; Python 3.6+.

Downloads official Firefox ESR tarball from ftp.mozilla.org (TLS, no signature
verification claim). Extracts to ~/browser-libs/firefox, checks ldd with private
libs, and smoke-tests --version.

No system changes, no root, process-scoped LD_LIBRARY_PATH.
"""
import argparse
import os
import platform
import pwd
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

# Fixed ESR known to work on glibc 2.28 EL8; update manually if needed.
FIREFOX_URL = 'https://ftp.mozilla.org/pub/firefox/releases/115.15.0esr/linux-x86_64/en-US/firefox-115.15.0esr.tar.bz2'
# Fallback newer ESR
FALLBACK_URL = 'https://ftp.mozilla.org/pub/firefox/releases/128.12.0esr/linux-x86_64/en-US/firefox-128.12.0esr.tar.bz2'

def download(url, dest, limit=300*1024*1024, retries=3):
    print('Fetching: {} ({} MB limit)'.format(url, limit//1024//1024), flush=True)
    last=None
    for attempt in range(1, retries+1):
        try:
            print('Attempt {}/{}'.format(attempt, retries), flush=True)
            with urllib.request.urlopen(url, timeout=120) as r:
                # Allow mozilla.org/ftp.mozilla.org redirects
                data = r.read(limit+1)
            if len(data) > limit:
                raise RuntimeError('Exceeded size limit')
            # atomic write
            fd, tmp = tempfile.mkstemp(dir=str(dest.parent))
            try:
                with os.fdopen(fd, 'wb') as f:
                    f.write(data)
                os.replace(tmp, str(dest))
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)
            print('Saved {} bytes to {}'.format(len(data), dest), flush=True)
            return dest
        except Exception as e:
            last=e
            print('Failed attempt {}/{}: {}'.format(attempt, retries, e), flush=True)
            if attempt < retries:
                time.sleep(attempt*2)
    raise RuntimeError('Download failed after {} attempts: {}'.format(retries, last))

def check_ldd(path, libdir):
    env=dict(os.environ)
    if libdir and libdir.is_dir():
        env['LD_LIBRARY_PATH']=str(libdir)+ (':'+env.get('LD_LIBRARY_PATH','') if env.get('LD_LIBRARY_PATH') else '')
    print('\n=== ldd {} ==='.format(path), flush=True)
    result=subprocess.run(['ldd', str(path)], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, timeout=20)
    print('ldd exit {}'.format(result.returncode), flush=True)
    print(result.stdout[:8000], flush=True)
    return result.returncode==0 and 'not found' not in result.stdout

def smoke_test(path, libdir):
    env=dict(os.environ)
    if libdir and libdir.is_dir():
        env['LD_LIBRARY_PATH']=str(libdir)+ (':'+env.get('LD_LIBRARY_PATH','') if env.get('LD_LIBRARY_PATH') else '')
    # Firefox needs a writable profile dir; use /tmp
    env['TMPDIR']=env.get('TMPDIR','/tmp')
    for args in (['--version'], ['--headless','--version']):
        cmd=[str(path)]+args
        print('\n=== Launch: {} ==='.format(' '.join(cmd)), flush=True)
        try:
            res=subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, timeout=20)
        except subprocess.TimeoutExpired:
            print('Timeout after 20s', flush=True)
            continue
        print('Exit {}'.format(res.returncode), flush=True)
        print((res.stdout or '')[:4000], flush=True)
        if res.returncode==0:
            return True
        if res.returncode<0:
            print('Signal {}'.format(-res.returncode), flush=True)
    return False

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='Do not download, only check existing')
    parser.add_argument('--url', default=FIREFOX_URL, help='Firefox tarball URL')
    args=parser.parse_args()
    if os.geteuid()==0:
        raise RuntimeError('Run as hosting account, not root')
    if platform.system()!='Linux' or platform.machine()!='x86_64':
        raise RuntimeError('Linux x86_64 only')
    home=Path(pwd.getpwuid(os.getuid()).pw_dir)
    root=home/'browser-libs'
    root.mkdir(mode=0o700, exist_ok=True)
    pkgs=root/'packages'
    pkgs.mkdir(mode=0o700, exist_ok=True)
    libdir=root/'lib'
    dest_tar=pkgs/'firefox.tar.bz2'
    firefox_root=root/'firefox'
    firefox_bin=firefox_root/'firefox'

    if args.offline:
        if not firefox_bin.is_file():
            raise RuntimeError('Offline but {} not found'.format(firefox_bin))
    else:
        # Download if not exists or --url forced
        if not dest_tar.is_file() or dest_tar.stat().st_size < 10*1024*1024:
            try:
                download(args.url, dest_tar)
            except Exception as e:
                print('Primary URL failed: {}'.format(e), flush=True)
                print('Trying fallback {}'.format(FALLBACK_URL), flush=True)
                download(FALLBACK_URL, dest_tar)
        print('Extracting {}'.format(dest_tar), flush=True)
        # Remove old dir if exists
        if firefox_root.is_dir():
            shutil.rmtree(str(firefox_root))
        with tarfile.open(str(dest_tar), 'r:bz2') as tf:
            # Security: only extract firefox/ prefix, no absolute paths
            members=[m for m in tf.getmembers() if m.name.startswith('firefox/') and not os.path.isabs(m.name) and '..' not in m.name]
            tf.extractall(path=str(root), members=members)
        print('Extracted to {}'.format(firefox_root), flush=True)
        if not firefox_bin.is_file():
            raise RuntimeError('Firefox binary not found after extract')

    print('Firefox dir: {}'.format(firefox_root), flush=True)
    print('Binary: {} size {} mode {:o}'.format(firefox_bin, firefox_bin.stat().st_size, firefox_bin.stat().st_mode & 0o777), flush=True)

    healthy=True
    if libdir.is_dir():
        healthy=check_ldd(firefox_bin, libdir) and healthy
    else:
        healthy=check_ldd(firefox_bin, None) and healthy

    # Also check libxul
    libxul=firefox_root/'libxul.so'
    if libxul.is_file():
        check_ldd(libxul, libdir if libdir.is_dir() else None)

    ok=smoke_test(firefox_bin, libdir if libdir.is_dir() else None)
    print('\n=== Result ===', flush=True)
    if ok:
        print('Firefox started (version check passed). LVE may allow Firefox even if Chromium blocked.', flush=True)
        print('You can set BROWSER_TYPE=firefox or use Playwright firefox channel.', flush=True)
        return 0
    else:
        print('Firefox could NOT start (SIGTRAP/SIGKILL or missing libs). LVE blocks even Firefox.', flush=True)
        print('Use VPS for browser jobs; shared-host can still do non-JS extraction.', flush=True)
        return 4

if __name__=='__main__':
    try:
        sys.exit(main())
    except Exception as e:
        print('STOP: {}'.format(e), file=sys.stderr)
        sys.exit(1)
