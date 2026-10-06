/**
 * Public read-only mirrors of a web page.
 *
 * When a source refuses every request shape AND every header trick, the refusal is almost
 * always about WHO is asking (datacenter IP, country, ASN) rather than HOW. The user can fix
 * that with their own Worker gateway, but until they do, a public mirror that fetches the page
 * from its own address and hands back the original HTML gets the extraction working today.
 *
 * Rules kept deliberately strict, because a mirror is someone else's server:
 *  - GET only, public pages only, no credentials, no cookies, no POST;
 *  - only mirrors that return the ORIGINAL HTML can be learned — a mirror that rewrites the
 *    markup (text extractors, the Wayback toolbar) would silently poison selectors and links,
 *    so it may be probed for a diagnosis but never becomes the standing recipe;
 *  - the loop still verifies the body against the profile's list selector before trusting it.
 *
 * Runtime free: both twins and the offline tests share this table.
 */

export type MirrorId = 'allorigins' | 'codetabs' | 'jina' | 'wayback';

export type SourceMirror = {
  id: MirrorId;
  label: string;
  /** The address to request instead of the blocked one. */
  build: (target: string) => string;
  /** Extra headers the mirror itself understands. */
  headers?: Record<string, string>;
  /**
   * False when the mirror returns something other than the untouched page (rewritten links,
   * injected toolbars, markdown). Those are diagnosis only and are never remembered.
   */
  verbatim: boolean;
  /** One-line Persian explanation shown in the attempt table. */
  note: string;
};

export const SOURCE_MIRRORS: SourceMirror[] = [
  {
    id: 'allorigins', label: 'آینهٔ عمومی AllOrigins', verbatim: true,
    build: target => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(target),
    note: 'صفحه را بدون تغییر از آدرس خودش می‌گیرد و همان HTML را برمی‌گرداند.'
  },
  {
    id: 'codetabs', label: 'آینهٔ عمومی CodeTabs', verbatim: true,
    build: target => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(target),
    note: 'پراکسی سادهٔ عمومی؛ خروجی همان HTML مبدأ است.'
  },
  {
    id: 'jina', label: 'آینهٔ r.jina.ai (HTML)', verbatim: true,
    build: target => 'https://r.jina.ai/' + target,
    headers: { 'x-return-format': 'html', 'x-respond-with': 'html' },
    note: 'سرویس خواندن صفحه؛ با هدر مخصوص، HTML اصلی را برمی‌گرداند.'
  },
  {
    id: 'wayback', label: 'نسخهٔ بایگانی‌شده (Wayback)', verbatim: false,
    build: target => 'https://web.archive.org/web/2/' + target,
    note: 'فقط برای تشخیص: اگر نسخهٔ بایگانی باز شود یعنی سلکتورها سالم‌اند و مسدودسازی از سمت IP است.'
  }
];

export function mirrorById(id: string): SourceMirror | undefined {
  return SOURCE_MIRRORS.find(mirror => mirror.id === id);
}

/** Mirrors that may be remembered and used for real extraction runs. */
export function learnableMirrors(): SourceMirror[] {
  return SOURCE_MIRRORS.filter(mirror => mirror.verbatim);
}

const WAYBACK_TOOLBAR = /<script[^>]+archive\.org[\s\S]*?<\/script>|<!--\s*BEGIN WAYBACK TOOLBAR INSERT\s*-->[\s\S]*?<!--\s*END WAYBACK TOOLBAR INSERT\s*-->/gi;

/**
 * Normalises a mirrored body back towards the original page: strips the archive toolbar and
 * undoes the `/web/<stamp>/` link rewriting so a diagnosis reads like the real page.
 */
export function unwrapMirror(id: MirrorId, text: string): string {
  if (id !== 'wayback') return text;
  return text.replace(WAYBACK_TOOLBAR, '').replace(/https?:\/\/web\.archive\.org\/web\/[^/]+\//g, '');
}
