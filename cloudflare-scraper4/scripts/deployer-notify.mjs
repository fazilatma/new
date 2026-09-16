// OS-level announcements for the local deployer.
//
// The deployer spends its life in the background — a Termux session on a phone, a pm2 process on a
// VPS — so when a branch scan finds a version newer than what is installed, telling only its own
// log means telling nobody. This module turns that event into a real system notification using
// whichever notifier the platform already has, and stays silent-but-explanatory when there is
// none: the browser page announces the same event through the Notifications API, which reaches the
// OS notification centre once permission is granted.
//
// Kept as a separate module (like py-extract-run.mjs) so the selection logic is testable without
// starting a server, and so the deployer never blocks on a missing notifier.
export const OFF_VALUES = /^(?:false|0|no|off)$/i;

/** `LOCAL_DEPLOYER_NOTIFY` is on unless someone said otherwise, in any of the words people type. */
export function notifyEnabledFor(value) {
  return !OFF_VALUES.test(String(value ?? 'true').trim());
}

const quote = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 180);

/**
 * The notifier to use, or null when the machine has none.
 *
 * `LOCAL_DEPLOYER_NOTIFY_CMD` forces a program (its arguments are appended, never interpolated into
 * a shell string, so a branch name with a quote in it cannot become code). Otherwise: Termux's
 * termux-notification, Linux's notify-send, macOS' osascript, Windows' PowerShell toast.
 */
export function pickNotifyChannel({ platform = process.platform, env = {} } = {}) {
  const forced = String(env.LOCAL_DEPLOYER_NOTIFY_CMD || '').trim();
  const forcedWords = tokenizeCommand(forced);
  if (forcedWords.length) {
    // Anything written after the program becomes its leading arguments; the message is appended,
    // never interpolated, so `sh hook.sh` works and a quote inside a title stays data.
    return {
      id: 'custom',
      label: forced,
      build: (title, body) => ({ command: forcedWords[0], args: forcedWords.slice(1).concat([quote(title), quote(body)]) })
    };
  }
  const termux = platform === 'android' || /com\.termux/i.test(String(env.PREFIX || '')) || Boolean(env.TERMUX_VERSION);
  if (termux) {
    return {
      id: 'termux',
      // -T picks the channel, --priority makes it interrupt do-not-disturb like an alert should,
      // --result keeps the notification tappable so termux-notification-return can bring the UI back.
      label: 'termux-notification',
      build: (title, body) => ({
        command: 'termux-notification',
        args: ['--title', quote(title), '--content', quote(body), '--priority', 'high', '--channel', 'Scraper4', '--id', 'scraper4-update']
      })
    };
  }
  if (platform === 'linux') {
    return {
      id: 'notify-send',
      // urgency critical: a version notice should not be buried in the silent summary.
      label: 'notify-send',
      build: (title, body) => ({
        command: 'notify-send',
        args: ['--app-name', 'Scraper4', '--urgency', 'critical', '--expire-time', '15000', quote(title), quote(body)]
      })
    };
  }
  if (platform === 'darwin') {
    return {
      id: 'osascript',
      label: 'macOS notification',
      build: (title, body) => ({
        command: '/usr/bin/osascript',
        args: ['-e', `display notification ${JSON.stringify(quote(body))} with title ${JSON.stringify(quote(title))} sound name "Glass"`]
      })
    };
  }
  if (platform === 'win32') {
    return {
      id: 'powershell',
      label: 'Windows toast',
      build: (title, body) => ({
        command: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command',
          '[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null;'
          + '$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(2);'
          + `$x=[xml]"<toast><visual><binding template='ToastGeneric'><text>${escapeXml(title)}</text><text>${escapeXml(body)}</text></binding></visual></toast>";`
          + '$n=[Windows.UI.Notifications.ToastNotification]::new($x);'
          + '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Scraper4").Show($n)']
      })
    };
  }
  return null;
}

function escapeXml(value) {
  return quote(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Split a command line into words, honouring quoted program paths (`"/data/data/com.termux/… /x.sh"`).
 * No shell is involved: the words become argv directly, which is what keeps a branch title containing
 * a quote from turning into code.
 */
export function tokenizeCommand(value) {
  const raw = String(value == null ? '' : value).trim();
  const out = [];
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (/\s/.test(c)) { i++; continue; }
    const quoteChar = c === '"' || c === "'" ? c : '';
    let word = '';
    i += quoteChar ? 1 : 0;
    while (i < raw.length) {
      if (quoteChar && raw[i] === quoteChar) { i++; break; }
      if (!quoteChar && /\s/.test(raw[i])) break;
      word += raw[i];
      i++;
    }
    if (word) out.push(word);
  }
  return out;
}

/**
 * One stable identity per event, so a scanner that runs every minute cannot spam the same notice.
 * A branch that moves its tip gets a new key (new sha); a branch that only re-reports the same
 * commit gets the same key and is skipped.
 */
export function notifyKey(kind, info = {}) {
  return [kind, info.name || '', info.version || '', String(info.sha || '').slice(0, 12)].join(':');
}

/** Which announcements this scan justifies. Pure: takes the scan state, returns ready-to-send items. */
export function pendingNotices({ branchState = {}, code = {}, installedVersion = '', seen = new Set() } = {}) {
  const out = [];
  const latest = branchState.latest || null;
  const current = branchState.current || {};
  if (latest && latest.hasCode !== false && latest.version) {
    const key = notifyKey('branch', latest);
    const behindBranch = latest.name !== (current.branch || '') && compareVersion(latest.version, installedVersion) > 0;
    const movedCurrent = latest.name === (current.branch || '') && Boolean(latest.sha) && latest.sha !== (current.sha || '');
    if ((behindBranch || movedCurrent) && !seen.has(key)) {
      out.push({
        key,
        kind: behindBranch ? 'newer-branch' : 'new-commit',
        title: behindBranch ? `Scraper4 ${latest.version} available` : `New commits on ${latest.name}`,
        body: behindBranch
          ? `Branch ${latest.name} has v${latest.version}; this machine runs ${installedVersion || 'nothing installed'}. Open the deployer to install it.`
          : `${latest.name} moved to ${String(latest.sha || '').slice(0, 7)} while this checkout stays behind.`
      });
    }
  }
  if (code && code.stale && code.onDisk) {
    const key = notifyKey('disk', { name: 'checkout', version: code.onDisk, sha: code.diskHead });
    if (!seen.has(key)) {
      out.push({
        key,
        kind: 'restart-needed',
        title: `Scraper4 ${code.onDisk} is on disk, not running`,
        body: `The local build still serves ${code.running || 'an older version'}. Rebuild and restart it from the deployer.`
      });
    }
  }
  return out;
}

/**
 * Major/minor/patch over the numeric core, ignoring a `-rc` suffix or the agent release marker `+`.
 * This is deliberately the same rule `numericCore` in worker-src/deployer-branches.ts uses to rank
 * branches: if the two disagreed, a version could be announced as new while the branch table called
 * it equal, and 1.182.0 vs 1.182.0+ must stay equal for exactly that reason.
 */
export function compareVersion(a, b) {
  const parts = value => {
    const core = String(value == null ? '' : value).trim().replace(/^v/i, '').split(/[-+]/)[0];
    const nums = core.split('.').map(Number);
    return nums.length === 3 && nums.every(Number.isFinite) ? nums : null;
  };
  const x = parts(a), y = parts(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Send one notification. Never throws and never takes longer than `timeoutMs`: a machine without
 * the notifier (a headless VPS) must keep scanning, and a hanging notify-send must not hold the
 * scan loop. The outcome is returned so the UI can say what happened.
 */
export async function sendNotification(channel, title, body, { spawn, timeoutMs = 4000 } = {}) {
  if (!channel) return { ok: false, channel: 'none', error: 'no system notifier on this machine' };
  const built = channel.build(title, body);
  if (!built || !built.command) return { ok: false, channel: channel.id, error: 'notifier has no command' };
  const launcher = spawn || (await import('node:child_process')).spawn;
  return await new Promise(resolve => {
    let settled = false;
    let stderr = '';
    let child;
    try {
      child = launcher(built.command, built.args || [], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, detached: false });
    } catch (error) {
      resolve({ ok: false, channel: channel.id, error: String(error?.message || error) });
      return;
    }
    const finish = result => { if (!settled) { settled = true; try { if (timer) clearTimeout(timer); } catch {} resolve(result); } };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish({ ok: false, channel: channel.id, error: `timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    child.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-400); });
    child.on('error', error => finish({ ok: false, channel: channel.id, error: String(error?.code || error?.message || error) }));
    child.on('close', code => finish(code === 0
      ? { ok: true, channel: channel.id, label: channel.label }
      : { ok: false, channel: channel.id, error: `exit ${code}${stderr ? ': ' + stderr.trim() : ''}` }));
  });
}

/** Keep a small ring of announcements so the page and the dashboard can show what was sent when. */
export function pushNotice(log, entry, max = 20) {
  log.unshift(entry);
  if (log.length > max) log.length = max;
  return log;
}
