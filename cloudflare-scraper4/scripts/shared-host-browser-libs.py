#!/usr/bin/env python3
"""Opt-in EL8 user-local Chromium dependency experiment; Python 3.6+.

Downloads from AlmaLinux's official HTTPS repository; does not verify RPM
signatures. Does not execute package scripts, replace glibc, launch browsers,
change the application environment, or install packages system-wide.
"""
import argparse
import os
import platform
import pwd
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = 'https://repo.almalinux.org/almalinux/8/'
WANTED = {
    'at-spi2-atk': 'libatk-bridge-2.0.so.0',
    'at-spi2-core': 'libatspi.so.0',
    'mesa-libgbm': 'libgbm.so.1',
    'alsa-lib': 'libasound.so.2',
    'libwayland-server': 'libwayland-server.so.0',
}


def version_key(name):
    return [int(p) if p.isdigit() else p for p in re.split(r'(\d+)', name)]


def select_package(listing, package):
    pattern = re.escape(package) + r'-[0-9][A-Za-z0-9._+%-]*\.x86_64\.rpm'
    matches = [name for name in re.findall(r'href="([^"]+)"', listing)
               if re.fullmatch(pattern, name)]
    if not matches:
        return None
    # Only fixed package names, x86_64, no paths or source/devel packages.
    return sorted(matches, key=version_key)[-1]


def download(url, limit, retries=3):
    if not url.startswith(BASE):
        raise RuntimeError('Unexpected repository URL')
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            print('Fetching: {} (attempt {}/{})'.format(url, attempt, retries), flush=True)
            with urllib.request.urlopen(url, timeout=120) as response:
                final = urllib.parse.urlparse(response.geturl())
                if final.scheme != 'https' or final.hostname != 'repo.almalinux.org':
                    raise RuntimeError('Unexpected repository redirect')
                data = response.read(limit + 1)
            if len(data) > limit:
                raise RuntimeError('Download exceeded size limit')
            return data
        except Exception as exc:
            last_error = exc
            print('Download failed (attempt {}/{}): {}'.format(attempt, retries, exc), flush=True)
            if attempt < retries:
                time.sleep(attempt * 2)
    raise RuntimeError('Failed to download {} after {} attempts: {}'.format(url, retries, last_error))


def elf_x64(data):
    return (len(data) >= 20 and data[:6] == b'\x7fELF\x02\x01'
            and data[18:20] == b'\x3e\x00')


def atomic_write(destination, data):
    # Never follow an existing output symlink; replace the directory entry.
    fd, name = tempfile.mkstemp(prefix='.download-', dir=str(destination.parent))
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        os.chmod(name, 0o644)
        os.replace(name, str(destination))
    finally:
        if os.path.exists(name):
            os.unlink(name)


def describe_browser(path):
    """Read-only evidence; a loader error alone does not prove file corruption."""
    print('\n=== Browser file: {} ==='.format(path), flush=True)
    info = path.stat()
    with path.open('rb') as stream:
        header = stream.read(64)
    print('Size: {} bytes; mode: {:o}; executable by account: {}'.format(
        info.st_size, info.st_mode & 0o777, os.access(str(path), os.X_OK)))
    if elf_x64(header):
        print('Header: ELF64, little-endian, x86_64 (header only; not integrity proof)')
    elif header.startswith(b'\x7fELF'):
        print('Header: ELF, but not the expected ELF64 little-endian x86_64 format')
    else:
        print('Header: NOT ELF; first 16 bytes (hex): ' + header[:16].hex())
    # Heuristic: Chrome binaries are typically >50 MB; a much smaller file
    # often indicates an interrupted download, not a hosting restriction.
    if info.st_size < 20 * 1024 * 1024:
        print('Warning: file is unusually small (<20 MB); may be incomplete.', flush=True)
    elif path.name == 'chrome' and info.st_size < 50 * 1024 * 1024:
        print('Warning: chrome binary is unusually small (<50 MB); may be incomplete.', flush=True)
    tool = shutil.which('file')
    if tool:
        result = subprocess.run([tool, '-L', str(path)],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                universal_newlines=True, timeout=20)
        print(result.stdout.strip(), flush=True)


def check_dependencies(path, libdir):
    env = dict(os.environ)
    env['LD_LIBRARY_PATH'] = str(libdir)
    print('\n=== Dependencies: {} ==='.format(path), flush=True)
    result = subprocess.run(['ldd', str(path)], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            universal_newlines=True, timeout=45)
    print('ldd exit code: {}'.format(result.returncode), flush=True)
    print(result.stdout, flush=True)
    if 'not a dynamic executable' in result.stdout:
        print('Loader inspection failed; this alone does not identify corruption, '
              'architecture mismatch, or a hosting restriction.', flush=True)
    return (result.returncode == 0 and 'not found' not in result.stdout
            and 'not a dynamic executable' not in result.stdout)


def smoke_test(browser, libdir):
    """Opt-in: start the browser binary only to ask for its version string."""
    env = dict(os.environ)
    env['LD_LIBRARY_PATH'] = str(libdir)
    print('\n=== Launch check: {} --version ==='.format(browser), flush=True)
    attempts = [
        ([str(browser), '--version'], 'default'),
        ([str(browser), '--no-sandbox', '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', '--disable-gpu', '--version'], 'no-sandbox'),
    ]
    last_result = None
    for command, label in attempts:
        print('Attempt ({}): {}'.format(label, ' '.join(command)), flush=True)
        try:
            result = subprocess.run(command, env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    universal_newlines=True, timeout=60)
        except subprocess.TimeoutExpired:
            print('No result after 60 seconds; nothing was left running.', flush=True)
            continue
        print('Exit code: {}'.format(result.returncode), flush=True)
        output = (result.stdout or '').strip()
        if output:
            print(output[:2000], flush=True)
        else:
            print('(no output)', flush=True)
        if result.returncode < 0:
            sig = -result.returncode
            try:
                import signal as _signal
                try:
                    name = _signal.Signals(sig).name
                except Exception:
                    name = {5: 'SIGTRAP', 11: 'SIGSEGV', 6: 'SIGABRT',
                            4: 'SIGILL', 8: 'SIGFPE', 9: 'SIGKILL',
                            15: 'SIGTERM'}.get(sig, 'signal {}'.format(sig))
            except Exception:
                name = 'signal {}'.format(sig)
            print('Terminated by {} (signal {}).'.format(name, sig), flush=True)
            if sig == 5:
                print('SIGTRAP often means Chromium sandbox check failed; '
                      'try --no-sandbox on this host.', flush=True)
            elif sig == 11:
                print('SIGSEGV often means incompatible library or truncated binary.',
                      flush=True)
        if result.returncode == 0:
            if label == 'default':
                print('The loader found every library this browser needs.', flush=True)
            else:
                print('Browser started with {} flags; default sandbox mode '
                      'is blocked on this host.'.format(label), flush=True)
            return True
        last_result = result
        if label == 'default':
            print('Trying with --no-sandbox to distinguish sandbox vs library failure...',
                  flush=True)
    if last_result is not None:
        print('Startup failed. Any line naming "error while loading shared libraries" '
              'gives the next library to solve; other messages point to another cause.',
              flush=True)
    return False


def libs_present_and_valid(libdir):
    """Return True if all wanted SONAMEs exist and look like x86_64 ELF."""
    for soname in WANTED.values():
        path = libdir / soname
        if not path.is_file():
            return False
        try:
            with path.open('rb') as stream:
                header = stream.read(20)
            if not elf_x64(header):
                return False
        except Exception:
            return False
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path,
                        help='Optional Scraper4 project directory for ldd checks')
    parser.add_argument('--smoke-test', action='store_true',
                        help='Opt in to starting each browser binary with --version '
                             'only, to confirm the libraries actually load')
    parser.add_argument('--offline', action='store_true',
                        help='Do not download; only check existing private libraries and browsers')
    parser.add_argument('--force', action='store_true',
                        help='Force re-download even if private libraries already exist')
    args = parser.parse_args()
    if os.geteuid() == 0:
        raise RuntimeError('Run as the hosting account, not root')
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise RuntimeError('This helper is only for Linux x86_64')
    if os.confstr('CS_GNU_LIBC_VERSION') != 'glibc 2.28':
        raise RuntimeError('This experiment targets the reported glibc 2.28 host only')
    if not shutil.which('ldd'):
        raise RuntimeError('ldd is required for dependency checks')

    home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    root = home / 'browser-libs'
    # Do not let an existing symlink redirect writes outside the private folder.
    if root.is_symlink():
        raise RuntimeError('browser-libs must not be a symlink')
    root.mkdir(mode=0o700, exist_ok=True)
    packages, libs = root / 'packages', root / 'lib'
    for directory in (packages, libs):
        if directory.is_symlink():
            raise RuntimeError('Output directories must not be symlinks')
        directory.mkdir(mode=0o700, exist_ok=True)
    sys.path.insert(0, str(root / 'tools'))
    try:
        import rpmfile
        import zstandard  # noqa: F401 -- required for zstd-compressed RPM payloads
    except ImportError:
        raise RuntimeError('Private rpmfile/zstandard tools are missing under browser-libs/tools')

    print('Private directory: {}'.format(root), flush=True)
    print('Official HTTPS downloads; RPM signatures are NOT verified.', flush=True)
    print('No system changes, package scripts or browser launches.', flush=True)

    if args.offline:
        print('Offline mode: skipping downloads, checking existing libraries only.', flush=True)
        if not libs_present_and_valid(libs):
            raise RuntimeError('Offline mode requested but private libraries are missing or invalid in {}'.format(libs))
    elif not args.force and libs_present_and_valid(libs):
        print('Existing private libraries found and appear valid; skipping download (use --force to re-download).', flush=True)
    else:
        found = {}
        for repo in ('BaseOS', 'AppStream'):
            url = BASE + repo + '/x86_64/os/Packages/'
            print('Reading repository: ' + repo + ' -> ' + url, flush=True)
            listing = download(url, 32 * 1024 * 1024).decode('utf-8')
            for package in WANTED:
                name = select_package(listing, package)
                if name:
                    found[package] = (url + name, name)
        missing = set(WANTED) - set(found)
        if missing:
            raise RuntimeError('Packages not found: ' + ', '.join(sorted(missing)))

        staged = {}
        for package, soname in WANTED.items():
            url, name = found[package]
            print('Downloading: ' + name, flush=True)
            archive = packages / name
            atomic_write(archive, download(url, 64 * 1024 * 1024))
            with rpmfile.open(str(archive)) as rpm:
                for member in rpm.getmembers():
                    filename = member.name.rsplit('/', 1)[-1]
                    if filename != soname and not filename.startswith(soname + '.'):
                        continue
                    stream = rpm.extractfile(member)
                    if stream is None:
                        continue
                    data = stream.read(32 * 1024 * 1024 + 1)
                    if len(data) > 32 * 1024 * 1024:
                        raise RuntimeError('Library exceeded size limit')
                    if elf_x64(data):
                        staged[soname] = data
                        break
            if soname not in staged:
                raise RuntimeError('Expected x86_64 ELF library not found: ' + soname)

        # Copy only the five allowlisted ELF libraries, not arbitrary archive paths.
        for soname, data in staged.items():
            atomic_write(libs / soname, data)
            print('Extracted: ' + soname, flush=True)

    healthy = True
    for soname in WANTED.values():
        healthy = check_dependencies(libs / soname, libs) and healthy

    project = args.project
    if project is None and (Path.cwd() / 'data/browsers').is_dir():
        project = Path.cwd()
    if project is None:
        candidates = list((home / 'public_html/project/.wconsole_data/projects').glob(
            'scraper4-cloudflare-*/data/browsers'))
        if len(candidates) == 1:
            project = candidates[0].parent.parent
    browsers = []
    if project is not None:
        cache = project / 'data/browsers'
        if cache.is_dir():
            browsers = sorted(p for p in cache.rglob('*')
                              if p.name in ('chrome', 'chrome-headless-shell')
                              and p.is_file())
    launched = {}
    for browser in browsers:
        describe_browser(browser)
        healthy = check_dependencies(browser, libs) and healthy
        if args.smoke_test:
            launched[browser] = smoke_test(browser, libs)
    if not browsers:
        print('Browser files not found. Re-run with --project /actual/project/path.')
    print('\nApplication settings have NOT changed.')
    if args.smoke_test:
        print('Each browser was started once with --version and exited.')
    else:
        print('No browser was launched. Send this output before configuring the service.')
    if not healthy:
        print('DEPENDENCIES STILL UNRESOLVED: additional libraries/versions may be needed.')
        return 2
    if not browsers:
        return 3
    if args.smoke_test and not all(launched.values()):
        print('AT LEAST ONE BROWSER COULD NOT START; see the launch-check output above.')
        return 4
    if args.smoke_test:
        print('LDD AND LAUNCH CHECKS PASSED; site rendering and hosting limits remain '
              'untested, and the application still needs the private library path.')
        return 0
    print('LDD CHECKS PASSED; browser startup and hosting restrictions remain untested.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('STOP: {}'.format(error), file=sys.stderr)
        sys.exit(1)
