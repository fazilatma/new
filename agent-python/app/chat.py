"""Chat completions engine, multi-protocol adapter, tool calling loop, and automatic provider fallback."""
import os
import json
import time
import httpx
from typing import Dict, Any, List, Optional, AsyncGenerator

from .models import Provider, ModelSpec
from .providers import ProviderStore, PROVIDER_STORE, CIRCUIT_BREAKER
from .agent_tools import AGENT_TOOL_DEFINITIONS, execute_agent_tool
from .workspaces import get_active_workspace
from .projects import get_active_project

def build_system_prompt() -> str:
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

    return prompt

async def call_provider_api(
    provider: Provider,
    model: ModelSpec,
    messages: List[Dict[str, Any]],
    api_key: str,
    stream: bool = False
) -> Dict[str, Any]:
    base_url = provider.url.rstrip("/")
    proxy_url = provider.proxyUrl or os.getenv("AGENT_PROXY_URL", "")

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

    if proxy_url:
        url = proxy_url.replace("{url}", url)

    started = time.perf_counter()
    timeout = httpx.Timeout(provider.timeoutSec or 120.0, connect=15.0)

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
                return {
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": content_text
                        }
                    }]
                }
            elif provider.protocol == "ollama":
                return {
                    "choices": [{
                        "message": data.get("message", {"role": "assistant", "content": ""})
                    }]
                }
            return data
        except Exception as e:
            latency = (time.perf_counter() - started) * 1000
            CIRCUIT_BREAKER.record_failure(provider.id)
            PROVIDER_STORE.record_metric(provider.id, model.id, latency, is_error=True)
            raise e

async def complete_chat(
    store: ProviderStore,
    provider_id: str,
    model_id: str,
    messages: List[Dict[str, Any]],
    max_steps: int = 8,
    user_id: str = "user"
) -> Dict[str, Any]:
    # Ensure system prompt is present
    sys_prompt = build_system_prompt()
    chat_msgs = []
    if not any(m.get("role") == "system" for m in messages):
        chat_msgs.append({"role": "system", "content": sys_prompt})
    chat_msgs.extend(messages)

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
            return {
                "message": {
                    "role": "assistant",
                    "content": f"⚠️ **API Key Required**: Provider `{primary_p.name}` (`{primary_p.id}`) does not have an API key configured.\n\nPlease open the **Providers & Models** or **Security & Settings** tab to enter your API key (or environment variable `{primary_p.apiKeyEnv or 'OPENROUTER_API_KEY'}`), or switch to **Ollama** if running locally."
                },
                "steps": 0,
                "provider": primary_p.id,
                "model": model.id,
                "pendingApprovals": []
            }

    # Find candidate providers for fallback
    candidates = [primary_p] + [p for p in store.data.values() if p.enabled and p.id != provider_id and not CIRCUIT_BREAKER.is_tripped(p.id)]

    last_error = None
    step_history = []
    pending_approvals = []

    for p in candidates:
        api_key = store.get_api_key(p)
        if not api_key and p.protocol != "ollama":
            continue

        target_model = model if p.id == primary_p.id else (p.models[0] if p.models else None)
        if not target_model:
            continue

        try:
            for step_idx in range(max_steps):
                resp = await call_provider_api(p, target_model, chat_msgs, api_key)
                choice = resp["choices"][0]
                msg = choice["message"]
                chat_msgs.append(msg)

                tool_calls = msg.get("tool_calls") or []
                if not tool_calls:
                    return {
                        "message": msg,
                        "steps": step_idx + 1,
                        "provider": p.id,
                        "model": target_model.id,
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

            return {
                "message": {"role": "assistant", "content": "Reached maximum tool execution steps."},
                "steps": max_steps,
                "provider": p.id,
                "model": target_model.id,
                "pendingApprovals": pending_approvals
            }

        except Exception as e:
            last_error = e
            continue

    if last_error:
        raise last_error
    raise ValueError("No reachable provider with valid API key found.")
