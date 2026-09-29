"""Chat completions engine, multi-protocol adapter, tool calling loop, and automatic provider fallback."""
import os
import re
import json
import time
import asyncio
import httpx
from typing import Dict, Any, List, Optional, Tuple, AsyncGenerator

from .models import Provider, ModelSpec
from .config import get_proxy_url, get_proxy_config, get_raw_config
from .providers import ProviderStore, PROVIDER_STORE, CIRCUIT_BREAKER
from .agent_tools import AGENT_TOOL_DEFINITIONS, execute_agent_tool
from .workspaces import (
    get_active_workspace, get_conversation_references, list_reference_files,
    add_conversation_reference
)
from .projects import get_active_project

def build_system_prompt(
    conversation_id: Optional[str] = None,
    referenced_items: Optional[List[Dict[str, Any]]] = None,
    messages: Optional[List[Dict[str, Any]]] = None
) -> str:
    proj = get_active_project()
    ws = get_active_workspace()

    prompt = (
        "You are an expert AI Coding Agent running in the Arena Agent environment. "
        "You have full access to workspace file tools, terminal execution with external internet connectivity, and browser tools.\n\n"
        f"Active Project: {proj.get('name', 'Main Project')}\n"
    )
    if proj.get("description"):
        prompt += f"Project Description: {proj['description']}\n"
    if proj.get("path"):
        prompt += f"Project Workspace Directory: {proj['path']}\n"
    if proj.get("default_branch"):
        prompt += f"Target Git Branch: {proj['default_branch']}\n"

    if proj.get("instructions") or ws.get("instructions"):
        ins = proj.get("instructions") or ws.get("instructions")
        prompt += f"\nProject Instructions & Guidelines:\n{ins}\n"

    if proj.get("agent_rules") or ws.get("agent_rules"):
        rules = proj.get("agent_rules") or ws.get("agent_rules")
        prompt += f"\nAgent Rules & Constraints:\n{rules}\n"

    # Gather conversation references
    refs = list(referenced_items or [])
    if conversation_id and not refs:
        try:
            refs = get_conversation_references(conversation_id)
        except Exception:
            refs = []

    # Also extract any dynamic @chat:... or @project:... mentions from user messages
    if messages:
        for m in messages:
            content = str(m.get("content", ""))
            # Pattern for @chat:<id> or @project:<id>
            chat_mentions = re.findall(r"@chat:([a-zA-Z0-9_\-]+)", content)
            for cid in chat_mentions:
                if not any(r.get("target_id") == cid for r in refs):
                    refs.append({"target_type": "chat", "target_id": cid, "title": f"Chat {cid}"})
                    if conversation_id:
                        try:
                            add_conversation_reference(conversation_id, "chat", cid)
                        except Exception:
                            pass

            proj_mentions = re.findall(r"@project:([a-zA-Z0-9_\-]+)", content)
            for pid in proj_mentions:
                if not any(r.get("target_id") == pid for r in refs):
                    refs.append({"target_type": "project", "target_id": pid, "title": f"Project {pid}"})
                    if conversation_id:
                        try:
                            add_conversation_reference(conversation_id, "project", pid)
                        except Exception:
                            pass

    if refs:
        prompt += "\n\n### 🔗 Referenced Chats & Projects (Cross-Session File Access):\n"
        prompt += (
            "This chat references the following other chats and projects. You have FULL permission and ability to inspect, "
            "read, and copy files from them into the active workspace using the `read_referenced_file`, `list_referenced_files`, "
            "and `copy_referenced_file` tools (or by prefixing paths with `@chat:<id>/path` or `@project:<id>/path`):\n"
        )
        for r in refs:
            t_type = r.get("target_type", "chat")
            t_id = r.get("target_id", "")
            title = r.get("title") or t_id
            prompt += f"- [{t_type.upper()}] Reference '{title}' (ID: `{t_id}`):\n"
            try:
                files = list_reference_files(t_type, t_id)
                if files:
                    file_names = [f["path"] for f in files if f["type"] == "file"][:15]
                    prompt += f"  Files ({len(file_names)}): {', '.join(file_names)}\n"
                else:
                    prompt += "  Files: (empty or newly created)\n"
            except Exception as e:
                prompt += f"  Files: (unable to list: {e})\n"

    prompt += (
        "\n### 🤖 ARENA AGENT WORKFLOW & AGENTIC CODING STANDARD:\n"
        "You must structure all your multi-step coding, debugging, and implementation responses according to the Arena Agent standard:\n"
        "1. **اعلام هدف و نیت (Goal & Intent)**: Start immediately with a clear statement of your goal and the approach you will take.\n"
        "2. **برنامه کاری مرحله‌ای (Step-by-Step Work Plan)**: Provide an explicit numbered work plan under `### 📋 برنامه کاری (Work Plan)`.\n"
        "3. **اجرای گام‌ها در کشوهای تاشو (Collapsible Step Drawers)**: Wrap each step's execution details, tools called, generated code, and error tracebacks inside `<details class=\"agent-step-drawer\" open>` with a `<summary class=\"agent-step-summary\">` line displaying the step number, title, and badge (e.g. `<span class=\"agent-step-badge done\">تکمیل شد ✓</span>` or `<span class=\"agent-step-badge healed\">اصلاح شد ✓</span>`).\n"
        "4. **خلاصه کارهای انجام‌شده (Accomplishments Summary)**: End with a clean bulleted report under `### 🏁 خلاصه کارهای انجام‌شده (Accomplishments)` listing all created files, executed tests, and verified results.\n\n"
        "### 🐘 PHP LANGUAGE & RUNTIME SUPPORT:\n"
        "- Full support is enabled for PHP (`.php`) scripting and web templates.\n"
        "- When writing PHP code, produce clean modern PHP (`<?php ... ?>`), output files as `.php` (e.g. `index.php`, `calc.php`), and execute using the workspace runner (`php filename.php`).\n\n"
        "### 🛠️ WORKSPACE FILE CREATION & EDITING RULES:\n"
        "- When the user asks you to write, create, generate, modify, refactor, or test code or files, "
        "you MUST ALWAYS call the `write_file` tool (`write_file(path=..., content=...)`) so the code is saved directly into the active workspace directory.\n"
        "- DO NOT just output markdown code blocks without saving the file using `write_file`.\n"
        "- Always ensure the generated code is completely implemented, production-ready, and saved to the correct relative path in the workspace.\n"
    )

    return prompt

async def call_provider_api(
    provider: Provider,
    model: ModelSpec,
    messages: List[Dict[str, Any]],
    api_key: str,
    stream: bool = False,
    custom_timeout_sec: Optional[float] = None,
    custom_connect_sec: Optional[float] = None
) -> Dict[str, Any]:
    base_url = provider.url.rstrip("/")
    proxy_url = provider.proxyUrl or get_raw_config("AGENT_PROXY_URL", "https://proxy.fazilat-ma.workers.dev/?url={url}")
    proxy_enabled = get_raw_config("AGENT_PROXY_ENABLED", "true").lower() in ("1", "true", "yes")

    headers = {
        "Content-Type": "application/json"
    }
    if api_key:
        if provider.protocol == "anthropic":
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"
        elif provider.protocol == "azure":
            headers["api-key"] = api_key
        else:
            headers["Authorization"] = f"Bearer {api_key}"

    # Build endpoint URL and Body based on protocol
    if provider.protocol == "anthropic":
        url = f"{base_url}/v1/messages" if not base_url.endswith("/messages") else base_url
        system_msg = next((m["content"] for m in messages if m["role"] == "system"), "")
        user_msgs = [m for m in messages if m["role"] != "system"]
        body = {
            "model": model.id,
            "system": system_msg,
            "messages": user_msgs,
            "max_tokens": model.maxOutputTokens or 4096,
            "temperature": 0.2
        }
    elif provider.protocol == "ollama":
        url = f"{base_url}/api/chat" if not base_url.endswith("/chat") else base_url
        body = {
            "model": model.id,
            "messages": messages,
            "stream": False
        }
    else: # openai-compatible, mistral, azure, cloudflare, openrouter
        url = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"
        body = {
            "model": model.id,
            "messages": messages,
            "temperature": 0.2
        }
        if model.toolCalling:
            body["tools"] = AGENT_TOOL_DEFINITIONS

    # Resolve Proxy Routing
    proxy_client = None
    direct_url = url

    if provider.protocol == "ollama" or "127.0.0.1" in base_url or "localhost" in base_url:
        target_url = url
        proxy_client = None
    elif provider.proxyUrl:
        target_url, proxy_client = get_proxy_config(url, custom_proxy_url=provider.proxyUrl)
    else:
        target_url, proxy_client = get_proxy_config(url)

    started = time.perf_counter()
    tot_timeout = custom_timeout_sec if custom_timeout_sec is not None else (provider.timeoutSec or 120.0)
    conn_timeout = custom_connect_sec if custom_connect_sec is not None else 15.0
    timeout = httpx.Timeout(tot_timeout, connect=conn_timeout)

    # 1. Primary Attempt: with proxy routing if enabled
    try:
        async with httpx.AsyncClient(timeout=timeout, verify=False, proxy=proxy_client) as client:
            r = await client.post(target_url, headers=headers, json=body)
            r.raise_for_status()
            data = r.json()
            latency = (time.perf_counter() - started) * 1000

            CIRCUIT_BREAKER.record_success(provider.id)
            PROVIDER_STORE.record_metric(provider.id, model.id, latency, is_error=False)

            # Normalize response to OpenAI format
            if provider.protocol == "anthropic":
                content_text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
                thinking_text = "".join(b.get("thinking", "") for b in data.get("content", []) if b.get("type") == "thinking")
                msg_dict = {
                    "role": "assistant",
                    "content": content_text
                }
                if thinking_text:
                    msg_dict["reasoning_content"] = thinking_text
                return {
                    "choices": [{
                        "message": msg_dict
                    }]
                }
            elif provider.protocol == "ollama":
                msg_dict = data.get("message", {"role": "assistant", "content": ""})
                return {
                    "choices": [{
                        "message": msg_dict
                    }]
                }
            return data
    except Exception as proxy_or_direct_err:
        # 2. Adaptive Direct Fallback: If proxy was used and failed, retry directly without proxy
        if (target_url != direct_url or proxy_client is not None) and provider.protocol != "ollama":
            try:
                async with httpx.AsyncClient(timeout=timeout, verify=False) as direct_client:
                    r = await direct_client.post(direct_url, headers=headers, json=body)
                    r.raise_for_status()
                    data = r.json()
                    latency = (time.perf_counter() - started) * 1000
                    CIRCUIT_BREAKER.record_success(provider.id)
                    PROVIDER_STORE.record_metric(provider.id, model.id, latency, is_error=False)
                    if provider.protocol == "anthropic":
                        content_text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
                        thinking_text = "".join(b.get("thinking", "") for b in data.get("content", []) if b.get("type") == "thinking")
                        msg_dict = {"role": "assistant", "content": content_text}
                        if thinking_text:
                            msg_dict["reasoning_content"] = thinking_text
                        return {"choices": [{"message": msg_dict}]}
                    return data
            except Exception:
                pass

        latency = (time.perf_counter() - started) * 1000
        CIRCUIT_BREAKER.record_failure(provider.id)
        PROVIDER_STORE.record_metric(provider.id, model.id, latency, is_error=True)
        raise proxy_or_direct_err

def auto_detect_and_save_code_files(content: str, pending_approvals: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    from .workspaces import create_workspace_item, get_active_workspace
    from .changesets import save_file_version_snapshot
    saved_files: List[Dict[str, Any]] = []
    if not content or "```" not in content:
        return saved_files

    used_names = set()
    blocks = re.split(r'```', content)
    for i in range(1, len(blocks), 2):
        block = blocks[i]
        preceding_text = blocks[i-1] if i > 0 else ""
        lines = block.split('\n', 1)
        first_line = lines[0].strip()
        code = lines[1] if len(lines) > 1 else ""
        if not code.strip():
            continue

        filename = None
        lang = first_line.lower()
        clean_lang = re.split(r'[\s:;=]', lang)[0].strip().lower() if lang else "code"

        # 1. Check for filename directly attached to language tag (e.g. `html:index.html` or `python filename=main.py`)
        tag_match = re.search(r'(?:^|[\s:])(?:file=|filename=|path=|:)?\s*([a-zA-Z0-9_\-\./]+\.[a-zA-Z0-9]+)', first_line, re.IGNORECASE)
        if tag_match:
            filename = tag_match.group(1).strip()

        # 2. Check for filename in first 3 lines of code inside block
        if not filename:
            code_head = "\n".join(code.strip().split('\n')[:3])
            code_fn_match = re.search(r'(?:#|//|/\*|<!--)\s*(?:filename|filepath|file|path|نام فایل)?\s*:?\s*`?([a-zA-Z0-9_\-\./]+\.[a-zA-Z0-9]+)`?', code_head, re.IGNORECASE)
            if code_fn_match:
                filename = code_fn_match.group(1).strip()

        # 3. Check preceding text (heading or line before code block)
        if not filename and preceding_text:
            last_lines = [l.strip() for l in preceding_text.strip().split('\n')[-3:] if l.strip()]
            for l in reversed(last_lines):
                prec_match = re.search(r'(?:###|##|#|\*\*|فایل|File:?|ساخت فایل|کد فایل)?\s*`?([a-zA-Z0-9_\-\./]+\.(?:html|htm|py|js|ts|css|json|sql|sh|md|txt))`?', l, re.IGNORECASE)
                if prec_match:
                    filename = prec_match.group(1).strip()
                    break

        # 4. Fallback based on code content and language tag
        if not filename:
            if "<!doctype html" in code.lower() or "<html" in code.lower():
                filename = "index.html"
            elif clean_lang in ("html", "htm"):
                filename = "index.html" if "index.html" not in used_names else f"page_{len(used_names)+1}.html"
            elif clean_lang in ("css",):
                filename = "style.css" if "style.css" not in used_names else f"style_{len(used_names)+1}.css"
            elif clean_lang in ("javascript", "js"):
                filename = "app.js" if "app.js" not in used_names else f"script_{len(used_names)+1}.js"
            elif clean_lang in ("typescript", "ts"):
                filename = "app.ts" if "app.ts" not in used_names else f"script_{len(used_names)+1}.ts"
            elif clean_lang in ("python", "py"):
                if "tkinter" in code or "math" in code or "calculator" in content.lower():
                    filename = "main.py" if "main.py" not in used_names else "calculator.py"
                else:
                    filename = "main.py" if "main.py" not in used_names else f"script_{len(used_names)+1}.py"
            elif clean_lang in ("json",):
                filename = "data.json"
            elif clean_lang in ("sql",):
                filename = "schema.sql"
            elif clean_lang in ("bash", "sh", "zsh"):
                filename = "run.sh"
            elif clean_lang in ("php",) or "<?php" in code:
                filename = "index.php" if "index.php" not in used_names else f"script_{len(used_names)+1}.php"

        if filename:
            clean_fn = filename.strip().lstrip("/").replace("\\", "/")
            if clean_fn and not clean_fn.startswith("..") and "." in clean_fn:
                try:
                    create_workspace_item(clean_fn, is_dir=False, content=code)
                    ws = get_active_workspace()
                    save_file_version_snapshot(ws["id"], clean_fn, code, created_by="agent-auto-save")
                    used_names.add(clean_fn)
                    is_exec = clean_fn.lower().endswith((".py", ".pyw", ".sh", ".bash", ".js", ".mjs", ".ts", ".php"))
                    is_html = clean_fn.lower().endswith((".html", ".htm"))
                    saved_files.append({
                        "path": clean_fn,
                        "type": clean_lang or "code",
                        "content": code,
                        "isExecutable": is_exec,
                        "isHtml": is_html
                    })
                except Exception:
                    pass

    return saved_files

def execute_file_in_workspace(path: str) -> Dict[str, Any]:
    from .terminal_sandbox import execute_sandboxed_command
    from .workspaces import safe_path
    try:
        p = safe_path(path)
        if not p.exists() or p.is_dir():
            return {"ok": False, "success": False, "error": f"File not found: {path}", "exitCode": 1, "path": path}

        suffix = p.suffix.lower()
        if suffix in (".py", ".pyw"):
            cmd = f"python3 '{p.name}'"
        elif suffix in (".sh", ".bash"):
            cmd = f"bash '{p.name}'"
        elif suffix in (".js", ".mjs"):
            cmd = f"node '{p.name}'"
        elif suffix == ".ts":
            cmd = f"npx --yes tsx '{p.name}'"
        elif suffix in (".php",):
            cmd = f"php '{p.name}'"
        elif suffix in (".html", ".htm"):
            return {
                "ok": True,
                "success": True,
                "type": "html",
                "fileType": "html",
                "path": path,
                "previewUrl": f"/api/workspace/raw?path={path}",
                "exitCode": 0,
                "stdout": "Live HTML preview ready.",
                "stderr": "",
                "message": "HTML ready for live preview."
            }
        else:
            return {"ok": True, "success": True, "type": "text", "fileType": suffix.lstrip('.'), "path": path, "message": "File created."}

        res = execute_sandboxed_command(cmd, cwd=str(p.parent), confirmed_dangerous=True)
        is_ok = res.get("exitCode", 0) == 0
        return {
            "ok": is_ok,
            "success": is_ok,
            "command": cmd,
            "path": path,
            "type": "script",
            "fileType": suffix.lstrip('.'),
            "exitCode": res.get("exitCode", 0),
            "stdout": res.get("stdout", ""),
            "stderr": res.get("stderr", ""),
            "durationMs": res.get("durationMs", 0)
        }
    except Exception as e:
        return {"ok": False, "success": False, "error": str(e), "exitCode": 1, "path": path}

async def stream_call_provider_api(
    provider: Provider,
    model: ModelSpec,
    messages: List[Dict[str, Any]],
    api_key: str,
    custom_timeout_sec: Optional[float] = None,
    custom_connect_sec: Optional[float] = None
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    True SSE streaming caller for OpenAI-compatible, Anthropic, and Ollama providers.
    Yields dicts with:
      {"type": "token", "text": "..."}
      {"type": "reasoning", "reasoning": "..."}
      {"type": "full_message", "message": {...}}
    """
    base_url = provider.url.rstrip("/")
    headers = {"Content-Type": "application/json"}
    if api_key:
        if provider.protocol == "anthropic":
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"
        elif provider.protocol == "azure":
            headers["api-key"] = api_key
        else:
            headers["Authorization"] = f"Bearer {api_key}"

    if provider.protocol == "anthropic":
        url = f"{base_url}/v1/messages" if not base_url.endswith("/messages") else base_url
        system_msg = next((m["content"] for m in messages if m["role"] == "system"), "")
        user_msgs = [m for m in messages if m["role"] != "system"]
        body = {
            "model": model.id,
            "system": system_msg,
            "messages": user_msgs,
            "max_tokens": model.maxOutputTokens or 4096,
            "temperature": 0.2,
            "stream": True
        }
    elif provider.protocol == "ollama":
        url = f"{base_url}/api/chat" if not base_url.endswith("/chat") else base_url
        body = {
            "model": model.id,
            "messages": messages,
            "stream": True
        }
    else: # openai-compatible, mistral, azure, cloudflare, openrouter
        url = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"
        body = {
            "model": model.id,
            "messages": messages,
            "temperature": 0.2,
            "stream": True
        }
        if model.toolCalling:
            body["tools"] = AGENT_TOOL_DEFINITIONS

    proxy_client = None
    direct_url = url

    if provider.protocol == "ollama" or "127.0.0.1" in base_url or "localhost" in base_url:
        target_url = url
        proxy_client = None
    elif provider.proxyUrl:
        target_url, proxy_client = get_proxy_config(url, custom_proxy_url=provider.proxyUrl)
    else:
        target_url, proxy_client = get_proxy_config(url)

    started = time.perf_counter()
    tot_timeout = custom_timeout_sec if custom_timeout_sec is not None else (provider.timeoutSec or 120.0)
    conn_timeout = custom_connect_sec if custom_connect_sec is not None else 15.0
    timeout = httpx.Timeout(tot_timeout, connect=conn_timeout)

    async def _stream_request(request_url, client_proxy):
        full_content = []
        full_reasoning = []
        tool_calls_dict: Dict[int, Dict[str, Any]] = {}

        async with httpx.AsyncClient(timeout=timeout, verify=False, proxy=client_proxy) as client:
            async with client.stream("POST", request_url, headers=headers, json=body) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line or line.startswith(":"):
                        continue

                    if line.startswith("data: "):
                        data_str = line[6:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            choices = chunk.get("choices") or []
                            if not choices:
                                continue
                            delta = choices[0].get("delta") or {}

                            r_text = delta.get("reasoning_content") or delta.get("reasoning") or delta.get("thought") or ""
                            if r_text:
                                full_reasoning.append(r_text)
                                yield {"type": "reasoning", "reasoning": r_text}

                            c_text = delta.get("content") or ""
                            if c_text:
                                full_content.append(c_text)
                                yield {"type": "token", "text": c_text}

                            tc_list = delta.get("tool_calls") or []
                            for tc in tc_list:
                                idx = tc.get("index", 0)
                                if idx not in tool_calls_dict:
                                    tool_calls_dict[idx] = {
                                        "id": tc.get("id", f"call_{idx}_{int(time.time()*1000)}"),
                                        "type": "function",
                                        "function": {"name": "", "arguments": ""}
                                    }
                                if tc.get("id"):
                                    tool_calls_dict[idx]["id"] = tc["id"]
                                fn = tc.get("function") or {}
                                if fn.get("name"):
                                    tool_calls_dict[idx]["function"]["name"] += fn["name"]
                                if fn.get("arguments"):
                                    tool_calls_dict[idx]["function"]["arguments"] += fn["arguments"]
                        except Exception:
                            pass

                    elif provider.protocol == "ollama" and line.startswith("{"):
                        try:
                            chunk = json.loads(line)
                            msg = chunk.get("message") or {}
                            c_text = msg.get("content") or ""
                            if c_text:
                                full_content.append(c_text)
                                yield {"type": "token", "text": c_text}
                            if chunk.get("done"):
                                break
                        except Exception:
                            pass

                    elif provider.protocol == "anthropic" and line.startswith("data: "):
                        try:
                            chunk = json.loads(line[6:].strip())
                            ev_type = chunk.get("type")
                            if ev_type == "content_block_delta":
                                delta = chunk.get("delta") or {}
                                if delta.get("type") == "text_delta" and delta.get("text"):
                                    full_content.append(delta["text"])
                                    yield {"type": "token", "text": delta["text"]}
                                elif delta.get("type") == "thinking_delta" and delta.get("thinking"):
                                    full_reasoning.append(delta["thinking"])
                                    yield {"type": "reasoning", "reasoning": delta["thinking"]}
                        except Exception:
                            pass

        tool_calls_final = [v for k, v in sorted(tool_calls_dict.items())] if tool_calls_dict else []
        final_msg = {
            "role": "assistant",
            "content": "".join(full_content)
        }
        if full_reasoning:
            final_msg["reasoning_content"] = "".join(full_reasoning)
        if tool_calls_final:
            final_msg["tool_calls"] = tool_calls_final

        yield {"type": "full_message", "message": final_msg}

    try:
        async for item in _stream_request(target_url, proxy_client):
            yield item
        CIRCUIT_BREAKER.record_success(provider.id)
        PROVIDER_STORE.record_metric(provider.id, model.id, (time.perf_counter() - started) * 1000, is_error=False)
    except Exception as proxy_err:
        if (target_url != direct_url or proxy_client is not None) and provider.protocol != "ollama":
            try:
                async for item in _stream_request(direct_url, None):
                    yield item
                CIRCUIT_BREAKER.record_success(provider.id)
                PROVIDER_STORE.record_metric(provider.id, model.id, (time.perf_counter() - started) * 1000, is_error=False)
                return
            except Exception:
                pass

        try:
            resp = await call_provider_api(provider, model, messages, api_key)
            choice = resp["choices"][0]
            msg = choice["message"]
            content = msg.get("content", "")
            reasoning = msg.get("reasoning_content") or msg.get("reasoning") or msg.get("thought") or ""

            if reasoning:
                yield {"type": "reasoning", "reasoning": reasoning}
            if content:
                chunk_sz = 25
                for i in range(0, len(content), chunk_sz):
                    yield {"type": "token", "text": content[i:i+chunk_sz]}
                    await asyncio.sleep(0.01)

            yield {"type": "full_message", "message": msg}
            return
        except Exception as non_stream_err:
            CIRCUIT_BREAKER.record_failure(provider.id)
            PROVIDER_STORE.record_metric(provider.id, model.id, (time.perf_counter() - started) * 1000, is_error=True)
            raise non_stream_err


async def stream_complete_chat(
    store: ProviderStore,
    provider_id: str,
    model_id: str,
    messages: List[Dict[str, Any]],
    max_steps: int = 30,
    user_id: str = "user",
    conversation_id: Optional[str] = None,
    references: Optional[List[Dict[str, Any]]] = None
) -> AsyncGenerator[Dict[str, Any], None]:
    if conversation_id:
        from .workspaces import get_or_create_session_workspace, set_active_workspace
        try:
            session_ws = get_or_create_session_workspace(conversation_id)
            set_active_workspace(session_ws["id"])
        except Exception:
            pass

    sys_prompt = build_system_prompt(conversation_id=conversation_id, referenced_items=references, messages=messages)
    chat_msgs = []
    if not any(m.get("role") == "system" for m in messages):
        chat_msgs.append({"role": "system", "content": sys_prompt})
    else:
        for m in messages:
            if m.get("role") == "system":
                m["content"] = sys_prompt
    chat_msgs.extend([m for m in messages if m.get("role") != "system"])

    primary_p = store.data.get(provider_id)
    if not primary_p:
        raise ValueError(f"Provider '{provider_id}' is not configured in the Provider Catalog.")

    model = next((m for m in primary_p.models if m.id == model_id), None)
    if not model:
        if primary_p.models:
            model = primary_p.models[0]
        else:
            model = ModelSpec(id=model_id or "default-model", name=model_id or "Default Model", toolCalling=True)

    yield {"type": "status", "status": "started", "provider": primary_p.id, "model": model.id}

    primary_key = store.get_api_key(primary_p)
    if not primary_key and primary_p.protocol != "ollama":
        fallback_with_key = next((p for p in store.data.values() if p.enabled and p.id != provider_id and (store.get_api_key(p) or p.protocol == "ollama")), None)
        if not fallback_with_key:
            err_msg = f"Provider '{primary_p.name}' ({primary_p.id}) does not have an API key configured."
            yield {
                "type": "error",
                "error": err_msg,
                "errorDetails": {
                    "provider": primary_p.id,
                    "providerName": primary_p.name,
                    "model": model.id,
                    "protocol": primary_p.protocol,
                    "url": primary_p.url,
                    "error": err_msg,
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
                    "remediation": f"Go to 'Providers & Models' or 'Security & Settings' and enter your API key for {primary_p.name}."
                }
            }
            return

    candidates: List[Tuple[Provider, ModelSpec, bool]] = [(primary_p, model, False)]
    seen = {(primary_p.id, model.id)}

    verified_fallbacks = store.get_verified_fallback_candidates(exclude_provider_id=primary_p.id, exclude_model_id=model.id)
    for vp, vm in verified_fallbacks:
        if (vp.id, vm.id) not in seen:
            candidates.append((vp, vm, True))
            seen.add((vp.id, vm.id))

    for p in sorted(store.data.values(), key=lambda x: x.priority, reverse=True):
        if not p.enabled or p.id == primary_p.id or CIRCUIT_BREAKER.is_tripped(p.id):
            continue
        api_key = store.get_api_key(p)
        if not api_key and p.protocol != "ollama":
            continue
        for m in (p.models or []):
            if (p.id, m.id) not in seen:
                candidates.append((p, m, True))
                seen.add((p.id, m.id))

    pending_approvals = []
    primary_error: Optional[str] = None
    fallback_errors: List[Dict[str, Any]] = []

    for p, target_model, is_fallback in candidates:
        api_key = store.get_api_key(p)
        if not api_key and p.protocol != "ollama":
            continue

        if is_fallback:
            yield {
                "type": "fallback_activated",
                "fallbackDetails": {
                    "used": True,
                    "originalProvider": primary_p.name,
                    "originalModel": model.id,
                    "activeProvider": p.name,
                    "activeModel": target_model.id
                }
            }

        try:
            for step_idx in range(max_steps):
                last_msg = None
                async for chunk in stream_call_provider_api(p, target_model, chat_msgs, api_key):
                    if chunk["type"] == "token":
                        yield {"type": "token", "text": chunk["text"]}
                    elif chunk["type"] == "reasoning":
                        yield {"type": "reasoning", "reasoning": chunk["reasoning"]}
                    elif chunk["type"] == "full_message":
                        last_msg = chunk["message"]

                if not last_msg:
                    break

                chat_msgs.append(last_msg)
                tool_calls = last_msg.get("tool_calls") or []

                if not tool_calls:
                    saved_files = auto_detect_and_save_code_files(last_msg.get("content", ""), pending_approvals)
                    execution_reports = []

                    # Autonomous Self-Healing Execution Loop
                    for sf in saved_files:
                        if sf.get("isExecutable"):
                            exec_res = execute_file_in_workspace(sf["path"])
                            if exec_res.get("exitCode", 1) == 0:
                                yield {
                                    "type": "execution_result",
                                    "path": sf["path"],
                                    "status": "success",
                                    "exitCode": 0,
                                    "command": exec_res.get("command", ""),
                                    "stdout": exec_res.get("stdout", ""),
                                    "stderr": exec_res.get("stderr", ""),
                                    "durationMs": exec_res.get("durationMs", 0)
                                }
                                execution_reports.append(exec_res)
                            else:
                                yield {
                                    "type": "execution_fixing",
                                    "path": sf["path"],
                                    "status": "fixing",
                                    "exitCode": exec_res.get("exitCode", 1),
                                    "command": exec_res.get("command", ""),
                                    "stdout": exec_res.get("stdout", ""),
                                    "stderr": exec_res.get("stderr", ""),
                                    "attempt": 1
                                }

                                current_err = exec_res.get("stderr") or exec_res.get("stdout") or "Execution failed with non-zero exit code"
                                for heal_attempt in range(1, 4):
                                    heal_prompt = (
                                        f"\n\n[AUTONOMOUS TEST EXECUTION FAILURE - Attempt {heal_attempt}/3]\n"
                                        f"File `{sf['path']}` was executed and failed with Exit Code {exec_res.get('exitCode', 1)}.\n"
                                        f"Error Traceback:\n```\n{current_err}\n```\n\n"
                                        f"Please diagnose this error, fix all issues in `{sf['path']}`, and output the full corrected code in a code block."
                                    )
                                    chat_msgs.append({"role": "user", "content": heal_prompt})

                                    yield {"type": "token", "text": f"\n\n⚙️ *در حال رفع خودکار خطای اجرای `{sf['path']}` (تلاش {heal_attempt})...*\n\n"}

                                    heal_msg = None
                                    async for chunk in stream_call_provider_api(p, target_model, chat_msgs, api_key):
                                        if chunk["type"] == "token":
                                            yield {"type": "token", "text": chunk["text"]}
                                        elif chunk["type"] == "reasoning":
                                            yield {"type": "reasoning", "reasoning": chunk["reasoning"]}
                                        elif chunk["type"] == "full_message":
                                            heal_msg = chunk["message"]

                                    if not heal_msg:
                                        break

                                    chat_msgs.append(heal_msg)
                                    auto_detect_and_save_code_files(heal_msg.get("content", ""), pending_approvals)

                                    re_exec = execute_file_in_workspace(sf["path"])
                                    if re_exec.get("exitCode", 1) == 0:
                                        yield {
                                            "type": "execution_healed",
                                            "path": sf["path"],
                                            "status": "healed",
                                            "exitCode": 0,
                                            "command": re_exec.get("command", ""),
                                            "stdout": re_exec.get("stdout", ""),
                                            "stderr": re_exec.get("stderr", ""),
                                            "durationMs": re_exec.get("durationMs", 0),
                                            "attempts": heal_attempt + 1
                                        }
                                        execution_reports.append(re_exec)
                                        break
                                    else:
                                        current_err = re_exec.get("stderr") or re_exec.get("stdout")
                                        exec_res = re_exec

                        elif sf.get("isHtml"):
                            yield {
                                "type": "render_preview_ready",
                                "path": sf["path"],
                                "previewUrl": f"/api/workspace/raw?path={sf['path']}&conversation_id={conversation_id or ''}",
                                "previewType": "html"
                            }

                    CIRCUIT_BREAKER.record_success(p.id)
                    store.record_metric(p.id, target_model.id, 0, is_error=False)

                    if pending_approvals:
                        yield {"type": "approvals", "approvals": pending_approvals}

                    yield {
                        "type": "done",
                        "steps": step_idx + 1,
                        "provider": p.id,
                        "model": target_model.id,
                        "reasoning": last_msg.get("reasoning_content", ""),
                        "executionReports": execution_reports,
                        "isFallback": is_fallback,
                        "fallbackDetails": {
                            "used": is_fallback,
                            "originalProvider": primary_p.name,
                            "originalModel": model.id,
                            "activeProvider": p.name,
                            "activeModel": target_model.id
                        } if is_fallback else None
                    }
                    return

                # Execute tool calls
                for tc in tool_calls:
                    fn = tc["function"]
                    name = fn["name"]
                    args = json.loads(fn.get("arguments") or "{}")

                    yield {"type": "tool_executing", "tool": name, "args": args}
                    try:
                        res = await execute_agent_tool(name, args)
                        status = "success"
                        if isinstance(res, dict) and res.get("requiresApproval"):
                            pending_approvals.append(res)
                    except Exception as e:
                        res = {"error": str(e)}
                        status = "error"

                    chat_msgs.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps(res, ensure_ascii=False)
                    })

            CIRCUIT_BREAKER.record_success(p.id)
            yield {
                "type": "done",
                "steps": max_steps,
                "provider": p.id,
                "model": target_model.id,
                "isFallback": is_fallback
            }
            return

        except Exception as e:
            err_text = str(e)
            CIRCUIT_BREAKER.record_failure(p.id)
            store.record_metric(p.id, target_model.id, 0, is_error=True)
            if p.id == primary_p.id:
                primary_error = f"{err_text} (Endpoint: {p.url})"
            else:
                fallback_errors.append({
                    "provider": p.id,
                    "providerName": p.name,
                    "model": target_model.id,
                    "url": p.url,
                    "error": err_text
                })
            continue

    # All candidates failed
    err_meta = {
        "provider": primary_p.id,
        "providerName": primary_p.name,
        "model": model.id,
        "protocol": primary_p.protocol,
        "url": primary_p.url,
        "error": primary_error or "All candidate models failed to respond.",
        "fallbackErrors": fallback_errors,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "remediation": "1. Check internet connection and API keys.\n2. In Providers & Models, test your model health.\n3. Verify your proxy server connection in Settings."
    }
    yield {
        "type": "error",
        "error": f"Failed to get response from {primary_p.name}: {primary_error or 'Network/API error'}",
        "errorDetails": err_meta
    }


async def complete_chat(
    store: ProviderStore,
    provider_id: str,
    model_id: str,
    messages: List[Dict[str, Any]],
    max_steps: int = 30,
    user_id: str = "user",
    conversation_id: Optional[str] = None,
    references: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    if conversation_id:
        from .workspaces import get_or_create_session_workspace, set_active_workspace
        try:
            session_ws = get_or_create_session_workspace(conversation_id)
            set_active_workspace(session_ws["id"])
        except Exception:
            pass

    # Ensure system prompt is present
    sys_prompt = build_system_prompt(conversation_id=conversation_id, referenced_items=references, messages=messages)
    chat_msgs = []
    if not any(m.get("role") == "system" for m in messages):
        chat_msgs.append({"role": "system", "content": sys_prompt})
    else:
        # Append reference instructions to existing system message
        for m in messages:
            if m.get("role") == "system":
                m["content"] = sys_prompt
    chat_msgs.extend([m for m in messages if m.get("role") != "system"])

    # Provider Resolution & Fallback list
    primary_p = store.data.get(provider_id)
    if not primary_p:
        raise ValueError(f"Provider '{provider_id}' is not configured in the Provider Catalog.")

    model = next((m for m in primary_p.models if m.id == model_id), None)
    if not model:
        if primary_p.models:
            model = primary_p.models[0]
        else:
            model = ModelSpec(id=model_id or "default-model", name=model_id or "Default Model", toolCalling=True)

    # Check key for primary provider
    primary_key = store.get_api_key(primary_p)
    if not primary_key and primary_p.protocol != "ollama":
        # Check if another enabled provider has a key
        fallback_with_key = next((p for p in store.data.values() if p.enabled and p.id != provider_id and (store.get_api_key(p) or p.protocol == "ollama")), None)
        if not fallback_with_key:
            err_msg = f"Provider '{primary_p.name}' ({primary_p.id}) does not have an API key configured."
            return {
                "message": {
                    "role": "assistant",
                    "content": f"⚠️ **API Key Required**: Provider `{primary_p.name}` (`{primary_p.id}`) does not have an API key configured.\n\nPlease open the **Providers & Models** or **Security & Settings** tab to enter your API key (or environment variable `{primary_p.apiKeyEnv or 'OPENROUTER_API_KEY'}`), or switch to **Ollama** if running locally."
                },
                "steps": 0,
                "provider": primary_p.id,
                "model": model.id,
                "errorDetails": {
                    "provider": primary_p.id,
                    "providerName": primary_p.name,
                    "model": model.id,
                    "protocol": primary_p.protocol,
                    "url": primary_p.url,
                    "error": err_msg,
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
                    "remediation": f"Go to 'Providers & Models' or 'Security & Settings' and enter your API key for {primary_p.name}."
                },
                "pendingApprovals": []
            }

    # Build prioritized candidate list:
    # 1. Primary candidate
    candidates: List[Tuple[Provider, ModelSpec, bool]] = [(primary_p, model, False)]
    seen = {(primary_p.id, model.id)}

    # 2. Verified fallback candidates (Models that successfully passed health/latency tests)
    verified_fallbacks = store.get_verified_fallback_candidates(exclude_provider_id=primary_p.id, exclude_model_id=model.id)
    for vp, vm in verified_fallbacks:
        if (vp.id, vm.id) not in seen:
            candidates.append((vp, vm, True))
            seen.add((vp.id, vm.id))

    # 3. Secondary candidates (Other enabled providers with valid API keys)
    for p in sorted(store.data.values(), key=lambda x: x.priority, reverse=True):
        if not p.enabled or p.id == primary_p.id or CIRCUIT_BREAKER.is_tripped(p.id):
            continue
        api_key = store.get_api_key(p)
        if not api_key and p.protocol != "ollama":
            continue
        for m in (p.models or []):
            if (p.id, m.id) not in seen:
                candidates.append((p, m, True))
                seen.add((p.id, m.id))

    primary_error: Optional[str] = None
    fallback_errors: List[Dict[str, Any]] = []
    step_history = []
    pending_approvals = []

    for p, target_model, is_fallback in candidates:
        api_key = store.get_api_key(p)
        if not api_key and p.protocol != "ollama":
            continue

        try:
            for step_idx in range(max_steps):
                resp = await call_provider_api(p, target_model, chat_msgs, api_key)
                choice = resp["choices"][0]
                msg = choice["message"]
                chat_msgs.append(msg)

                tool_calls = msg.get("tool_calls") or []
                if not tool_calls:
                    saved_files = auto_detect_and_save_code_files(msg.get("content", ""), pending_approvals)
                    execution_reports = []
                    for sf in saved_files:
                        if sf.get("isExecutable"):
                            exec_res = execute_file_in_workspace(sf["path"])
                            execution_reports.append(exec_res)
                            if exec_res.get("exitCode", 1) != 0:
                                current_err = exec_res.get("stderr") or exec_res.get("stdout") or "Execution failed"
                                for heal_attempt in range(1, 4):
                                    heal_prompt = (
                                        f"\n\n[AUTONOMOUS TEST EXECUTION FAILURE - Attempt {heal_attempt}/3]\n"
                                        f"File `{sf['path']}` was executed and failed with Exit Code {exec_res.get('exitCode', 1)}.\n"
                                        f"Error Traceback:\n```\n{current_err}\n```\n\n"
                                        f"Please diagnose this error, fix all issues in `{sf['path']}`, and output the full corrected code in a code block."
                                    )
                                    chat_msgs.append({"role": "user", "content": heal_prompt})
                                    try:
                                        heal_resp = await call_provider_api(p, target_model, chat_msgs, api_key)
                                        heal_msg = heal_resp["choices"][0]["message"]
                                        chat_msgs.append(heal_msg)
                                        auto_detect_and_save_code_files(heal_msg.get("content", ""), pending_approvals)
                                        re_exec = execute_file_in_workspace(sf["path"])
                                        execution_reports = [r for r in execution_reports if r.get("path") != sf["path"]] + [re_exec]
                                        if re_exec.get("exitCode", 1) == 0:
                                            msg = heal_msg
                                            break
                                        current_err = re_exec.get("stderr") or re_exec.get("stdout")
                                        exec_res = re_exec
                                    except Exception:
                                        break

                    CIRCUIT_BREAKER.record_success(p.id)
                    store.record_metric(p.id, target_model.id, 0, is_error=False)
                    return {
                        "message": msg,
                        "steps": step_idx + 1,
                        "provider": p.id,
                        "model": target_model.id,
                        "saved_files": saved_files,
                        "executionReports": execution_reports,
                        "execution_results": execution_reports,
                        "isFallback": is_fallback,
                        "fallbackDetails": {
                            "used": is_fallback,
                            "originalProvider": primary_p.name,
                            "originalModel": model.id,
                            "activeProvider": p.name,
                            "activeModel": target_model.id
                        } if is_fallback else None,
                        "pendingApprovals": pending_approvals
                    }

                # Execute tool calls
                for tc in tool_calls:
                    fn = tc["function"]
                    name = fn["name"]
                    args = json.loads(fn.get("arguments") or "{}")

                    t_start = time.perf_counter()
                    try:
                        res = await execute_agent_tool(name, args)
                        status = "success"
                        if isinstance(res, dict) and res.get("requiresApproval"):
                            pending_approvals.append(res)
                    except Exception as e:
                        res = {"error": str(e)}
                        status = "error"
                    duration_ms = int((time.perf_counter() - t_start) * 1000)

                    step_history.append({
                        "tool": name,
                        "args": args,
                        "result": res,
                        "status": status,
                        "durationMs": duration_ms
                    })

                    chat_msgs.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps(res, ensure_ascii=False)
                    })

            CIRCUIT_BREAKER.record_success(p.id)
            store.record_metric(p.id, target_model.id, 0, is_error=False)
            return {
                "message": {"role": "assistant", "content": "Reached maximum tool execution steps."},
                "steps": max_steps,
                "provider": p.id,
                "model": target_model.id,
                "isFallback": is_fallback,
                "pendingApprovals": pending_approvals
            }

        except Exception as e:
            err_text = str(e)
            CIRCUIT_BREAKER.record_failure(p.id)
            store.record_metric(p.id, target_model.id, 0, is_error=True)
            if p.id == primary_p.id:
                primary_error = f"{err_text} (Endpoint: {p.url})"
            else:
                fallback_errors.append({
                    "provider": p.id,
                    "providerName": p.name,
                    "model": target_model.id,
                    "url": p.url,
                    "error": err_text
                })
            continue

    # Build clean diagnostic description
    if primary_error:
        main_err_desc = f"`{primary_error}`"
    else:
        main_err_desc = f"`No API key or reachable endpoint configured for {primary_p.name} ({primary_p.url})`"

    fallback_section = ""
    if fallback_errors:
        fallback_lines = "\n".join(
            f"- **Fallback Provider `{f['providerName']}`** (`{f['model']}` @ `{f['url']}`): `{f['error']}`"
            for f in fallback_errors
        )
        fallback_section = f"\n\n**Automatic Fallback Attempts**:\n{fallback_lines}"

    combined_content = (
        f"⚠️ **Model Provider Notice**: Failed to communicate with primary model `{primary_p.name}` (`{model.id}`).\n\n"
        f"**Primary Error Details**: {main_err_desc}{fallback_section}\n\n"
        f"*(Click this message to view full error diagnostics and copy logs)*"
    )

    return {
        "message": {
            "role": "assistant",
            "content": combined_content
        },
        "steps": 0,
        "provider": primary_p.id,
        "model": model.id,
        "errorDetails": {
            "provider": primary_p.id,
            "providerName": primary_p.name,
            "model": model.id,
            "protocol": primary_p.protocol,
            "url": primary_p.url,
            "error": primary_error or "Provider communication failed",
            "fallbackErrors": fallback_errors,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "remediation": f"1. Check if your API key for '{primary_p.name}' is valid in Providers & Models.\n2. Ensure endpoint URL '{primary_p.url}' is reachable.\n3. Check circuit breaker status and reset if tripped."
        },
        "pendingApprovals": pending_approvals
    }
