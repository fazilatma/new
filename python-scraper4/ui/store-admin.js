(() => {
  "use strict";
  const BASE = document.body.dataset.base || "";
  const $ = (id) => document.getElementById(id);
  const state = { overview: null, settings: null, orderPage: 1, events: [] };
  const titles = {
    overview: [
      "نمای کلی فروشگاه",
      "فروش، سفارش‌ها و وضعیت اتصال‌ها در یک نگاه",
    ],
    orders: ["سفارش‌های فروشگاه", "مدیریت وضعیت، مرسوله و اطلاعات سفارش"],
    settings: ["تنظیمات فروشگاه", "هویت ویترین، ارسال، قیمت و موجودی"],
    payments: ["درگاه‌های پرداخت", "Credential امن و قرارداد پرداخت سمت سرور"],
    webhooks: ["وب‌هوک باسلام", "دریافت امن و idempotent پیام‌ها و رخدادها"],
  };

  function esc(value) {
    return String(value ?? "").replace(
      /[&<>'"]/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[char],
    );
  }
  function fa(value) {
    return new Intl.NumberFormat("fa-IR").format(Number(value || 0));
  }
  function money(value) {
    return `${fa(value)} تومان`;
  }
  function date(value) {
    return value ? new Date(Number(value) * 1000).toLocaleString("fa-IR") : "—";
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body) headers.set("Content-Type", "application/json");
    const response = await fetch(BASE + path, {
      ...options,
      headers,
      cache: "no-store",
    });
    let data;
    try {
      data = await response.json();
    } catch (_) {
      data = { ok: false, error: "پاسخ سرور معتبر نیست" };
    }
    if (!response.ok || data.ok === false)
      throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function toast(message, type = "") {
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = message;
    $("adminToasts").appendChild(node);
    setTimeout(() => node.remove(), 3800);
  }

  function statusTitle(status) {
    return (
      {
        awaiting_payment: "در انتظار پرداخت",
        payment_failed: "پرداخت ناموفق",
        confirmed: "تأیید شده",
        processing: "آماده‌سازی",
        shipped: "ارسال شده",
        delivered: "تحویل شده",
        cancelled: "لغو شده",
        refunded: "بازپرداخت",
        needs_review: "نیازمند بررسی",
      }[status] ||
      status ||
      "نامشخص"
    );
  }

  function orderRows(rows, header = true) {
    if (!rows?.length)
      return '<div class="empty">هنوز سفارشی ثبت نشده است.</div>';
    return `${header ? '<div class="table-row header"><span>شماره سفارش</span><span>مشتری</span><span>مبلغ</span><span>وضعیت</span><span></span></div>' : ""}${rows.map((order) => `<div class="table-row"><span class="order-id">${esc(order.id)}</span><span class="customer"><b>${esc(order.customer?.name || "—")}</b><small>${esc(order.customer?.mobile || "")}</small></span><span class="order-price">${money(order.total)}</span><span><i class="status-badge status-${esc(order.status)}">${esc(statusTitle(order.status))}</i></span><button class="view-order" data-order="${esc(order.id)}" type="button">جزئیات</button></div>`).join("")}`;
  }

  async function loadOverview() {
    try {
      const data = await api("/api/store/admin/overview");
      state.overview = data.overview;
      state.settings = data.overview.settings;
      const overview = state.overview;
      $("statProducts").textContent = fa(overview.products);
      $("statOrders").textContent = fa(overview.orders);
      $("statPaid").textContent = `${fa(overview.paid_orders)} پرداخت‌شده`;
      $("statRevenue").textContent = fa(overview.revenue);
      $("statEvents").textContent = fa(overview.webhook_events);
      $("navOrderCount").textContent = fa(overview.orders);
      $("navWebhookCount").textContent = fa(overview.webhook_events);
      $("recentOrders").innerHTML = orderRows(overview.recent_orders);
      bindOrderButtons($("recentOrders"));
      renderReadiness(overview.settings);
      populateForms(overview.settings);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderReadiness(settings) {
    const gateways = settings.gateways || {};
    const readyOnline = ["zarinpal", "digipay", "torobpay", "custom"].some(
      (name) => gateways[name]?.ready,
    );
    const rows = [
      [
        Boolean(settings.branding?.name),
        "هویت فروشگاه",
        settings.branding?.name || "نام فروشگاه تنظیم نشده",
      ],
      [
        Boolean(settings.public_url),
        "آدرس callback",
        settings.public_url || "در محیط عملیاتی دامنه HTTPS ثبت کنید",
      ],
      [
        readyOnline,
        "درگاه آنلاین",
        readyOnline
          ? "حداقل یک درگاه آماده است"
          : "فقط پرداخت هنگام تحویل در دسترس است",
      ],
      [
        Boolean(settings.basalam_webhook?.token_configured),
        "وب‌هوک باسلام",
        settings.basalam_webhook?.token_configured
          ? "Secret گیرنده ساخته شده"
          : "هنوز راه‌اندازی نشده",
      ],
    ];
    $("readinessList").innerHTML = rows
      .map(
        ([ok, title, note]) =>
          `<div class="readiness-item ${ok ? "" : "missing"}"><i>${ok ? "✓" : "!"}</i><div><b>${esc(title)}</b><small>${esc(note)}</small></div></div>`,
      )
      .join("");
  }

  function showView(view) {
    document
      .querySelectorAll(".nav-item")
      .forEach((node) =>
        node.classList.toggle("active", node.dataset.view === view),
      );
    document
      .querySelectorAll(".admin-view")
      .forEach((node) =>
        node.classList.toggle("active", node.id === `view-${view}`),
      );
    $("pageTitle").textContent = titles[view][0];
    $("pageSubtitle").textContent = titles[view][1];
    document.querySelector(".admin-sidebar").classList.remove("open");
    $("adminOverlay").classList.remove("open");
    if (view === "orders") loadOrders();
    if (view === "webhooks") loadWebhookPanel();
    scrollTo({ top: 0, behavior: "smooth" });
  }

  function setField(form, name, value, checked = false) {
    const node = form.elements[name];
    if (!node) return;
    if (checked || node.type === "checkbox") node.checked = Boolean(value);
    else node.value = value ?? "";
  }

  function populateForms(settings) {
    const form = $("storeSettings");
    const branding = settings.branding || {};
    const shipping = settings.shipping || {};
    const pricing = settings.pricing || {};
    const catalog = settings.catalog || {};
    setField(form, "enabled", settings.enabled, true);
    setField(form, "brand_name", branding.name);
    setField(form, "tagline", branding.tagline);
    setField(form, "description", branding.description);
    setField(form, "support_phone", branding.support_phone);
    setField(form, "accent", branding.accent || "#ef4056");
    setField(form, "accent_text", branding.accent || "#ef4056");
    setField(form, "announcement", branding.announcement);
    setField(form, "public_url", settings.public_url);
    setField(form, "shipping_label", shipping.label);
    setField(form, "shipping_eta", shipping.eta);
    setField(form, "flat_fee", shipping.flat_fee);
    setField(form, "free_over", shipping.free_over);
    setField(form, "minimum_order", shipping.minimum_order);
    setField(form, "price_mode", pricing.mode);
    setField(form, "price_value", pricing.value);
    setField(form, "price_round", pricing.round);
    setField(form, "default_stock", catalog.default_stock);
    setField(form, "show_profiles", catalog.show_profile_names, true);
    const gateways = settings.gateways || {};
    const pay = $("paymentSettings");
    const zp = gateways.zarinpal || {};
    setField(pay, "zarinpal_enabled", zp.enabled, true);
    setField(pay, "zarinpal_sandbox", zp.sandbox, true);
    setField(pay, "zarinpal_currency", zp.currency || "IRT");
    $("zarinpalConfigured").textContent = zp.merchant_id_configured
      ? "✓ Merchant ID ذخیره شده است"
      : "Merchant ID هنوز تنظیم نشده است";
    const dg = gateways.digipay || {};
    setField(pay, "digipay_enabled", dg.enabled, true);
    setField(pay, "digipay_sandbox", dg.sandbox, true);
    setField(pay, "digipay_multiplier", dg.amount_multiplier || 10);
    setField(pay, "digipay_preferred", dg.preferred_gateway || "");
    $("digipayConfigured").textContent = [
      "client_id",
      "client_secret",
      "username",
      "password",
    ].every((key) => dg[`${key}_configured`])
      ? "✓ همه Credentialهای دیجی‌پی ذخیره شده‌اند"
      : "Credentialهای دیجی‌پی کامل نیستند";
    const tp = gateways.torobpay || {};
    setField(pay, "torobpay_enabled", tp.enabled, true);
    setField(pay, "torobpay_request_url", tp.request_url);
    setField(pay, "torobpay_verify_url", tp.verify_url);
    setField(pay, "torobpay_checkout", tp.checkout_url_template);
    setField(pay, "torobpay_multiplier", tp.amount_multiplier || 1);
    setField(
      pay,
      "torobpay_request_template",
      JSON.stringify(tp.request_template || {}, null, 2),
    );
    setField(
      pay,
      "torobpay_verify_template",
      JSON.stringify(tp.verify_template || {}, null, 2),
    );
    $("torobpayConfigured").textContent = tp.ready
      ? "✓ قرارداد ترب‌پی آماده استفاده است"
      : "Endpointهای قراردادی ترب‌پی هنوز کامل نیست";
    const custom = gateways.custom || {};
    setField(pay, "custom_enabled", custom.enabled, true);
    setField(pay, "custom_request_url", custom.request_url);
    setField(pay, "custom_verify_url", custom.verify_url);
    setField(pay, "custom_checkout", custom.checkout_url_template);
    setField(pay, "custom_multiplier", custom.amount_multiplier || 1);
    setField(
      pay,
      "custom_request_template",
      JSON.stringify(custom.request_template || {}, null, 2),
    );
    setField(
      pay,
      "custom_verify_template",
      JSON.stringify(custom.verify_template || {}, null, 2),
    );
    $("customConfigured").textContent = custom.ready
      ? "✓ درگاه سفارشی آماده استفاده است"
      : "Endpointهای درگاه سفارشی کامل نیست";
    const cod = gateways.cod || {};
    setField(pay, "cod_enabled", cod.enabled, true);
  }

  async function saveStoreSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $("settingsStatus");
    const payload = {
      enabled: form.elements.enabled.checked,
      public_url: form.elements.public_url.value.trim(),
      branding: {
        name: form.elements.brand_name.value,
        tagline: form.elements.tagline.value,
        description: form.elements.description.value,
        support_phone: form.elements.support_phone.value,
        accent: form.elements.accent_text.value,
        announcement: form.elements.announcement.value,
      },
      shipping: {
        label: form.elements.shipping_label.value,
        eta: form.elements.shipping_eta.value,
        flat_fee: Number(form.elements.flat_fee.value || 0),
        free_over: Number(form.elements.free_over.value || 0),
        minimum_order: Number(form.elements.minimum_order.value || 0),
      },
      pricing: {
        mode: form.elements.price_mode.value,
        value: Number(form.elements.price_value.value || 0),
        round: Number(form.elements.price_round.value || 0),
      },
      catalog: {
        default_stock: Number(form.elements.default_stock.value || 0),
        show_profile_names: form.elements.show_profiles.checked,
      },
    };
    status.className = "form-status";
    status.textContent = "در حال ذخیره…";
    try {
      const data = await api("/api/store/admin/settings", {
        method: "PUT",
        body: JSON.stringify({ settings: payload }),
      });
      state.settings = data.settings;
      populateForms(data.settings);
      status.className = "form-status ok";
      status.textContent = "✓ تنظیمات ذخیره شد";
      toast("تنظیمات فروشگاه ذخیره شد", "ok");
      await loadOverview();
    } catch (error) {
      status.className = "form-status error";
      status.textContent = error.message;
    }
  }

  function parseTemplate(value, title) {
    try {
      const parsed = JSON.parse(value || "{}");
      if (!parsed || typeof parsed !== "object") throw new Error();
      return parsed;
    } catch (_) {
      throw new Error(`${title} JSON معتبر نیست`);
    }
  }

  async function savePayments(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $("paymentStatus");
    status.className = "form-status";
    status.textContent = "در حال رمزنگاری و ذخیره…";
    try {
      const gateways = {
        cod: { enabled: form.elements.cod_enabled.checked },
        zarinpal: {
          enabled: form.elements.zarinpal_enabled.checked,
          sandbox: form.elements.zarinpal_sandbox.checked,
          currency: form.elements.zarinpal_currency.value,
          merchant_id: form.elements.zarinpal_merchant.value.trim(),
        },
        digipay: {
          enabled: form.elements.digipay_enabled.checked,
          sandbox: form.elements.digipay_sandbox.checked,
          amount_multiplier: Number(
            form.elements.digipay_multiplier.value || 10,
          ),
          preferred_gateway: form.elements.digipay_preferred.value,
          client_id: form.elements.digipay_client_id.value.trim(),
          client_secret: form.elements.digipay_client_secret.value,
          password: form.elements.digipay_password.value,
          username: form.elements.digipay_username.value.trim(),
        },
        torobpay: {
          enabled: form.elements.torobpay_enabled.checked,
          request_url: form.elements.torobpay_request_url.value.trim(),
          verify_url: form.elements.torobpay_verify_url.value.trim(),
          checkout_url_template: form.elements.torobpay_checkout.value.trim(),
          amount_multiplier: Number(
            form.elements.torobpay_multiplier.value || 1,
          ),
          api_token: form.elements.torobpay_token.value,
          request_template: parseTemplate(
            form.elements.torobpay_request_template.value,
            "قالب درخواست",
          ),
          verify_template: parseTemplate(
            form.elements.torobpay_verify_template.value,
            "قالب تأیید",
          ),
        },
        custom: {
          enabled: form.elements.custom_enabled.checked,
          request_url: form.elements.custom_request_url.value.trim(),
          verify_url: form.elements.custom_verify_url.value.trim(),
          checkout_url_template: form.elements.custom_checkout.value.trim(),
          amount_multiplier: Number(form.elements.custom_multiplier.value || 1),
          api_token: form.elements.custom_token.value,
          request_template: parseTemplate(
            form.elements.custom_request_template.value,
            "قالب درخواست درگاه سفارشی",
          ),
          verify_template: parseTemplate(
            form.elements.custom_verify_template.value,
            "قالب تأیید درگاه سفارشی",
          ),
        },
      };
      const data = await api("/api/store/admin/settings", {
        method: "PUT",
        body: JSON.stringify({ settings: { gateways } }),
      });
      state.settings = data.settings;
      populateForms(data.settings);
      [
        "zarinpal_merchant",
        "digipay_client_id",
        "digipay_client_secret",
        "digipay_username",
        "digipay_password",
        "torobpay_token",
        "custom_token",
      ].forEach((name) => {
        form.elements[name].value = "";
      });
      status.className = "form-status ok";
      status.textContent = "✓ تنظیمات درگاه‌ها امن ذخیره شد";
      toast("درگاه‌ها ذخیره شدند", "ok");
    } catch (error) {
      status.className = "form-status error";
      status.textContent = error.message;
    }
  }

  async function loadOrders() {
    const q = encodeURIComponent($("orderSearch").value.trim());
    const status = encodeURIComponent($("orderStatus").value);
    try {
      const data = await api(
        `/api/store/admin/orders?page=${state.orderPage}&per_page=30&q=${q}&status=${status}`,
      );
      $("orderTotal").textContent = `${fa(data.total)} سفارش`;
      $("ordersTable").innerHTML = orderRows(data.items);
      bindOrderButtons($("ordersTable"));
      renderOrderPages(data.page, data.total_pages);
    } catch (error) {
      $("ordersTable").innerHTML =
        `<div class="empty">${esc(error.message)}</div>`;
    }
  }
  function bindOrderButtons(scope) {
    scope
      .querySelectorAll("[data-order]")
      .forEach((node) =>
        node.addEventListener("click", () => openOrder(node.dataset.order)),
      );
  }
  function renderOrderPages(page, total) {
    const start = Math.max(1, page - 2),
      end = Math.min(total, page + 2);
    let html = "";
    for (let i = start; i <= end; i++)
      html += `<button class="${i === page ? "active" : ""}" data-page="${i}" type="button">${fa(i)}</button>`;
    $("ordersPagination").innerHTML = html;
    $("ordersPagination")
      .querySelectorAll("button")
      .forEach((node) =>
        node.addEventListener("click", () => {
          state.orderPage = Number(node.dataset.page);
          loadOrders();
        }),
      );
  }

  async function openOrder(id) {
    openModal("orderModal");
    $("orderDetail").innerHTML =
      '<div class="empty">در حال دریافت سفارش…</div>';
    try {
      const data = await api(
        `/api/store/admin/orders/${encodeURIComponent(id)}`,
      );
      const order = data.order;
      const customer = order.customer || {};
      $("orderDetail").innerHTML =
        `<div class="detail-head"><h2>سفارش <span dir="ltr">${esc(order.id)}</span></h2><p>${date(order.created_at)} · <i class="status-badge status-${esc(order.status)}">${esc(statusTitle(order.status))}</i></p></div><div class="detail-grid"><div class="detail-box"><small>مشتری</small><b>${esc(customer.name)} · <span dir="ltr">${esc(customer.mobile)}</span></b></div><div class="detail-box"><small>نشانی</small><b>${esc([customer.province, customer.city, customer.address, customer.postal_code].filter(Boolean).join("، "))}</b></div><div class="detail-box"><small>پرداخت</small><b>${esc(order.payment?.gateway)} · ${esc(order.payment?.status)} ${order.payment?.reference_id ? `· ${esc(order.payment.reference_id)}` : ""}</b></div><div class="detail-box"><small>مبلغ</small><b>${money(order.total)} (ارسال: ${money(order.shipping)})</b></div></div><div class="detail-items">${(order.items || []).map((item) => `<div class="detail-item"><span>${esc(item.title)} × ${fa(item.quantity)}</span><b>${money(item.line_total)}</b></div>`).join("")}</div><div class="detail-actions"><select id="detailStatus">${["confirmed", "processing", "shipped", "delivered", "needs_review", "cancelled", "refunded"].map((status) => `<option value="${status}" ${order.status === status ? "selected" : ""}>${statusTitle(status)}</option>`).join("")}</select><input id="detailTracking" value="${esc(order.tracking_code || "")}" placeholder="کد رهگیری مرسوله"><button id="saveOrderDetail" type="button">ذخیره وضعیت</button></div>`;
      $("saveOrderDetail").addEventListener("click", () => saveOrder(id));
    } catch (error) {
      $("orderDetail").innerHTML =
        `<div class="empty">${esc(error.message)}</div>`;
    }
  }
  async function saveOrder(id) {
    try {
      await api(`/api/store/admin/orders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: $("detailStatus").value,
          tracking_code: $("detailTracking").value,
        }),
      });
      toast("سفارش به‌روزرسانی شد", "ok");
      closeModal("orderModal");
      loadOrders();
      loadOverview();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function loadWebhookPanel() {
    await Promise.all([loadWebhookSetup(), loadWebhooks()]);
  }
  async function loadWebhookSetup() {
    try {
      const data = await api("/api/store/admin/webhooks/setup");
      const hook = data.webhook;
      $("webhookUrl").value = hook.url || "";
      $("webhookAuth").value = hook.authorization || "";
      $("webhookRequireHeader").checked = Boolean(hook.require_header);
      $("webhookState").textContent = "آماده";
      $("webhookState").className = "badge status-confirmed";
      $("eventTypes").innerHTML = Object.entries(hook.event_types || {})
        .map(
          ([id, name]) =>
            `<label class="event-check"><input type="checkbox" value="${id}" ${(hook.event_ids || []).map(String).includes(id) ? "checked" : ""}><span>${esc(name)}</span></label>`,
        )
        .join("");
    } catch (error) {
      $("webhookStatus").textContent = error.message;
      $("webhookStatus").className = "form-status error";
    }
  }
  async function saveWebhook() {
    const event_ids = [
      ...$("eventTypes").querySelectorAll("input:checked"),
    ].map((node) => Number(node.value));
    try {
      await api("/api/store/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          settings: {
            basalam_webhook: {
              enabled: true,
              require_header: $("webhookRequireHeader").checked,
              event_ids,
            },
          },
        }),
      });
      toast("تنظیمات وب‌هوک ذخیره شد", "ok");
      await loadWebhookSetup();
    } catch (error) {
      toast(error.message, "error");
    }
  }
  async function rotateWebhook() {
    if (
      !confirm(
        "URL و Bearer قبلی بلافاصله نامعتبر شوند؟ پس از چرخش باید پنل باسلام را هم به‌روزرسانی کنید.",
      )
    )
      return;
    try {
      const data = await api("/api/store/admin/webhooks/rotate", {
        method: "POST",
        body: "{}",
      });
      $("webhookUrl").value = data.webhook.url;
      $("webhookAuth").value = data.webhook.authorization;
      toast("Secretهای جدید ساخته شدند", "ok");
    } catch (error) {
      toast(error.message, "error");
    }
  }
  async function registerWebhook() {
    if (
      !confirm(
        "وب‌هوک با توکن اتصال فعلی باسلام و eventهای انتخاب‌شده ثبت شود؟",
      )
    )
      return;
    try {
      $("webhookStatus").textContent = "در حال ثبت در webhook.basalam.com…";
      const data = await api("/api/store/admin/webhooks/register", {
        method: "POST",
        body: "{}",
      });
      $("webhookStatus").textContent = "✓ وب‌هوک باسلام ثبت شد";
      $("webhookStatus").className = "form-status ok";
      toast("ثبت وب‌هوک موفق بود", "ok");
      console.info(data.registration);
    } catch (error) {
      $("webhookStatus").textContent = error.message;
      $("webhookStatus").className = "form-status error";
    }
  }
  async function loadWebhooks() {
    try {
      const data = await api("/api/store/admin/webhooks");
      state.events = data.events || [];
      $("webhookEvents").innerHTML =
        state.events
          .map(
            (event) =>
              `<button class="event-row" data-event="${esc(event.id)}" type="button"><i>${event.event_id || "?"}</i><span><b>${esc(event.event_name)}</b><small>${esc(event.summary?.message || event.summary?.title || "رخداد دریافت شد")}</small></span><time>${date(event.received_at)}${event.deliveries > 1 ? ` · ${fa(event.deliveries)} تحویل` : ""}</time></button>`,
          )
          .join("") || '<div class="empty">هنوز رخدادی دریافت نشده است.</div>';
      $("webhookEvents")
        .querySelectorAll("[data-event]")
        .forEach((node) =>
          node.addEventListener("click", () => openEvent(node.dataset.event)),
        );
    } catch (error) {
      $("webhookEvents").innerHTML =
        `<div class="empty">${esc(error.message)}</div>`;
    }
  }
  async function openEvent(id) {
    openModal("eventModal");
    $("eventDetail").innerHTML =
      '<div class="empty">در حال دریافت payload…</div>';
    try {
      const data = await api(
        `/api/store/admin/webhooks/${encodeURIComponent(id)}`,
      );
      const event = data.event;
      $("eventDetail").innerHTML =
        `<div class="detail-head"><h2>${esc(event.event_name)}</h2><p>${date(event.received_at)} · شناسه ${esc(event.id)}</p></div><h3>Payload ثبت‌شده</h3><pre id="eventPayload" class="payload"></pre>`;
      $("eventPayload").textContent = JSON.stringify(event.payload, null, 2);
    } catch (error) {
      $("eventDetail").innerHTML =
        `<div class="empty">${esc(error.message)}</div>`;
    }
  }

  function openModal(id) {
    $(id).classList.add("open");
    $(id).setAttribute("aria-hidden", "false");
    $("adminOverlay").classList.add("open");
  }
  function closeModal(id) {
    $(id).classList.remove("open");
    $(id).setAttribute("aria-hidden", "true");
    if (!document.querySelector(".admin-modal.open"))
      $("adminOverlay").classList.remove("open");
  }

  function bindEvents() {
    document
      .querySelectorAll(".nav-item")
      .forEach((node) =>
        node.addEventListener("click", () => showView(node.dataset.view)),
      );
    document
      .querySelectorAll("[data-go]")
      .forEach((node) =>
        node.addEventListener("click", () => showView(node.dataset.go)),
      );
    $("refreshPage").addEventListener("click", () => {
      loadOverview();
      const active = document.querySelector(".nav-item.active")?.dataset.view;
      if (active === "orders") loadOrders();
      if (active === "webhooks") loadWebhookPanel();
    });
    $("sidebarToggle").addEventListener("click", () => {
      document.querySelector(".admin-sidebar").classList.add("open");
      $("adminOverlay").classList.add("open");
    });
    $("adminOverlay").addEventListener("click", () => {
      document.querySelector(".admin-sidebar").classList.remove("open");
      closeModal("orderModal");
      closeModal("eventModal");
    });
    $("storeSettings").addEventListener("submit", saveStoreSettings);
    $("paymentSettings").addEventListener("submit", savePayments);
    $("storeSettings").elements.accent.addEventListener("input", (event) => {
      $("storeSettings").elements.accent_text.value = event.target.value;
    });
    $("storeSettings").elements.accent_text.addEventListener(
      "input",
      (event) => {
        if (/^#[0-9a-f]{6}$/i.test(event.target.value))
          $("storeSettings").elements.accent.value = event.target.value;
      },
    );
    $("orderFilter").addEventListener("click", () => {
      state.orderPage = 1;
      loadOrders();
    });
    $("orderSearch").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        state.orderPage = 1;
        loadOrders();
      }
    });
    $("orderStatus").addEventListener("change", () => {
      state.orderPage = 1;
      loadOrders();
    });
    $("orderModalClose").addEventListener("click", () =>
      closeModal("orderModal"),
    );
    $("eventModalClose").addEventListener("click", () =>
      closeModal("eventModal"),
    );
    $("saveWebhook").addEventListener("click", saveWebhook);
    $("rotateWebhook").addEventListener("click", rotateWebhook);
    $("registerWebhook").addEventListener("click", registerWebhook);
    $("refreshWebhooks").addEventListener("click", loadWebhooks);
    document.querySelectorAll("[data-copy]").forEach((node) =>
      node.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText($(node.dataset.copy).value);
          toast("کپی شد", "ok");
        } catch (_) {
          toast("کپی خودکار ممکن نیست", "error");
        }
      }),
    );
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const hadInnerLayer = Boolean(
          document.querySelector(".admin-modal.open,.admin-sidebar.open"),
        );
        closeModal("orderModal");
        closeModal("eventModal");
        document.querySelector(".admin-sidebar")?.classList.remove("open");
        $("adminOverlay").classList.remove("open");
        if (
          !hadInnerLayer &&
          document.body.classList.contains("embedded-admin") &&
          window.parent !== window
        )
          window.parent.postMessage(
            { type: "scraper4:close-store-manager" },
            location.origin,
          );
      }
    });
  }

  bindEvents();
  loadOverview();
})();
