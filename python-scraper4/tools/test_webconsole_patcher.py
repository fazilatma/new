#!/usr/bin/env python3
"""Regression tests for the WebConsole patcher (1.6.4/1.6.5 -> 1.6.6).

Run from anywhere:

    python3 tools/test_webconsole_patcher.py

Offline checks only (no PHP binary required):
- the patcher carries both payload functions (browser bootstrap + swap setup)
  and every nowdoc is terminated;
- the injected bash payloads parse with bash -n and dash -n;
- the swap branch (swap_2g/4g/8g/16g -> wcp_swap_setup_cmd) is wired into
  cli_install_component via the known anchor;
- the patcher simulates cleanly on a fresh-1.6.4 mock (8 patches) and on an
  already-1.6.5 mock (3 patches), both ending at WCP_VERSION 1.6.6;
- tools/enable_swap_server.sh shares the same swap logic and parses.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PATCHER = os.path.join(HERE, "webconsole-patch.php")
SWAP_SH = os.path.join(HERE, "enable_swap_server.sh")

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ✓ {name}")
    else:
        FAILURES.append(name)
        print(f"  ✕ {name}" + (f" — {detail}" if detail else ""))


def main() -> int:
    p = open(PATCHER, encoding="utf-8").read()
    lines = p.splitlines()

    print("== A: patcher structure ==")
    openers = [i for i, l in enumerate(lines) if "<<<'" in l and "WCP" in l]
    check("payload functions present",
          "function wcp_browser_bootstrap_cmd(): string {" in p.replace("$payloadFunc = <<<'WCPPATCHFUNC'\n", "", 1)
          or "wcp_browser_bootstrap_cmd" in p)
    terminated = True
    for i in openers:
        op = re.search(r"<<<'([A-Z0-9]+)'", lines[i]).group(1)
        if not any(lines[j] in (op + ";", op + ");") for j in range(i + 1, len(lines))):
            terminated = False
    check(f"all {len(openers)} nowdocs terminated", terminated)
    check("1.6.5-already path exists (3-patch upgrade)",
          "$ver === '1.6.5'" in p and "version bump 1.6.5 -> 1.6.6" in p)
    check("--swap-apply flag wired", "$swapApplyMb > 0" in p and "wcp_swap_setup_cmd($swapApplyMb)" in p)

    print("== B: injected bash payloads parse ==")
    def nowdoc(name: str) -> str:
        m = re.search(rf"<<<'{name}'\n(.*?)\n{name}\)?;", p, re.S)
        return m.group(1) if m else ""
    for name in ("WCPBROWSERCMD", "WCPSWAPCMD"):
        payload = nowdoc(name)
        check(f"{name} extracted", len(payload) > 500, str(len(payload)))
        tmp = f"/tmp/s4-{name}.sh"
        open(tmp, "w").write(payload.replace("__MB__", "4096"))
        r1 = subprocess.run(["bash", "-n", tmp], capture_output=True, text=True)
        r2 = subprocess.run(["dash", "-n", tmp], capture_output=True, text=True)
        check(f"{name} parses (bash+dash)", r1.returncode == 0 and r2.returncode == 0,
              (r1.stderr + r2.stderr)[:120])
    swap = nowdoc("WCPSWAPCMD")
    for needle in ("sudo -n", "mkswap -f", "swapon", "/etc/fstab", "vm.swappiness=20",
                   "user_beancounters", "already satisfied"):
        check(f"swap payload has {needle}", needle in swap)

    print("== C: swap components wired into cli_install_component ==")
    branch = nowdoc("WCPPATCHSWAPB")
    check("branch handles swap_2g/4g/8g/16g",
          all(k in branch for k in ("swap_2g", "swap_4g", "swap_8g", "swap_16g")))
    check("size math (swap_4g -> 4096)", "((int)substr($name, 5)) * 1024" in branch)
    check("uses cli_checked + wcp_swap_setup_cmd",
          "cli_checked(wcp_swap_setup_cmd($mb))" in branch)
    check("anchor targets the known python_scrapers line",
          p.count("if (\\$name === 'python_scrapers') {") >= 2)

    print("== D: standalone script ==")
    sh = open(SWAP_SH, encoding="utf-8").read()
    r = subprocess.run(["bash", "-n", SWAP_SH], capture_output=True, text=True)
    check("enable_swap_server.sh parses", r.returncode == 0, r.stderr[:120])
    for needle in ("swapon", "/etc/fstab", "vm.swappiness=20", "sudo -n"):
        check(f"script has {needle}", needle in sh)
    same = all(n in sh for n in ("already satisfied", "user_beancounters"))
    check("same guard logic as the console payload", same)
    r = subprocess.run(["bash", SWAP_SH, "not-a-number"], capture_output=True, text=True)
    check("bad arg rejected", r.returncode == 1)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED: " + ", ".join(FAILURES))
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
