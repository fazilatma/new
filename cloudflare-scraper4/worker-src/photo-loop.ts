/**
 * Product photo feedback loop (source image -> Basalam file id).
 *
 * Why: Basalam answers `422 {"fields":["photo"],"message":"شناسه تصویر الزامی است"}` when a create
 * carries no photo id. The old uploader hid the reason — a source image that answered 403 (hotlink
 * protection) or returned an HTML page was skipped with a bare `continue`, so the panel reported
 * «this product has no image at all» even for products whose image URL was perfectly recorded.
 * Three very different causes produced one misleading sentence.
 *
 * So the photo pipeline became a loop like the others: every step asks one question, reads the real
 * answer and the answer picks the next step — a 403 on the download means "ask again as a browser
 * with a Referer", a 404 means "try the next candidate image", a 422 from the upload means "try the
 * next multipart shape", a 401/403 from the upload means "stop, this is the token". The winning
 * download shape per source host and the winning upload shape are learned and reused.
 *
 * Runtime free (same contract as api-loop.ts): transports are injected, so both runtimes share this
 * file and the lab can run the whole loop with no network.
 */

export type PhotoVerdict = 'ok' | 'empty' | 'not-image' | 'forbidden' | 'missing' | 'too-large' | 'auth' | 'payload' | 'throttled' | 'server' | 'network';

export type PhotoAttempt = {
  stage: 'download' | 'upload';
  candidate: string;
  shape: string;
  shapeLabel: string;
  status: number;
  bytes: number;
  verdict: PhotoVerdict;
  note: string;
};

export type PhotoReport = {
  ok: boolean;
  ids: number[];
  candidates: string[];
  attempts: PhotoAttempt[];
  /** Machine readable cause, used to choose the Persian sentence and whether a create may proceed. */
  cause: 'ok' | 'no-candidate' | 'download-blocked' | 'download-missing' | 'upload-auth' | 'upload-rejected' | 'network';
  reason: string;
  advice: string;
};

export type DownloadAnswer = { status: number; contentType?: string; bytes?: number; data?: unknown; error?: string };
export type UploadAnswer = { status: number; body?: any; error?: string };

export type DownloadShape = { id: string; label: string; headers: Record<string, string> };
export type UploadShape = { id: string; label: string; path: string; fileField: string; fields: Record<string, string> };

export type PhotoLoopDeps = {
  base: string;
  /** Page the image belongs to; some shops only serve images with a matching Referer. */
  referer?: string;
  limit?: number;
  download: (url: string, shape: DownloadShape) => Promise<DownloadAnswer>;
  upload: (url: string, shape: UploadShape, file: { data: unknown; name: string; bytes: number }) => Promise<UploadAnswer>;
  getState?: (key: string, fallback: any) => Promise<any>;
  setState?: (key: string, value: any) => Promise<void>;
};

export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const PLACEHOLDER = /(^|[/_-])(placeholder|loading|lazy|blank|spacer|no[-_]?image|default)([._-]|$)/i;

export const photoDownloadKey = (host: string) => 'photo.download:' + host;
export const photoUploadKey = () => 'photo.upload:basalam';

/** Absolute, de-duplicated, plausible image URLs — relative paths resolved against the product page. */
export function photoCandidates(product: { image?: string; images?: string[]; link?: string }, limit = 3): string[] {
  const raw = [product?.image, ...(product?.images || [])].map(value => String(value || '').trim()).filter(Boolean);
  const out: string[] = [];
  for (const value of raw) {
    if (/^data:/i.test(value)) continue;                      // inline placeholder, never a real photo
    if (/\.svg($|\?)/i.test(value)) continue;                 // Basalam rejects vector files
    if (PLACEHOLDER.test(value.split('?')[0].split('/').pop() || '')) continue;
    let url = value;
    if (!/^https?:\/\//i.test(url)) {
      if (!product?.link) continue;
      try { url = new URL(url, product.link).toString(); } catch { continue; }
    }
    if (!out.includes(url)) out.push(url);
    if (out.length >= Math.max(1, limit)) break;
  }
  return out;
}

export function downloadShapes(referer?: string): DownloadShape[] {
  const shapes: DownloadShape[] = [{ id: 'plain', label: 'درخواست ساده', headers: { accept: 'image/*' } }];
  if (referer) shapes.push({ id: 'referer', label: 'مرورگر + Referer صفحهٔ محصول', headers: { accept: 'image/avif,image/webp,image/*,*/*;q=0.8', 'user-agent': BROWSER_UA, referer, 'accept-language': 'fa-IR,fa;q=0.9,en;q=0.8' } });
  shapes.push({ id: 'browser', label: 'مرورگر بدون Referer', headers: { accept: 'image/avif,image/webp,image/*,*/*;q=0.8', 'user-agent': BROWSER_UA, 'accept-language': 'fa-IR,fa;q=0.9,en;q=0.8' } });
  return shapes;
}

export function uploadShapes(): UploadShape[] {
  return [
    { id: 'file+type', label: 'multipart: file + file_type=product.photo', path: '/files', fileField: 'file', fields: { file_type: 'product.photo' } },
    { id: 'file', label: 'multipart: فقط file', path: '/files', fileField: 'file', fields: {} },
    { id: 'file+custom', label: 'multipart: file + file_type + custom_unique_name', path: '/files', fileField: 'file', fields: { file_type: 'product.photo', custom_unique_name: 'false' } }
  ];
}

/** Basalam has answered with the id at several depths over the years; accept all of them. */
export function readFileId(body: any): number {
  const seen = [body?.id, body?.data?.id, body?.file?.id, body?.photo?.id, body?.result?.id, body?.data?.file?.id, body?.data?.photo?.id];
  for (const value of seen) { const id = Number(value); if (Number.isFinite(id) && id > 0) return id; }
  return 0;
}

export function classifyDownload(answer: DownloadAnswer): { verdict: PhotoVerdict; note: string } {
  if (answer.error && !answer.status) return { verdict: 'network', note: 'دریافت نشد: ' + answer.error };
  const status = Number(answer.status || 0), bytes = Number(answer.bytes || 0), type = String(answer.contentType || '').toLowerCase();
  if (status === 401 || status === 403) return { verdict: 'forbidden', note: 'سایت مبدأ دانلود تصویر را رد کرد (' + status + ').' };
  if (status === 404 || status === 410) return { verdict: 'missing', note: 'این آدرس تصویر دیگر وجود ندارد (' + status + ').' };
  if (status === 429) return { verdict: 'throttled', note: 'محدودیت نرخ هنگام دانلود تصویر (۴۲۹).' };
  if (status >= 500) return { verdict: 'server', note: 'خطای سرور مبدأ هنگام دانلود تصویر (' + status + ').' };
  if (status !== 200) return { verdict: 'payload', note: 'پاسخ غیرمنتظرهٔ ' + status + ' هنگام دانلود تصویر.' };
  // Some CDNs serve images as application/octet-stream, so only an obvious document counts as a miss.
  if (/html|json|xml|text\//.test(type)) return { verdict: 'not-image', note: 'به‌جای تصویر، ' + type + ' برگشت (معمولاً صفحهٔ خطا یا ورود).' };
  if (bytes < 1024) return { verdict: 'empty', note: 'فایل برگشت ولی فقط ' + bytes + ' بایت بود.' };
  return { verdict: 'ok', note: 'تصویر با ' + bytes + ' بایت دانلود شد.' };
}

export function classifyUpload(answer: UploadAnswer): { verdict: PhotoVerdict; note: string; id: number } {
  if (answer.error && !answer.status) return { verdict: 'network', note: 'آپلود انجام نشد: ' + answer.error, id: 0 };
  const status = Number(answer.status || 0), id = readFileId(answer.body);
  const message = String(answer.body?.message || answer.body?.error || (Array.isArray(answer.body?.messages) ? answer.body.messages.map((m: any) => m?.message).filter(Boolean).join('، ') : '') || '').slice(0, 120);
  if (status >= 200 && status < 300) {
    if (id > 0) return { verdict: 'ok', note: 'شناسهٔ فایل ' + id + ' گرفته شد.', id };
    return { verdict: 'payload', note: 'آپلود ۲۰۰ بود ولی هیچ شناسه‌ای در پاسخ نبود.' + (message ? ' ' + message : ''), id: 0 };
  }
  if (status === 401) return { verdict: 'auth', note: 'توکن غرفه برای آپلود فایل پذیرفته نشد (۴۰۱).', id: 0 };
  if (status === 403) return { verdict: 'auth', note: 'توکن اجازهٔ آپلود فایل (scope) را ندارد (۴۰۳).', id: 0 };
  if (status === 404) return { verdict: 'missing', note: 'آدرس آپلود پیدا نشد (۴۰۴)؛ شکل بعدی امتحان می‌شود.', id: 0 };
  if (status === 413) return { verdict: 'too-large', note: 'حجم تصویر برای باسلام زیاد بود (۴۱۳).', id: 0 };
  if (status === 429) return { verdict: 'throttled', note: 'محدودیت نرخ آپلود (۴۲۹).', id: 0 };
  if (status >= 500) return { verdict: 'server', note: 'خطای سرور باسلام هنگام آپلود (' + status + ').', id: 0 };
  return { verdict: 'payload', note: 'باسلام فایل را نپذیرفت (' + status + ')' + (message ? ': ' + message : '.'), id: 0 };
}

export function summarizePhotoAttempts(attempts: PhotoAttempt[]): string {
  return attempts.map(a => (a.stage === 'download' ? '⬇ ' : '⬆ ') + a.shape + ' → ' + (a.status || 'بی‌پاسخ') + '/' + a.verdict).join(' | ');
}

export function photoAdvice(cause: PhotoReport['cause'], attempts: PhotoAttempt[]): string {
  const last = attempts.filter(a => a.verdict !== 'ok').slice(-1)[0];
  if (cause === 'ok') return 'تصویرها آپلود شدند.';
  if (cause === 'no-candidate') return 'هیچ آدرس تصویری برای این محصول ذخیره نشده است؛ سلکتور تصویر همین پروفایل (و استخراج جزئیات) را بررسی کنید. تا وقتی تصویر نباشد باسلام محصول تازه را نمی‌پذیرد.';
  if (cause === 'download-blocked') return 'آدرس تصویر ثبت شده ولی سایت مبدأ دانلود آن را رد می‌کند (هات‌لینک بسته است). حلقه با Referer صفحهٔ محصول و هدرهای مرورگر هم امتحان کرد و باز هم رد شد؛ برای این منبع باید تصویر از مسیر واسط (Worker/VPS) گرفته شود.';
  if (cause === 'download-missing') return 'آدرس تصویرِ ذخیره‌شده دیگر روی سایت مبدأ وجود ندارد؛ این محصول را دوباره استخراج کنید تا آدرس تازه بگیرد.';
  if (cause === 'upload-auth') return 'دانلود تصویر موفق بود ولی باسلام آپلود را با خطای دسترسی رد کرد؛ توکن این غرفه باید دسترسی آپلود فایل داشته باشد.';
  if (cause === 'upload-rejected') return 'تصویر دانلود شد ولی باسلام فایل را نپذیرفت' + (last ? ' (' + last.note + ')' : '') + '؛ شکل‌های دیگر آپلود هم امتحان شدند.';
  return 'ارتباط شبکه در مرحلهٔ تصویر قطع شد؛ چند دقیقه بعد دوباره تلاش کنید.';
}

function attempt(stage: PhotoAttempt['stage'], candidate: string, shape: { id: string; label: string }, status: number, bytes: number, verdict: PhotoVerdict, note: string): PhotoAttempt {
  return { stage, candidate, shape: shape.id, shapeLabel: shape.label, status, bytes, verdict, note };
}

/**
 * Walk the candidates until `limit` file ids exist. Download shapes escalate only when the answer
 * says the shape is the problem; upload shapes escalate on 404/422 and stop dead on 401/403.
 */
export async function runPhotoLoop(product: { image?: string; images?: string[]; link?: string }, deps: PhotoLoopDeps): Promise<PhotoReport> {
  const limit = Math.max(1, deps.limit || 3);
  // More candidates than wanted ids on purpose: a dead or blocked address must not consume the
  // whole budget, the next image of the same product is a perfectly good answer.
  const candidates = photoCandidates(product, Math.min(6, limit + 2));
  const attempts: PhotoAttempt[] = [];
  const ids: number[] = [];
  if (!candidates.length) {
    return { ok: false, ids, candidates, attempts, cause: 'no-candidate', reason: 'هیچ آدرس تصویری در این محصول ذخیره نشده است.', advice: photoAdvice('no-candidate', attempts) };
  }
  const base = String(deps.base || '').replace(/\/$/, '');
  const host = (() => { try { return new URL(candidates[0]).host; } catch { return 'source'; } })();
  const learnedDownload = deps.getState ? await deps.getState(photoDownloadKey(host), '') : '';
  const learnedUpload = deps.getState ? await deps.getState(photoUploadKey(), '') : '';
  const order = <T extends { id: string }>(list: T[], learned: string) => {
    const first = list.filter(item => item.id === learned);
    return first.length ? [...first, ...list.filter(item => item.id !== learned)] : list;
  };
  const downloads = order(downloadShapes(deps.referer), String(learnedDownload || ''));
  const uploads = order(uploadShapes(), String(learnedUpload || ''));
  let authStop = false, lastCause: PhotoReport['cause'] | '' = '';

  for (const candidate of candidates) {
    if (ids.length >= limit || authStop) break;
    let file: { data: unknown; name: string; bytes: number } | null = null;
    for (const shape of downloads) {
      const answer = await deps.download(candidate, shape);
      const { verdict, note } = classifyDownload(answer);
      attempts.push(attempt('download', candidate, shape, Number(answer.status || 0), Number(answer.bytes || 0), verdict, note));
      if (verdict === 'ok') {
        const name = (candidate.split('/').pop() || 'photo.jpg').split('?')[0] || 'photo.jpg';
        file = { data: answer.data, name: /\.[a-z0-9]{2,5}$/i.test(name) ? name : name + '.jpg', bytes: Number(answer.bytes || 0) };
        if (deps.setState && shape.id !== learnedDownload) await deps.setState(photoDownloadKey(host), shape.id);
        break;
      }
      // The answer decides: only a refusal is worth re-asking with a different disguise.
      if (verdict === 'missing') { lastCause = 'download-missing'; break; }
      if (verdict === 'network' || verdict === 'server' || verdict === 'throttled') { lastCause = 'network'; break; }
      lastCause = 'download-blocked';
    }
    if (!file) continue;

    for (const shape of uploads) {
      const answer = await deps.upload(base + shape.path, shape, file);
      const { verdict, note, id } = classifyUpload(answer);
      attempts.push(attempt('upload', candidate, shape, Number(answer.status || 0), file.bytes, verdict, note));
      if (verdict === 'ok') {
        ids.push(id);
        if (deps.setState && shape.id !== learnedUpload) await deps.setState(photoUploadKey(), shape.id);
        break;
      }
      if (verdict === 'auth') { authStop = true; lastCause = 'upload-auth'; break; }
      if (verdict === 'too-large' || verdict === 'network' || verdict === 'server' || verdict === 'throttled') { lastCause = verdict === 'network' ? 'network' : 'upload-rejected'; break; }
      lastCause = 'upload-rejected';   // 404 / 422 / idless 200: the next multipart shape may fit
    }
  }

  if (ids.length) return { ok: true, ids, candidates, attempts, cause: 'ok', reason: '', advice: photoAdvice('ok', attempts) };
  const cause = (lastCause || 'upload-rejected') as PhotoReport['cause'];
  const reason = attempts.filter(a => a.verdict !== 'ok').slice(-1)[0]?.note || 'تصویری آپلود نشد.';
  return { ok: false, ids, candidates, attempts, cause, reason, advice: photoAdvice(cause, attempts) };
}
