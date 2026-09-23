#!/usr/bin/env python3
"""Regression tests for the WebConsole patcher (1.6.4/1.6.5/1.6.6 -> 1.6.7).

Run from anywhere:

    python3 tools/test_webconsole_patcher.py

Offline checks only (no PHP binary required):
- the patcher carries all payload functions (browser bootstrap, swap setup,
  self-update, companion tools page) and every nowdoc is terminated;
- the injected bash payloads parse with bash -n and dash -n;
- the swap (swap_2g/4g/8g/16g) and self-update (selfupdate_check/apply)
  branches are wired into cli_install_component via the known anchor;
- the embedded companion equals the committed tools/webconsole-tools.php;
- the patcher simulates cleanly on fresh-1.6.4 (10 patches), already-1.6.5
  (5 patches) and already-1.6.6 (3 patches) mocks, all ending at 1.6.7;
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
TOOLS = os.path.join(HERE, "webconsole-tools.php")

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
    terminated = True
    for i in openers:
        op = re.search(r"<<<'([A-Z0-9]+)'", lines[i]).group(1)
        if not any(lines[j] in (op + ";", op + ");") for j in range(i + 1, len(lines))):
            terminated = False
    check(f"all {len(openers)} nowdocs terminated", terminated)
    check("version matrix (1.6.4/1.6.5/1.6.6 -> 1.6.7)",
          all(v in p for v in ("'1.6.4'", "'1.6.5'", "'1.6.6'", "'1.6.7'"))
          and "$ver === '1.6.5'" in p and "$ver === '1.6.6'" in p)
    check("--tools flag wired", "$toolsOnly" in p and "wcp_write_tools_file($dir, $key)" in p)
    check("--swap-apply flag wired", "$swapApplyMb > 0" in p and "wcp_swap_setup_cmd($swapApplyMb)" in p)

    def nowdoc(name: str) -> str:
        m = re.search(rf"<<<'{name}'\n(.*?)\n{name}\)?;", p, re.S)
        return m.group(1) if m else ""

    print("== B: injected bash payloads parse ==")
    for name in ("WCPBROWSERCMD", "WCPSWAPCMD", "WCPSELFCMD"):
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
    selfcmd = nowdoc("WCPSELFCMD")
    for needle in ("selfupdate.conf", "raw.githubusercontent.com", "php -l", "cp -a",
                   "WCP_VERSION", "APPLY"):
        check(f"self-update payload has {needle}", needle in selfcmd)

    print("== C: components wired into cli_install_component ==")
    swapb = re.search(r"\$swapBranch = <<<'WCPPATCHSWAPB'\n(.*?)\nWCPPATCHSWAPB;", p, re.S)
    selfb = re.search(r"\$selfBranch = <<<'WCPPATCHSELFB'\n(.*?)\nWCPPATCHSELFB;", p, re.S)
    swapb = swapb.group(1) if swapb else ""
    selfb = selfb.group(1) if selfb else ""
    check("swap branch handles swap_2g/4g/8g/16g",
          all(k in swapb for k in ("swap_2g", "swap_4g", "swap_8g", "swap_16g")))
    check("swap size math", "((int)substr($name, 5)) * 1024" in swapb)
    check("swap uses cli_checked + wcp_swap_setup_cmd", "cli_checked(wcp_swap_setup_cmd($mb))" in swapb)
    check("self-update branch handles check+apply",
          "selfupdate_check" in selfb and "selfupdate_apply" in selfb)
    check("apply mode passes APPLY=1", "APPLY=1" in selfb)
    check("both branches anchor on the known python_scrapers line",
          p.count("if (\\$name === 'python_scrapers') {") >= 4)
    check("base deploy/browser set intact",
          all(s in p for s in ("$oldD, $newD", "$oldE1, $newE1", "$oldE2, $newE2", "$oldC, $newC")))

    print("== D: companion tools page ==")
    tools = open(TOOLS, encoding="utf-8").read().rstrip("\n")
    check("committed companion exists", len(tools) > 5000, str(len(tools)))
    check("embedded companion equals the committed file", nowdoc("WCPTOOLSFILE") == tools)
    for needle in ("hash_equals", "raw.githubusercontent.com", "api.github.com/repos",
                   "selfupdate.conf", "github-files", "wcp-random" if False else "bin2hex(random_bytes"):
        check(f"companion has {needle}", needle in tools)
    check("companion never trusts repo/branch/path input",
          "clean_repo" in tools and "clean_branch" in tools and "clean_path" in tools)
    check("companion guards path traversal", "strpos($v, '..')" in tools)

    print("== E: upgrade-path simulations ==")
    def sim(start_ver: str, apply_sets: list[tuple[str, list[tuple[str, str]]]], label: str, n: int) -> None:
        mock = ("""<?php
define('WCP_VERSION', '%s');
function default_install_cmd(string $type): string {
    $cmd .= ' && (pip3 install --break-system-packages --ignore-installed flask requests beautifulsoup4 lxml python-dotenv basalam-sdk selectolax html5lib psutil --no-warn-script-location 2>/dev/null || true); fi';
    return $cmd;
}
function proj_perform_deploy(string $id): array {
    $dest = '/tmp/x';
    foreach (['install' => ($p['install_cmd'] ?: default_install_cmd($p['type'])), 'build' => $p['build_cmd']] as $label => $cmd) {
        if (trim($cmd) === '') continue;
        cli_log("step");
    }
    return proj_all();
}
function cli_install_component(string $name): void {
    if ($name === 'browser_deps') {
        cli_log("📦 Installing headless-browser OS dependencies...");
        cli_log("✓ Headless browser dependencies installed.");
    }
    if ($name === 'python_scrapers') {
        cli_log("🐍 Installing Python scraping packages...");
        cli_log("✓ Python scraping packages installed successfully.");
    }
}
""" % start_ver)
        anchor = "    if ($name === 'python_scrapers') {"
        dfn = 'function default_install_cmd(string $type): string {'
        pool: dict[str, tuple[str, str]] = {
            "ver": (f"define('WCP_VERSION', '{start_ver}');", "define('WCP_VERSION', '1.6.7');"),
            "func": (dfn, nowdoc("WCPPATCHFUNC") + dfn),
            "base": None, "swap": (anchor, swapb + anchor), "swapfn": (dfn, nowdoc("WCPPATCHSWAP") + dfn),
            "self": (anchor, selfb + anchor), "selffn": (dfn, nowdoc("WCPPATCHSELF") + dfn),
        }
        pool["base"] = (nowdoc("WCPPATCHD"), nowdoc("WCPPATCHDN"))
        base = [pool["base"],
                (nowdoc("WCPPATCHE1"), nowdoc("WCPPATCHE1N")),
                (nowdoc("WCPPATCHE2"), nowdoc("WCPPATCHE2N")),
                (nowdoc("WCPPATCHC"), nowdoc("WCPPATCHCN"))]
        patches: list[tuple[str, str]] = [pool["ver"]]
        if "func" in apply_sets:
            patches.append(pool["func"])
        if "base" in apply_sets:
            patches += base
        if "swap" in apply_sets:
            patches += [pool["swap"], pool["swapfn"]]
        if "self" in apply_sets:
            patches += [pool["self"], pool["selffn"]]
        src = mock
        for o, nw in patches:
            c = src.count(o)
            assert c == 1, f"{label}: anchor count={c}"
            src = src.replace(o, nw)
        okv = "define('WCP_VERSION', '1.6.7');" in src
        # which helpers the patcher adds depends on the starting version
        # (a real 1.6.5 file already carries the browser function, etc.)
        need = ["function wcp_selfupdate_cmd()"]
        if start_ver == "1.6.4":
            need += ["function wcp_browser_bootstrap_cmd()", "function wcp_swap_setup_cmd(int $mb)"]
        if start_ver == "1.6.5":
            need += ["function wcp_swap_setup_cmd(int $mb)"]
        okf = all(f in src for f in need)
        check(f"{label} ({n} patches -> 1.6.7, helpers added)", okv and okf)

    sim("1.6.4", ["func", "base", "swap", "self"], "fresh 1.6.4", 10)
    sim("1.6.5", ["swap", "self"], "already 1.6.5", 5)
    sim("1.6.6", ["self"], "already 1.6.6", 3)

    print("== F: standalone swap script ==")
    sh = open(SWAP_SH, encoding="utf-8").read()
    r = subprocess.run(["bash", "-n", SWAP_SH], capture_output=True, text=True)
    check("enable_swap_server.sh parses", r.returncode == 0, r.stderr[:120])
    for needle in ("swapon", "/etc/fstab", "vm.swappiness=20", "sudo -n", "already satisfied"):
        check(f"script has {needle}", needle in sh)
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
