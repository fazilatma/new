/**
 * Payment plugins for the storefront: ZarinPal, TorobPay, DigiPay and manual card-to-card.
 *
 * Every gateway is a PLUGIN with the same shape, so adding another one later means adding an
 * entry to PAYMENT_PLUGINS and nothing else. Network access is injected (fetchImpl) so the
 * offline test suite can drive the full request/verify handshake with fixtures — the sandbox
 * has no outbound network and live gateways must never be contacted from tests.
 *
 * Endpoints are overridable per gateway in the shop settings: merchants are sometimes issued a
 * dedicated base URL, and a hard-coded host would make the plugin unusable for them.
 */
import type { Order } from './shop-core.js';

export type PaymentGatewayId = 'zarinpal' | 'torobpay' | 'digipay' | 'card';

export type GatewayConfig = {
  enabled: boolean;
  /** ZarinPal merchant_id, DigiPay/TorobPay client id. */
  merchantId: string;
  /** DigiPay/TorobPay secret (username/password pair is stored as "user:pass"). */
  secret: string;
  baseUrl: string;
  sandbox: boolean;
};

export type PaymentSettings = Record<PaymentGatewayId, GatewayConfig>;

export type PaymentPlugin = {
  id: PaymentGatewayId;
  title: string;
  description: string;
  /** Redirect to a gateway page, or show instructions in the shop. */
  kind: 'redirect' | 'manual';
  defaultBaseUrl: string;
  needs: Array<keyof GatewayConfig>;
};

export const PAYMENT_PLUGINS: PaymentPlugin[] = [
  { id: 'zarinpal', title: 'زرین‌پال', description: 'پرداخت آنلاین با همهٔ کارت‌های شتاب از طریق درگاه زرین‌پال.', kind: 'redirect', defaultBaseUrl: 'https://payment.zarinpal.com', needs: ['merchantId'] },
  { id: 'torobpay', title: 'ترب‌پی', description: 'خرید اعتباری و پرداخت اقساطی ترب‌پی.', kind: 'redirect', defaultBaseUrl: 'https://tpay.torob.com', needs: ['merchantId', 'secret'] },
  { id: 'digipay', title: 'دیجی‌پی', description: 'پرداخت و خرید اعتباری دیجی‌پی (اسنپ‌پی سابق).', kind: 'redirect', defaultBaseUrl: 'https://api.mydigipay.com', needs: ['merchantId', 'secret'] },
  { id: 'card', title: 'کارت به کارت', description: 'واریز مستقیم به کارت فروشگاه و ثبت کد پیگیری. سفارش پس از تأیید دستی ارسال می‌شود.', kind: 'manual', defaultBaseUrl: '', needs: [] }
];

export const PAYMENT_IDS = PAYMENT_PLUGINS.map(plugin => plugin.id);
export const PAYMENT_SETTINGS_KEY = 'shop.payments';

export function isPaymentGateway(value: unknown): value is PaymentGatewayId {
  return PAYMENT_IDS.includes(String(value ?? '') as PaymentGatewayId);
}

export function normalizePaymentSettings(raw: unknown): PaymentSettings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const out = {} as PaymentSettings;
  for (const plugin of PAYMENT_PLUGINS) {
    const row = (input[plugin.id] && typeof input[plugin.id] === 'object' ? input[plugin.id] : {}) as Record<string, any>;
    out[plugin.id] = {
      enabled: Boolean(row.enabled),
      merchantId: String(row.merchantId ?? '').trim().slice(0, 120),
      secret: String(row.secret ?? '').trim().slice(0, 200),
      baseUrl: String(row.baseUrl ?? '').trim().replace(/\/+$/, '').slice(0, 200) || plugin.defaultBaseUrl,
      sandbox: Boolean(row.sandbox)
    };
  }
  return out;
}

/** Card-to-card needs a card number, the online gateways need their credentials. */
export function gatewayReady(id: PaymentGatewayId, settings: PaymentSettings, cardNumber = ''): boolean {
  const config = settings[id];
  if (!config?.enabled) return false;
  if (id === 'card') return cardNumber.replace(/\D/g, '').length >= 16;
  const plugin = PAYMENT_PLUGINS.find(entry => entry.id === id)!;
  return plugin.needs.every(field => String(config[field] ?? '').length > 0);
}

export function availableGateways(settings: PaymentSettings, cardNumber = ''): PaymentPlugin[] {
  return PAYMENT_PLUGINS.filter(plugin => gatewayReady(plugin.id, settings, cardNumber));
}

export type StartResult = {
  ok: boolean;
  /** redirect target for 'redirect' plugins */
  redirect?: string;
  authority?: string;
  /** Persian instructions for the manual plugin */
  instructions?: string;
  error?: string;
};

export type Fetcher = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>;

type StartInput = {
  order: Order;
  settings: PaymentSettings;
  callbackUrl: string;
  card?: { number: string; holder: string; bank: string };
  fetchImpl?: Fetcher;
};

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
  body: JSON.stringify(body)
});

/** ZarinPal and friends price in RIAL; the shop keeps Toman. */
export const toRial = (toman: number) => Math.round(Math.max(0, Number(toman) || 0) * 10);

export async function startPayment(gateway: PaymentGatewayId, input: StartInput): Promise<StartResult> {
  const config = input.settings[gateway];
  if (!config?.enabled) return { ok: false, error: 'این روش پرداخت فعال نیست.' };
  const fetchImpl = input.fetchImpl ?? (globalThis.fetch as unknown as Fetcher);
  const amount = toRial(input.order.total);
  if (gateway !== 'card' && amount <= 0) return { ok: false, error: 'مبلغ سفارش معتبر نیست.' };
  try {
    if (gateway === 'card') {
      const number = String(input.card?.number || '').replace(/\D/g, '');
      if (number.length < 16) return { ok: false, error: 'شمارهٔ کارت فروشگاه تنظیم نشده است.' };
      const grouped = number.replace(/(\d{4})(?=\d)/g, '$1-');
      return {
        ok: true,
        instructions: `مبلغ ${input.order.total.toLocaleString('en-US')} ${input.order.currency} را به کارت ${grouped}` +
          (input.card?.holder ? ` به نام ${input.card.holder}` : '') +
          (input.card?.bank ? ` (${input.card.bank})` : '') +
          ' واریز کنید و سپس کد پیگیری/شمارهٔ رسید را در همین صفحه ثبت کنید.'
      };
    }
    if (gateway === 'zarinpal') {
      const response = await fetchImpl(`${config.baseUrl}/pg/v4/payment/request.json`, json({
        merchant_id: config.merchantId,
        amount,
        callback_url: input.callbackUrl,
        description: `سفارش ${input.order.id}`,
        metadata: { mobile: input.order.customer.phone }
      }));
      const body = await response.json();
      const authority = String(body?.data?.authority || '');
      if (!authority) return { ok: false, error: gatewayError(body) };
      const start = config.sandbox ? 'https://sandbox.zarinpal.com' : config.baseUrl;
      return { ok: true, authority, redirect: `${start}/pg/StartPay/${authority}` };
    }
    if (gateway === 'torobpay') {
      const response = await fetchImpl(`${config.baseUrl}/api/online/v1/payment/token`, json({
        amount,
        mobile: input.order.customer.phone,
        callbackUrl: input.callbackUrl,
        invoiceNumber: input.order.id,
        items: input.order.lines.map(line => ({ name: line.title, count: line.qty, amount: toRial(line.price) }))
      }, { authorization: `Bearer ${config.secret}`, 'x-client-id': config.merchantId }));
      const body = await response.json();
      const token = String(body?.token || body?.data?.token || '');
      const redirect = String(body?.paymentPageUrl || body?.data?.paymentPageUrl || (token ? `${config.baseUrl}/pay/${token}` : ''));
      if (!token || !redirect) return { ok: false, error: gatewayError(body) };
      return { ok: true, authority: token, redirect };
    }
    // DigiPay: OAuth token first, then a payment ticket.
    const [user, password] = config.secret.split(':');
    const auth = await fetchImpl(`${config.baseUrl}/digipay/api/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: basic(config.merchantId, password || '') },
      body: `username=${encodeURIComponent(user || '')}&password=${encodeURIComponent(password || '')}&grant_type=password`
    });
    const token = String((await auth.json())?.access_token || '');
    if (!token) return { ok: false, error: 'دریافت توکن دیجی‌پی ناموفق بود.' };
    const response = await fetchImpl(`${config.baseUrl}/digipay/api/businesses/ticket?type=0`, json({
      amount,
      cellNumber: input.order.customer.phone,
      providerId: input.order.id,
      callbackUrl: input.callbackUrl
    }, { authorization: `Bearer ${token}` }));
    const body = await response.json();
    const redirect = String(body?.redirectUrl || '');
    if (!redirect) return { ok: false, error: gatewayError(body) };
    return { ok: true, authority: String(body?.ticket || ''), redirect };
  } catch (error) {
    return { ok: false, error: `ارتباط با درگاه ${gateway} برقرار نشد: ${(error as Error)?.message || error}` };
  }
}

export type VerifyResult = { ok: boolean; reference?: string; error?: string };

export async function verifyPayment(gateway: PaymentGatewayId, input: { order: Order; settings: PaymentSettings; query: Record<string, string>; fetchImpl?: Fetcher }): Promise<VerifyResult> {
  const config = input.settings[gateway];
  const fetchImpl = input.fetchImpl ?? (globalThis.fetch as unknown as Fetcher);
  const amount = toRial(input.order.total);
  try {
    if (gateway === 'card') {
      const reference = String(input.query.reference || '').trim();
      return reference.length >= 4 ? { ok: true, reference } : { ok: false, error: 'کد پیگیری واریز را وارد کنید.' };
    }
    if (gateway === 'zarinpal') {
      if (String(input.query.Status || input.query.status || '').toUpperCase() !== 'OK') return { ok: false, error: 'پرداخت توسط کاربر لغو شد.' };
      const authority = String(input.query.Authority || input.query.authority || '');
      if (!authority || (input.order.payment.authority && authority !== input.order.payment.authority)) return { ok: false, error: 'شناسهٔ پرداخت با سفارش هم‌خوانی ندارد.' };
      const body = await (await fetchImpl(`${config.baseUrl}/pg/v4/payment/verify.json`, json({ merchant_id: config.merchantId, amount, authority }))).json();
      const code = Number(body?.data?.code || 0);
      // 100 = verified now, 101 = already verified. Both mean the money arrived.
      return code === 100 || code === 101 ? { ok: true, reference: String(body?.data?.ref_id || '') } : { ok: false, error: gatewayError(body) };
    }
    if (gateway === 'torobpay') {
      const token = String(input.query.token || input.order.payment.authority || '');
      const body = await (await fetchImpl(`${config.baseUrl}/api/online/v1/payment/verify`, json({ token, amount, invoiceNumber: input.order.id },
        { authorization: `Bearer ${config.secret}`, 'x-client-id': config.merchantId }))).json();
      const status = String(body?.status || body?.data?.status || '').toUpperCase();
      return status === 'SUCCESS' || body?.verified === true
        ? { ok: true, reference: String(body?.referenceNumber || body?.data?.referenceNumber || token) }
        : { ok: false, error: gatewayError(body) };
    }
    const [user, password] = String(config.secret || '').split(':');
    const auth = await fetchImpl(`${config.baseUrl}/digipay/api/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: basic(config.merchantId, password || '') },
      body: `username=${encodeURIComponent(user || '')}&password=${encodeURIComponent(password || '')}&grant_type=password`
    });
    const token = String((await auth.json())?.access_token || '');
    const trackingCode = String(input.query.trackingCode || input.order.payment.trackingCode || '');
    const body = await (await fetchImpl(`${config.baseUrl}/digipay/api/purchases/verify/${encodeURIComponent(trackingCode)}`, json({}, { authorization: `Bearer ${token}` }))).json();
    return Number(body?.result?.status ?? body?.status ?? -1) === 0
      ? { ok: true, reference: String(body?.trackingCode || trackingCode) }
      : { ok: false, error: gatewayError(body) };
  } catch (error) {
    return { ok: false, error: `تأیید پرداخت ناموفق بود: ${(error as Error)?.message || error}` };
  }
}

function gatewayError(body: any): string {
  const detail = body?.errors?.message || body?.error?.message || body?.message || body?.result?.message || body?.error_description;
  return detail ? String(detail).slice(0, 200) : 'درگاه پرداخت پاسخ معتبری نداد.';
}

function basic(user: string, password: string): string {
  const raw = `${user}:${password}`;
  const encode = (globalThis as any).btoa as ((value: string) => string) | undefined;
  return 'Basic ' + (encode ? encode(raw) : Buffer.from(raw, 'utf8').toString('base64'));
}
