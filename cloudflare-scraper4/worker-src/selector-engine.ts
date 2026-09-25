/** The product parser switch does not affect DOM selector tools. */
export function isBrowserSelectorEngine(engine?:string):boolean {
  return ['playwright','puppeteer','crawlee_playwright','network_api'].includes(engine||'');
}
export function requireStaticSelectorEngine(engine?:string):void {
  if(isBrowserSelectorEngine(engine))throw Error('آزمایش و پیشنهاد سلکتور با موتور مرورگری به اجرای Node روی VPS یا Termux نیاز دارد؛ Cloudflare Worker نمی‌تواند مرورگر اجرا کند.');
}
