#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HELPERS_DIR = Path(__file__).resolve().parents[1]
HELPER_PATH = HELPERS_DIR / "copilot-models.py"
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

    def test_environment_key_replaces_existing_key(self) -> None:
        existing = [
            {"vendor": "customoai", "name": "Example", "apiKey": "old", "models": []}
        ]
        with mock.patch.dict(os.environ, {"EXAMPLE_API_KEY": "new"}, clear=True):
            merged, _ = copilot_models.merge_groups(existing, [self.provider], False)
        self.assertEqual(merged[0]["apiKey"], "new")


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
                                        "toolCalling": True,
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
            ]
            environment = {**os.environ, "EXAMPLE_API_KEY": "runtime-secret"}
            first = subprocess.run(command, env=environment, capture_output=True, text=True)
            second = subprocess.run(command, env=environment, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)

            config_path = user_data / "User" / "chatLanguageModels.json"
            groups = json.loads(config_path.read_text(encoding="utf-8"))
            self.assertEqual(len(groups), 1)
            self.assertEqual(groups[0]["vendor"], "customoai")
            self.assertEqual(groups[0]["apiKey"], "runtime-secret")
            self.assertEqual(groups[0]["models"][0]["id"], "chat-a")
            self.assertEqual(config_path.stat().st_mode & 0o777, 0o600)

            package = json.loads(package_path.read_text(encoding="utf-8"))
            custom = package["contributes"]["languageModelChatProviders"][0]
            self.assertNotIn("when", custom)


if __name__ == "__main__":
    unittest.main()
