"""Chat completions engine, multi-protocol adapter, tool calling loop, and automatic provider fallback."""
import os
import re
import json
import time
import httpx
from typing import Dict, Any, List, Optional, AsyncGenerator

from .models import Provider, ModelSpec
from .config import get_proxy_url, get_raw_config
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
        "\n### 🛠️ WORKSPACE FILE CREATION & EDITING RULES:\n"
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

    if provider.proxyUrl:
        url = provider.proxyUrl.replace("{url}", url)
    else:
        proxied = get_proxy_url(url)
        if proxied:
            url = proxied

    started = time.perf_counter()
    tot_timeout = custom_timeout_sec if custom_timeout_sec is not None else (provider.timeoutSec or 120.0)
    conn_timeout = custom_connect_sec if custom_connect_sec is not None else 15.0
    timeout = httpx.Timeout(tot_timeout, connect=conn_timeout)

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            r = await client.post(url, headers=headers, json=body)
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
        except Exception as e:
            latency = (time.perf_counter() - started) * 1000
            CIRCUIT_BREAKER.record_failure(provider.id)
            PROVIDER_STORE.record_metric(provider.id, model.id, latency, is_error=True)
            raise e

def auto_detect_and_save_code_files(content: str, pending_approvals: Optional[List[Dict[str, Any]]] = None):
    from .workspaces import create_workspace_item, get_active_workspace
    from .changesets import save_file_version_snapshot
    if not content or "```" not in content:
        return

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
            clean_lang = re.split(r'[\s:]', lang)[0].strip()
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

        if filename:
            clean_fn = filename.strip().lstrip("/").replace("\\", "/")
            if clean_fn and not clean_fn.startswith("..") and "." in clean_fn:
                try:
                    create_workspace_item(clean_fn, is_dir=False, content=code)
                    ws = get_active_workspace()
                    save_file_version_snapshot(ws["id"], clean_fn, code, created_by="agent-auto-save")
                    used_names.add(clean_fn)
                except Exception:
                    pass

async def complete_chat(
    store: ProviderStore,
    provider_id: str,
    model_id: str,
    messages: List[Dict[str, Any]],
    max_steps: int = 8,
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
                    auto_detect_and_save_code_files(msg.get("content", ""), pending_approvals)
                    CIRCUIT_BREAKER.record_success(p.id)
                    store.record_metric(p.id, target_model.id, 0, is_error=False)
                    return {
                        "message": msg,
                        "steps": step_idx + 1,
                        "provider": p.id,
                        "model": target_model.id,
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
