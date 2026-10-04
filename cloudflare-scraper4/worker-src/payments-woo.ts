/**
 * WordPress / WooCommerce payment gateways.
 *
 * Instead of talking to ZarinPal, TorobPay or DigiPay ourselves, the storefront delegates the
 * whole payment to the WooCommerce site that is already connected in the dashboard: the order is
 * created through the WC REST API and the customer is sent to Woo's own `payment_url`, where the
 * INSTALLED WORDPRESS PLUGIN (درگاه زرین‌پال، ترب‌پی، دیجی‌پی، کارت به کارت، …) runs the real
 * handshake, the callback, the receipt and the refund flow.
 *
 * Why this is the right layer:
 *  - gateway credentials stay in WordPress, never in this app;
 *  - whatever plugin the shop owner installs/activates shows up at checkout automatically;
 *  - the Woo order is the single source of truth for "paid", so stock, emails, invoices and
 *    accounting keep working exactly as the shop owner already configured them.
 */
import type { Order } from './shop-core.js';

export type WooConfig = { url: string; key: string; secret: string };
export type WooFetch = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>;
export type WooClient = { config: WooConfig; fetch: WooFetch };

export type WooGateway = { id: string; title: string; description: string; order?: number };

/** WooCommerce rejects unauthenticated writes, so credentials ride in the Basic header. */
export function wooAuth(config: WooConfig): string {
  const raw = `${config.key}:${config.secret}`;
  const encode = (globalThis as any).btoa as ((value: string) => string) | undefined;
  return 'Basic ' + (encode ? encode(raw) : Buffer.from(raw, 'utf8').toString('base64'));
}

export function wooUrl(config: WooConfig, path: string): string {
  return `${String(config.url || '').replace(/\/+$/, '')}/wp-json/wc/v3/${path.replace(/^\/+/, '')}`;
}

function headers(config: WooConfig): Record<string, string> {
  return { authorization: wooAuth(config), accept: 'application/json', 'content-type': 'application/json' };
}

export function wooConfigured(config: WooConfig | null | undefined): config is WooConfig {
  return Boolean(config?.url && config?.key && config?.secret);
}

/** Every gateway the WordPress site has ENABLED, in the order the shop owner arranged them. */
export async function listWooGateways(client: WooClient): Promise<WooGateway[]> {
  const response = await client.fetch(wooUrl(client.config, 'payment_gateways'), { headers: headers(client.config) });
  if (!response.ok) throw new Error(`WooCommerce HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error('پاسخ ووکامرس برای درگاه‌های پرداخت معتبر نبود.');
  return body
    .filter((row: any) => row?.enabled === true || row?.enabled === 'yes')
    .map((row: any) => ({
      id: String(row.id),
      title: String(row.title || row.method_title || row.id),
      description: stripHtml(String(row.description || row.method_description || '')),
      order: Number(row.order) || 0
    }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export type WooOrderResult = { ok: boolean; wooOrderId?: number; payUrl?: string; error?: string };

/**
 * Create the order in WooCommerce. Lines that were already synced to Woo are sent as real
 * product_id lines (stock, taxes and reports stay correct); anything not synced yet is sent as a
 * named line item with the storefront price, so a customer is never blocked by a missing sync.
 */
export async function createWooOrder(client: WooClient, order: Order, input: {
  productIdFor: (line: Order['lines'][number]) => Promise<number | string | null>;
  gatewayTitle?: string;
  currency?: string;
}): Promise<WooOrderResult> {
  try {
    const lineItems: any[] = [];
    for (const line of order.lines) {
      const productId = Number(await input.productIdFor(line)) || 0;
      const total = (line.price * line.qty).toString();
      lineItems.push(productId > 0
        ? { product_id: productId, quantity: line.qty, total }
        : { name: line.title.slice(0, 200), quantity: line.qty, total, subtotal: total });
    }
    const [firstName, ...rest] = order.customer.name.split(/\s+/);
    const payload: any = {
      payment_method: order.gateway,
      payment_method_title: input.gatewayTitle || order.gateway,
      set_paid: false,
      status: 'pending',
      billing: {
        first_name: firstName || order.customer.name, last_name: rest.join(' '),
        phone: order.customer.phone, address_1: order.customer.address, country: 'IR'
      },
      shipping: { first_name: firstName || order.customer.name, last_name: rest.join(' '), address_1: order.customer.address, country: 'IR' },
      customer_note: order.customer.note || '',
      line_items: lineItems,
      shipping_lines: order.shipping > 0 ? [{ method_id: 'flat_rate', method_title: 'ارسال', total: String(order.shipping) }] : [],
      fee_lines: order.tax > 0 ? [{ name: 'مالیات', total: String(order.tax), tax_status: 'none' }] : [],
      meta_data: [{ key: '_scraper4_order', value: order.id }]
    };
    const response = await client.fetch(wooUrl(client.config, 'orders'), { method: 'POST', headers: headers(client.config), body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.id) return { ok: false, error: wooError(body, response.status) };
    const payUrl = String(body.payment_url || '');
    if (!payUrl) return { ok: false, wooOrderId: Number(body.id), error: 'ووکامرس آدرس پرداخت برنگرداند؛ آیا این درگاه در وردپرس فعال است؟' };
    return { ok: true, wooOrderId: Number(body.id), payUrl };
  } catch (error) {
    return { ok: false, error: `ایجاد سفارش در ووکامرس ناموفق بود: ${(error as Error)?.message || error}` };
  }
}

/** WooCommerce (and therefore the WordPress gateway plugin) owns the truth about payment. */
export const WOO_PAID_STATUSES = ['processing', 'completed', 'on-hold'];

export type WooStatus = { ok: boolean; status?: string; paid?: boolean; reference?: string; error?: string };

export async function readWooOrder(client: WooClient, wooOrderId: number): Promise<WooStatus> {
  try {
    const response = await client.fetch(wooUrl(client.config, `orders/${wooOrderId}`), { headers: headers(client.config) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.id) return { ok: false, error: wooError(body, response.status) };
    const status = String(body.status || '');
    return {
      ok: true, status, paid: WOO_PAID_STATUSES.includes(status),
      reference: String(body.transaction_id || body.number || '')
    };
  } catch (error) {
    return { ok: false, error: `خواندن سفارش ووکامرس ناموفق بود: ${(error as Error)?.message || error}` };
  }
}

function wooError(body: any, status: number): string {
  const detail = body?.message || body?.data?.message || body?.code;
  return detail ? String(detail).slice(0, 200) : `WooCommerce HTTP ${status}`;
}
