"""PythonAnywhere WSGI entry point for the v10.599 migration.

This scaffold is intentionally feature-gated until full PHP route/UI parity is
complete; see MIGRATION_STATUS.md.
"""
from __future__ import annotations

import json
from pathlib import Path

from flask import Flask, Response, jsonify, request

from scraper4_port.compat.pagination import build_page_url_custom

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / "migration" / "source_manifest.json").read_text(encoding="utf-8"))
PORT_PARITY_COMPLETE = False

DASHBOARD_HTML = r'''<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#101820">
  <title>Scraper | پنل مرحله‌ای</title>
  <style>
    :root{color-scheme:dark;--bg:#0b1117;--panel:#121c25;--panel2:#17232e;--line:#263745;--text:#edf4f8;--muted:#9fb0bb;--cyan:#51d7d0;--amber:#ffc86a;--red:#ff8b8b;--green:#84e0aa}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 80% -10%,#17333c 0,transparent 42%),var(--bg);color:var(--text);font-family:Tahoma,"Segoe UI",sans-serif;line-height:1.7}
    .wrap{max-width:1100px;margin:auto;padding:22px 18px 48px}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px}.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:18px}.mark{width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,#50dfd2,#3d8be8);color:#071319;display:grid;place-items:center;font-size:22px}.tag{border:1px solid #765d2e;background:#302817;color:var(--amber);border-radius:99px;padding:5px 12px;font-size:12px;font-weight:700}
    .warning{border:1px solid #715629;background:linear-gradient(110deg,#251f13,#1a1c1d);border-radius:16px;padding:16px 18px;margin-bottom:22px}.warning strong{color:var(--amber);font-size:15px}.warning p{margin:4px 0 0;color:#e7d7b8;font-size:13px}
    h1{font-size:clamp(23px,4vw,34px);line-height:1.35;margin:0 0 8px}.lead{margin:0 0 22px;color:var(--muted);max-width:780px;font-size:14px}.layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(260px,.85fr);gap:16px;align-items:start}.card{background:linear-gradient(145deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:0 18px 44px #0002}.card h2{font-size:17px;margin:0 0 4px}.sub{font-size:12px;color:var(--muted);margin:0 0 16px}.formgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:flex;flex-direction:column;gap:5px}.field.full{grid-column:1/-1}label{font-size:12px;color:#c5d2d9}input,select{width:100%;border:1px solid #344a59;border-radius:10px;padding:11px 12px;background:#0d151c;color:var(--text);font:inherit;font-size:13px;outline:none}input:focus,select:focus{border-color:var(--cyan);box-shadow:0 0 0 3px #51d7d022}input[dir=ltr]{text-align:left;direction:ltr}.actions{display:flex;align-items:center;gap:10px;margin-top:14px}button{border:0;border-radius:10px;padding:10px 16px;font:inherit;font-size:13px;font-weight:800;cursor:pointer;background:var(--cyan);color:#081719}button:disabled{opacity:.55;cursor:wait}.hint{font-size:11px;color:var(--muted)}.results{margin-top:18px;display:none}.results.show{display:block}.results h3{font-size:13px;margin:0 0 8px}.result-list{margin:0;padding:0;list-style:none;display:grid;gap:7px}.result-list li{direction:ltr;text-align:left;word-break:break-all;background:#0b1319;border:1px solid #233440;border-radius:9px;padding:9px 11px;color:#bdece7;font:12px/1.5 ui-monospace,monospace}.error{color:var(--red);font-size:12px;margin-top:10px;min-height:20px}.statuscard{margin-bottom:16px}.statline{display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid #263745;padding:8px 0;font-size:12px}.statline:last-child{border-bottom:0}.statline span:first-child{color:var(--muted)}.value{font-weight:700;text-align:left;direction:ltr;overflow-wrap:anywhere}.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid #315343;background:#13291e;color:var(--green);padding:3px 9px;border-radius:99px;font-size:11px}.dot{width:7px;height:7px;background:currentColor;border-radius:50%}.features{display:grid;gap:9px}.feature{display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-size:12px}.feature .state{color:var(--amber);font-size:10px;white-space:nowrap}.foot{margin-top:18px;color:#80929d;font-size:11px;text-align:center}
    @media(max-width:760px){.wrap{padding:14px 12px 34px}.layout{grid-template-columns:1fr}.top{margin-bottom:16px}.card{padding:16px}.formgrid{grid-template-columns:1fr}.field.full{grid-column:auto}.brand{font-size:16px}.tag{font-size:10px}.actions{align-items:flex-start;flex-direction:column}button{width:100%}}
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top"><div class="brand"><div class="mark">س</div><span>Scraper · پنل پایتون</span></div><span class="tag">نسخه مرحله‌ای</span></header>
    <section class="warning" role="status"><strong>در حال انتقال — مناسب آزمایش، نه استفاده عملیاتی</strong><p>رابط اولیه و پیش‌نمایش صفحه‌بندی فعال‌اند؛ اسکرپ، صف‌ها و عملیات اصلی هنوز منتقل نشده‌اند. برای جلوگیری از اختلال، از این نسخه برای کار واقعی فروشگاه استفاده نکنید.</p></section>
    <h1>پنل اسکرپر</h1><p class="lead">این مرحله، پوستهٔ اولیهٔ رابط کاربری و ابزار سازگاری صفحه‌بندی را فراهم می‌کند. وضعیت انتقال و نسخهٔ منبع را از کارت کناری ببینید.</p>
    <div class="layout">
      <section class="card">
        <h2>پیش‌نمایش صفحه‌بندی</h2><p class="sub">چند نشانی صفحهٔ بعدی را بسازید؛ این ابزار هیچ درخواستی به فروشگاه نمی‌فرستد.</p>
        <form id="preview-form">
          <div class="formgrid">
            <div class="field full"><label for="url">نشانی فعلی</label><input id="url" name="url" type="url" dir="ltr" placeholder="https://example.com/products?page=1" required></div>
            <div class="field full"><label for="base-url">نشانی پایه</label><input id="base-url" name="base_url" type="url" dir="ltr" placeholder="https://example.com/products?page=1" required></div>
            <div class="field"><label for="kind">روش صفحه‌بندی</label><select id="kind" name="type"><option value="query_page">پارامتر page</option><option value="query_custom">پارامتر دلخواه</option><option value="path_pattern">الگوی مسیر</option><option value="full_pattern">الگوی کامل نشانی</option></select></div>
            <div class="field"><label for="value">پارامتر یا الگو</label><input id="value" name="value" dir="ltr" placeholder="page"></div>
            <div class="field"><label for="first">شمارهٔ صفحهٔ شروع</label><input id="first" name="from" type="number" value="2" min="1" max="99999"></div>
            <div class="field"><label for="count">تعداد صفحه‌ها (حداکثر ۵۰)</label><input id="count" name="count" type="number" value="3" min="1" max="50"></div>
          </div>
          <div class="actions"><button id="preview-button" type="submit">ساخت پیش‌نمایش</button><span class="hint">نمونهٔ آدرس‌ها فقط در همین صفحه نمایش داده می‌شود.</span></div>
          <div id="preview-error" class="error" role="alert"></div>
        </form>
        <div id="results" class="results"><h3>آدرس‌های ساخته‌شده</h3><ol id="result-list" class="result-list"></ol></div>
      </section>
      <aside>
        <section class="card statuscard"><h2>وضعیت پورت</h2><p class="sub">این وضعیت از API محلی برنامه خوانده می‌شود.</p>
          <div class="statline"><span>وضعیت سرویس</span><span class="pill"><i class="dot"></i>در حال اجرا</span></div>
          <div class="statline"><span>نسخهٔ منبع</span><span id="source-version" class="value">در حال خواندن…</span></div>
          <div class="statline"><span>شاخهٔ منبع</span><span id="source-branch" class="value">—</span></div>
          <div class="statline"><span>آمادهٔ تولید</span><span id="deployable" class="value">خیر</span></div>
          <div id="status-error" class="error"></div>
        </section>
        <section class="card"><h2>امکانات در حال انتقال</h2><p class="sub">این قسمت‌ها هنوز در این نسخه فعال نیستند.</p>
          <div class="features"><div class="feature"><span>استخراج محصولات</span><span class="state">در حال انتقال</span></div><div class="feature"><span>صف‌ها و دو مسیر Basalam</span><span class="state">در حال انتقال</span></div><div class="feature"><span>ذخیره‌سازی و ادامهٔ کار</span><span class="state">در حال انتقال</span></div><div class="feature"><span>ارسال به فروشگاه و اعلان‌ها</span><span class="state">در حال انتقال</span></div></div>
        </section>
      </aside>
    </div>
    <footer class="foot">Scraper Python Port · نسخهٔ آزمایشی · قابلیت‌های منتقل‌نشده غیرفعال‌اند</footer>
  </div>
  <script>
    const form=document.getElementById('preview-form');
    const kind=document.getElementById('kind');
    const value=document.getElementById('value');
    const placeholders={query_page:'page',query_custom:'page',path_pattern:'/page/{page}/',full_pattern:'https://example.com/page/{page}'};
    kind.addEventListener('change',()=>{value.placeholder=placeholders[kind.value]||'';});
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const button=document.getElementById('preview-button');
      const error=document.getElementById('preview-error');
      const results=document.getElementById('results');
      const list=document.getElementById('result-list');
      error.textContent='';list.replaceChildren();results.classList.remove('show');button.disabled=true;button.textContent='در حال ساخت…';
      const params=new URLSearchParams(new FormData(form));
      try{
        const response=await fetch('/api/pagination/preview?'+params.toString(),{headers:{Accept:'application/json'}});
        const data=await response.json();
        if(!response.ok||!data.ok)throw new Error(data.error||'درخواست ناموفق بود');
        for(const url of data.urls){const item=document.createElement('li');item.textContent=url;list.appendChild(item);}
        results.classList.add('show');
      }catch(err){error.textContent=err.message||'ارتباط با سرویس برقرار نشد.';}
      finally{button.disabled=false;button.textContent='ساخت پیش‌نمایش';}
    });
    fetch('/api/port-status',{headers:{Accept:'application/json'}}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error('وضعیت سرویس قابل دریافت نیست');document.getElementById('source-version').textContent=data.source?.version||'—';document.getElementById('source-branch').textContent=data.source?.branch||'—';document.getElementById('deployable').textContent=data.deployable?'بله':'خیر — هنوز ناقص';}).catch(()=>{document.getElementById('status-error').textContent='دریافت وضعیت با خطا روبه‌رو شد.';document.getElementById('source-version').textContent='نامشخص';});
  </script>
</body>
</html>'''


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.update(JSON_AS_ASCII=False, MAX_CONTENT_LENGTH=16 * 1024 * 1024)

    @app.get("/api/port-status")
    def port_status():
        source = MANIFEST["source"]
        counts = MANIFEST["inventory_counts"]
        return jsonify({
            "ok": True,
            "deployable": PORT_PARITY_COMPLETE,
            "migration": "in_progress",
            "source": source,
            "inventory": counts,
            "implemented_ui_features": [
                "initial_dashboard",
                "pagination_preview_form",
            ],
            "implemented_compat_helpers": [
                "pagination.build_page_url_custom",
                "text.persian_to_english",
                "text.normalize_text",
                "text.normalize_html",
                "text.extract_price",
                "urls.make_absolute_url",
                "urls.profile_key",
                "product_key.product_key",
            ],
            "notice": "Not a production replacement. Full route and UI parity has not been completed.",
        }), 200

    @app.get("/api/pagination/preview")
    def pagination_preview():
        current = request.args.get("url", "")
        base = request.args.get("base_url", current)
        kind = request.args.get("type", "query_page")
        value = request.args.get("value", "")
        try:
            first = int(request.args.get("from", "2"))
            count = max(1, min(50, int(request.args.get("count", "3"))))
        except ValueError:
            return jsonify({"ok": False, "error": "from/count must be integers"}), 400
        if not current or not base:
            return jsonify({"ok": False, "error": "url and base_url are required"}), 400
        return jsonify({
            "ok": True,
            "urls": [
                build_page_url_custom(current, base, page, kind, value)
                for page in range(first, first + count)
            ],
        })

    @app.get("/")
    def dashboard():
        # The initial UI is usable only for port-status and pagination preview.
        # The app-wide production gate remains false until full parity is tested.
        return Response(DASHBOARD_HTML, status=200, mimetype="text/html")

    @app.route("/<path:unknown>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def not_migrated(unknown: str):
        return jsonify({
            "ok": False,
            "error": "route_not_ported",
            "route": "/" + unknown,
            "deployable": PORT_PARITY_COMPLETE,
        }), 501

    return app


app = create_app()
