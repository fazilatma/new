#!/usr/bin/env bash
# =====================================================================
#  deploy/tests/s4-termfix-selftest.sh  v1.0
#  Checks the terminal repair path end to end, offline:
#    - s4-termfix.sh runs its own built-in --selftest
#    - the settings.json block that s4-remote.sh writes is valid python,
#      produces valid JSON, adds the "safe" profile, pins a cwd that
#      exists, injects a Termux environment, and never overwrites a
#      default profile that s4-termfix.sh already chose
#    - all three shell tools are syntax-clean and pure ASCII English
#
#    bash deploy/tests/s4-termfix-selftest.sh
# =====================================================================
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
ROOT="${TMPDIR:-/tmp}/s4-termfix-harness-$$"
mkdir -p "$ROOT"

PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL %s :: %s\n' "$1" "${2:-}"; }
a_eq()  { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "got [$2] want [$3]"; fi; }
a_has() { if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else bad "$1" "missing [$3]"; fi; }
a_lacks(){ if printf '%s' "$2" | grep -qF -- "$3"; then bad "$1" "found forbidden [$3]"; else ok "$1"; fi; }
a_file(){ if [ -f "$2" ]; then ok "$1"; else bad "$1" "no such file: $2"; fi; }

cleanup() { rm -rf "$ROOT" 2>/dev/null; }
trap cleanup EXIT INT TERM

TF="$DEPLOY/s4-termfix.sh"
RM="$DEPLOY/s4-remote.sh"
IN="$DEPLOY/s4-install.sh"
for f in "$TF" "$RM" "$IN"; do
  [ -f "$f" ] || { echo "MISSING: $f"; exit 2; }
done

echo ""
echo "== 1  the three shell tools =="
for f in "$TF" "$RM" "$IN"; do
  bash -n "$f"; a_eq "bash -n $(basename "$f")" "$?" "0"
  na=$(LC_ALL=C tr -d '\000-\177' < "$f" | wc -c | tr -d ' ')
  a_eq "$(basename "$f") is pure ASCII English" "$na" "0"
done
a_eq "s4-termfix --version" "$(bash "$TF" --version 2>&1)" "s4-termfix 1.0.0"
a_eq "s4-remote  --version" "$(bash "$RM" --version 2>&1)" "s4-remote 1.3.0"
a_eq "s4-install --version" "$(bash "$IN" --version 2>&1)" "s4-install 1.0.1"
TF_HELP="$(bash "$TF" --help 2>&1)"
a_has "s4-termfix --help explains exit code 1" "$TF_HELP" 'terminated with exit code: 1'
a_lacks "s4-termfix --help prints only the header" "$TF_HELP" 'set -u'
RM_HELP="$(bash "$RM" --help 2>&1)"
a_has "s4-remote --help documents --termfix" "$RM_HELP" '--termfix'
a_lacks "s4-remote --help prints only the header" "$RM_HELP" 'set -u'
IN_HELP="$(bash "$IN" --help 2>&1)"
a_has "s4-install --help documents --log-tail" "$IN_HELP" '--log-tail'
a_has "s4-install --help documents the fail marker" "$IN_HELP" 'S4_INSTALL=fail reason='
a_lacks "s4-install --help prints only the header" "$IN_HELP" 'set -u'

echo ""
echo "== 2  s4-termfix.sh built-in selftest =="
TF_OUT="$(timeout 300 bash "$TF" --selftest 2>&1 </dev/null)"; TF_RC=$?
a_eq "selftest exits 0" "$TF_RC" "0"
a_has "selftest passes" "$TF_OUT" 'ALL_TESTS_PASSED'
a_lacks "selftest reports no failure" "$TF_OUT" 'TESTS_FAILED'
printf '%s\n' "$TF_OUT" | sed 's/^/       /'

echo ""
echo "== 3  the settings.json block inside s4-remote.sh =="
if command -v python3 >/dev/null 2>&1; then
  # pull the python heredoc out of apply_settings and run it for real
  python3 - "$RM" "$ROOT/settings_block.py" <<'PYX'
import sys
src = open(sys.argv[1], encoding="utf-8").read().split("\n")
blocks, cur, grab = [], [], False
for line in src:
    if "python3 - <<'PY'" in line:
        grab, cur = True, []
        continue
    if grab and line.strip() == "PY":
        grab = False
        blocks.append(cur)
        continue
    if grab:
        cur.append(line)
want = [b for b in blocks if any("terminal.integrated" in l for l in b)]
if not want:
    raise SystemExit("no settings block found in " + sys.argv[1])
open(sys.argv[2], "w", encoding="utf-8").write("\n".join(want[0]) + "\n")
PYX
  a_file "extracted the settings block" "$ROOT/settings_block.py"
  python3 -c 'import ast,sys; ast.parse(open(sys.argv[1],encoding="utf-8").read())' \
    "$ROOT/settings_block.py" 2>/dev/null
  a_eq "the settings block is valid python" "$?" "0"

  PFXFAKE="$ROOT/pfx"; mkdir -p "$PFXFAKE/bin" "$PFXFAKE/tmp" "$PFXFAKE/lib"
  BASHFAKE="$PFXFAKE/bin/bash"
  S1="$ROOT/settings.json"
  printf '%s\n' '{"editor.fontSize": 18}' > "$S1"
  SETTINGS="$S1" S4_BASH="$BASHFAKE" S4_PFX="$PFXFAKE" S4_HOME="$ROOT" \
    python3 "$ROOT/settings_block.py" > "$ROOT/run1.out" 2>&1
  a_eq "first merge exits 0" "$?" "0"
  python3 -c 'import json,sys; json.load(open(sys.argv[1],encoding="utf-8"))' "$S1" 2>/dev/null
  a_eq "the result is valid JSON" "$?" "0"

  q() {
    python3 -c 'import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
v = d
for k in sys.argv[2:]:
    v = v[k]
print(v)' "$S1" "$@" 2>/dev/null
  }

  a_eq "keeps unrelated user settings" "$(q editor.fontSize)" "18"
  a_eq "default profile is the normal one" \
    "$(q terminal.integrated.defaultProfile.linux)" "Termux bash"
  a_eq "the safe profile exists" \
    "$(q terminal.integrated.profiles.linux 'Termux bash (safe)' path)" "$BASHFAKE"
  a_has "the safe profile ignores rc files" \
    "$(q terminal.integrated.profiles.linux 'Termux bash (safe)' args)" "--norc"
  a_eq "automation profile ignores rc files" \
    "$(q terminal.integrated.automationProfile.linux args)" "['--norc', '--noprofile', '-l']"
  a_eq "cwd is a directory that exists" "$(q terminal.integrated.cwd)" "$ROOT"
  a_eq "env injects PREFIX" "$(q terminal.integrated.env.linux PREFIX)" "$PFXFAKE"
  a_has "env injects a Termux PATH" "$(q terminal.integrated.env.linux PATH)" "$PFXFAKE/bin"
  a_eq "env injects TERM" "$(q terminal.integrated.env.linux TERM)" "xterm-256color"

  # a cwd that does not exist must fall back to HOME, never stay broken
  python3 - "$S1" "$ROOT/nope" <<'PYX'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
d["terminal.integrated.cwd"] = sys.argv[2]
json.dump(d, open(sys.argv[1], "w", encoding="utf-8"), indent=2)
PYX
  SETTINGS="$S1" S4_BASH="$BASHFAKE" S4_PFX="$PFXFAKE" S4_HOME="$ROOT" \
    python3 "$ROOT/settings_block.py" > "$ROOT/run2.out" 2>&1
  a_eq "re-merge exits 0" "$?" "0"
  a_eq "a dangling cwd is replaced by HOME" "$(q terminal.integrated.cwd)" "$ROOT"

  # a default chosen by s4-termfix.sh must survive a later s4-remote run
  python3 - "$S1" <<'PYX'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
d["terminal.integrated.defaultProfile.linux"] = "Termux bash (safe)"
json.dump(d, open(sys.argv[1], "w", encoding="utf-8"), indent=2)
PYX
  SETTINGS="$S1" S4_BASH="$BASHFAKE" S4_PFX="$PFXFAKE" S4_HOME="$ROOT" \
    python3 "$ROOT/settings_block.py" > "$ROOT/run3.out" 2>&1
  a_eq "the safe default is preserved" \
    "$(q terminal.integrated.defaultProfile.linux)" "Termux bash (safe)"

  # a bogus default is replaced, not kept
  python3 - "$S1" <<'PYX'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
d["terminal.integrated.defaultProfile.linux"] = "/bin/sh that does not exist"
json.dump(d, open(sys.argv[1], "w", encoding="utf-8"), indent=2)
PYX
  SETTINGS="$S1" S4_BASH="$BASHFAKE" S4_PFX="$PFXFAKE" S4_HOME="$ROOT" \
    python3 "$ROOT/settings_block.py" > "$ROOT/run4.out" 2>&1
  a_eq "an impossible default is replaced" \
    "$(q terminal.integrated.defaultProfile.linux)" "Termux bash"
else
  echo "  skip settings assertions (no python3)"
fi

echo ""
echo "== 4  the installer's failure marker =="
BOGUS="$(bash "$IN" --definitely-not-a-flag 2>&1 </dev/null)"; BRC=$?
a_eq "a bad flag exits 1" "$BRC" "1"
a_has "a bad flag prints S4_INSTALL=fail reason=" "$BOGUS" 'S4_INSTALL=fail reason='

printf '\n========================================\n'
printf 'passed=%s  failed=%s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then echo TESTS_FAILED; exit 1; fi
echo ALL_TESTS_PASSED
