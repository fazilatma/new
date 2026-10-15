#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

HELPERS_DIR = Path(__file__).resolve().parents[1]
HELPER_PATH = HELPERS_DIR / "copilot-models.py"
TOOLBOX_DIR = HELPERS_DIR / "copilot-models-toolbox"
SPEC = importlib.util.spec_from_file_location("copilot_models", HELPER_PATH)
assert SPEC and SPEC.loader
copilot_models = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(copilot_models)


class NormalizeTests(unittest.TestCase):
    def test_provider_export_is_normalized_and_non_chat_models_are_filtered(self) -> None:
        source = {
            "providers": [
                {
                    "id": "Cloudflare Workers AI",
                    "name": "Cloudflare Workers AI",
                    "type": "customendpoint",
                    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/account/ai/run/@cf/meta/llama",
                    "apiKey": "must-not-be-imported",
                    "models": [
                        {
                            "id": "@cf/meta/llama",
                            "name": "Llama",
                            "contextLength": 64000,
                            "supportsTools": True,
                        },
                        {"id": "@cf/baai/bge-base", "endpointType": "nonChat"},
                        {"id": "whisper-large-v3"},
                    ],
                }
            ]
        }
        providers = copilot_models.normalize_catalog(source)
        self.assertEqual(len(providers), 1)
        provider = providers[0]
        self.assertEqual(provider["slug"], "cloudflare")
        self.assertEqual(
            provider["baseUrl"],
            "https://api.cloudflare.com/client/v4/accounts/account/ai/v1",
        )
        self.assertNotIn("sourceApiKey", provider)
        self.assertEqual([model["id"] for model in provider["models"]], ["@cf/meta/llama"])
        self.assertEqual(provider["models"][0]["maxInputTokens"], 64000)

    def test_source_key_requires_explicit_opt_in(self) -> None:
        source = {
            "providers": [
                {
                    "id": "example",
                    "url": "https://example.test/v1",
                    "apiKey": "secret",
                    "models": ["chat-model"],
                }
            ]
        }
        without_key = copilot_models.normalize_catalog(source)
        with_key = copilot_models.normalize_catalog(source, import_source_keys=True)
        self.assertNotIn("sourceApiKey", without_key[0])
        self.assertEqual(with_key[0]["sourceApiKey"], "secret")
        self.assertEqual(with_key[0]["sourceKeyStatus"], "imported")

    def test_nested_plural_and_active_source_keys_are_imported(self) -> None:
        key, status = copilot_models.extract_source_api_key(
            {
                "credentials": {
                    "apiKeys": [
                        {"value": "old-key", "active": False},
                        {"value": "Bearer active-key", "active": True},
                    ]
                },
                "models": [{"token": "must-not-be-used"}],
            }
        )
        self.assertEqual(key, "active-key")
        self.assertEqual(status, "imported")

    def test_masked_or_environment_source_keys_are_rejected(self) -> None:
        for value in ("${OPENROUTER_API_KEY}", "********", "<your-api-key>"):
            key, status = copilot_models.extract_source_api_key({"api_key": value})
            self.assertIsNone(key)
            self.assertEqual(status, "placeholder-or-masked")

    def test_top_level_provider_key_map_is_joined_to_provider(self) -> None:
        source = {
            "providers": [
                {
                    "id": "openrouter",
                    "url": "https://openrouter.ai/api/v1",
                    "models": ["openai/gpt-test"],
                }
            ],
            "apiKeys": {"open-router": {"value": "mapped-key", "active": True}},
        }
        providers = copilot_models.normalize_catalog(source, import_source_keys=True)
        self.assertEqual(providers[0]["sourceApiKey"], "mapped-key")
        self.assertEqual(providers[0]["sourceKeyStatus"], "imported")

    def test_explicit_source_key_wins_over_stale_environment_key(self) -> None:
        provider = {
            "apiKeyEnv": ["EXAMPLE_API_KEY"],
            "sourceApiKey": "fresh-source-key",
        }
        with mock.patch.dict(
            os.environ, {"EXAMPLE_API_KEY": "stale-environment-key"}, clear=True
        ):
            self.assertEqual(
                copilot_models.provider_api_key(provider), "fresh-source-key"
            )

    def test_actual_model_id_wins_over_internal_database_id(self) -> None:
        model = copilot_models.normalize_model(
            {
                "id": "internal-row-uuid",
                "modelId": "vendor/real-model",
                "name": "Real model",
            },
            "https://example.test/v1",
        )
        assert model
        self.assertEqual(model["id"], "vendor/real-model")
        self.assertFalse(model["toolCalling"])
        self.assertFalse(model["streaming"])

    def test_known_provider_import_is_rebased_to_compatible_endpoint(self) -> None:
        defaults = [
            {
                "slug": "cohere",
                "name": "Cohere",
                "baseUrl": "https://api.cohere.ai/compatibility/v1",
                "models": [],
            }
        ]
        imported = [
            {
                "slug": "cohere",
                "name": "Cohere",
                "baseUrl": "https://api.cohere.com/v2/chat",
                "models": [{"id": "command-a", "url": "https://api.cohere.com/v2/chat"}],
            }
        ]
        merged = copilot_models.overlay_providers(defaults, imported)
        self.assertEqual(merged[0]["name"], defaults[0]["name"])
        self.assertEqual(merged[0]["baseUrl"], defaults[0]["baseUrl"])
        self.assertEqual(merged[0]["models"][0]["url"], defaults[0]["baseUrl"])

    def test_cloudflare_account_and_ollama_root_are_preserved(self) -> None:
        cloudflare = copilot_models.canonical_provider_url(
            "cloudflare",
            "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
            "https://api.cloudflare.com/client/v4/accounts/account-123/ai/run/@cf/meta/llama",
        )
        self.assertEqual(
            cloudflare,
            "https://api.cloudflare.com/client/v4/accounts/account-123/ai/v1",
        )
        self.assertEqual(
            copilot_models.normalize_ollama_url(
                "http://127.0.0.1:11434/v1/chat/completions"
            ),
            "http://127.0.0.1:11434",
        )

    def test_env_file_parses_values_without_executing_shell(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / "keys.env"
            env_file.write_text(
                "# credentials\nexport EXAMPLE_API_KEY='key with spaces'\nEMPTY=\n",
                encoding="utf-8",
            )
            env_file.chmod(0o600)
            with mock.patch.dict(os.environ, {}, clear=True):
                copilot_models.load_env_file(str(env_file))
                self.assertEqual(os.environ["EXAMPLE_API_KEY"], "key with spaces")
                self.assertEqual(os.environ["EMPTY"], "")

    def test_secret_prompt_reads_controlling_tty_without_using_stdin(self) -> None:
        characters = [bytes([value]) for value in b"secret-key\n"]
        attributes = [0, 0, 0, copilot_models.termios.ECHO, 0, 0, []]
        with (
            mock.patch.object(copilot_models.os, "open", return_value=42),
            mock.patch.object(copilot_models.os, "read", side_effect=characters),
            mock.patch.object(copilot_models.os, "write") as write,
            mock.patch.object(copilot_models.os, "close") as close,
            mock.patch.object(copilot_models.termios, "tcgetattr", return_value=attributes),
            mock.patch.object(copilot_models.termios, "tcsetattr") as set_attributes,
        ):
            value = copilot_models.read_from_tty("Key: ", secret=True)
        self.assertEqual(value, "secret-key")
        self.assertGreaterEqual(set_attributes.call_count, 2)
        write.assert_any_call(42, b"Key: ")
        close.assert_called_once_with(42)


class PinnedModelStorageTests(unittest.TestCase):
    def test_successful_models_are_pinned_unhidden_and_backed_up(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            storage = root / "globalStorage" / "state.vscdb"
            storage.parent.mkdir(parents=True)
            with sqlite3.connect(storage) as connection:
                connection.execute(
                    "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)"
                )
                connection.execute(
                    "INSERT INTO ItemTable(key, value) VALUES(?, ?)",
                    ("chatModelPinned", json.dumps(["copilot/existing"])),
                )
                connection.execute(
                    "INSERT INTO ItemTable(key, value) VALUES(?, ?)",
                    (
                        "chatModelVisibility",
                        json.dumps(
                            {
                                "hiddenModels": [
                                    "customoai/Mistral/model-a",
                                    "customoai/Other/model-b",
                                ]
                            }
                        ),
                    ),
                )
            backups = root / "backups"
            result = copilot_models.pin_chat_models(
                storage,
                ["customoai/Mistral/model-a", "customoai/Mistral/model-a"],
                backups,
            )
            self.assertEqual(result["requested"], 1)
            self.assertEqual(result["added"], 1)
            self.assertEqual(result["total"], 2)
            self.assertEqual(result["unhidden"], 1)
            self.assertTrue(result["restartRequired"])
            backup = Path(result["backup"])
            self.assertTrue(backup.is_file())
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
            with sqlite3.connect(storage) as connection:
                pinned = json.loads(
                    connection.execute(
                        "SELECT value FROM ItemTable WHERE key = 'chatModelPinned'"
                    ).fetchone()[0]
                )
                visibility = json.loads(
                    connection.execute(
                        "SELECT value FROM ItemTable WHERE key = 'chatModelVisibility'"
                    ).fetchone()[0]
                )
            self.assertEqual(
                pinned, ["copilot/existing", "customoai/Mistral/model-a"]
            )
            self.assertEqual(
                visibility["hiddenModels"], ["customoai/Other/model-b"]
            )
            repeated = copilot_models.pin_chat_models(
                storage, ["customoai/Mistral/model-a"], backups
            )
            self.assertFalse(repeated["changed"])
            self.assertEqual(repeated["backup"], "")

    def test_selected_model_is_pinned_unhidden_persisted_and_backed_up(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            storage = root / "globalStorage" / "state.vscdb"
            storage.parent.mkdir(parents=True)
            identifier = "customoai/Mistral/model-a"
            with sqlite3.connect(storage) as connection:
                connection.execute(
                    "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)"
                )
                connection.execute(
                    "INSERT INTO ItemTable(key, value) VALUES(?, ?)",
                    ("chat.currentLanguageModel.panel", "copilot/old"),
                )
                connection.execute(
                    "INSERT INTO ItemTable(key, value) VALUES(?, ?)",
                    ("chat.currentLanguageModel.panel.local", "copilot/old-local"),
                )
                connection.execute(
                    "INSERT INTO ItemTable(key, value) VALUES(?, ?)",
                    ("chat.currentLanguageModel.panel.isDefault", "true"),
                )
                connection.execute(
                    "INSERT INTO ItemTable(key, value) VALUES(?, ?)",
                    ("chatModelPinned", json.dumps(["copilot/existing"])),
                )
                connection.execute(
                    "INSERT INTO ItemTable(key, value) VALUES(?, ?)",
                    (
                        "chatModelVisibility",
                        json.dumps({"hiddenModels": [identifier, "copilot/hidden"]}),
                    ),
                )
            result = copilot_models.select_chat_model(
                storage, identifier, root / "backups"
            )
            self.assertTrue(result["changed"])
            self.assertTrue(result["restartRequired"])
            self.assertEqual(result["selectionKeys"], 2)
            self.assertEqual(result["added"], 1)
            self.assertEqual(result["unhidden"], 1)
            self.assertTrue(Path(result["backup"]).is_file())
            with sqlite3.connect(storage) as connection:
                selected = dict(
                    connection.execute(
                        "SELECT key, value FROM ItemTable WHERE key LIKE 'chat.currentLanguageModel.panel%'"
                    ).fetchall()
                )
                pinned = json.loads(
                    connection.execute(
                        "SELECT value FROM ItemTable WHERE key = 'chatModelPinned'"
                    ).fetchone()[0]
                )
                visibility = json.loads(
                    connection.execute(
                        "SELECT value FROM ItemTable WHERE key = 'chatModelVisibility'"
                    ).fetchone()[0]
                )
            self.assertEqual(
                selected,
                {
                    "chat.currentLanguageModel.panel": identifier,
                    "chat.currentLanguageModel.panel.local": identifier,
                },
            )
            self.assertEqual(pinned, ["copilot/existing", identifier])
            self.assertEqual(visibility["hiddenModels"], ["copilot/hidden"])
            repeated = copilot_models.select_chat_model(
                storage, identifier, root / "backups"
            )
            self.assertFalse(repeated["changed"])

    def test_pin_models_cli_runs_without_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            profile = Path(temporary) / "User"
            settings = profile / "settings.json"
            storage = profile / "globalStorage" / "state.vscdb"
            storage.parent.mkdir(parents=True)
            settings.write_text("{}\n", encoding="utf-8")
            with sqlite3.connect(storage) as connection:
                connection.execute(
                    "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)"
                )
            pin_file = Path(temporary) / "pins.json"
            pin_file.write_text(
                json.dumps(["customoai/Mistral/model-a"]), encoding="utf-8"
            )
            completed = subprocess.run(
                [
                    sys.executable,
                    str(HELPER_PATH),
                    "--pin-models-file",
                    str(pin_file),
                    "--settings-file",
                    str(settings),
                    "--pin-backup-dir",
                    str(Path(temporary) / "backups"),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn('PIN_RESULT {"requested":1,"added":1', completed.stdout)

    def test_select_model_cli_runs_without_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            profile = Path(temporary) / "User"
            settings = profile / "settings.json"
            storage = profile / "globalStorage" / "state.vscdb"
            storage.parent.mkdir(parents=True)
            settings.write_text("{}\n", encoding="utf-8")
            with sqlite3.connect(storage) as connection:
                connection.execute(
                    "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)"
                )
            completed = subprocess.run(
                [
                    sys.executable,
                    str(HELPER_PATH),
                    "--select-model",
                    "customoai/Mistral/model-a",
                    "--settings-file",
                    str(settings),
                    "--pin-backup-dir",
                    str(Path(temporary) / "backups"),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn(
                'SELECT_RESULT {"identifier":"customoai/Mistral/model-a"',
                completed.stdout,
            )
            with sqlite3.connect(storage) as connection:
                selected = connection.execute(
                    "SELECT value FROM ItemTable WHERE key = 'chat.currentLanguageModel.panel'"
                ).fetchone()[0]
            self.assertEqual(selected, "customoai/Mistral/model-a")


class TerminalSettingsTests(unittest.TestCase):
    def test_jsonc_settings_are_loaded_without_corrupting_comment_like_strings(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            settings_path = Path(temporary) / "settings.json"
            settings_path.write_text(
                '''{
                    // Existing code-server settings may use JSONC.
                    "example.url": "https://example.test/a//b",
                    "nested": {"enabled": true,}, /* trailing comma */
                }''',
                encoding="utf-8",
            )
            settings = copilot_models.load_settings(settings_path)
        self.assertEqual(settings["example.url"], "https://example.test/a//b")
        self.assertEqual(settings["nested"], {"enabled": True})

    def test_terminal_settings_preserve_profiles_and_do_not_approve_all_commands(self) -> None:
        termux_prefix = "/data/data/com.termux/files/usr"
        termux_bash = termux_prefix + "/bin/bash"
        existing = {
            "terminal.integrated.profiles.linux": {
                "Fish": {"path": "/usr/bin/fish"},
                "Termux Bash": {"path": termux_bash, "args": ["-l"]},
            },
            "chat.tools.terminal.autoApprove": {"rm": False},
            "editor.fontSize": 15,
        }
        with (
            mock.patch.dict(
                os.environ,
                {
                    "PREFIX": termux_prefix,
                    "HOME": "/data/data/com.termux/files/home",
                },
            ),
            mock.patch.object(Path, "is_file", return_value=True),
            mock.patch("os.access", return_value=True),
        ):
            merged = copilot_models.terminal_enabled_settings(existing, termux_bash)
        profiles = merged["terminal.integrated.profiles.linux"]
        safe_name = "Termux Android Shell"
        termux_sh = "/system/bin/sh"
        self.assertEqual(profiles["Fish"], {"path": "/usr/bin/fish"})
        self.assertNotIn("Termux Bash", profiles)
        self.assertEqual(profiles[safe_name]["path"], termux_sh)
        self.assertNotIn("args", profiles[safe_name])
        self.assertEqual(profiles[safe_name]["env"]["PREFIX"], termux_prefix)
        self.assertEqual(profiles[safe_name]["env"]["TMPDIR"], termux_prefix + "/tmp")
        self.assertEqual(profiles[safe_name]["env"]["SHELL"], termux_sh)
        self.assertEqual(profiles[safe_name]["env"]["ENV"], "")
        self.assertEqual(profiles[safe_name]["env"]["BASH_ENV"], "")
        self.assertTrue(
            profiles[safe_name]["env"]["PATH"].startswith(termux_prefix + "/bin:")
        )
        self.assertEqual(
            merged["terminal.integrated.defaultProfile.linux"], safe_name
        )
        self.assertTrue(merged["terminal.integrated.inheritEnv"])
        self.assertFalse(merged["terminal.integrated.shellIntegration.enabled"])
        self.assertEqual(
            merged["terminal.integrated.cwd"], "/data/data/com.termux/files/home"
        )
        self.assertFalse(merged["terminal.integrated.enablePersistentSessions"])
        self.assertEqual(merged["terminal.integrated.detectLocale"], "off")
        self.assertFalse(merged["chat.tools.terminal.sandbox.enabled"])
        self.assertEqual(merged["js/ts.tsserver.maxMemory"], 256)
        self.assertEqual(merged["typescript.tsserver.maxTsServerMemory"], 256)
        self.assertEqual(merged["js/ts.tsserver.useSyntaxServer"], "never")
        self.assertEqual(merged["typescript.tsserver.useSyntaxServer"], "never")
        self.assertFalse(merged["typescript.tsserver.useSeparateSyntaxServer"])
        self.assertFalse(merged["js/ts.tsserver.automaticTypeAcquisition.enabled"])
        self.assertTrue(merged["typescript.disableAutomaticTypeAcquisition"])
        self.assertFalse(merged["js/ts.validate.enabled"])
        self.assertFalse(merged["typescript.validate.enable"])
        self.assertFalse(merged["javascript.validate.enable"])
        self.assertEqual(merged["js/ts.tsserver.watchOptions"], "vscode")
        self.assertEqual(
            merged["js/ts.preferences.includePackageJsonAutoImports"], "off"
        )
        self.assertTrue(merged["files.watcherExclude"]["**/node_modules/**"])
        self.assertEqual(
            merged["terminal.integrated.env.linux"]["PREFIX"], termux_prefix
        )
        self.assertEqual(
            merged["chat.tools.terminal.terminalProfile.linux"]["path"],
            termux_sh,
        )
        self.assertEqual(
            merged["chat.tools.terminal.terminalProfile.linux"]["env"]["PREFIX"],
            termux_prefix,
        )
        self.assertNotIn(
            "args", merged["chat.tools.terminal.terminalProfile.linux"]
        )
        self.assertTrue(merged["chat.tools.terminal.enableAutoApprove"])
        self.assertEqual(merged["chat.tools.terminal.autoApprove"], {"rm": False})
        self.assertNotIn(".*", merged["chat.tools.terminal.autoApprove"])
        self.assertEqual(
            existing["terminal.integrated.profiles.linux"],
            {
                "Fish": {"path": "/usr/bin/fish"},
                "Termux Bash": {"path": termux_bash, "args": ["-l"]},
            },
        )

    def test_self_repair_command_creates_backup_before_branch_update(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            prefix = Path(temporary) / "com.termux" / "files" / "usr"
            prefix.mkdir(parents=True)
            with mock.patch.dict(os.environ, {"PREFIX": str(prefix)}, clear=True):
                command = copilot_models.install_self_repair_command()
            assert command
            text = command.read_text(encoding="utf-8")
            self.assertIn("BACKUP_ROOT=", text)
            self.assertIn("install-copilot-models-termux.sh", text)
            self.assertIn('cp -a "$extension_dir"', text)
            self.assertIn("--preserve-existing-keys", text)
            self.assertEqual(command.stat().st_mode & 0o777, 0o700)

    def test_termux_safe_profile_uses_argument_free_sh_and_bypasses_bashrc(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            prefix = root / "com.termux" / "files" / "usr"
            shell = prefix / "bin" / "bash"
            safe_shell = prefix / "bin" / "sh"
            shell.parent.mkdir(parents=True)
            shell.symlink_to("/bin/bash")
            safe_shell.symlink_to("/bin/sh")
            home = root / "home"
            home.mkdir()
            (home / ".bashrc").write_text("exit 77\n", encoding="utf-8")
            environment = {
                **os.environ,
                "PREFIX": str(prefix),
                "HOME": str(home),
                "PATH": str(prefix / "bin") + os.pathsep + os.environ.get("PATH", ""),
                "COPILOT_TERMINAL_SAFE_SHELL": str(safe_shell),
            }
            with mock.patch.dict(os.environ, environment, clear=True):
                settings = copilot_models.terminal_enabled_settings({}, str(shell))
            profile = settings["terminal.integrated.profiles.linux"][
                "Termux Safe Shell"
            ]
            self.assertNotIn("args", profile)
            unsafe = subprocess.run(
                [str(shell), "-i", "-c", "printf ready"],
                env=environment,
                capture_output=True,
                text=True,
            )
            safe_environment = {**environment}
            for name, value in profile["env"].items():
                if value is None:
                    safe_environment.pop(name, None)
                else:
                    safe_environment[name] = value
            safe = subprocess.run(
                [profile["path"], "-i", "-c", "printf ready"],
                env=safe_environment,
                capture_output=True,
                text=True,
            )
            self.assertEqual(unsafe.returncode, 77)
            self.assertEqual(safe.returncode, 0, safe.stderr)
            self.assertEqual(safe.stdout, "ready")


class MergeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = {
            "slug": "example",
            "name": "Example",
            "baseUrl": "https://example.test/v1",
            "apiKeyEnv": ["EXAMPLE_API_KEY"],
            "models": [
                {
                    "id": "model-a",
                    "name": "Model A",
                    "url": "https://example.test/v1",
                    "toolCalling": True,
                    "vision": False,
                    "maxInputTokens": 32000,
                    "maxOutputTokens": 4000,
                }
            ],
        }

    def test_merge_preserves_unrelated_groups_and_existing_key(self) -> None:
        existing = [
            {"vendor": "other", "name": "Keep Me", "value": 1},
            {
                "vendor": "customoai",
                "name": "Example",
                "apiKey": "existing-key",
                "models": [{"id": "old"}],
            },
        ]
        with mock.patch.dict(os.environ, {}, clear=True):
            merged, summary = copilot_models.merge_groups(existing, [self.provider], False)
            merged_again, _ = copilot_models.merge_groups(merged, [self.provider], False)
        self.assertEqual(merged[0], existing[0])
        self.assertEqual(merged[1]["apiKey"], "existing-key")
        self.assertEqual(merged[1]["models"][0]["id"], "model-a")
        self.assertEqual(summary, [("Example", 1, True)])
        self.assertEqual(merged_again, merged)

    def test_alias_duplicate_uses_credentialed_group_and_removes_keyless_collision(self) -> None:
        provider = copy.deepcopy(self.provider)
        provider.update({"slug": "mistral", "name": "Mistral"})
        provider["models"][0].update(
            {"id": "mistral-small", "url": "https://api.mistral.ai/v1"}
        )
        provider["baseUrl"] = "https://api.mistral.ai/v1"
        existing = [
            {
                "vendor": "customoai",
                "name": "Mistral AI",
                "apiKey": "${input:chat.lm.secret.working}",
                "models": [
                    {"id": "mistral-small", "url": "https://api.mistral.ai/v1"}
                ],
            },
            {
                "vendor": "customoai",
                "name": "Mistral",
                "models": [
                    {"id": "mistral-small", "url": "https://api.mistral.ai/v1"}
                ],
            },
        ]
        with mock.patch.dict(os.environ, {}, clear=True):
            merged, summary = copilot_models.merge_groups(
                existing, [provider], False, preserve_existing_keys=True
            )
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["name"], "Mistral")
        self.assertEqual(merged[0]["apiKey"], "${input:chat.lm.secret.working}")
        self.assertEqual(summary, [("Mistral", 1, True)])

    def test_environment_key_replaces_existing_key(self) -> None:
        existing = [
            {"vendor": "customoai", "name": "Example", "apiKey": "old", "models": []}
        ]
        with mock.patch.dict(os.environ, {"EXAMPLE_API_KEY": "new"}, clear=True):
            merged, _ = copilot_models.merge_groups(existing, [self.provider], False)
        self.assertEqual(merged[0]["apiKey"], "new")

    def test_code_update_can_preserve_existing_key_over_environment(self) -> None:
        existing = [
            {"vendor": "customoai", "name": "Example", "apiKey": "working", "models": []}
        ]
        with mock.patch.dict(os.environ, {"EXAMPLE_API_KEY": "stale"}, clear=True):
            merged, _ = copilot_models.merge_groups(
                existing,
                [self.provider],
                False,
                preserve_existing_keys=True,
            )
        self.assertEqual(merged[0]["apiKey"], "working")


class ChatBidiStyleTests(unittest.TestCase):
    def test_python_and_activation_fallback_use_the_same_style(self) -> None:
        extension_source = (TOOLBOX_DIR / "extension.js").read_text(encoding="utf-8")
        match = re.search(
            r"const CHAT_BIDI_STYLE = `(.+?)`;\nconst RESTART_COMMAND",
            extension_source,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(match)
        node_style = (
            match.group(1)
            .replace("${CHAT_BIDI_STYLE_BEGIN}", copilot_models.CHAT_BIDI_STYLE_BEGIN)
            .replace("${CHAT_BIDI_STYLE_END}", copilot_models.CHAT_BIDI_STYLE_END)
        )
        self.assertEqual(node_style, copilot_models.CHAT_BIDI_STYLE)

    def test_workbench_style_patch_is_idempotent_backed_up_and_restorable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            vscode_root = Path(temporary) / "vscode"
            workbench = vscode_root / "out" / "vs" / "code" / "browser" / "workbench"
            workbench.mkdir(parents=True)
            stylesheet = workbench / "workbench.css"
            original = ".interactive-session{display:flex}\n"
            stylesheet.write_text(original, encoding="utf-8")
            stylesheet.chmod(0o644)
            with mock.patch.dict(
                os.environ,
                {"CODE_SERVER_VSCODE_ROOT": str(vscode_root), "PATH": ""},
                clear=True,
            ):
                self.assertIn(
                    stylesheet.resolve(),
                    copilot_models.code_server_workbench_stylesheets(),
                )
                result = copilot_models.patch_chat_bidi_stylesheet(stylesheet)
                repeated = copilot_models.patch_chat_bidi_stylesheet(stylesheet)
            self.assertEqual(result, "rtl-enabled")
            self.assertEqual(repeated, "already-rtl")
            patched = stylesheet.read_text(encoding="utf-8")
            self.assertIn("unicode-bidi: plaintext", patched)
            self.assertIn(".interactive-response", patched)
            self.assertIn(".interactive-input-editor", patched)
            self.assertIn("unicode-bidi: isolate", patched)
            backup = Path(str(stylesheet) + copilot_models.BACKUP_SUFFIX)
            self.assertEqual(backup.read_text(encoding="utf-8"), original)

            upgraded = ".interactive-session{display:grid}\n"
            stylesheet.write_text(upgraded, encoding="utf-8")
            self.assertEqual(
                copilot_models.patch_chat_bidi_stylesheet(stylesheet),
                "rtl-enabled",
            )
            self.assertEqual(backup.read_text(encoding="utf-8"), upgraded)
            archived = list(backup.parent.glob(backup.name + ".*"))
            self.assertEqual(len(archived), 1)
            self.assertEqual(archived[0].read_text(encoding="utf-8"), original)
            self.assertTrue(copilot_models.restore_file(stylesheet))
            self.assertEqual(stylesheet.read_text(encoding="utf-8"), upgraded)


class ManifestTests(unittest.TestCase):
    def test_manifest_patch_is_narrow_and_restorable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package_path = Path(temporary) / "package.json"
            package = {
                "publisher": "GitHub",
                "name": "copilot-chat",
                "contributes": {
                    "languageModelChatProviders": [
                        {"vendor": "copilot", "displayName": "Copilot"},
                        {
                            "vendor": "customoai",
                            "when": "productQualityType != 'stable'",
                            "displayName": "OpenAI Compatible",
                            "configuration": {"type": "object"},
                        },
                    ]
                },
            }
            package_path.write_text(json.dumps(package), encoding="utf-8")
            result = copilot_models.patch_manifest(package_path)
            changed = json.loads(package_path.read_text(encoding="utf-8"))
            custom = changed["contributes"]["languageModelChatProviders"][1]
            self.assertEqual(result, "patched")
            self.assertNotIn("when", custom)
            self.assertEqual(custom["configuration"], {"type": "object"})
            self.assertTrue(Path(str(package_path) + copilot_models.BACKUP_SUFFIX).is_file())
            self.assertTrue(copilot_models.restore_file(package_path))
            self.assertEqual(json.loads(package_path.read_text(encoding="utf-8")), package)

    def test_unexpected_condition_is_not_removed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package_path = Path(temporary) / "package.json"
            package_path.write_text(
                json.dumps(
                    {
                        "contributes": {
                            "languageModelChatProviders": [
                                {"vendor": "customoai", "when": "isWorkspaceTrusted"}
                            ]
                        }
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "refusing"):
                copilot_models.patch_manifest(package_path)
            self.assertFalse(
                Path(str(package_path) + copilot_models.BACKUP_SUFFIX).exists()
            )


class ToolboxPackagingTests(unittest.TestCase):
    def test_helper_extension_and_launcher_versions_match(self) -> None:
        package = json.loads((TOOLBOX_DIR / "package.json").read_text(encoding="utf-8"))
        launcher = (HELPERS_DIR / "install-copilot-models-termux.sh").read_text(
            encoding="utf-8"
        )
        self.assertEqual(package["version"], copilot_models.HELPER_VERSION)
        self.assertIn(
            f'HELPER_VERSION="{copilot_models.HELPER_VERSION}"', launcher
        )

    def test_coding_prompt_and_answer_power_are_wired_without_diagnostic_leaks(self) -> None:
        extension = (TOOLBOX_DIR / "extension.js").read_text(encoding="utf-8")
        package = json.loads((TOOLBOX_DIR / "package.json").read_text(encoding="utf-8"))
        self.assertIn('id="testPrompt"', extension)
        self.assertIn("DEFAULT_CODING_TEST_PROMPT", extension)
        self.assertIn("SIMPLE_TEST_PROMPT", extension)
        self.assertIn("DEFAULT_IMPORT_JSON_FILENAME", extension)
        self.assertIn("ai-providers-2026-08-23-160523-gemini-llm7-opencode-ollama-cloud-added.json", extension)
        self.assertIn('id="suggestedJsonPath"', extension)
        self.assertIn("prompt: currentPrompt()", extension)
        self.assertIn("profile: currentProfile()", extension)
        self.assertIn("core.scoreSimpleResponse(assistantResponse)", extension)
        self.assertIn("Math.min(64, options.maxOutputTokens)", extension)
        self.assertEqual(extension.count('class="sortable" data-sort='), 14)
        self.assertIn("function sortRows()", extension)
        self.assertIn("messages: [{ role: 'user', content: prompt }]", extension)
        self.assertIn("max_tokens: maxOutputTokens", extension)
        self.assertIn("core.scoreCodingResponse(assistantResponse)", extension)
        self.assertIn("responsePower: tested.responsePower", extension)
        self.assertIn("response: tested.response || ''", extension)
        self.assertIn("result: results.get(model.testKey)", extension)
        self.assertEqual(
            package["contributes"]["configuration"]["properties"][
                "copilotModels.codingTestMaxOutputTokens"
            ]["default"],
            768,
        )
        sanitized = extension[
            extension.index("async function saveSanitizedDiagnostics") : extension.index(
                "async function exportTestReport"
            )
        ]
        self.assertNotIn("testPrompt", sanitized)
        self.assertNotIn("response: result.response", sanitized)
        self.assertIn("sanitizedModelTestError", sanitized)

    def test_generated_vsix_contains_runtime_and_manifest(self) -> None:
        package = json.loads((TOOLBOX_DIR / "package.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            staging = root / "extension"
            staging.mkdir()
            for filename in ("package.json", "extension.js", "core.js"):
                (staging / filename).write_bytes((TOOLBOX_DIR / filename).read_bytes())
            runtime = staging / "runtime"
            runtime.mkdir()
            (runtime / "copilot-models.py").write_text("print('ok')\n", encoding="utf-8")
            (runtime / "copilot-models.catalog.json").write_text(
                '{"providers": []}\n', encoding="utf-8"
            )
            vsix = root / "toolbox.vsix"
            copilot_models.build_toolbox_vsix(staging, package, vsix)
            with zipfile.ZipFile(vsix) as archive:
                names = set(archive.namelist())
                manifest = archive.read("extension.vsixmanifest").decode("utf-8")
            self.assertIn("extension/package.json", names)
            self.assertIn("extension/extension.js", names)
            self.assertIn("extension/runtime/copilot-models.py", names)
            self.assertIn("extension/runtime/copilot-models.catalog.json", names)
            self.assertIn(f'Version="{copilot_models.HELPER_VERSION}"', manifest)


class CommandIntegrationTests(unittest.TestCase):
    def test_cli_writes_config_patches_manifest_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            catalog_path = root / "catalog.json"
            extension = root / "github.copilot-chat-1.0.0"
            extension.mkdir()
            package_path = extension / "package.json"
            package_path.write_text(
                json.dumps(
                    {
                        "publisher": "GitHub",
                        "name": "copilot-chat",
                        "contributes": {
                            "languageModelChatProviders": [
                                {
                                    "vendor": "customoai",
                                    "when": "productQualityType != 'stable'",
                                    "configuration": {"type": "object"},
                                }
                            ]
                        },
                    }
                ),
                encoding="utf-8",
            )
            catalog_path.write_text(
                json.dumps(
                    {
                        "providers": [
                            {
                                "slug": "example",
                                "name": "Example API",
                                "baseUrl": "https://example.test/v1",
                                "apiKeyEnv": ["EXAMPLE_API_KEY"],
                                "models": [
                                    {
                                        "id": "chat-a",
                                        "name": "Chat A",
                                        "toolCalling": False,
                                        "vision": False,
                                        "maxInputTokens": 64000,
                                        "maxOutputTokens": 8000,
                                    }
                                ],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            user_data = root / "user-data"
            settings_path = user_data / "User" / "settings.json"
            settings_path.parent.mkdir(parents=True)
            original_settings = '''{
                // Preserve unrelated code-server settings and the original JSONC backup.
                "editor.fontSize": 16,
                "terminal.integrated.profiles.linux": {
                    "Fish": {"path": "/usr/bin/fish"},
                },
            }'''
            settings_path.write_text(original_settings, encoding="utf-8")

            # Emulate code-server's local VSIX installer so this integration
            # test exercises packaging, CLI installation, and discovery.
            bin_dir = root / "bin"
            bin_dir.mkdir()
            fake_code_server = bin_dir / "code-server"
            fake_code_server.write_text(
                '''#!/usr/bin/env python3
import json
import sys
import zipfile
from pathlib import Path

args = sys.argv[1:]
root = Path(args[args.index("--extensions-dir") + 1]) if "--extensions-dir" in args else None
if "--install-extension" in args:
    vsix = Path(args[args.index("--install-extension") + 1])
    with zipfile.ZipFile(vsix) as archive:
        package = json.loads(archive.read("extension/package.json"))
        target = root / f"{package['publisher']}.{package['name']}-{package['version']}"
        target.mkdir(parents=True, exist_ok=True)
        for member in archive.namelist():
            if member.startswith("extension/") and not member.endswith("/"):
                relative = member.removeprefix("extension/")
                destination = target / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.read(member))
    print(f"Installed {package['publisher']}.{package['name']}")
elif "--locate-extension" in args and root:
    extension_id = args[args.index("--locate-extension") + 1]
    matches = sorted(root.glob(extension_id + "-*"))
    if matches:
        print(matches[-1])
''',
                encoding="utf-8",
            )
            fake_code_server.chmod(0o700)

            command = [
                sys.executable,
                str(HELPER_PATH),
                "--catalog",
                str(catalog_path),
                "--no-discover",
                "--user-data-dir",
                str(user_data),
                "--extension-dir",
                str(extension),
                "--toolbox-dir",
                str(TOOLBOX_DIR),
                "--enable-terminal",
            ]
            environment = {
                **os.environ,
                "PATH": str(bin_dir) + os.pathsep + os.environ.get("PATH", ""),
                "EXAMPLE_API_KEY": "runtime-secret",
                "COPILOT_TERMINAL_SHELL": "/bin/bash",
            }
            first = subprocess.run(command, env=environment, capture_output=True, text=True)
            second = subprocess.run(command, env=environment, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertIn("pkill -f '[c]ode-server' || true", first.stdout)
            self.assertIn("nohup code-server", first.stdout)
            self.assertIn("installed-via-code-server", first.stdout)
            self.assertIn("updated-via-code-server", second.stdout)

            config_path = user_data / "User" / "chatLanguageModels.json"
            groups = json.loads(config_path.read_text(encoding="utf-8"))
            self.assertEqual(len(groups), 1)
            self.assertEqual(groups[0]["vendor"], "customoai")
            self.assertEqual(groups[0]["apiKey"], "runtime-secret")
            self.assertEqual(groups[0]["models"][0]["id"], "chat-a")
            self.assertTrue(groups[0]["models"][0]["toolCalling"])
            self.assertEqual(config_path.stat().st_mode & 0o777, 0o600)

            settings = json.loads(settings_path.read_text(encoding="utf-8"))
            self.assertEqual(settings["editor.fontSize"], 16)
            self.assertEqual(
                settings["terminal.integrated.profiles.linux"]["Fish"],
                {"path": "/usr/bin/fish"},
            )
            self.assertEqual(settings["terminal.integrated.defaultProfile.linux"], "Bash")
            self.assertEqual(
                settings["chat.tools.terminal.terminalProfile.linux"]["path"],
                "/bin/bash",
            )
            self.assertNotIn(
                "args", settings["chat.tools.terminal.terminalProfile.linux"]
            )
            self.assertTrue(settings["terminal.integrated.shellIntegration.enabled"])
            self.assertTrue(settings["chat.tools.terminal.enableAutoApprove"])
            self.assertNotIn("chat.tools.terminal.autoApprove", settings)
            self.assertEqual(settings["copilotModels.configFile"], str(config_path))
            self.assertEqual(settings["copilotModels.settingsFile"], str(settings_path))
            self.assertEqual(settings_path.stat().st_mode & 0o777, 0o600)

            toolbox_target = (
                user_data
                / "extensions"
                / f"fazilatma.copilot-models-toolbox-{copilot_models.HELPER_VERSION}"
            )
            self.assertTrue((toolbox_target / "package.json").is_file())
            self.assertTrue((toolbox_target / "extension.js").is_file())
            self.assertTrue((toolbox_target / "core.js").is_file())
            self.assertTrue((toolbox_target / "runtime" / "copilot-models.py").is_file())
            self.assertTrue(
                (toolbox_target / "runtime" / "copilot-models.catalog.json").is_file()
            )

            package = json.loads(package_path.read_text(encoding="utf-8"))
            custom = package["contributes"]["languageModelChatProviders"][0]
            self.assertNotIn("when", custom)

            restored = subprocess.run(
                [*command, "--restore"],
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertEqual(restored.returncode, 0, restored.stderr)
            self.assertFalse(config_path.exists())
            self.assertFalse(toolbox_target.exists())
            self.assertTrue(settings_path.exists())
            self.assertEqual(settings_path.read_text(encoding="utf-8"), original_settings)
            restored_package = json.loads(package_path.read_text(encoding="utf-8"))
            restored_custom = restored_package["contributes"]["languageModelChatProviders"][0]
            self.assertEqual(restored_custom["when"], "productQualityType != 'stable'")


if __name__ == "__main__":
    unittest.main()
