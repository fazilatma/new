#!/usr/bin/env node
/**
 * Single-File Bundle Builder for Arena Coding Agent
 * Generates:
 *   1. agent-php/agent.php (All-in-one standalone PHP drop-in)
 *   2. agent-python/agent.py (All-in-one standalone Python FastAPI drop-in)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('📦 Building Single-File Distributions for Arena Agents...');

// ============================================================================
// 1. BUILD PHP SINGLE-FILE (agent-php/agent.php)
// ============================================================================
function buildPhpAgent() {
  const phpDir = path.join(ROOT_DIR, 'agent-php');
  const appDir = path.join(phpDir, 'app');

  const phpFiles = [
    'Bootstrap.php',
    'Http.php',
    'Crypto.php',
    'Config.php',
    'Observability.php',
    'Database.php',
    'Files.php',
    'Diff.php',
    'Security.php',
    'Terminal.php',
    'Git.php',
    'GitHub.php',
    'Browser.php',
    'HttpClient.php',
    'Providers.php',
    'Models.php',
    'LocalAI.php',
    'Projects.php',
    'Workspaces.php',
    'References.php',
    'ChangeSets.php',
    'Conversations.php',
    'AgentTools.php',
    'Chat.php',
    'Jobs.php',
    'Auth.php',
    'Router.php',
    'Routes.php'
  ];

  const initSql = fs.readFileSync(path.join(phpDir, 'migrations/0001_init.sql'), 'utf-8');
  const indexHtml = fs.readFileSync(path.join(phpDir, 'public/index.html'), 'utf-8');
  const localaiHtml = fs.existsSync(path.join(phpDir, 'public/localai.html')) ? fs.readFileSync(path.join(phpDir, 'public/localai.html'), 'utf-8') : '';
  const diagHtml = fs.existsSync(path.join(phpDir, 'public/diag.html')) ? fs.readFileSync(path.join(phpDir, 'public/diag.html'), 'utf-8') : '';
  const catalogJson = fs.existsSync(path.join(phpDir, 'data/model_catalog.json')) ? fs.readFileSync(path.join(phpDir, 'data/model_catalog.json'), 'utf-8') : '{}';

  let body = '';

  for (const file of phpFiles) {
    const filePath = path.join(appDir, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`Warning: ${file} not found in agent-php/app`);
      continue;
    }
    let code = fs.readFileSync(filePath, 'utf-8');
    // Remove opening <?php, declare(strict_types=1);, namespace Arena;
    code = code.replace(/<\?php\s*/g, '');
    code = code.replace(/declare\s*\(\s*strict_types\s*=\s*1\s*\)\s*;\s*/g, '');
    code = code.replace(/namespace\s+Arena\s*;\s*/g, '');
    code = code.replace(/require_once\s+__DIR__\s*\.\s*'\/[^']+'\s*;\s*/g, '');
    body += `\n/* ==========================================================================\n * FILE: ${file}\n * ========================================================================== */\n` + code.trim() + '\n';
  }

  // Create embedded asset fallbacks
  const embeddedAssets = `
namespace Arena {
    final class EmbeddedAssets {
        public const INIT_SQL = ${JSON.stringify(initSql)};
        public const INDEX_HTML = ${JSON.stringify(indexHtml)};
        public const LOCALAI_HTML = ${JSON.stringify(localaiHtml)};
        public const DIAG_HTML = ${JSON.stringify(diagHtml)};
        public const CATALOG_JSON = ${JSON.stringify(catalogJson)};
    }
}
`;

  const runner = `
namespace Arena {
    // Single-File Dispatcher & Front-Controller
    if (php_sapi_name() === 'cli' && isset($argv[1]) && in_array($argv[1], ['migrate', 'doctor', 'worker', 'version', 'help', '--help', '-h'], true)) {
        Bootstrap::init();
        Database::init();
        $cmd = $argv[1];
        if ($cmd === 'migrate') {
            echo "✓ Database schema verified.\\n";
            exit(0);
        } elseif ($cmd === 'doctor') {
            $caps = Bootstrap::capabilities();
            echo "Arena Agent PHP Doctor Report:\\n";
            foreach ($caps as $k => $v) {
                echo " - " . str_pad($k, 18) . ": " . (is_bool($v) ? ($v ? 'YES' : 'NO') : (string)$v) . "\\n";
            }
            exit(0);
        } elseif ($cmd === 'version') {
            echo "Arena Coding Agent PHP v" . APP_VERSION . "\\n";
            exit(0);
        } elseif ($cmd === 'worker') {
            Jobs::runWorkerLoop(2);
            exit(0);
        } else {
            echo "Arena Coding Agent PHP v" . APP_VERSION . " (Single-File Distribution)\\n";
            echo "Usage: php -S 0.0.0.0:8099 " . basename(__FILE__) . "\\n";
            echo "CLI commands: migrate | doctor | worker | version\\n";
            exit(0);
        }
    }

    // Web Request Handler
    Bootstrap::init();

    // Ensure database is initialized with embedded fallback if file missing
    try {
        Database::init();
    } catch (\\Throwable $e) {
        // Fallback migration with embedded SQL
        try {
            $pdo = Database::pdo();
            $pdo->exec(EmbeddedAssets::INIT_SQL);
        } catch (\\Throwable $inner) {}
    }

    $req = Request::capture();

    // CORS Handling
    $origins = Config::corsOrigins();
    $requestOrigin = (string) $req->header('origin', '');
    $allowAll = in_array('*', $origins, true);
    $allowOrigin = $allowAll ? '*' : (in_array($requestOrigin, $origins, true) ? $requestOrigin : '');

    if ($allowOrigin !== '') {
        header('Access-Control-Allow-Origin: ' . $allowOrigin);
        header('Vary: Origin');
        if (!$allowAll) {
            header('Access-Control-Allow-Credentials: true');
        }
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token');
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS');
    }

    if ($req->method === 'OPTIONS') {
        http_response_code(204);
        exit;
    }

    try {
        Observability::boot();
        if (!Auth::middleware($req)) {
            exit;
        }
        $router = new Router();
        Routes::register($router);
        $router->dispatch($req);
    } catch (HttpError $e) {
        if (!Response::$headersSent) {
            Response::json($e->payload, $e->getCode() ?: 400);
        }
    } catch (\\Throwable $e) {
        $message = $e->getMessage();
        try {
            Observability::log('ERROR', 'API', $message, [
                'path' => $req->path,
                'method' => $req->method,
                'file' => $e->getFile() . ':' . $e->getLine(),
            ]);
        } catch (\\Throwable) {}
        if (!Response::$headersSent) {
            Response::json(['detail' => $message], 400);
        }
    }
}
`;

  const fullPhp = `<?php
/**
 * Arena AI Coding Agent — Single-File Standalone Distribution.
 * Version: 2.1.0
 *
 * Fully self-contained single-file agent with embedded SPA UI, SQLite database,
 * multi-provider routing, local AI management, code sandbox, and terminal execution.
 *
 * Usage:
 *   php -S 0.0.0.0:8099 agent.php
 *   Or drop agent.php directly into Apache / Nginx / Caddy web root as index.php
 */

declare(strict_types=1);

namespace Arena;

${embeddedAssets}

${body}

${runner}
`;

  const outPhp = path.join(phpDir, 'agent.php');
  fs.writeFileSync(outPhp, fullPhp, 'utf-8');
  console.log(`✅ Generated ${outPhp} (${(fullPhp.length / 1024).toFixed(1)} KB)`);
}

// ============================================================================
// 2. BUILD PYTHON SINGLE-FILE (agent-python/agent.py)
// ============================================================================
function buildPythonAgent() {
  const pyDir = path.join(ROOT_DIR, 'agent-python');
  const appDir = path.join(pyDir, 'app');

  const indexHtml = fs.readFileSync(path.join(appDir, 'static/index.html'), 'utf-8');
  const localaiHtml = fs.existsSync(path.join(appDir, 'static/localai.html')) ? fs.readFileSync(path.join(appDir, 'static/localai.html'), 'utf-8') : '';
  const diagHtml = fs.existsSync(path.join(appDir, 'static/diag.html')) ? fs.readFileSync(path.join(appDir, 'static/diag.html'), 'utf-8') : '';
  const catalogJson = fs.existsSync(path.join(pyDir, 'data/model_catalog.json')) ? fs.readFileSync(path.join(pyDir, 'data/model_catalog.json'), 'utf-8') : '{}';

  // Read app modules in order
  const pyFiles = [
    'models.py',
    'config.py',
    'database.py',
    'observability.py',
    'security.py',
    'terminal_sandbox.py',
    'git_manager.py',
    'github_workspace.py',
    'browser_automation.py',
    'workspaces.py',
    'changesets.py',
    'providers.py',
    'local_ai.py',
    'projects.py',
    'agent_tools.py',
    'auth.py',
    'chat.py',
    'worker.py',
    'workflow.py',
    'connectors.py',
    'runtime.py',
    'main.py'
  ];

  let combined = '';
  // Collect all imports at top
  const importsSet = new Set();
  const fileBlocks = [];

  for (const file of pyFiles) {
    const filePath = path.join(appDir, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`Warning: ${file} not found in agent-python/app`);
      continue;
    }
    let code = fs.readFileSync(filePath, 'utf-8');
    
    // Remove __future__ annotations from modules since top of file already has it
    code = code.replace(/from\s+__future__\s+import\s+annotations/g, '# future annotations');

    // Clean relative imports from . or .module (handles single-line and multi-line imports)
    code = code.replace(/from\s+\.(?:[a-zA-Z0-9_]+)?\s+import\s+(?:\([^)]*\)|[^\n]+)/g, '# relative import');
    code = code.replace(/import\s+\.[a-zA-Z0-9_]+/g, '# relative import');

    fileBlocks.push(`\n# =============================================================================\n# MODULE: ${file}\n# =============================================================================\n` + code.trim());
  }

  const embeddedPyAssets = `
# Embedded Assets
EMBEDDED_INDEX_HTML = ${JSON.stringify(indexHtml)}
EMBEDDED_LOCALAI_HTML = ${JSON.stringify(localaiHtml)}
EMBEDDED_DIAG_HTML = ${JSON.stringify(diagHtml)}
EMBEDDED_CATALOG_JSON = ${JSON.stringify(catalogJson)}
`;

  const singleFileLauncher = `
# Standalone CLI and Server Launcher
if __name__ == "__main__":
    import uvicorn
    init_db()
    port = int(os.getenv("PORT", "8788"))
    host = os.getenv("HOST", "0.0.0.0")
    print(f"🚀 Arena Python Agent2 v{APP_VERSION} (Single-File Standalone)")
    print(f"📡 Serving on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port)
`;

  const fullPython = `"""
Arena AI Coding Agent — Single-File Standalone Python Distribution.
Version: 2.1.0

Fully self-contained single-file agent with embedded FastAPI backend, SQLite WAL database,
multi-provider LLM routing, local AI runtime management, code execution sandbox,
and single-page web UI.

Usage:
  python3 agent.py
"""
from __future__ import annotations
import os
import sys
import json
import time
import uuid
import re
import ast
import shutil
import hashlib
import hmac
import secrets
import sqlite3
import threading
import queue
import subprocess
import signal
import platform
import socket
import base64
import mimetypes
import csv
import io
import asyncio
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Union, Set

import httpx
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException, UploadFile, File, Request, Response, Depends, Form
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from cryptography.fernet import Fernet

${embeddedPyAssets}

${fileBlocks.join('\n\n')}

${singleFileLauncher}
`;

  const outPy = path.join(pyDir, 'agent.py');
  fs.writeFileSync(outPy, fullPython, 'utf-8');
  console.log(`✅ Generated ${outPy} (${(fullPython.length / 1024).toFixed(1)} KB)`);
}

buildPhpAgent();
buildPythonAgent();
console.log('🎉 Single-File Distributions built successfully!');
