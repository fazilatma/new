"""Offline tests for the standalone shared-host helper; no downloads or installs."""
import contextlib
import io
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

script = Path(__file__).with_name('shared-host-browser-libs.py')
spec = importlib.util.spec_from_file_location('shared_host_libs', str(script))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class HelperTests(unittest.TestCase):
    def test_package_selection_is_specific_and_numeric(self):
        names = ['alsa-lib-1.2.9-1.el8.x86_64.rpm',
                 'alsa-lib-1.2.10-1.el8.x86_64.rpm',
                 'alsa-lib-devel-9.9-1.el8.x86_64.rpm',
                 '../alsa-lib-9.9-1.el8.x86_64.rpm',
                 'alsa-lib-9.9-1.el8.i686.rpm']
        listing = ''.join('<a href="{}">x</a>'.format(n) for n in names)
        self.assertEqual(helper.select_package(listing, 'alsa-lib'), names[1])
        self.assertIsNone(helper.select_package(listing, 'glibc'))

    def test_elf_architecture_filter(self):
        sample = bytearray(64)
        sample[:6] = b'\x7fELF\x02\x01'
        sample[18:20] = b'\x3e\x00'
        self.assertTrue(helper.elf_x64(sample))
        sample[18:20] = b'\xb7\x00'
        self.assertFalse(helper.elf_x64(sample))
        self.assertFalse(helper.elf_x64(b'libfoo.so.1'))

    def test_atomic_write_does_not_follow_output_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original = root / 'original'
            original.write_bytes(b'unchanged')
            output = root / 'library'
            output.symlink_to(original)
            helper.atomic_write(output, b'new library')
            self.assertEqual(original.read_bytes(), b'unchanged')
            self.assertEqual(output.read_bytes(), b'new library')
            self.assertFalse(output.is_symlink())

    def test_wayland_dependency_is_allowlisted(self):
        self.assertEqual(helper.WANTED['libwayland-server'], 'libwayland-server.so.0')
        listing = '<a href="libwayland-server-1.21.0-1.el8.x86_64.rpm">x</a>'
        self.assertEqual(helper.select_package(listing, 'libwayland-server'),
                         'libwayland-server-1.21.0-1.el8.x86_64.rpm')

    def test_browser_evidence_does_not_launch_file(self):
        with tempfile.TemporaryDirectory() as folder:
            browser = Path(folder) / 'chrome'
            browser.write_bytes(b'<html>incomplete download</html>')
            out = io.StringIO()
            with patch.object(helper.shutil, 'which', return_value=None):
                with patch.object(helper.subprocess, 'run') as run:
                    with contextlib.redirect_stdout(out):
                        helper.describe_browser(browser)
                    run.assert_not_called()
            self.assertIn('Header: NOT ELF', out.getvalue())
            self.assertIn('Size: 32 bytes', out.getvalue())

    def test_smoke_test_uses_private_env_and_reports_version(self):
        result = type('Result', (), {
            'returncode': 0, 'stdout': 'Chromium 152.0.7977.75\n'})()
        with patch.object(helper.subprocess, 'run', return_value=result) as run:
            self.assertTrue(helper.smoke_test(Path('/browser/chrome'), Path('/private/lib')))
        command, kwargs = run.call_args
        self.assertEqual(command[0], ['/browser/chrome', '--version'])
        self.assertEqual(kwargs['env']['LD_LIBRARY_PATH'], '/private/lib')
        self.assertNotIn('shell', command[0][0])

    def test_smoke_test_failure_and_timeout_are_not_success(self):
        failed = type('Result', (), {
            'returncode': 127,
            'stdout': 'error while loading shared libraries: libx.so.1'})()
        with patch.object(helper.subprocess, 'run', return_value=failed):
            self.assertFalse(helper.smoke_test(Path('/browser/chrome'), Path('/private/lib')))
        with patch.object(helper.subprocess, 'run',
                          side_effect=helper.subprocess.TimeoutExpired('chrome', 60)):
            self.assertFalse(helper.smoke_test(Path('/browser/chrome'), Path('/private/lib')))

    def test_smoke_test_is_opt_in(self):
        source = Path(__file__).with_name('shared-host-browser-libs.py').read_text()
        self.assertIn("'--smoke-test', action='store_true'", source)
        self.assertIn('if args.smoke_test:', source)

    def test_dynamic_loader_failure_is_not_success(self):
        result = type('Result', (), {
            'returncode': 0, 'stdout': 'not a dynamic executable'})()
        with patch.object(helper.subprocess, 'run', return_value=result):
            self.assertFalse(helper.check_dependencies(Path('/browser'), Path('/private/lib')))

    def test_download_rejects_other_sources(self):
        with self.assertRaises(RuntimeError):
            helper.download('http://example.test/file.rpm', 100)

    def test_dependency_failure_and_scoped_environment(self):
        result = type('Result', (), {'returncode': 0, 'stdout': 'libfoo => not found'})()
        with patch.object(helper.subprocess, 'run', return_value=result) as run:
            self.assertFalse(helper.check_dependencies(Path('/browser'), Path('/private/lib')))
            self.assertEqual(run.call_args[1]['env']['LD_LIBRARY_PATH'], '/private/lib')
            self.assertEqual(run.call_args[0][0], ['ldd', '/browser'])


if __name__ == '__main__':
    unittest.main()
