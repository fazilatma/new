# `ops/` — the instruction channel for the device agent

`deploy/s4-agent.sh` is **frozen**: it is installed once on the device and never
changes. Everything that changes lives here.

| file | role |
|---|---|
| `ops/round.txt` | one line: the id of the current round. The agent polls it. A new id ⇒ a new round runs. |
| `ops/next.sh` | the instructions for that round (plain bash). |
| `deploy/s4-agent.sh` | the frozen agent (protocol `s4-agent/1`). |
| `deploy/s4-report.sh` | one-shot diagnostics, no loop (still useful). |

## The loop

```
device                                GitHub
──────                                ──────
bash s4-agent.sh --loop
  │ poll ops/round.txt ──────────────► raw.githubusercontent / api contents
  │ id changed?
  │ fetch ops/next.sh ───────────────►
  │ snapshot ~/.s4-run, mirror deploy.php + scraper4.php out of ~/storage/shared/codes
  │ run ops/next.sh   (no token in env, hard timeout, refuse-list)
  │ collect evidence  (stdout, files created, php -l, error log, HTTP probes)
  │ redact secrets
  └ upload ──────────────────────────► branch device-reports
                                        reports/<host>/LATEST.md
                                        reports/<host>/round-<id>.md
                                        reports/<host>/status.json
                                        (and reports/<host>/deploy.php.txt with --with-src)
agent reads LATEST.md via the GitHub API, writes the next ops/round.txt + ops/next.sh
…repeat until a round prints S4_ROUND_STATUS=success → the loop stops itself.
```

Reports go to `device-reports`, never to a branch a host auto-deploys from.

## Contract for a round script (`ops/next.sh`)

* Runs with `bash`, cwd = the run dir (`~/.s4-run`, internal storage).
* **No GitHub token in its environment** — the agent strips it.
* Source `$S4_HELPERS` to get the stable toolkit.
* Print a short summary to stdout (it becomes the report's "Round output").
* Push long listings/log tails into `$S4_REPORT` with `s4_note`/`s4_ls`/`s4_tail`.
* Finish with `s4_done success|failed|needs-input`.

Environment provided: `S4_ROUND_ID S4_SRCDIR S4_RUNDIR S4_STATE S4_HELPERS
S4_REPORT S4_LOG S4_PORT S4_HOST_SLUG S4_REPO S4_SRC_BRANCH S4_RAWBASE
S4_MIRROR S4_SRC_SHARED`.

Helpers: `s4_say s4_note s4_hr s4_md5 s4_size s4_have s4_php s4_lint s4_backup
s4_patch s4_write s4_try_server s4_serve s4_stop_server s4_curl s4_ls s4_tail
s4_head s4_grep s4_probe_dir s4_dl s4_done`.

## Device side

```sh
curl -fsSL -o ~/s4-agent.sh \
  https://raw.githubusercontent.com/fazilatma/new/arena/f5a628bb-new/deploy/s4-agent.sh
bash ~/s4-agent.sh --loop            # polls every 30 s
bash ~/s4-agent.sh --once --force    # single round, even if the id did not change
bash ~/s4-agent.sh --dry-run         # show what the round would do, run nothing
bash ~/s4-agent.sh --rollback        # restore the newest snapshot of ~/.s4-run
bash ~/s4-agent.sh --with-src        # also upload deploy.php for review
```

Other projects: `--repo owner/name --src-branch B --ops-dir ops --srcdir DIR
--mirror "a.php b.php"`, or write those keys once into `~/.s4-agent/config`.

## Safety

* the round script runs with no token, under `timeout`, output captured;
* refuse-list aborts rounds containing `rm -rf /`, `mkfs`, `dd of=/dev/…`, fork bombs;
* `bash -n` on the round script before executing it;
* `~/.s4-run` is tar-snapshotted before every round (last 5 kept), `--rollback` restores;
* your source folder is **never** modified in place — the agent copies out of it;
* every uploaded byte passes a secret redaction pass.
