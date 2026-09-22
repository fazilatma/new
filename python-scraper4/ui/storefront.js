(() => {
  "use strict";

  const BASE = document.body.dataset.base || "";
  const $ = (id) => document.getElementById(id);
  const state = {
    config: null,
    products: [],
    featuredProducts: [],
    productMap: new Map(),
    categories: [],
    profiles: [],
    page: 1,
    totalPages: 1,
    total: 0,
    query: "",
    category: "",
    profile: "",
    sort: "featured",
    available: false,
    loading: false,
    requestSeq: 0,
    cart: loadCart(),
    lastOrder: loadLastOrder(),
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

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""), location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function fa(value) {
    return new Intl.NumberFormat("fa-IR").format(Number(value || 0));
  }

  function price(value) {
    return `${fa(value)} تومان`;
  }

  function loadCart() {
    try {
      const rows = JSON.parse(
        localStorage.getItem("scraper4-store-cart") || "[]",
      );
      return Array.isArray(rows)
        ? rows
            .filter((row) => row && row.id && Number(row.quantity) > 0)
            .slice(0, 40)
        : [];
    } catch (_) {
      return [];
    }
  }

  function loadLastOrder() {
    try {
      const saved = JSON.parse(
        localStorage.getItem("scraper4-last-order") || "null",
      );
      if (!saved?.id) return null;
      return {
        id: String(saved.id),
        access_token: String(saved.token || ""),
        mobile: String(saved.mobile || ""),
      };
    } catch (_) {
      return null;
    }
  }

  function saveCart() {
    localStorage.setItem("scraper4-store-cart", JSON.stringify(state.cart));
    renderCart();
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    const response = await fetch(BASE + path, {
      ...options,
      headers,
      cache: options.cache || "no-store",
    });
    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = { ok: false, error: "پاسخ سرور قابل خواندن نیست" };
    }
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || `خطای HTTP ${response.status}`);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  function toast(message, type = "") {
    const node = document.createElement("div");
    node.className = `toast ${type}`.trim();
    node.textContent = message;
    $("toastRegion").appendChild(node);
    setTimeout(() => node.remove(), 3600);
  }

  function applyBrand() {
    const cfg = state.config;
    if (!cfg) return;
    const root = document.documentElement;
    if (/^#[0-9a-f]{6}$/i.test(cfg.accent || ""))
      root.style.setProperty("--accent", cfg.accent);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", cfg.accent || "#ef4056");
    document.title = `${cfg.name || "فروشگاه"} | خرید آنلاین`;
    $("brandName").textContent = cfg.name || "فروشگاه من";
    $("footerName").textContent = cfg.name || "فروشگاه من";
    $("brandTagline").textContent = cfg.tagline || "";
    $("heroTitle").textContent = cfg.tagline || "همه چیز برای یک خرید مطمئن";
    $("heroDescription").textContent = cfg.description || "";
    $("footerDescription").textContent = cfg.description || "";
    $("announcement").firstElementChild.textContent =
      cfg.announcement || "خرید امن و ارسال مطمئن";
    $("shippingEta").textContent =
      cfg.shipping?.eta || "زمان ارسال در تسویه نمایش داده می‌شود";
    $("supportText").textContent = cfg.support_phone
      ? `پاسخ‌گویی: ${cfg.support_phone}`
      : "همراه شما تا دریافت سفارش";
  }

  async function loadConfig() {
    const data = await api("/api/store/config", { cache: "default" });
    state.config = data.store;
    applyBrand();
    renderPaymentMethods();
  }

  function queryString() {
    const params = new URLSearchParams({
      page: String(state.page),
      per_page: "24",
      sort: state.sort,
    });
    if (state.query) params.set("q", state.query);
    if (state.category) params.set("category", state.category);
    if (state.profile) params.set("profile", state.profile);
    if (state.available) params.set("available", "1");
    return params.toString();
  }

  async function loadProducts({ scroll = false } = {}) {
    const sequence = ++state.requestSeq;
    state.loading = true;
    showProductLoading();
    try {
      const data = await api(`/api/store/products?${queryString()}`, {
        cache: "default",
      });
      if (sequence !== state.requestSeq) return;
      state.products = data.items || [];
      state.products.forEach((item) => state.productMap.set(item.id, item));
      if (
        !state.featuredProducts.length &&
        state.page === 1 &&
        !state.query &&
        !state.category &&
        !state.profile
      ) {
        const available = state.products.filter((item) => item.available);
        const featured = available.length ? available : state.products;
        state.featuredProducts = featured.slice(0, 8);
      }
      state.categories = data.categories || [];
      state.profiles = data.profiles || [];
      state.total = Number(data.total || 0);
      state.totalPages = Number(data.total_pages || 1);
      renderProducts();
      renderFeatured();
      renderFilters();
      renderPagination();
      if (scroll)
        $("products").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (sequence !== state.requestSeq) return;
      $("productGrid").innerHTML = "";
      $("offers")?.classList.add("hidden");
      $("emptyProducts").classList.remove("hidden");
      $("emptyProducts").querySelector("h3").textContent =
        "دریافت محصولات ناموفق بود";
      $("emptyProducts").querySelector("p").textContent = error.message;
      toast(error.message, "error");
    } finally {
      if (sequence === state.requestSeq) state.loading = false;
    }
  }

  function showProductLoading() {
    $("emptyProducts").classList.add("hidden");
    $("productGrid").innerHTML = '<div class="product-skeleton"></div>'.repeat(
      8,
    );
  }

  function imageMarkup(item, className = "") {
    const src = safeUrl(item.image);
    if (!src)
      return `<span class="image-placeholder ${className}" aria-hidden="true">◇</span>`;
    return `<img class="fallback-image ${className}" src="${esc(src)}" alt="${esc(item.title || "")}" loading="lazy">`;
  }

  function bindImageFallbacks(scope = document) {
    scope.querySelectorAll("img.fallback-image").forEach((image) => {
      image.addEventListener(
        "error",
        () => {
          const replacement = document.createElement("span");
          replacement.className = "image-placeholder";
          replacement.textContent = "◇";
          image.replaceWith(replacement);
        },
        { once: true },
      );
    });
  }

  function card(item) {
    const comparison = Number(item.compare_price || 0);
    const unavailable = !item.available;
    return `<article class="product-card" data-id="${esc(item.id)}">
      <div class="product-badges">
        ${item.discount_percent ? `<span class="product-badge">${fa(item.discount_percent)}٪ تخفیف</span>` : ""}
        ${item.price_adjusted ? '<span class="product-badge adjusted">قیمت نهایی پروفایل</span>' : ""}
      </div>
      <button class="product-image js-detail" type="button" aria-label="جزئیات ${esc(item.title)}">${imageMarkup(item)}</button>
      <div class="product-profile">${esc([item.profile, item.category].filter(Boolean).join(" · "))}</div>
      <h3 class="product-title js-detail">${esc(item.title)}</h3>
      <span class="product-stock ${unavailable ? "out" : ""}">${unavailable ? "ناموجود" : `${fa(item.stock)} عدد موجود`}</span>
      <div class="product-price-row">
        ${item.discount_percent ? `<span class="product-discount">${fa(item.discount_percent)}٪</span>` : "<span></span>"}
        <div class="product-price">${comparison > Number(item.price) ? `<del>${fa(comparison)}</del>` : "<del></del>"}<b>${fa(item.price)}</b><small>تومان</small></div>
      </div>
      <button class="add-button js-add" type="button" ${unavailable ? "disabled" : ""}>${unavailable ? "ناموجود" : "+ افزودن به سبد"}</button>
    </article>`;
  }

  function featuredCard(item) {
    const comparison = Number(item.compare_price || 0);
    const current = Number(item.price || 0);
    const discount = Number(item.discount_percent || 0);
    return `<article class="featured-product" data-id="${esc(item.id)}">
      ${discount ? `<span class="featured-discount">${fa(discount)}٪</span>` : '<span class="featured-choice">منتخب</span>'}
      <button class="featured-image js-featured-detail" type="button" aria-label="جزئیات ${esc(item.title)}">${imageMarkup(item)}</button>
      <span class="featured-profile">${esc(item.profile || item.category || "پیشنهاد فروشگاه")}</span>
      <h3 class="js-featured-detail">${esc(item.title)}</h3>
      <div class="featured-price">
        ${comparison > current ? `<del>${fa(comparison)}</del>` : ""}
        <b>${fa(current)}</b><small>تومان</small>
      </div>
      <button class="featured-add js-featured-add" type="button" aria-label="افزودن ${esc(item.title)} به سبد" ${item.available ? "" : "disabled"}>${item.available ? "+" : "×"}</button>
    </article>`;
  }

  function renderFeatured() {
    const section = $("offers");
    const rail = $("featuredRail");
    if (!section || !rail) return;
    if (!state.featuredProducts.length) {
      section.classList.add("hidden");
      rail.innerHTML = "";
      return;
    }
    section.classList.remove("hidden");
    rail.innerHTML = state.featuredProducts.map(featuredCard).join("");
    bindImageFallbacks(rail);
    rail.querySelectorAll(".featured-product").forEach((node) => {
      const id = node.dataset.id;
      node
        .querySelectorAll(".js-featured-detail")
        .forEach((button) =>
          button.addEventListener("click", () => openProduct(id)),
        );
      node
        .querySelector(".js-featured-add")
        ?.addEventListener("click", () => addToCart(id));
    });
  }

  function renderProducts() {
    $("resultCount").textContent = state.total
      ? `${fa(state.total)} کالا پیدا شد`
      : "کالایی پیدا نشد";
    if (!state.products.length) {
      $("productGrid").innerHTML = "";
      $("emptyProducts").classList.remove("hidden");
      return;
    }
    $("emptyProducts").classList.add("hidden");
    $("productGrid").innerHTML = state.products.map(card).join("");
    bindImageFallbacks($("productGrid"));
    $("productGrid")
      .querySelectorAll(".product-card")
      .forEach((node) => {
        const id = node.dataset.id;
        node
          .querySelectorAll(".js-detail")
          .forEach((button) =>
            button.addEventListener("click", () => openProduct(id)),
          );
        node
          .querySelector(".js-add")
          ?.addEventListener("click", () => addToCart(id));
      });
  }

  function categoryIcon(index) {
    return ["◈", "◇", "○", "✦", "△", "□", "⌁", "◎"][index % 8];
  }

  function renderFilters() {
    const categoryRows = state.categories;
    $("categoryChips").innerHTML = [
      `<button class="category-chip ${!state.category ? "active" : ""}" data-category="" type="button"><i>همه</i><span>همه محصولات</span></button>`,
      ...categoryRows
        .slice(0, 12)
        .map(
          (row, index) =>
            `<button class="category-chip ${state.category === row.name ? "active" : ""}" data-category="${esc(row.name)}" type="button"><i>${categoryIcon(index)}</i><span>${esc(row.name)}</span></button>`,
        ),
    ].join("");
    $("categoryChips")
      .querySelectorAll("[data-category]")
      .forEach((node) =>
        node.addEventListener("click", () =>
          setCategory(node.dataset.category || ""),
        ),
      );

    $("categoryFilters").innerHTML =
      categoryRows
        .map(
          (row) =>
            `<label class="filter-option"><input type="radio" name="category-filter" value="${esc(row.name)}" ${state.category === row.name ? "checked" : ""}><span>${esc(row.name)}</span><b>${fa(row.count)}</b></label>`,
        )
        .join("") || "<small>دسته‌بندی ثبت نشده است.</small>";
    $("categoryFilters")
      .querySelectorAll("input")
      .forEach((node) =>
        node.addEventListener("change", () => setCategory(node.value)),
      );

    $("profileFilters").innerHTML = state.profiles
      .map(
        (row) =>
          `<label class="filter-option"><input type="radio" name="profile-filter" value="${esc(row.name)}" ${state.profile === row.name ? "checked" : ""}><span>${esc(row.name)}</span><b>${fa(row.count)}</b></label>`,
      )
      .join("");
    $("profileFilterSection").classList.toggle(
      "hidden",
      !state.profiles.length,
    );
    $("profileFilters")
      .querySelectorAll("input")
      .forEach((node) =>
        node.addEventListener("change", () => {
          state.profile = node.value;
          state.page = 1;
          loadProducts({ scroll: true });
        }),
      );

    $("quickCategories").innerHTML = categoryRows
      .slice(0, 4)
      .map(
        (row) =>
          `<a href="#products" data-category="${esc(row.name)}">${esc(row.name)}</a>`,
      )
      .join("");
    $("quickCategories")
      .querySelectorAll("[data-category]")
      .forEach((node) =>
        node.addEventListener("click", (event) => {
          event.preventDefault();
          setCategory(node.dataset.category || "");
        }),
      );

    $("drawerCategories").innerHTML =
      categoryRows
        .map(
          (row, index) =>
            `<button class="drawer-category" data-category="${esc(row.name)}" type="button"><i>${categoryIcon(index)}</i><span>${esc(row.name)}</span><b>${fa(row.count)} کالا</b></button>`,
        )
        .join("") || "<p>هنوز دسته‌بندی‌ای وجود ندارد.</p>";
    $("drawerCategories")
      .querySelectorAll("[data-category]")
      .forEach((node) =>
        node.addEventListener("click", () => {
          setCategory(node.dataset.category || "");
          closeLayers();
        }),
      );
    $("availableOnly").checked = state.available;
  }

  function setCategory(category) {
    state.category = category;
    state.page = 1;
    loadProducts({ scroll: true });
  }

  function resetFilters() {
    state.query = "";
    state.category = "";
    state.profile = "";
    state.available = false;
    state.page = 1;
    $("searchInput").value = "";
    $("clearSearch").classList.remove("visible");
    loadProducts({ scroll: true });
  }

  function renderPagination() {
    if (state.totalPages <= 1) {
      $("pagination").innerHTML = "";
      return;
    }
    const pages = new Set([
      1,
      state.totalPages,
      state.page - 1,
      state.page,
      state.page + 1,
    ]);
    const valid = [...pages]
      .filter((page) => page >= 1 && page <= state.totalPages)
      .sort((a, b) => a - b);
    const parts = [
      `<button class="page-button" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""} aria-label="صفحه قبل">‹</button>`,
    ];
    let previous = 0;
    valid.forEach((page) => {
      if (previous && page - previous > 1)
        parts.push('<span class="page-button">…</span>');
      parts.push(
        `<button class="page-button ${page === state.page ? "active" : ""}" data-page="${page}" type="button">${fa(page)}</button>`,
      );
      previous = page;
    });
    parts.push(
      `<button class="page-button" data-page="${state.page + 1}" ${state.page >= state.totalPages ? "disabled" : ""} aria-label="صفحه بعد">›</button>`,
    );
    $("pagination").innerHTML = parts.join("");
    $("pagination")
      .querySelectorAll("button[data-page]:not(:disabled)")
      .forEach((node) =>
        node.addEventListener("click", () => {
          state.page = Number(node.dataset.page);
          loadProducts({ scroll: true });
        }),
      );
  }

  async function openProduct(id) {
    openModal("productModal");
    $("productModalBody").innerHTML = '<div class="product-skeleton"></div>';
    try {
      const data = await api(`/api/store/products/${encodeURIComponent(id)}`, {
        cache: "default",
      });
      const item = data.product;
      state.productMap.set(item.id, item);
      const images = (item.images?.length ? item.images : [item.image]).filter(
        Boolean,
      );
      $("productModalBody").innerHTML = `<div class="product-detail-grid">
        <div><div class="product-gallery-main">${imageMarkup({ ...item, image: images[0] || "" })}</div><div class="product-thumbs">${images.map((image) => `<button class="product-thumb" data-image="${esc(safeUrl(image))}" type="button"><img class="fallback-image" src="${esc(safeUrl(image))}" alt=""></button>`).join("")}</div></div>
        <div class="product-detail-info"><span class="eyebrow">${esc(item.category)}</span><h2 id="productModalTitle">${esc(item.title)}</h2>
          <div class="detail-meta"><span>${esc(item.profile || "")}</span>${item.sku ? `<span>کد کالا: ${esc(item.sku)}</span>` : ""}<span>${item.available ? `${fa(item.stock)} عدد موجود` : "ناموجود"}</span></div>
          ${item.short_description ? `<p class="detail-description">${esc(item.short_description)}</p>` : ""}
          ${item.description ? `<p class="detail-description">${esc(item.description)}</p>` : ""}
          <div class="detail-attributes">${(item.attributes || []).map((row) => `<div class="detail-attribute"><small>${esc(row.name)}</small><b>${esc(row.value)}</b></div>`).join("")}</div>
          <div class="detail-buy-box"><div class="product-price"><b>${fa(item.price)}</b><small>تومان</small></div><button class="add-button" id="modalAdd" type="button" ${item.available ? "" : "disabled"}>${item.available ? "افزودن به سبد خرید" : "این کالا ناموجود است"}</button></div>
        </div></div>`;
      bindImageFallbacks($("productModalBody"));
      $("modalAdd")?.addEventListener("click", () => {
        addToCart(item.id);
        closeModal("productModal");
        openDrawer("cartDrawer");
      });
      $("productModalBody")
        .querySelectorAll(".product-thumb")
        .forEach((button) =>
          button.addEventListener("click", () => {
            const main = $("productModalBody").querySelector(
              ".product-gallery-main img",
            );
            if (main && button.dataset.image) main.src = button.dataset.image;
          }),
        );
    } catch (error) {
      $("productModalBody").innerHTML =
        `<div class="empty-state"><h3>جزئیات محصول دریافت نشد</h3><p>${esc(error.message)}</p></div>`;
    }
  }

  function findCart(id) {
    return state.cart.find((row) => row.id === id);
  }

  function addToCart(id) {
    const item = state.productMap.get(id);
    if (!item || !item.available)
      return toast("این کالا اکنون موجود نیست", "error");
    const current = findCart(id);
    if (current) {
      if (current.quantity >= Math.min(20, Number(item.stock || 20)))
        return toast("بیشتر از موجودی قابل افزودن نیست", "error");
      current.quantity += 1;
      current.price = Number(item.price);
      current.stock = Number(item.stock);
    } else {
      state.cart.push({
        id: item.id,
        title: item.title,
        image: item.image || "",
        price: Number(item.price),
        stock: Number(item.stock),
        quantity: 1,
      });
    }
    saveCart();
    toast("به سبد خرید اضافه شد", "success");
  }

  function changeQuantity(id, delta) {
    const item = findCart(id);
    if (!item) return;
    const next = item.quantity + delta;
    if (next <= 0) state.cart = state.cart.filter((row) => row.id !== id);
    else if (next <= Math.min(20, Number(item.stock || 20)))
      item.quantity = next;
    else return toast("موجودی کافی نیست", "error");
    saveCart();
  }

  function renderCart() {
    const count = state.cart.reduce(
      (sum, row) => sum + Number(row.quantity),
      0,
    );
    const subtotal = state.cart.reduce(
      (sum, row) => sum + Number(row.price) * Number(row.quantity),
      0,
    );
    $("cartCount").textContent = fa(count);
    $("mobileCartCount").textContent = fa(count);
    $("cartTitleCount").textContent = count ? `(${fa(count)} کالا)` : "";
    $("cartEmpty").classList.toggle("hidden", Boolean(state.cart.length));
    $("cartSummary").classList.toggle("hidden", !state.cart.length);
    $("cartItems").innerHTML = state.cart
      .map(
        (item) =>
          `<article class="cart-item" data-id="${esc(item.id)}"><div class="cart-item-image">${imageMarkup(item)}</div><div><h3>${esc(item.title)}</h3><div class="cart-item-bottom"><div><div class="quantity"><button class="plus" type="button" aria-label="افزایش">+</button><b>${fa(item.quantity)}</b><button class="minus" type="button" aria-label="کاهش">−</button></div><button class="remove-item" type="button">حذف از سبد</button></div><div class="cart-item-price"><b>${price(item.price * item.quantity)}</b><small>${fa(item.quantity)} عدد</small></div></div></div></article>`,
      )
      .join("");
    $("cartSubtotal").textContent = price(subtotal);
    $("cartTotal").textContent = price(subtotal);
    bindImageFallbacks($("cartItems"));
    $("cartItems")
      .querySelectorAll(".cart-item")
      .forEach((node) => {
        node
          .querySelector(".plus")
          .addEventListener("click", () => changeQuantity(node.dataset.id, 1));
        node
          .querySelector(".minus")
          .addEventListener("click", () => changeQuantity(node.dataset.id, -1));
        node.querySelector(".remove-item").addEventListener("click", () => {
          state.cart = state.cart.filter((row) => row.id !== node.dataset.id);
          saveCart();
        });
      });
  }

  function cartSubtotal() {
    return state.cart.reduce(
      (sum, row) => sum + Number(row.price) * Number(row.quantity),
      0,
    );
  }

  function shippingPreview() {
    const subtotal = cartSubtotal();
    const shipping = state.config?.shipping || {};
    return Number(shipping.free_over || 0) &&
      subtotal >= Number(shipping.free_over)
      ? 0
      : Number(shipping.flat_fee || 0);
  }

  function renderPaymentMethods() {
    if (!state.config) return;
    const methods = state.config.payment_methods || [];
    $("paymentMethods").innerHTML =
      methods
        .map(
          (method, index) =>
            `<label class="payment-method"><input type="radio" name="payment_method" value="${esc(method.id)}" ${index === 0 ? "checked" : ""}><i>${method.online ? "◇" : "⌂"}</i><span><b>${esc(method.title)}</b><small>${esc(method.description)}</small></span></label>`,
        )
        .join("") ||
      '<div class="form-error">روش پرداخت فعالی وجود ندارد.</div>';
  }

  function openCheckout() {
    if (!state.cart.length) return toast("سبد خرید خالی است", "error");
    closeLayers();
    $("checkoutForm").classList.remove("hidden");
    $("orderSuccess").classList.add("hidden");
    $("checkoutError").classList.add("hidden");
    $("checkoutItems").innerHTML = state.cart
      .map(
        (item) =>
          `<div class="checkout-mini-item">${safeUrl(item.image) ? `<img class="fallback-image" src="${esc(safeUrl(item.image))}" alt="">` : '<span class="checkout-mini-placeholder"></span>'}<b>${esc(item.title)}</b><small>${fa(item.quantity)} × ${fa(item.price)}</small></div>`,
      )
      .join("");
    const subtotal = cartSubtotal();
    const shipping = shippingPreview();
    $("checkoutSubtotal").textContent = price(subtotal);
    $("checkoutShipping").textContent = shipping ? price(shipping) : "رایگان";
    $("checkoutTotal").textContent = price(subtotal + shipping);
    renderPaymentMethods();
    bindImageFallbacks($("checkoutItems"));
    openModal("checkoutModal");
  }

  function idempotencyKey() {
    const signature = state.cart
      .map((row) => `${row.id}:${row.quantity}`)
      .sort()
      .join("|");
    const saved = JSON.parse(
      sessionStorage.getItem("scraper4-order-idempotency") || "null",
    );
    if (saved?.signature === signature && saved?.key) return saved.key;
    const key = globalThis.crypto?.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(
      "scraper4-order-idempotency",
      JSON.stringify({ signature, key }),
    );
    return key;
  }

  async function submitCheckout(event) {
    event.preventDefault();
    const button = $("placeOrder");
    const errorBox = $("checkoutError");
    button.disabled = true;
    button.classList.add("loading");
    errorBox.classList.add("hidden");
    const form = new FormData(event.currentTarget);
    const body = {
      customer: {
        name: form.get("name"),
        mobile: form.get("mobile"),
        email: form.get("email"),
        province: form.get("province"),
        city: form.get("city"),
        address: form.get("address"),
        postal_code: form.get("postal_code"),
      },
      note: form.get("note"),
      payment_method: form.get("payment_method"),
      idempotency_key: idempotencyKey(),
      items: state.cart.map((row) => ({ id: row.id, quantity: row.quantity })),
    };
    try {
      const data = await api("/api/store/orders", {
        method: "POST",
        body: JSON.stringify(body),
      });
      finishOrder(data.order);
    } catch (error) {
      if (error.payload?.order) {
        finishOrder(error.payload.order, error.message);
      } else {
        errorBox.textContent = error.message;
        errorBox.classList.remove("hidden");
      }
    } finally {
      button.disabled = false;
      button.classList.remove("loading");
    }
  }

  function finishOrder(order, warning = "") {
    state.lastOrder = order;
    localStorage.setItem(
      "scraper4-last-order",
      JSON.stringify({
        id: order.id,
        token: order.access_token || "",
        mobile: $("checkoutForm").elements.mobile.value,
      }),
    );
    state.cart = [];
    saveCart();
    sessionStorage.removeItem("scraper4-order-idempotency");
    $("checkoutForm").classList.add("hidden");
    $("orderSuccess").classList.remove("hidden");
    $("successOrderId").textContent = order.id;
    $("successMessage").textContent =
      warning ||
      (order.payment_method === "cod"
        ? "سفارش ثبت شد و برای آماده‌سازی بررسی می‌شود."
        : "سفارش ثبت شد؛ برای تکمیل خرید وارد درگاه شوید.");
    const pay = $("payNow");
    pay.dataset.retry = "";
    if (safeUrl(order.redirect_url)) {
      pay.href = safeUrl(order.redirect_url);
      pay.classList.remove("hidden");
      pay.textContent = "ورود به صفحه پرداخت";
    } else if (
      warning &&
      order.access_token &&
      order.payment_method !== "cod"
    ) {
      pay.href = "#";
      pay.dataset.retry = "1";
      pay.classList.remove("hidden");
      pay.textContent = "تلاش دوباره برای اتصال به درگاه";
    } else {
      pay.classList.add("hidden");
    }
    if (!warning && safeUrl(order.redirect_url))
      setTimeout(() => {
        location.assign(order.redirect_url);
      }, 700);
  }

  async function retryPayment(event) {
    if ($("payNow").dataset.retry !== "1") return;
    event.preventDefault();
    const order = state.lastOrder;
    if (!order?.id || !order.access_token) return;
    $("payNow").textContent = "در حال اتصال…";
    try {
      const data = await api(
        `/api/store/orders/${encodeURIComponent(order.id)}/pay`,
        {
          method: "POST",
          body: "{}",
          headers: { Authorization: `Bearer ${order.access_token}` },
        },
      );
      state.lastOrder = { ...data.order, access_token: order.access_token };
      if (safeUrl(data.order.redirect_url))
        location.assign(data.order.redirect_url);
      else throw new Error("نشانی درگاه دریافت نشد");
    } catch (error) {
      $("payNow").textContent = "تلاش دوباره برای اتصال به درگاه";
      toast(error.message, "error");
    }
  }

  async function trackOrder(event) {
    event.preventDefault();
    const result = $("trackResult");
    result.classList.remove("hidden");
    result.innerHTML = "<p>در حال دریافت وضعیت سفارش…</p>";
    try {
      const data = await api("/api/store/orders/track", {
        method: "POST",
        body: JSON.stringify({
          order_id: $("trackOrderId").value,
          mobile: $("trackMobile").value,
        }),
      });
      const order = data.order;
      result.innerHTML = `<div class="track-result-head"><div><small>سفارش <b dir="ltr">${esc(order.id)}</b></small><h3>${esc(order.status_title)}</h3></div><span class="track-status">${esc(order.status_title)}</span></div>
        <div class="timeline">${(order.history || []).map((row) => `<div class="timeline-item"><b>${esc(row.title)}</b><small>${new Date(Number(row.at) * 1000).toLocaleString("fa-IR")}</small></div>`).join("")}</div>
        <p>مبلغ سفارش: <b>${price(order.total)}</b>${order.tracking_code ? ` · کد مرسوله: <b>${esc(order.tracking_code)}</b>` : ""}</p>`;
      result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      result.innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
    }
  }

  function openDrawer(id) {
    closeLayers(false);
    $(id).classList.add("open");
    $(id).setAttribute("aria-hidden", "false");
    $("overlay").classList.add("open");
    document.body.classList.add("locked");
  }
  function openModal(id) {
    closeLayers(false);
    $(id).classList.add("open");
    $(id).setAttribute("aria-hidden", "false");
    document.body.classList.add("locked");
  }
  function closeModal(id) {
    $(id)?.classList.remove("open");
    $(id)?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("locked");
  }
  function closeLayers(unlock = true) {
    document.querySelectorAll(".drawer.open,.modal.open").forEach((node) => {
      node.classList.remove("open");
      node.setAttribute("aria-hidden", "true");
    });
    $("overlay").classList.remove("open");
    if (unlock) document.body.classList.remove("locked");
  }

  function openTrack() {
    closeLayers();
    $("track").scrollIntoView({ behavior: "smooth" });
    setTimeout(() => $("trackOrderId").focus(), 400);
  }

  function bindEvents() {
    $("searchForm").addEventListener("submit", (event) => {
      event.preventDefault();
      state.query = $("searchInput").value.trim();
      state.page = 1;
      loadProducts({ scroll: true });
    });
    let searchTimer;
    $("searchInput").addEventListener("input", () => {
      $("clearSearch").classList.toggle(
        "visible",
        Boolean($("searchInput").value),
      );
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = $("searchInput").value.trim();
        state.page = 1;
        loadProducts();
      }, 500);
    });
    $("clearSearch").addEventListener("click", () => {
      $("searchInput").value = "";
      state.query = "";
      state.page = 1;
      $("clearSearch").classList.remove("visible");
      loadProducts();
    });
    document.querySelectorAll("[data-sort]").forEach((node) =>
      node.addEventListener("click", () => {
        document
          .querySelectorAll("[data-sort]")
          .forEach((button) =>
            button.classList.toggle("active", button === node),
          );
        state.sort = node.dataset.sort;
        state.page = 1;
        loadProducts();
      }),
    );
    $("availableOnly").addEventListener("change", () => {
      state.available = $("availableOnly").checked;
      state.page = 1;
      loadProducts();
    });
    $("resetFilters").addEventListener("click", resetFilters);
    $("emptyReset").addEventListener("click", resetFilters);
    $("cartOpen").addEventListener("click", () => openDrawer("cartDrawer"));
    $("mobileCart").addEventListener("click", () => openDrawer("cartDrawer"));
    $("footerCart").addEventListener("click", () => openDrawer("cartDrawer"));
    $("categoryOpen").addEventListener("click", () =>
      openDrawer("categoryDrawer"),
    );
    $("mobileFilterOpen").addEventListener("click", () => {
      $("filters").classList.add("open");
      $("overlay").classList.add("open");
      document.body.classList.add("locked");
    });
    $("trackOpen").addEventListener("click", openTrack);
    $("mobileTrack").addEventListener("click", openTrack);
    $("heroTrack").addEventListener("click", openTrack);
    $("overlay").addEventListener("click", () => {
      $("filters").classList.remove("open");
      closeLayers();
    });
    document
      .querySelectorAll(".drawer-close")
      .forEach((node) => node.addEventListener("click", closeLayers));
    document
      .querySelectorAll(".modal-close")
      .forEach((node) =>
        node.addEventListener("click", () =>
          closeModal(node.closest(".modal").id),
        ),
      );
    document.querySelectorAll(".modal").forEach((node) =>
      node.addEventListener("click", (event) => {
        if (event.target === node) closeModal(node.id);
      }),
    );
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        $("filters").classList.remove("open");
        closeLayers();
      }
    });
    $("checkoutOpen").addEventListener("click", openCheckout);
    $("checkoutForm").addEventListener("submit", submitCheckout);
    $("payNow").addEventListener("click", retryPayment);
    $("trackForm").addEventListener("submit", trackOrder);
    $("successClose").addEventListener("click", () =>
      closeModal("checkoutModal"),
    );
    $("copyOrderId").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("successOrderId").textContent);
        toast("شماره سفارش کپی شد", "success");
      } catch (_) {
        toast("شماره سفارش را دستی کپی کنید");
      }
    });
  }

  async function init() {
    bindEvents();
    renderCart();
    if (state.lastOrder) {
      $("trackOrderId").value = state.lastOrder.id || "";
      $("trackMobile").value = state.lastOrder.mobile || "";
    }
    try {
      await loadConfig();
    } catch (error) {
      toast(`تنظیمات فروشگاه: ${error.message}`, "error");
    }
    await loadProducts();
    const hash = location.hash;
    if (hash === "#track")
      setTimeout(() => {
        openTrack();
        if ($("trackOrderId").value && $("trackMobile").value)
          $("trackForm").requestSubmit();
      }, 200);
  }

  init();
})();
