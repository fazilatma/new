#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Scraper4 VPS edition — full-power Python port of scraper4.php 10.123.

This file is the Python product that runs on a dedicated VPS (not PythonAnywhere).
It keeps scraper4.php's extraction, profiles, WooCommerce, Basalam, AI, deploy,
destination ledger, reconcile/repair, and live Task Manager — without request-time
caps, allow-lists, WSGI 120s kills, or free-plan storage guards.

Power that PythonAnywhere stripped, restored here:
- Uncapped pages/products and long-running extract/detail/dispatch workers
- Direct outbound by default (Cloudflare Worker remains optional)
- PHP v10.123 extractBeat + extractChainResume: stalled jobs resume themselves
- Woo/Basalam queues drain to completion in background threads
- Persistent live-task files beside the app (survive reboot)
- systemd + gunicorn --timeout 0 (see deploy/scraper4.service)

Extraction still follows scraper4.php: download/render HTML, CSS selectors,
structural fallbacks, optional Playwright. No source-site product API.

VPS setup
---------
    sudo bash tools/vps-live/install_scraper4_vps.sh

Run locally:  python3 scraper4.py
Data: scraper4_data.json beside this file.
"""

from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import ipaddress
import importlib
import importlib.metadata
import json
import os
import re
import secrets
import site
import socket
import subprocess
import shutil
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import traceback
import logging
import zipfile
from dataclasses import dataclass, field
from html import escape
from typing import Any, Callable, Iterable, Optional
from urllib.parse import parse_qs, quote, unquote, urlencode, urljoin, urlparse, urlunparse

try:
    import requests
    from bs4 import BeautifulSoup, Tag
    from flask import Flask, Response, jsonify, request
except ImportError as exc:
    raise RuntimeError(
        "Missing dependency. Run: pip3 install flask requests beautifulsoup4 lxml"
    ) from exc

# Every APP_VERSION bump must add a new top CHANGELOG row (گزارش تغییرات نسخه‌ها).
APP_VERSION = "10.167"
CHANGELOG = [
    {"version":"10.167","date":"2026-09-20","title":"چسبان شدن انتخابگر پروفایل، ماندگاری فونت و پاک‌سازی فهرست موتورها","items":["کارت انتخاب پروفایل در صفحهٔ شروع هنگام اسکرول بالای صفحه می‌چسبد","فونت انتخابی پس از رفرش دیگر به پیش‌فرض برنمی‌گردد؛ تنظیمات ظاهری اصلاً ذخیره نمی‌شدند","علت: مسیر ذخیرهٔ تنظیمات فقط شبکه و پروفایل فعال را نگه می‌داشت و بقیهٔ گروه‌ها را دور می‌ریخت","فهرست موتورها از ۱۴ گزینه به ۷ گزینهٔ واقعی کاهش یافت؛ ۸ گزینهٔ «پارس» اصلاً قابل انتخاب نبودند و بی‌صدا نادیده گرفته می‌شدند","خواندن JSON-LD و __NEXT_DATA__ و کارت‌های محصول برای همهٔ موتورها به‌صورت خودکار انجام می‌شود و نیازی به انتخاب ندارد","بررسی شد که هر چهار موتور نصب‌شده واقعاً کار می‌کنند و موتور انتخاب‌شده دقیقاً اول امتحان می‌شود"]},
    {"version":"10.166","date":"2026-09-19","title":"رفع هنگ کردن استخراج با پلی‌رایت و نصب SDK باسلام","items":["اگر استخراج با پلی‌رایت انجام می‌شد، کار کاملاً هنگ می‌کرد و حتی «توقف اجباری همه» هم کاری از پیش نمی‌برد","علت: رندر مرورگر مستقیم صدا زده می‌شد و از مسیر قابل‌توقفی که در نسخهٔ ۱۰.۱۶۳ ساخته شده بود رد می‌شد؛ ضمناً هیچ بررسی توقفی داخل خودش نداشت","حالا رندر مرورگر در رشتهٔ جداگانه اجرا می‌شود و بین هر مرحله (اجرا، ناوبری، اسکرول‌ها، خواندن صفحه) توقف بررسی می‌شود","هنگام توقف، مرورگر بسته می‌شود تا پروسهٔ chromium باقی نماند","SDK رسمی باسلام حالا همراه بسته‌های اصلی نصب می‌شود؛ قبلاً فقط در مرحلهٔ اختیاری بود و با SKIP_ENGINES=1 نصب نمی‌شد","سازگاری کامل با نسخهٔ ۱.۲.۰ کتابخانه بررسی و تأیید شد"]},
    {"version":"10.165","date":"2026-09-19","title":"قالب پیش‌فرض تازه برای کل برنامه","items":["رنگ‌بندی حالا واقعاً روی کل برنامه اعمال می‌شود؛ قبلاً ۱۱ متغیر رنگ ساخته می‌شد ولی استایل‌ها فقط یک‌بار از آن‌ها استفاده می‌کردند","۱۹۳ رنگ ثابت به متغیرهای قالب وصل شد، پس تغییر رنگ‌بندی همهٔ کارت‌ها، نوارها و جدول‌ها را عوض می‌کند","یک مقیاس واحد برای گردی گوشه‌ها، فاصله‌ها و اندازهٔ فونت جایگزین ۲۶ گردی و ۲۹ اندازهٔ پراکنده شد","دکمه‌ها، ورودی‌ها، کارت‌ها، جدول‌ها، پنجره‌ها و نوار پیمایش ظاهر یکدست گرفتند","حلقهٔ فوکوس استاندارد برای دسترس‌پذیری و پشتیبانی از کاهش انیمیشن","پنل‌های تودرتو حالا از هم تفکیک رنگی دارند","کنتراست متن در حد AAA استاندارد WCAG بررسی و تأیید شد"]},
    {"version":"10.164","date":"2026-09-19","title":"توقف اجباری، رفع فونت‌ها و بازطراحی بخش نسخه","items":["دکمهٔ «توقف اجباری همهٔ پروسه‌ها» در مدیر وظایف اضافه شد؛ همهٔ کارهای در حال اجرا و در صف را یکجا متوقف می‌کند","انتخاب فونت اصلاً اعمال نمی‌شد چون فایل‌های /assets/fonts/*.css وجود نداشتند و ۴۰۴ می‌دادند؛ حالا از روی سرور سرو می‌شوند","اگر فایل woff2 را در ui/fonts بگذارید از سرور خودتان خوانده می‌شود، وگرنه از CDN","بخش نسخه حالا کارت وضعیت به‌روزرسانی دارد: عقب‌بودن از برنچ، شمارهٔ کامیت و دکمهٔ نصب","قبلاً اندپوینت‌های به‌روزرسانی هیچ رابط کاربری نداشتند و فقط با curl قابل استفاده بودند"]},
    {"version":"10.163","date":"2026-09-19","title":"دکمهٔ توقف، استخراج گیرکرده را فوراً متوقف می‌کند","items":["اگر سایت پاسخ نمی‌داد، توقف تا پایان مهلت کامل (۶۰ ثانیه و روی سرور تا ۵ دقیقه) بی‌اثر بود و دکمه خراب به‌نظر می‌رسید","علت: درخواست شبکه در همان رشته اجرا می‌شد و پرچم توقف فقط یک‌بار در هر صفحه بررسی می‌شد","حالا دریافت صفحه در رشتهٔ جداگانه انجام می‌شود و درخواست توقف در کمتر از یک ثانیه اعمال می‌شود","توقف بین موتورهای مختلف، بین تلاش‌های مجدد و حین مکث بین درخواست‌ها هم بررسی می‌شود","سایت‌های کند ولی سالم همچنان کامل استخراج می‌شوند؛ مهلت کوتاه نشد"]},
    {"version":"10.162","date":"2026-09-19","title":"رفع بیرون‌زدگی کارت‌های صف در موبایل","items":["حداقل عرض ستون‌ها ۳۱۰ پیکسل بود؛ روی گوشی ۳۶۰ پیکسلی بعد از حاشیه‌ها فقط ۳۰۸ پیکسل جا بود و کارت بیرون می‌زد","آدرس‌های طولانی داخل متن خطا شکسته نمی‌شدند و کارت را پهن می‌کردند","عنوان پروفایل و نام مرحله در صورت طولانی بودن با سه‌نقطه کوتاه می‌شوند","در گوشی، حاشیه‌ها کمتر و وضعیت هر مرحله زیر نامش نمایش داده می‌شود و دکمه‌ها تمام‌عرض می‌شوند","همین محافظت به کارت‌های تب «کارها» هم اضافه شد","چیدمان چندستونی روی صفحهٔ بزرگ دست‌نخورده ماند"]},
    {"version":"10.161","date":"2026-09-19","title":"برنامهٔ مراحل صف، رنگی و شهودی","items":["مرحلهٔ فعلی هر کار بیرون از کشویی و در یک نگاه دیده می‌شود، همراه شمارش «۳/۸» و نوار نقطه‌ای","هر مرحله رنگ و نشان جداگانه دارد: انجام‌شده سبز، در حال اجرا آبی و پویا، ناموفق قرمز، منتظر نارنجی","مقصدهایی که به این کار مربوط نیستند خط‌خورده و کم‌رنگ نمایش داده می‌شوند","ریشهٔ مشکل رفع شد: بک‌اند فقط متن فارسی می‌نوشت و کلید مرحله نمی‌فرستاد، برای همین برنامهٔ مراحل هیچ‌وقت با واقعیت مطابقت نداشت و همهٔ مراحل «در پیش» می‌ماندند","حالا هر کار مرحلهٔ جاری و تاریخچهٔ مراحل طی‌شده را گزارش می‌کند"]},
    {"version":"10.160","date":"2026-09-19","title":"بازطراحی کارت‌های صف در صفحهٔ شروع","items":["وضعیت «متوقف» به‌جای کلمهٔ انگلیسی stopped نمایش داده می‌شود","نشان وضعیت «در حال اجرا» و «ناموفق» رنگ نداشتند و بی‌استایل بودند؛ اضافه شد","کارهای متوقف‌شده دکمهٔ «تلاش مجدد» و «حذف» نداشتند و بن‌بست بودند","نوار رنگی کنار هر کارت، وضعیت را در یک نگاه نشان می‌دهد","برچسب مقصد، تعداد جدید/بروزرسانی/خطا، درصد پیشرفت و زمان آخرین تغییر روی کارت آمد","متن خطا حالا روی کارت دیده می‌شود؛ قبلاً فقط در صفحهٔ کارها بود","جزئیات فنی جمع‌شونده شد تا کارت خلوت بماند","چیدمان کارت‌ها روی صفحهٔ عریض چندستونی شد"]},
    {"version":"10.159","date":"2026-09-19","title":"رفع بهم‌ریختگی پروفایل‌ها بعد از درون‌ریزی","items":["اگر فایل بکاپ از نسخهٔ Node.js می‌آمد، پروفایل‌ها خام ذخیره می‌شدند و در فهرست به‌جای نام، شناسه یا آدرس دیده می‌شد","موتور استخراج، پسوند عنوان و قواعد قیمت هم بی‌صدا حذف می‌شدند","حالا ساختار هر پروفایل تشخیص داده و در صورت نیاز تبدیل می‌شود","هر چهار حالت پشتیبانی می‌شود: بستهٔ Node (شیء یا آرایه) و فایل خام Node (شیء یا آرایه)"]},
    {"version":"10.158","date":"2026-09-19","title":"بازطراحی بخش نسخه و گزارش تغییرات","items":["کارت نسخهٔ نصب‌شده با عنوان و تاریخ آخرین تغییر در بالای بخش","نسخهٔ فعلی با نشان سبز مشخص می‌شود","جست‌وجوی زنده در عنوان و متن همهٔ تغییرات","روزهای قدیمی‌تر جمع‌شده نمایش داده می‌شوند تا فهرست طولانی نشود","دکمهٔ کپی کل گزارش","«گزارش فنی نسخه» حالا نسخه، تعداد انتشارها، نسخهٔ پایتون، وضعیت داشبورد و موتورهای نصب‌شده را نشان می‌دهد؛ قبلاً فیلد خالی php را گزارش می‌کرد"]},
    {"version":"10.157","date":"2026-09-19","title":"رفع درون‌ریزی بی‌اثر تنظیمات","items":["برون‌ریزی حالا بستهٔ استاندارد داشبورد را می‌سازد؛ قبلاً داده خام می‌داد و رابط آن را نمی‌شناخت","درون‌ریزی بستهٔ واقعی را می‌خواند و پروفایل‌ها، محصولات، اتصال‌ها، یادگیری دسته و تنظیمات را برمی‌گرداند","فایل نامعتبر دیگر «موفق» گزارش نمی‌شود و خطای مشخص می‌دهد","تعداد واقعی موارد بازیابی‌شده در پیام پایانی نمایش داده می‌شود"]},
    {"version":"10.156","date":"2026-09-19","title":"دکمه‌های صفحهٔ شروع","items":["«تست موتورها» هر موتور نصب‌شده را زمان‌سنجی می‌کند و سریع‌ترین را مستر پروفایل می‌کند","«عیب‌یابی» مرحله‌به‌مرحله می‌گوید کدام سلکتور بی‌نتیجه بوده یا صفحه جاوااسکریپتی است","هر دو قبلاً خطای ۴۰۵ می‌دادند و بی‌صدا کاری نمی‌کردند"]},
    {"version":"10.155","date":"2026-09-19","title":"نصب بدون قطع شدن SSH","items":["needrestart دیگر sshd را ری‌استارت نمی‌کند؛ علت اصلی نیمه‌کاره ماندن نصب","اسکریپت نصب جدا از ترمینال اجرا می‌شود و با قطع شدن SSH ادامه می‌دهد","لاگ کامل در /var/log/scraper4-install.log","SKIP_ENGINES=1 برای نصب سریع بدون مرورگرها"]},
    {"version":"10.154","date":"2026-09-19","title":"نصب داشبورد از دیپلویر","items":["دیپلویر حالا ui_bridge.py و ui/ را هم نصب می‌کند، نه فقط scraper4.py","دکمهٔ «نصب/تعمیر داشبورد» برای وقتی /ui خطای ۴۰۴ می‌دهد","مخزن پیش‌فرض همهٔ نصب‌کننده‌ها به این فورک تغییر کرد؛ مخزن قبلی فایل‌های داشبورد را نداشت"]},
    {"version":"10.153","date":"2026-09-19","title":"به‌روزرسانی خودکار امن با git","items":["هر ۶۰ ثانیه برنچ جاری بررسی و با git merge --ff-only به‌روز می‌شود","اگر تغییر محلی ذخیره‌نشده باشد اجرا نمی‌شود تا چیزی پاک نشود","همهٔ فایل‌ها با هم جابه‌جا می‌شوند؛ برخلاف روش قبلی که تک‌فایل دانلود می‌کرد"]},
    {"version":"10.152","date":"2026-09-19","title":"دستیار هوشمند و عملیات گروهی","items":["دستیار چندمرحله‌ای با شش ابزار واقعی و توقف/ادامه در checkpoint","ویرایش و حذف گروهی برای ووکامرس و باسلام با پیش‌نمایش اجباری","نصب برنچ از داشبورد","رفع افتادن کلیدهای داشبورد از فایل داده هنگام خواندن"]},
    {"version":"10.151","date":"2026-09-19","title":"فهرست موتورهای پایتون","items":["فهرست موتورها از کتابخانه‌های نصب‌شدهٔ همین سرور ساخته می‌شود","موتورهای نصب‌نشده با برچسب «نصب نیست» نمایش داده می‌شوند","curl_cffi برای دور زدن اثرانگشت TLS و selectolax برای پارس سریع اضافه شد","موتورهای نود که در پایتون وجود نداشتند حذف شدند"]},
    {"version":"10.150","date":"2026-09-19","title":"پنل‌های داشبورد فعال شدند","items":["۴۱ اندپوینت که ۴۰۴ می‌دادند به توابع واقعی بک‌اند وصل شدند","مقصدها، نگهداری، هوش مصنوعی، باسلام، یادگیری دسته و گیت‌هاب","جلوگیری از پاک شدن داشبورد توسط دو به‌روزرسان خودکار"]},
    {"version":"10.149","date":"2026-09-05","title":"موتور مستر هر سایت","items":["استخراج سریع‌ترین موتوری که برای آن سایت محصول بدهد را مستر پروفایل می‌کند","صفحات بعد و استخراج بعدی ابتدا مستر را می‌زنند؛ بقیه فقط پشتیبان‌اند"]},
    {"version":"10.148","date":"2026-09-05","title":"قیمت باسلام به ریال","items":["هنگام ارسال به باسلام قیمت تومان در ۱۰ ضرب می‌شود مگر اینکه واحد از قبل ریال باشد"]},
    {"version":"10.147","date":"2026-09-05","title":"توضیح‌ساز و دسته‌بندی هوش مصنوعی","items":["توضیح کوتاه و بلند HTML با مدل فعال","دسته‌بندی فروشگاهی و تطبیق با دسته باسلام","اصلاح دسته‌های خالی، عمومی یا اشتباه در پس‌زمینه"]},
    {"version":"10.146","date":"2026-09-05","title":"رفع استخراج صفر در صفحه شروع","items":["اگر رله HTTP 503 بدهد استخراج هم مثل پیش‌نمایش مستقیم تکرار می‌شود","خطای خالی‌ماندن config دیگر شروع برداشت را متوقف نمی‌کند","صفر محصول به‌جای سکوت، پیام خطا می‌دهد"]},
    {"version":"10.145","date":"2026-09-05","title":"رفع خطای بارگذاری صفحه سلکتورها","items":["مسیر پیش‌نمایش سلکتور دوباره به تابع درست وصل شد تا fetch_engine_installed بدون آرگومان صدا نشود"]},
    {"version":"10.144","date":"2026-09-05","title":"گزارش تغییرات نسخه ادامه یافت","items":["ورودی‌های ۱۰.۱۴۲ و ۱۰.۱۴۳ به فهرست گزارش تغییرات اضافه شد","از این نسخه هر انتشار در همین گزارش ثبت می‌شود"]},
    {"version":"10.143","date":"2026-09-05","title":"موتورهای کمکی سلکتور روی موبایل","items":["نصب جداگانه httpx و cloudscraper و curl_cffi در venv گوشی و VPS","Playwright و Selenium روی Termux نصب نمی‌شوند چون Chromium دسکتاپ ندارند","استخراج خودکار httpx را هم امتحان می‌کند اگر نصب باشد"]},
    {"version":"10.142","date":"2026-09-05","title":"پیش‌نمایش سلکتور و چندغرفه باسلام","items":["اگر رله HTTP 503 بدهد پیش‌نمایش مستقیم بدون پروکسی تکرار می‌شود","موتورهای نصب‌نشده دیگر خطای پیش‌نمایش نیستند","غرفه‌های اضافی باسلام با ارسال همزمان یا ترتیبی به همه غرفه‌های فعال"]},
    {"version":"10.141","date":"2026-09-05","title":"گالری جزئیات هم‌تراز PHP","items":["روش خودکار/دستی/شماره‌دار مثل PHP","ادغام گالری تا یک عکس فهرست چندعکس محصول را پاک نکند","تنظیم گالری در تب سلکتورها"]},
    {"version":"10.140","date":"2026-09-05","title":"پشتیبان بدون سقف ۲۰ مگابایت","items":["بازیابی فایل پشتیبان دیگر به ۲۰ مگابایت محدود نیست"]},
    {"version":"10.139","date":"2026-09-05","title":"رفع از کار افتادن دکمه‌ها روی موبایل","items":["async تکراری در پشتیبان سینتکس JS را می‌شکست"]},
    {"version":"10.138","date":"2026-09-05","title":"پشتیبان با نام فارسی روی موبایل","items":["نام فایل غیر لاتین دیگر fetch را نمی‌شکند","رمز فقط اگر Latin-1 باشد در هدر می‌رود"]},
    {"version":"10.137","date":"2026-09-05","title":"نام نمایشی پروفایل و جزئیات کامل‌تر","items":["تغییر نام در دراپ‌داون می‌ماند","بعد از فهرست، گالری و توضیحات صفحه محصول استخراج می‌شود","JSON-LD و گالری ووکامرس","اسنپ‌شاپ با Playwright"]},
    {"version":"10.136","date":"2026-09-05","title":"نام پروفایل خوانا مثل PHP","items":["نام نمایشی از دامنه و مسیر URL نه کد D9","صفحه شروع لینک را تکرار نمی‌کند","Selenium خودکار حذف شد","تایم‌اوت اسنپ‌شاپ کوتاه‌تر"]},
    {"version":"10.135","date":"2026-09-05","title":"تغییر نام پروفایل و سلکتور اسنپ‌شاپ","items":["تغییر نام پروفایل بدون از دست رفتن محصولات","انتخاب پروفایل همه تب‌ها از جمله URL سلکتور را پر می‌کند","پیش‌نمایش سلکتور برای snappshop.ir با Playwright و اسکرول واقعی","صفحه شروع با رنگ‌بندی کارت‌ها"]},
    {"version":"10.134","date":"2026-09-05","title":"شروع موبایلی و منوی فشرده","items":["منوی همبرگر فهرست ۴۴ پیکسلی به‌جای کاشی درشت","صفحه شروع: فقط URL و صفحات؛ بقیه پشت «پیشرفته»","هیچ اسکرول افقی اجباری روی موبایل","دکمه‌ها کوچک؛ فقط یک CTA اصلی"]},
    {"version":"10.133","date":"2026-09-05","title":"پوسته امروزی کل رابط","items":["نوار بالا یک‌تکه به‌جای سه دکمه روی‌هم","منوی تنظیمات کاشی سه‌ستونه؛ تب پایین شبکه ۷ستونه","دکمه‌ها و فیلترها دیگر به هم نمی‌چسبند","نام پروفایل خوانا بدون URL قاطی"]},
    {"version":"10.132","date":"2026-09-05","title":"کارت وظیفه خوانا و ارقام فارسی","items":["متریک‌های تسک در شبکه جدا می‌شوند تا «۷۶۸۴٪» و «توقف امنحذف» پیش نیاید","خطاهای تکراری باسلام در یک خط ×N جمع می‌شوند","ارقام UI مثل PHP با toFa فارسی می‌شوند"]},
    {"version":"10.131","date":"2026-09-05","title":"باسلام status و سلکتور XPath","items":["ارسال status=2976 و وزن بسته‌بندی به API باسلام تا خطای Field required قطع شود","سلکتور ظرف XPath دیگر کل استخراج را خراب نمی‌کند؛ Playwright منتظر networkidle نمی‌ماند"]},
    {"version":"10.130","date":"2026-09-05","title":"لاگ یکپارچه خطاها","items":["همه خطاهای Flask، نخ‌های پس‌زمینه و استثناهای گرفته‌نشده در scraper4-errors.jsonl نوشته می‌شوند","خواندن آخرین خطاها از /api/errors برای رفع خودکار"]},
    {"version":"10.129","date":"2026-09-05","title":"استخراج اسنپ‌شاپ و جدول برنچ دیپلویِر","items":["صفحه‌بندی query از page موجود در URL ادامه می‌دهد (مثلاً ۳۳۶ → ۳۳۷)","خواندن JSON-LD و __NEXT_DATA__ برای فروشگاه‌های SPA مثل snappshop.ir"]},
    {"version":"10.128","date":"2026-09-05","title":"نصب از git به‌جای GitHub API","items":["دیپلویِر و به‌روزرسانی خودکار از git clone/fetch استفاده می‌کنند چون api.github.com از ایران 403 می‌دهد"]},
    {"version":"10.127","date":"2026-09-05","title":"جدول افقی نتایج AI و به‌روزرسانی خودکار","items":["جدول آزمون مدل‌ها روی موبایل اسکرول افقی است نه کارت فشرده","به‌روزرسانی خودکار روی VPS مستقیم از GitHub و restart سرویس","دیپلویِر جدا روی /deploy/ برای نصب جدیدترین یا انتخاب برنچ"]},
    {"version":"10.126","date":"2026-09-05","title":"حذف فیلترهای آزمایشگاه مدل","items":["دراپ‌داون‌های فیلتر جدول نتایج تست AI حذف شد تا ردیف مدل‌ها روی موبایل جا شود","فقط جستجوی تک‌خطی بالای فهرست می‌ماند"]},
    {"version":"10.125","date":"2026-09-05","title":"جدول آزمون مدل‌ها برای موبایل","items":["نتایج تست AI روی گوشی به‌صورت کارت خوانا است نه جدول ۱۰۵۰ پیکسلی","فیلترهای آزمایشگاه جمع می‌شوند تا ردیف مدل‌ها جا داشته باشند","فهرست فشرده تست، مدل و وضعیت را بدون بریدن نام نشان می‌دهد"]},
    {"version":"10.124","date":"2026-09-05","title":"آدرس /put و موتور کامل استخراج روی VPS","items":["رابط و API پایتون روی http://SERVER/put — ریشهٔ Apache برای PHP می‌ماند","نصب کامل Chromium Playwright به‌جای headless-shell سبک PythonAnywhere","افزودن httpx و Selenium به زنجیرهٔ استخراج در کنار requests، cloudscraper، curl_cffi و Playwright"]},
    {"version":"10.123","date":"2026-09-05","title":"نسخه کامل VPS هم‌تراز PHP ۱۰.۱۲۳","items":["حذف سقف‌های PythonAnywhere: صفحه، محصول، timeout، صف ۱۲تایی و قطع وظیفه در ۶۰۰ ثانیه","اتصال پیش‌فرض مستقیم بدون Worker؛ رله اختیاری می‌ماند","نگهبان extractBeat/extractChainResume مثل PHP: استخراج گیرکرده خودش از checkpoint ادامه می‌دهد","صف ووکامرس و باسلام تا انتها در پس‌زمینه خالی می‌شود نه مرحله‌به‌مرحله برای محدودیت رایگان","Task Manager پایدار کنار فایل برنامه؛ gunicorn بدون timeout روی systemd"]},
    {"version":"4.6.0","date":"2026-09-04","title":"نصب چندبرنچی با انتخاب جدیدترین نسخه","items":["افزودن چند برنچ کاندید در بخش نصب نسخه؛ بررسی همه برنچ‌ها و نصب خودکار جدیدترین APP_VERSION","پنل نصب همسان PHP: اطلاعات محلی، فهرست برنچ‌ها، انتخاب فایل، بررسی خودکار هنگام باز شدن و بنر نسخه جدید","دکمه بررسی و نصب یک‌مرحله‌ای، جدول مقایسه نسخه هر برنچ و نصب تکی هر برنچ","اسکریپت نصب PythonAnywhere چندبرنچی: دانلود همه کاندیدها و انتخاب جدیدترین نسخه"]},
    {"version":"4.5.0","date":"2026-09-04","title":"ترمیم کنترل‌شده مغایرت‌های مقصد","items":["ارسال مستقیم محصولات موجودنبودن در مقصد از گزارش مغایرت","ترمیم قیمت و عنوان محصولات مغایر با استفاده از شناسه پایدار مقصد","وظیفه سرورساید مستقل با توقف امن و گزارش موفق/خطا","بررسی مجدد خودکار پس از ترمیم و ممنوعیت حذف خودکار محصولات اضافی مقصد"]},
    {"version":"4.4.0","date":"2026-09-03","title":"دفترچه شناسه و مغایرت‌گیری مقصدها","items":["ثبت پایدار شناسه محصول ووکامرس و باسلام پس از هر ارسال موفق","مغایرت‌گیری سرورساید مستقل برای هر پروفایل و هر مقصد با تطبیق شناسه، SKU و عنوان","تفکیک یکسان، مغایرت قیمت/عنوان، موجودنبودن در مقصد و محصول اضافی مقصد","گزارش موبایلی مقصد در تب اختصاصی و اجرای پس‌زمینه از Task Manager"]},
    {"version":"4.3.0","date":"2026-09-03","title":"مقصدهای مستقل و تنظیمات مدرن","items":["تفکیک کامل ارسال ووکامرس و باسلام در دو تب مستقل پایین","بازطراحی منوی همبرگری به مرکز کنترل کاشی‌محور مدرن","فاز بعدی تطبیق PHP: تعدیل قیمت جداگانه ووکامرس و باسلام در هر پروفایل","اصلاح اتصال کارت ووکامرس در تنظیمات و حفظ اجرای مستقل مقصدها"]},
    {"version":"4.2.0","date":"2026-09-03","title":"پوسته موبایل همسان PHP و نمایش چندحالته نتایج","items":["بازطراحی سراسری براساس تصاویر نسخه PHP با کارت‌های سرمه‌ای، خط دور روشن و تیترهای فیروزه‌ای","هدر فشرده، دکمه تمام‌صفحه و نوار پایین بزرگ با وضعیت فعال واضح","مرتب‌سازی دوباره شروع و انتقال گزینه‌های تخصصی به پنل جمع‌شونده","فاز بعدی: سه نمای جدول، کارت و متن برای نتایج با ذخیره انتخاب کاربر"]},
    {"version":"4.1.0","date":"2026-09-03","title":"استخراج سریع دومرحله‌ای و کنترل نمایش","items":["بازگرداندن سرعت استخراج فهرست با انتقال جزئیات به وظیفه مستقل پس‌زمینه","تنظیم زنده اندازه فونت در پنج سطح و ذخیره انتخاب در مرورگر","بازطراحی و مرتب‌سازی صفحه شروع با مسیر مرحله‌ای و کارت اجرای متمرکز","تشخیص قطعی Worker ناسازگار با Authorization باسلام بدون متهم‌کردن اشتباه توکن","فاز بعدی تطبیق PHP: وظیفه مستقل detail_extract با توقف، پیشرفت و حفظ نتایج"]},
    {"version":"4.0.0","date":"2026-09-03","title":"انتخابگر بصری دوگانه و استخراج تفصیلی خودکار","items":["انتخاب دستی سلکتورهای فهرست روی پیش‌نمایش زنده DOM با والد، فرزند و هم‌سطح","تب مستقل انتخاب سلکتورهای صفحه جزئیات برای توضیحات، تنوع‌ها، گالری و مشخصات","استخراج خودکار چندلایه صفحه هر محصول با توضیح کوتاه/بلند، HTML، گالری، تنوع و ویژگی‌ها","حفظ انتخاب‌ها در پروفایل و بازطراحی حرفه‌ای مرکز سلکتورها و وضعیت پوشش جزئیات"]},
    {"version":"3.9.0","date":"2026-09-03","title":"خوانایی سراسری و تاریخچه مقایسه","items":["افزایش اندازه فونت تمام متن‌ها، برچسب‌ها، منوها، جدول‌ها و نمای موبایل","حفظ آخرین جزئیات مقایسه پس از refresh و بارگذاری مجدد پروفایل","ثبت تاریخچه خلاصه ده استخراج اخیر هر پروفایل در تب نتایج","بهبود فاصله‌گذاری، ارتفاع کنترل‌ها و خوانایی مودال‌ها و تسک منیجر"]},
    {"version":"3.8.0","date":"2026-09-03","title":"مرکز نتیجه و تغییرات تعاملی","items":["انتقال کامل جدول محصولات از شروع به تب نتایج","کارت‌های قابل‌کلیک جدید، تغییر قیمت، تغییر محتوا، حذف و بدون تغییر کنار پیشرفت","نمایش قبل/بعد قیمت و فهرست جزئیات هر شمارنده در مودال","ارتقای تشخیص ضدبات SnappShop و راهنمای مسیر IP جایگزین"]},
    {"version":"3.7.0","date":"2026-09-03","title":"موتور چندلایه DOM و وظایف AI","items":["زنجیره requests، Cloudscraper، curl_cffi و Playwright Stealth بدون API یا hydration","تشخیص صفحه ضدبات/VPN و گزارش محدودیت IP دروازه برای سایت‌هایی مانند SnappShop","ثبت آزمون مدل‌ها در تسک منیجر با پیشرفت، مدل جاری، موفق/خطا و توقف امن","کنترل موتور دریافت در هر پروفایل و نمایش مسیرهای تلاش در رابط"]},
    {"version":"3.6.0","date":"2026-09-03","title":"دروازه مرکزی تمام اتصال‌های خروجی","items":["یک تنظیم واحد مستقیم/Worker/HTTP Proxy برای مبدأ، باسلام، ووکامرس، AI و GitHub","حذف تنظیمات شبکه تکراری از کارت‌های باسلام و ووکامرس","آزمایش توان Worker برای عبور Authorization، method و JSON بدون افشای کلید واقعی","نمایش مسیر فعال و سلامت دروازه در رابط بازطراحی‌شده"]},
    {"version":"3.5.0","date":"2026-09-03","title":"دسترسی سریع وظایف و آزمایشگاه حرفه‌ای AI","items":["دکمه چسبان تسک منیجر کنار منوی همبرگری با شمارنده زنده","نمایش برجسته نام پروفایل روی همه وظایف استخراج","فیلتر امتیاز و latency، رتبه‌بندی، percentile و مقایسه کنارهم مدل‌ها","بازطراحی جدول نتایج با جزئیات بازشونده و نمایش حرفه‌ای موبایل"]},
    {"version":"3.4.0","date":"2026-09-03","title":"REST API باسلام و مرکز عملیات","items":["انتخاب خودکار SDK سپس REST API مستقیم بدون وابستگی به SDK","تنظیم Base URL، روش کلاینت و مسیر مستقیم/Worker برای API باسلام","مدیریت REST محصولات، غرفه، گفت‌وگوها، پیام‌ها و سفارش‌های غرفه","بازطراحی مرکز باسلام و کارت‌های عملیاتی منظم و واکنش‌گرا"]},
    {"version":"3.3.1","date":"2026-09-03","title":"استخراج موازی و رابط وظایف","items":["حذف کامل FIFO؛ هر استخراج بلافاصله و مستقل آغاز می‌شود","گیرکردن یک منبع مانع اجرای پروفایل‌های دیگر نیست","فیلتر زنده نوع و وضعیت وظایف همراه جستجو در رویدادها","حفظ توقف امن، تشخیص قطع‌شدن و ادامه از checkpoint"]},
    {"version":"3.3.0","date":"2026-09-03","title":"رله ووکامرس و صف استخراج پایدار","items":["ارسال GET/POST/PUT ووکامرس از Cloudflare Worker با احراز هویت query امن HTTPS","اجرای FIFO استخراج برای جلوگیری از رقابت Playwright و جلو زدن وظایف","نمایش مرحله شبکه پیش از دریافت محصول، تشخیص وظیفه قطع‌شده و اجرای مجدد از checkpoint","بهبود کارت‌های مقصد و سلامت صف در رابط موبایل"]},
    {"version":"3.2.1","date":"2026-09-03","title":"ترمیم احراز هویت باسلام","items":["پاک‌سازی خودکار Bearer تکراری، کوتیشن و فاصله از Personal Token","ارسال هدرهای سازگار با رله و fallback امن به اتصال مستقیم هنگام 401 رله","تشخیص جداگانه Worker ناسازگار، توکن نامعتبر و محدودیت شبکه PythonAnywhere"]},
    {"version":"3.2.0","date":"2026-09-03","title":"ارسال کامل پروفایل‌ها و مرکز وظایف","items":["ارسال سرور‌ساید و کامل محصولات ذخیره‌شده هر پروفایل به ووکامرس و باسلام","تسک منیجر مرکزی با توقف، حذف، بازیابی پس از refresh و گزارش زمانی","نوار پیشرفت چندمرحله‌ای با شمارنده، موفق/خطا، زمان سپری‌شده و تخمین پایان","گزارش نسخه‌ها در رابط و API"]},
    {"version":"3.1.0","date":"2026-09-03","title":"رله رسمی SDK باسلام","items":["عبور درخواست‌های SDK از Cloudflare Worker","تشخیص دقیق خطای 403 و حفظ Authorization و multipart","کاتالوگ، آمار، کاندید و مستر مدل‌های هوش مصنوعی"]},
    {"version":"3.0.0","date":"2026-09-03","title":"صفحه‌بندی PHP و آزمایشگاه مدل‌ها","items":["صفحه‌بندی relative/full سازگار با PHP","استخراج واقعی چندصفحه‌ای","فیلتر، امتیازدهی و صفحه‌بندی نتایج آزمون AI"]},
    {"version":"2.9.0","date":"2026-09-03","title":"وظایف زنده و نصب SDK","items":["استخراج زنده سرور‌ساید","نصب غیرهمزمان SDK از سه منبع رسمی","جزئیات زمانی عملیات"]},
]
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DEPS_DIR = os.path.join(BASE_DIR, ".runtime-deps")
def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(os.environ.get(name, str(default)))))
    except (TypeError, ValueError):
        return default

VPS_MODE = os.environ.get("SCRAPER_RUNTIME", "vps").strip().lower() not in {"pythonanywhere", "pa", "limited"}
LIVE_TASK_DIR = os.environ.get("SCRAPER_LIVE_DIR") or (
    os.path.join(BASE_DIR, "scraper4-live") if VPS_MODE
    else os.path.join(tempfile.gettempdir(), "scraper4-live-"+str(os.getuid() if hasattr(os,"getuid") else "user"))
)
if os.path.isdir(LOCAL_DEPS_DIR):site.addsitedir(LOCAL_DEPS_DIR)
# VPS: use Playwright's normal browser cache (full Chromium). PA: keep a local folder.
if os.environ.get("SCRAPER_PLAYWRIGHT_PATH"):
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.environ["SCRAPER_PLAYWRIGHT_PATH"]
elif not VPS_MODE:
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(BASE_DIR, "ms-playwright")
URL_PREFIX = os.environ.get("SCRAPER_URL_PREFIX", "/put" if VPS_MODE else "").strip().rstrip("/")
try:
    with open(__file__, "rb") as _build_file:
        BUILD_ID = hashlib.sha256(_build_file.read()).hexdigest()[:12]
except OSError:
    BUILD_ID = APP_VERSION
AUTO_UPDATE_ENABLED = os.environ.get("SCRAPER_AUTO_UPDATE", "1").lower() not in {"0", "false", "off", "no"}
AUTO_UPDATE_INTERVAL = max(120, int(os.environ.get("SCRAPER_AUTO_UPDATE_INTERVAL", "300")))
DATA_FILE = os.environ.get("SCRAPER_DATA_FILE", os.path.join(BASE_DIR, "scraper4_data.json"))
ERROR_LOG_PATH = os.environ.get("SCRAPER_ERROR_LOG", os.path.join(BASE_DIR, "scraper4-errors.jsonl"))
ERROR_LOG_LOCK = threading.Lock()
PASSWORD = os.environ.get("SCRAPER_PASSWORD", "")
DEPLOY_PASSWORD = os.environ.get("SCRAPER_DEPLOY_PASSWORD", "")
MAX_PAGES_HARD = _env_int("SCRAPER_MAX_PAGES", 10000 if VPS_MODE else 50, 1, 100000)
MAX_PRODUCTS_HARD = _env_int("SCRAPER_MAX_PRODUCTS", 100000 if VPS_MODE else 2000, 1, 500000)
MAX_HTML_BYTES = _env_int("SCRAPER_MAX_HTML_BYTES", (32 if VPS_MODE else 12) * 1024 * 1024, 1024 * 1024, 128 * 1024 * 1024)
STALL_AFTER = _env_int("SCRAPER_STALL_AFTER", 300, 60, 86400)
TASK_STALE_SECONDS = _env_int("SCRAPER_TASK_STALE", 86400 if VPS_MODE else 600, 120, 604800)
EXTRACT_JOB_KEEP = _env_int("SCRAPER_EXTRACT_JOB_KEEP", 500 if VPS_MODE else 12, 4, 5000)
LIVE_TASK_KEEP = _env_int("SCRAPER_LIVE_TASK_KEEP", 500 if VPS_MODE else 30, 8, 5000)
DEST_QUEUE_KEEP = _env_int("SCRAPER_DEST_QUEUE_KEEP", 200 if VPS_MODE else 10, 4, 2000)
REMOTE_CATALOG_PAGES = _env_int("SCRAPER_REMOTE_PAGES", 200 if VPS_MODE else 11, 1, 2000)
REQUEST_TIMEOUT_CAP = _env_int("SCRAPER_TIMEOUT_CAP", 600 if VPS_MODE else 120, 30, 3600)
FETCH_TIMEOUT_CAP = _env_int("SCRAPER_FETCH_TIMEOUT_CAP", 300 if VPS_MODE else 90, 15, 1800)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
DATA_LOCK = threading.RLock()
LIVE_TASK_LOCK = threading.RLock()
LIVE_TASKS: dict[str,dict[str,Any]] = {}

app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False
application = app  # gunicorn / Apache WSGI alias

_REDACT_SECRET = re.compile(r"(password|token|secret|authorization|bearer|key)[=:\s]+\S+", re.I)


def _redact(text: str) -> str:
    return _REDACT_SECRET.sub(r"\1=***", text or "")


def report_error(where: str, err: Any = None, *, tb: str = "", extra: Optional[dict[str, Any]] = None) -> None:
    """Append one JSON line to scraper4-errors.jsonl (all scraper subsystems)."""
    if isinstance(err, BaseException):
        message = _redact(f"{type(err).__name__}: {err}")
        kind = type(err).__name__
        if not tb:
            tb = "".join(traceback.format_exception(type(err), err, err.__traceback__))
    else:
        message = _redact(str(err or "unknown"))
        kind = "Error"
    record = {
        "ts": int(time.time()),
        "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "where": str(where)[:200],
        "type": kind[:80],
        "message": message[:2000],
        "traceback": _redact(tb)[-8000:],
        "version": APP_VERSION,
        "extra": extra or {},
    }
    line = json.dumps(record, ensure_ascii=False) + "\n"
    try:
        with ERROR_LOG_LOCK:
            path = ERROR_LOG_PATH
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            if os.path.isfile(path) and os.path.getsize(path) > 2 * 1024 * 1024:
                try:
                    with open(path, "rb") as fh:
                        fh.seek(-min(400000, os.path.getsize(path)), os.SEEK_END)
                        tail = fh.read()
                    with open(path, "wb") as fh:
                        fh.write(tail)
                except OSError:
                    pass
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(line)
    except OSError:
        pass


def recent_errors(limit: int = 40) -> list[dict[str, Any]]:
    path = ERROR_LOG_PATH
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()[-max(1, min(200, limit)):]
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for raw in lines:
        try:
            row = json.loads(raw)
        except ValueError:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def _install_error_hooks() -> None:
    previous = sys.excepthook

    def _hook(exc_type, exc, tb):
        report_error("sys.excepthook", exc, tb="".join(traceback.format_exception(exc_type, exc, tb)))
        previous(exc_type, exc, tb)

    sys.excepthook = _hook

    def _thread_hook(args):
        report_error("thread:" + str(getattr(args, "thread", None) and args.thread.name), args.exc_value,
                     tb="".join(traceback.format_exception(args.exc_type, args.exc_value, args.exc_traceback)))

    try:
        threading.excepthook = _thread_hook  # type: ignore[attr-defined]
    except Exception:
        pass

    class _LogHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            if record.levelno < logging.ERROR:
                return
            try:
                report_error("log:" + record.name, record.getMessage(), tb=self.format(record) if record.exc_info else "")
            except Exception:
                pass

    root = logging.getLogger()
    if not any(isinstance(h, _LogHandler) for h in root.handlers):
        root.addHandler(_LogHandler())
        if root.level > logging.ERROR:
            root.setLevel(logging.ERROR)


_install_error_hooks()


# ---------------------------------------------------------------------------
# Persistent configuration
# ---------------------------------------------------------------------------
def default_data() -> dict[str, Any]:
    return {
        "profiles": {},
        "active_profile": "",
        "woocommerce": {"url": "", "consumer_key": "", "consumer_secret": "", "api_mode": "direct", "relay_url": "", "worker_key": ""},
        "network": {"timeout": 60, "gap_ms": 200, "proxy": "", "proxy_mode": "direct", "worker_key": "", "verify_tls": True},
        # Default to THIS fork. Pointing at fazilatma/amphp is what silently
        # removed the dashboard: that repo has no ui_bridge.py or ui/, so an
        # install from it "succeeds" while /ui starts returning 404.
        "deploy": {
            "repo": "fazilatma/new", "branch": "arena/01a0b7db-new",
            "branches": ["arena/01a0b7db-new"],
            "path": "python-scraper4/scraper4.py",
            "github_token": "", "reload_file": "", "check_on_load": False,
        },
        "last_result": [],
        "extract_jobs": {},
        "woo_jobs": {},
        "runtime": {"playwright_path": ""},
        "ai": {"provider": "openrouter", "endpoint": "https://openrouter.ai/api/v1/chat/completions", "api_key": "", "model": "meta-llama/llama-3.3-70b-instruct:free", "temperature": 0.3, "max_tokens": 1200, "system_prompt": "You write accurate Persian WooCommerce product content. Return only requested JSON."},
        "ai_providers": {},
        "ai_candidates": [],
        "ai_master": "",
        "basalam": {"token": "", "refresh_token": "", "vendor_id": 0, "category_id": 0, "shop_name": "", "preparation_days": 3, "weight": 500, "package_weight": 600, "status": 2976, "stock": 10, "update_existing": True, "client_mode": "auto", "api_mode": "direct", "api_base_url": "https://openapi.basalam.com", "relay_url": "", "worker_key": "", "last_test_at": 0, "last_test_user": "", "last_client": "", "vendors": [], "send_all_shops": True, "send_mode": "parallel", "price_mode": "none", "price_val": 0},
        "bsl_jobs": {},
        "ai_test_jobs": {},
        "dispatch_jobs": {},
        # Keys owned by the Node-parity dashboard (ui_bridge.py). load_data()
        # drops any key that is not declared here, so anything the dashboard
        # persists must be listed or it silently vanishes on the next read.
        "agent_prompts": [],
        "agent_runs": [],
        "category_learning": [],
        "ai_votes": {},
        "autoreply_rules": [],
        "import_history": [],
        "ui_settings": {},
    }


def load_data() -> dict[str, Any]:
    with DATA_LOCK:
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as fh:
                raw = json.load(fh)
            out = default_data()
            for key in out:
                if key in raw and isinstance(raw[key], type(out[key])):
                    if isinstance(out[key],dict):
                        merged=dict(out[key]);merged.update(raw[key]);out[key]=merged
                    else:out[key]=raw[key]
            return out
        except (OSError, ValueError, TypeError):
            return default_data()


def save_data(data: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(DATA_FILE) or ".", exist_ok=True)
    with DATA_LOCK:
        fd, tmp = tempfile.mkstemp(prefix=".scraper4-", suffix=".json", dir=os.path.dirname(DATA_FILE) or ".")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, DATA_FILE)
        finally:
            try:
                if os.path.exists(tmp):
                    os.unlink(tmp)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Security and HTTP
# ---------------------------------------------------------------------------
def authorized() -> bool:
    if not PASSWORD:
        return True
    supplied = request.headers.get("X-Scraper-Password", "")
    if not supplied:
        auth = request.authorization
        supplied = auth.password if auth else ""
    return bool(supplied) and hmac.compare_digest(supplied, PASSWORD)


def deploy_authorized() -> bool:
    """Authorize sensitive updater operations without locking the public UI."""
    if not DEPLOY_PASSWORD:
        return True
    supplied = clean_text(request.headers.get("X-Deploy-Password") or request.form.get("deploy_password") or "")
    if not supplied:
        return False
    candidates = {supplied}
    try:
        candidates.add(unquote(supplied))
    except Exception:
        pass
    for item in candidates:
        try:
            if item and hmac.compare_digest(item, DEPLOY_PASSWORD):
                return True
        except Exception:
            continue
    return False


def deploy_auth_error():
    if not DEPLOY_PASSWORD:
        return jsonify(ok=False, error="رمز مدیریت نصب تنظیم نشده است"), 503
    return jsonify(ok=False, error="رمز مدیریت نصب نادرست است"), 401


@app.before_request
def require_password():
    if request.path in {"/health", "/api/errors"} or authorized():
        return None
    return Response("Authentication required", 401, {"WWW-Authenticate": 'Basic realm="Scraper4"'})


def public_http_url(url: str) -> str:
    """Validate source URLs and reject localhost/private literal addresses."""
    url = (url or "").strip()
    markdown = re.fullmatch(r"\[[^]]+\]\((https?://[^)]+)\)", url, re.I)
    if markdown: url = markdown.group(1).strip()
    # Also tolerate copied rich-text links that contain a URL after display text.
    if not url.lower().startswith(("http://", "https://")):
        embedded = re.search(r"https?://[^\s)]+", url, re.I)
        if embedded: url = embedded.group(0)
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("آدرس باید با http:// یا https:// شروع شود")
    host = parsed.hostname.lower().rstrip(".")
    if host in {"localhost", "localhost.localdomain"}:
        raise ValueError("آدرس محلی مجاز نیست")
    try:
        ip = ipaddress.ip_address(host)
        if not ip.is_global:
            raise ValueError("IP خصوصی/محلی مجاز نیست")
    except ValueError as exc:
        if "مجاز نیست" in str(exc):
            raise
    return url


class FetchError(RuntimeError):
    pass


@dataclass
class FetchResult:
    url: str
    text: str
    content_type: str
    status: int
    mode: str = "http"


def outbound_mode(cfg: Optional[dict[str,Any]]=None) -> str:
    cfg=cfg or load_data().get("network",{});mode=clean_text(cfg.get("proxy_mode","auto")).lower();proxy=clean_text(cfg.get("proxy"))
    return ("relay" if proxy and ("workers.dev" in proxy.lower() or "?url=" in proxy or "{url}" in proxy) else "http" if proxy else "direct") if mode=="auto" else mode


def outbound_request(method: str, url: str, **kwargs: Any) -> requests.Response:
    """Route every requests-based external call through the one global connection gateway."""
    cfg=load_data().get("network",{});mode=outbound_mode(cfg);proxy=clean_text(cfg.get("proxy"));target=public_http_url(url)
    headers=dict(kwargs.pop("headers",{}) or {});params=kwargs.pop("params",None)
    if params:target=requests.Request("GET",target,params=params).prepare().url
    request_url=target
    if mode=="relay":
        if not proxy:raise FetchError("حالت Worker انتخاب شده اما آدرس دروازه مرکزی خالی است")
        relay=public_http_url(proxy.replace("{url}",quote(target,safe=""))) if "{url}" in proxy else public_http_url(proxy);request_url=relay if "{url}" in proxy else relay+("&" if "?" in relay else "?")+urlencode({"url":target});headers["X-Proxy-UA"]=headers.get("User-Agent",USER_AGENT);headers["X-Proxy-Method"]=method.upper()
        authorization=clean_text(headers.get("Authorization"))
        if authorization:
            # Compatible aliases for dedicated relays; none places credentials in the URL.
            for relay_header in ("X-Proxy-Authorization","X-Upstream-Authorization","X-Target-Authorization","X-Authorization"):headers[relay_header]=authorization
        if cfg.get("worker_key"):headers["X-Proxy-Key"]=str(cfg["worker_key"])
    elif mode=="http":
        if not proxy:raise FetchError("حالت HTTP Proxy انتخاب شده اما آدرس پروکسی خالی است")
        kwargs["proxies"]={"http":proxy,"https":proxy}
    kwargs.setdefault("timeout",max(5,min(REQUEST_TIMEOUT_CAP,int(cfg.get("timeout",60)))));kwargs.setdefault("allow_redirects",True);kwargs.setdefault("verify",bool(cfg.get("verify_tls",True)))
    response=requests.request(method,request_url,headers=headers,**kwargs);setattr(response,"scraper4_transport",mode);return response


def outbound_browser_target(url: str) -> str:
    cfg=load_data().get("network",{});mode=outbound_mode(cfg);proxy=clean_text(cfg.get("proxy"));target=public_http_url(url)
    if mode!="relay":return target
    relay=public_http_url(proxy.replace("{url}",quote(target,safe=""))) if "{url}" in proxy else public_http_url(proxy);return relay if "{url}" in proxy else relay+("&" if "?" in relay else "?")+urlencode({"url":target})


class CancelledError(Exception):
    """Raised as soon as a stop request is seen, from anywhere in a fetch."""


class Fetcher:
    def __init__(self, cfg: dict[str, Any]):
        self.timeout = max(5, min(FETCH_TIMEOUT_CAP, int(cfg.get("timeout", 60))))
        # Task this fetcher serves. Stop used to be polled only once per page,
        # so a page that exhausted every engine (3 attempts x N engines, plus
        # backoff and a browser fallback) blocked the stop button for many
        # minutes. With the id here we can bail out between attempts, between
        # engines and during the politeness sleep.
        self.task_id = str(cfg.get("_live_task_id", "") or "").strip()
        self.gap = max(0, min(10000, int(cfg.get("gap_ms", 350)))) / 1000.0
        self.verify = bool(cfg.get("verify_tls", True))
        self.proxy = str(cfg.get("proxy", "")).strip()
        self.proxy_mode = str(cfg.get("proxy_mode", "auto")).strip().lower()
        self.worker_key = str(cfg.get("worker_key", "")).strip()
        if self.proxy_mode == "auto":
            self.proxy_mode = "relay" if ("workers.dev" in self.proxy.lower() or "{url}" in self.proxy or "?url=" in self.proxy) else ("http" if self.proxy else "direct")
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "fa-IR,fa;q=0.9,en-US;q=0.7,en;q=0.6",
            "Cache-Control": "no-cache",
        })
        if self.proxy and self.proxy_mode == "http":
            self.session.proxies.update({"http": self.proxy, "https": self.proxy})
        self.last_by_host: dict[str, float] = {}

    def abort_if_cancelled(self) -> None:
        if self.task_id and live_task_cancelled(self.task_id):
            raise CancelledError("استخراج با درخواست کاربر متوقف شد")

    def effective_timeout(self) -> Any:
        """Socket budget for the next request.

        Once a stop is already pending there is no point waiting long for a
        brand-new request, so give it a token budget and let it fail fast.
        Otherwise use the configured timeout unchanged — shortening it would
        break sites that are simply slow.
        """
        if self.task_id and live_task_cancelled(self.task_id):
            return 2.0
        return self.timeout

    def sleep_cancellable(self, seconds: float) -> None:
        """Sleep in short slices so a stop request is honoured quickly."""
        end = time.monotonic() + max(0.0, seconds)
        while True:
            self.abort_if_cancelled()
            left = end - time.monotonic()
            if left <= 0:
                return
            time.sleep(min(0.25, left))

    def get(self, url: str, *, referer: str = "", accept_json: bool = False, engine: str = "requests") -> FetchResult:
        """Fetch a page, honouring a stop request within ~1 second.

        A socket read cannot be interrupted from another thread, and shortening
        the timeout is not an option: retrying restarts whatever work the
        server was doing, so slow-but-healthy sites would never complete. So
        the blocking work runs in a daemon helper thread and the caller polls
        for cancellation. On stop we abandon the thread — it is a daemon doing
        a read that will hit its own timeout and exit, holding no lock and
        writing no state.
        """
        if not self.task_id:
            return self._get_blocking(url, referer=referer, accept_json=accept_json, engine=engine)
        self.abort_if_cancelled()
        box: dict[str, Any] = {}
        def run() -> None:
            try:
                box["ok"] = self._get_blocking(url, referer=referer,
                                               accept_json=accept_json, engine=engine)
            except BaseException as exc:  # noqa: BLE001 - re-raised in caller
                box["err"] = exc
        worker = threading.Thread(target=run, name="fetch-" + engine, daemon=True)
        worker.start()
        while True:
            worker.join(0.25)
            if not worker.is_alive():
                break
            if live_task_cancelled(self.task_id):
                raise CancelledError("استخراج با درخواست کاربر متوقف شد")
        if "err" in box:
            raise box["err"]
        return box["ok"]

    def _get_blocking(self, url: str, *, referer: str = "", accept_json: bool = False, engine: str = "requests") -> FetchResult:
        self.abort_if_cancelled()
        url = public_http_url(url)
        target_url = url
        request_url = url
        if self.proxy and self.proxy_mode == "relay":
            relay = public_http_url(self.proxy.replace("{url}", quote(target_url, safe=""))) if "{url}" in self.proxy else public_http_url(self.proxy)
            if "{url}" not in self.proxy:
                separator = "&" if "?" in relay else "?"
                request_url = relay + separator + urlencode({"url": target_url})
            else:
                request_url = relay
        host = urlparse(target_url).hostname or ""
        elapsed = time.monotonic() - self.last_by_host.get(host, 0)
        if elapsed < self.gap:
            self.sleep_cancellable(self.gap - elapsed)
        headers = {}
        if referer:
            headers["Referer"] = referer
        if self.proxy_mode == "relay":
            headers["X-Proxy-UA"] = USER_AGENT
            if referer: headers["X-Proxy-Referer"] = referer
            if self.worker_key: headers["X-Proxy-Key"] = self.worker_key
        if accept_json:
            headers["Accept"] = "application/json,text/plain,*/*"
        if engine in {"playwright", "selenium"}:
            self.last_by_host[host] = time.monotonic()
            if engine == "playwright":
                return render_playwright(target_url, self.timeout, 4, self.task_id)
            return render_selenium(target_url, self.timeout, 4, self.task_id)
        last_error = ""
        for attempt in range(3):
            self.abort_if_cancelled()
            try:
                if engine=="cloudscraper":
                    try:import cloudscraper
                    except ImportError as exc:raise FetchError("کتابخانه cloudscraper نصب نیست") from exc
                    client=cloudscraper.create_scraper(browser={"browser":"chrome","platform":"windows","mobile":False});client.headers.update(self.session.headers);client.proxies.update(self.session.proxies);response=client.get(request_url,headers=headers,timeout=self.effective_timeout(),allow_redirects=True,verify=self.verify);body=response.content
                elif engine=="httpx":
                    try:
                        import httpx
                    except ImportError as exc:
                        raise FetchError("کتابخانه httpx نصب نیست") from exc
                    merged={**dict(self.session.headers), **headers}
                    proxy=None
                    if self.session.proxies:
                        proxy=self.session.proxies.get("https") or self.session.proxies.get("http")
                    client_kw=dict(timeout=self.effective_timeout(), follow_redirects=True, verify=self.verify, headers=merged)
                    try:
                        if proxy: client_kw["proxy"]=proxy
                        with httpx.Client(**client_kw) as hx:
                            response=hx.get(request_url); body=response.content
                    except TypeError:
                        client_kw.pop("proxy", None)
                        if proxy: client_kw["proxies"]=proxy
                        with httpx.Client(**client_kw) as hx:
                            response=hx.get(request_url); body=response.content
                elif engine=="curl_cffi":
                    try:from curl_cffi import requests as curl_requests
                    except ImportError as exc:raise FetchError("کتابخانه curl_cffi نصب نیست") from exc
                    proxies=self.session.proxies or None;response=curl_requests.get(request_url,headers={**dict(self.session.headers),**headers},timeout=self.effective_timeout(),allow_redirects=True,verify=self.verify,impersonate="chrome",proxies=proxies);body=response.content
                else:
                    response=self.session.get(request_url,headers=headers,timeout=self.effective_timeout(),allow_redirects=True,verify=self.verify,stream=True);body=response.raw.read(MAX_HTML_BYTES+1,decode_content=True)
                self.last_by_host[host] = time.monotonic()
                if len(body) > MAX_HTML_BYTES:
                    raise FetchError("پاسخ HTML بزرگ‌تر از سقف مجاز است")
                encoding=getattr(response,"encoding",None) or getattr(response,"apparent_encoding",None) or "utf-8"
                text = body.decode(encoding, errors="replace");sample=clean_text(BeautifulSoup(text[:200000],"html.parser").get_text(" ",strip=True)).lower()
                blocked=any(x in sample for x in ("access denied","موقتا vpn خود را خاموش","temporarily blocked","captcha","درخواست شما مشکوک","دسترسی شما مسدود"))
                if blocked:raise FetchError(f"{engine}: صفحه ضدبات/VPN به‌جای فهرست محصول برگشت؛ IP مسیر اتصال توسط سایت رد شده است (HTTP {response.status_code})")
                if response.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                    self.sleep_cancellable(1.5 * (2 ** attempt))
                    continue
                if not 200 <= response.status_code < 400:
                    raise FetchError(f"HTTP {response.status_code} برای {url}")
                return FetchResult(
                    target_url if self.proxy_mode == "relay" else str(response.url), text, response.headers.get("Content-Type", ""),
                    response.status_code,
                )
            except CancelledError:
                # Never swallow a stop request into the generic retry path.
                raise
            except Exception as exc:
                last_error = str(exc)
                if "ضدبات/VPN" in last_error:break
                if attempt < 2:
                    self.sleep_cancellable(1.0 * (2 ** attempt))
        raise FetchError(last_error or "دریافت صفحه ناموفق بود")


# ---------------------------------------------------------------------------
# Normalization and product conversion
# ---------------------------------------------------------------------------
def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return ""
    return re.sub(r"\s+", " ", str(value).translate(PERSIAN_DIGITS)).strip()


def absolute_url(value: Any, base: str) -> str:
    value = clean_text(value)
    if not value or value.startswith(("data:", "javascript:", "#")):
        return ""
    return urljoin(base, value)


def image_value(value: Any, base: str) -> str:
    if isinstance(value, list):
        for item in value:
            found = image_value(item, base)
            if found:
                return found
        return ""
    if isinstance(value, dict):
        for key in ("url", "src", "webp_url", "image_url", "original", "800", "main"):
            if key in value:
                found = image_value(value[key], base)
                if found:
                    return found
        for item in value.values():
            found = image_value(item, base)
            if found:
                return found
        return ""
    return absolute_url(value, base)


def extract_price(value: Any) -> str:
    """Normalize visible price text using scraper4.php's currency-aware rules."""
    text = clean_text(value)
    if not text:
        return ""
    currency = r"تومان|تومن|ریال|ر\.ی|USD|EUR|GBP|AED|TRY|CAD|AUD|CHF|JPY|CNY|£|\$|€|¥|₽|₺|₹|﷼"
    number = r"\d(?:[\d,،٬.٫\s]*\d)?"
    matches = re.findall(rf"(?:({number})\s*({currency})|({currency})\s*({number}))", text, re.I)
    if matches:
        choices = []
        for left, right_cur, left_cur, right in matches:
            raw, cur = (left, right_cur) if left else (right, left_cur)
            digits = re.sub(r"\D", "", raw)
            if digits:
                choices.append((len(digits), clean_text(f"{cur} {raw}" if left_cur else f"{raw} {cur}")))
        if choices:
            return max(choices, key=lambda item: item[0])[1]
    grouped = re.findall(r"\d{1,3}(?:[,،٬\s]\d{3})+", text)
    if grouped:
        return max(grouped, key=lambda item: len(re.sub(r"\D", "", item))) + " تومان"
    nums = [x for x in re.findall(r"\d{4,}", text) if int(x) >= 1000]
    return (max(nums, key=int) + " تومان") if nums else ""


def product_key(product: dict[str, Any]) -> str:
    link = re.sub(r"[?#].*$", "", clean_text(product.get("link"))).rstrip("/")
    if link:
        identity = "url:" + link
    elif clean_text(product.get("sku")):
        identity = "sku:" + clean_text(product.get("sku")).lower()
    else:
        # Price must not participate in identity, otherwise every price update looks like remove+add.
        identity = "title:" + clean_text(product.get("title")).lower()
    return hashlib.md5(identity.encode("utf-8", "ignore")).hexdigest()


def add_product(store: dict[str, dict[str, Any]], product: Optional[dict[str, Any]]) -> None:
    if not product:
        return
    key = product_key(product)
    if key in store:
        old = store[key]
        for field, value in product.items():
            if value not in ("", None, [], {}) and old.get(field) in ("", None, [], {}):
                old[field] = value
    elif len(store) < MAX_PRODUCTS_HARD:
        product["key"] = key
        store[key] = product


# ---------------------------------------------------------------------------
# HTML, selector and hydration extraction
# ---------------------------------------------------------------------------
def is_xpath(selector: str) -> bool:
    sel = (selector or "").strip()
    if sel.startswith(("//", "(//", "/html", "/*", "./", ".//")):
        return True
    return sel.startswith("/") and ("@" in sel or "[" in sel)


def query_nodes(root: Any, selector: str) -> list[Any]:
    """CSS or XPath — Chrome copy-xpath starts with // and is invalid CSS."""
    sel = clean_text(selector)
    if not sel:
        return []
    if not is_xpath(sel):
        try:
            return list(root.select(sel))
        except Exception:
            if "/" not in sel:
                raise
    try:
        from lxml import etree, html as lhtml
    except ImportError as exc:
        raise ValueError(f"برای XPath به lxml نیاز است: {exc}") from exc
    html_s = str(root)
    try:
        tree = lhtml.fromstring(html_s)
    except Exception:
        tree = lhtml.fromstring(f"<div>{html_s}</div>")
    found = tree.xpath(sel)
    out: list[Any] = []
    for el in found:
        if isinstance(el, (str, bytes)):
            continue
        try:
            frag = etree.tostring(el, encoding="unicode", method="html")
        except Exception:
            continue
        parsed = BeautifulSoup(frag, "lxml")
        node = parsed.find(True)
        if node:
            out.append(node)
    return out


def select_value(node: Tag, selector: str, kind: str, base: str) -> str:
    if not selector:
        return ""
    try:
        matches = query_nodes(node, selector)
    except Exception as exc:
        raise ValueError(f"سلکتور نامعتبر ({kind}): {exc}") from exc
    for match in matches:
        if kind == "link":
            value = match.get("href") or (match.find("a", href=True) or {}).get("href", "")
            value = absolute_url(value, base)
        elif kind == "image":
            value = ""
            for attr in ("data-zoom", "data-large", "data-src", "data-lazy-src", "src"):
                if match.get(attr):
                    value = absolute_url(match.get(attr), base)
                    break
            if not value:
                img = match.find("img")
                value = image_value(dict(img.attrs) if img else "", base)
        else:
            value = clean_text(match.get_text(" ", strip=True))
        if value:
            return value
    return ""


def parse_selectors(soup: BeautifulSoup, base: str, selectors: dict[str, str]) -> list[dict[str, Any]]:
    container = clean_text(selectors.get("container"))
    if not container:
        return []
    try:
        nodes = query_nodes(soup, container)
    except Exception as exc:
        raise ValueError(f"سلکتور ظرف نامعتبر است: {exc}") from exc
    out: list[dict[str, Any]] = []
    for node in nodes:
        title = select_value(node, selectors.get("title", ""), "title", base)
        if not title:
            candidate = node.select_one("h1,h2,h3,h4,[class*='title'],a[title]")
            title = clean_text(candidate.get("title") or candidate.get_text(" ", strip=True)) if candidate else ""
        price = extract_price(select_value(node, selectors.get("price", ""), "price", base))
        if not price:
            candidate = node.select_one("[class*='price'],[class*='amount'],ins")
            price = extract_price(candidate.get_text(" ", strip=True)) if candidate else ""
        link = select_value(node, selectors.get("link", ""), "link", base)
        if not link:
            candidate = node if node.name == "a" and node.get("href") else node.find("a", href=True)
            link = absolute_url(candidate.get("href"), base) if candidate else ""
        image = select_value(node, selectors.get("image", ""), "image", base)
        if not image:
            img = node.find("img")
            if img:
                image = next((absolute_url(img.get(a), base) for a in ("data-src", "data-lazy-src", "src") if img.get(a)), "")
        sku = select_value(node, selectors.get("sku", ""), "sku", base)
        if title or link:
            out.append({"title": title[:300], "price": price, "link": link, "image": image, "sku": sku})
    return out


def _html_product(node: Tag, base: str, selectors: Optional[dict[str, str]] = None) -> Optional[dict[str, Any]]:
    """PHP-compatible DOM extraction: selectors first, then structural HTML guesses."""
    selectors = selectors or {}
    title = select_value(node, selectors.get("title", ""), "title", base)
    if not title:
        candidate = node.select_one("h1,h2,h3,h4,[class*='title'],[class*='name'],a[title]")
        title = clean_text((candidate.get("title") if candidate else "") or (candidate.get_text(" ", strip=True) if candidate else ""))
    if not title:
        image_title = node.find("img")
        title = clean_text((image_title.get("alt") or image_title.get("title")) if image_title else "")
    if not title:
        pieces = [clean_text(x) for x in node.stripped_strings]
        pieces = [x for x in pieces if len(x) > 3 and not re.fullmatch(r"[%0-9,،٬.٫ تومانریال]+", x)]
        title = max(pieces, key=len, default="")
    price = extract_price(select_value(node, selectors.get("price", ""), "price", base))
    if not price:
        candidate = node.select_one("[class*='price'],[class*='amount'],ins,[itemprop='price']")
        price = extract_price((candidate.get("content") or candidate.get_text(" ", strip=True)) if candidate else "")
    if not price:
        price = extract_price(node.get_text(" ", strip=True))
    link = select_value(node, selectors.get("link", ""), "link", base)
    if not link:
        candidate = node if node.name == "a" and node.get("href") else node.find("a", href=True)
        link = absolute_url(candidate.get("href"), base) if candidate else ""
    image = select_value(node, selectors.get("image", ""), "image", base)
    if not image:
        img = node.find("img")
        if img:
            image = next((absolute_url(img.get(a), base) for a in ("data-zoom-image","data-large_image","data-src","data-lazy-src","src") if img.get(a)), "")
    sku = select_value(node, selectors.get("sku", ""), "sku", base) or clean_text(node.get("data-product-id", ""))
    if not title and not link:
        return None
    return {"title": title[:300], "price": price, "link": link, "image": image, "sku": sku}


def _json_price(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("final", "selling", "sale", "amount", "value", "min", "current", "discounted", "rrp", "price"):
            if key in value:
                got = _json_price(value[key])
                if got:
                    return got
        return ""
    if isinstance(value, (int, float)) and value > 0:
        number = int(value)
        if number >= 10**7:
            number = number // 10  # rial → toman-ish display; extract_price still runs
        return extract_price(f"{number} تومان") or str(number)
    return extract_price(value)


def _json_text(*values: Any) -> str:
    for value in values:
        text = clean_text(value)
        if text:
            return text
    return ""


def parse_embedded_catalog(text: str, base: str) -> list[dict[str, Any]]:
    """Products hidden in JSON-LD / Next / Nuxt — Snappshop category pages need this."""
    blobs: list[str] = []
    for pattern in (
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        r'<script[^>]+id=["\']__NUXT_DATA__["\'][^>]*>(.*?)</script>',
        r'window\.__NUXT__\s*=\s*(\{.*?\})\s*;\s*</script>',
    ):
        blobs.extend(m.group(1) for m in re.finditer(pattern, text or "", re.I | re.S))
    found: list[dict[str, Any]] = []

    def consider(obj: Any) -> None:
        if not isinstance(obj, dict):
            return
        title = _json_text(obj.get("title"), obj.get("name"), obj.get("productTitle"), obj.get("fa_title"), obj.get("displayName"))
        if not title or len(title) < 3:
            return
        price = _json_price(obj.get("price") or obj.get("offers") or obj.get("finalPrice") or obj.get("sellingPrice") or obj.get("discountedPrice") or obj.get("minPrice"))
        href = _json_text(obj.get("url"), obj.get("link"), obj.get("href"), obj.get("slug"), obj.get("productUrl"))
        ident = _json_text(obj.get("sku"), obj.get("id"), obj.get("productId"), obj.get("code"))
        if href:
            if re.fullmatch(r"snp-\d+", href, re.I):
                href = "/product/" + href
            href = absolute_url(href, base)
        elif ident and re.fullmatch(r"snp-\d+", ident, re.I):
            href = absolute_url("/product/" + ident, base)
        image = obj.get("image") or obj.get("thumbnail") or obj.get("cover") or obj.get("mainImage")
        if isinstance(image, list) and image:
            image = image[0]
        if isinstance(image, dict):
            image = image.get("url") or image.get("src")
        image = absolute_url(clean_text(image), base) if image else ""
        if not href and not price:
            return
        found.append({"title": title[:300], "price": price, "link": href, "image": image, "sku": ident[:80]})

    def walk(obj: Any, depth: int = 0) -> None:
        if depth > 14:
            return
        if isinstance(obj, dict):
            consider(obj)
            items = obj.get("itemListElement")
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict):
                        consider(item.get("item") if isinstance(item.get("item"), dict) else item)
            for value in obj.values():
                walk(value, depth + 1)
        elif isinstance(obj, list) and len(obj) < 4000:
            for item in obj:
                walk(item, depth + 1)

    for blob in blobs:
        raw = (blob or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        walk(data)
    # de-dupe while walking via add_product later
    return found


def parse_html(text: str, base: str, selectors: Optional[dict[str, str]] = None) -> tuple[list[dict[str, Any]], BeautifulSoup, dict[str, int]]:
    """Parse only the downloaded/rendered DOM, matching scraper4.php (never APIs/hydration)."""
    soup = BeautifulSoup(text, "lxml")
    store: dict[str, dict[str, Any]] = {}
    selectors = selectors or {}
    selector_rows: list[dict[str, Any]] = []
    if selectors.get("container"):
        try:
            selector_rows = parse_selectors(soup, base, selectors)
        except Exception:
            selector_rows = []
    for row in selector_rows:
        add_product(store, row)
    if not store:
        candidates = soup.select("li.product,article[class*='product'],div.product-card,div.product-item,div[class*='product-card'],div[class*='product-item'],[data-product-id],[itemtype*='Product']")
        # Like PHP's outer-container repair: if one wrapper was selected, descend to repeated cards.
        if len(candidates) == 1:
            nested = candidates[0].select("li,article,div[class*='product'],[data-product-id]")
            if len(nested) > 1:
                candidates = nested
        for node in candidates:
            add_product(store, _html_product(node, base, selectors))
    if not store:
        # PHP-style last fallback: product links with images are reliable even
        # when a shop uses unknown generated class names (e.g. barfbox.ir).
        for link in soup.select("a[href*='/product/'],a[href*='/products/'],a[href*='/shop/'],a[href*='/snp-']"):
            if not link.find("img") and not link.select_one("[class*='price']"): continue
            node: Tag = link
            for _ in range(5):
                parent=node.parent
                if not isinstance(parent,Tag): break
                node=parent
                if node.find("img") and extract_price(node.get_text(" ",strip=True)): break
            add_product(store,_html_product(node,base,selectors))
    for row in parse_embedded_catalog(text, base):
        add_product(store, row)
    return list(store.values()), soup, {"selector_matches": len(selector_rows), "dom_products": len(store), "html_bytes": len(text.encode("utf-8", "ignore"))}


def sanitize_rich_html(value: str) -> str:
    fragment=BeautifulSoup(value or "","html.parser")
    for node in fragment.select("script,style,iframe,object,embed,form,input,button,link,meta"):node.decompose()
    for node in fragment.find_all(True):
        for attr in list(node.attrs):
            if str(attr).lower().startswith("on") or str(attr).lower() in {"srcdoc","formaction"}:del node.attrs[attr]
        href=clean_text(node.get("href"))
        if href.lower().startswith(("javascript:","data:")):node.attrs.pop("href",None)
    return "".join(str(x) for x in fragment.contents)[:40000]


def _usable_image(url: str) -> bool:
    low=(url or "").lower()
    if not url or url.startswith("data:") or low.endswith(".svg"):
        return False
    return not any(x in low for x in ("logo","icon","avatar","placeholder","spinner","sprite","blank.gif","pixel.gif","1x1","favicon","dummy"))

def _srcset_largest(srcset: str, base: str) -> str:
    best, width = "", -1
    for part in (srcset or "").split(","):
        bits=part.strip().split()
        if not bits: continue
        url=absolute_url(bits[0], base)
        w=0
        if len(bits)>1 and bits[1].endswith("w"):
            try: w=int(bits[1][:-1])
            except ValueError: w=0
        if url and w>=width:
            best, width = url, w
    return best if _usable_image(best) else ""

def _detail_image_url(node: Tag, base: str) -> str:
    for attr in ("data-zoom-image","data-large_image","data-large-image","data-full","data-zoom","data-original","data-lazy","data-src","data-lazy-src","data-image","href"):
        url=absolute_url(node.get(attr),base)
        if _usable_image(url): return url
    for attr in ("data-srcset","data-lazy-srcset","srcset"):
        found=_srcset_largest(clean_text(node.get(attr)), base)
        if found: return found
    source=node.select_one("source[srcset],source[data-srcset]")
    if source:
        found=_srcset_largest(clean_text(source.get("srcset") or source.get("data-srcset")), base)
        if found: return found
    url=absolute_url(node.get("src"),base)
    if _usable_image(url): return url
    parent=node.parent
    if parent is not None:
        for attr in ("data-large_image","data-zoom-image","href"):
            url=absolute_url(parent.get(attr),base)
            if _usable_image(url): return url
    return ""

def _iter_json_ld(data: Any):
    if isinstance(data, list):
        for item in data:
            yield from _iter_json_ld(item)
    elif isinstance(data, dict):
        if "@graph" in data:
            yield from _iter_json_ld(data.get("@graph"))
        else:
            yield data

def parse_json_ld_product(soup: BeautifulSoup, base: str) -> dict[str, Any]:
    out: dict[str, Any] = {}; images: list[str] = []
    for script in soup.find_all("script", attrs={"type": True}):
        typ=clean_text(script.get("type")).lower()
        if "ld+json" not in typ: continue
        raw=clean_text(script.string or script.get_text() or "")
        if not raw: continue
        try: data=json.loads(raw)
        except Exception:
            try: data=json.loads(raw.rstrip(";"))
            except Exception: continue
        for node in _iter_json_ld(data):
            types=node.get("@type") or node.get("type") or ""
            if isinstance(types, list): types=" ".join(str(x) for x in types)
            if "product" not in str(types).lower(): continue
            desc=clean_text(node.get("description") or "")
            if desc: out.setdefault("long_desc", desc[:30000])
            sku=clean_text(node.get("sku") or node.get("mpn") or "")
            if sku: out.setdefault("sku", sku[:500])
            brand=node.get("brand")
            if isinstance(brand, dict): brand=brand.get("name")
            brand=clean_text(brand)
            if brand: out.setdefault("brand", brand[:1000])
            img=node.get("image")
            for item in (img if isinstance(img, list) else [img]):
                url=image_value(item, base)
                if _usable_image(url) and url not in images: images.append(url)
    if images:
        out["image"], out["images"], out["images_count"]=images[0], images[:30], min(30, len(images))
    return out

def detail_quality(fields: dict[str, Any]) -> int:
    n=len(fields.get("images") or ([] if not fields.get("image") else [fields.get("image")]))
    desc=len(clean_text(fields.get("long_desc") or fields.get("short_desc") or ""))
    return (2 if n>=2 else 1 if n else 0) + (2 if desc>=80 else 1 if desc>=20 else 0)



GALLERY_MAX_IMAGES = 30

def url_is_image(url: str) -> bool:
    u=clean_text(url)
    if not u or re.match(r"^(data:|blob:|javascript:|#)", u, re.I):
        return False
    if re.search(r"(placeholder|spacer|transparent|loading|no-?image|blank\.|1x1)", u, re.I):
        return False
    return _usable_image(u)

def gallery_dedupe(urls: list[str], max_n: int = GALLERY_MAX_IMAGES) -> list[str]:
    seen: dict[str, bool] = {}; out: list[str] = []
    for u in urls:
        u=clean_text(u)
        if not u: continue
        norm=re.sub(r"-\d{2,4}x\d{2,4}(?=\.[a-z]{3,4}(?:\?|$))", "", u, flags=re.I)
        norm=re.sub(r"[?#].*$", "", norm)
        if norm in seen: continue
        seen[norm]=True; out.append(u)
        if len(out)>=max_n: break
    return out

def gallery_normalize_cfg(raw: Any) -> dict[str, Any]:
    if isinstance(raw, str):
        try: raw=json.loads(raw)
        except Exception: raw={}
    if not isinstance(raw, dict): raw={}
    mode=clean_text(raw.get("mode") or "auto") or "auto"
    if mode not in {"off","auto","manual","number"}: mode="auto"
    box=clean_text(raw.get("box")) or ".woocommerce-product-gallery,[class*='product-gallery'],[class*='gallery'],[class*='swiper']"
    try: frm=max(0,int(raw.get("from") or 1))
    except (TypeError,ValueError): frm=1
    try: to=max(0,int(raw.get("to") or 10))
    except (TypeError,ValueError): to=10
    try: mx=max(1,min(GALLERY_MAX_IMAGES,int(raw.get("max") or GALLERY_MAX_IMAGES)))
    except (TypeError,ValueError): mx=GALLERY_MAX_IMAGES
    return {"mode":mode,"enabled":mode!="off","box":box,"selectors":clean_text(raw.get("selectors")),"pattern":clean_text(raw.get("pattern")),"from":frm,"to":to,"max":mx,"skip_first":bool(raw.get("skip_first"))}

def gallery_imgs_inside(node: Tag, base: str) -> list[str]:
    out=[]
    u=_detail_image_url(node, base)
    if url_is_image(u): out.append(u)
    try: subs=node.select("img, source, a[href], [data-src], [data-large_image], [data-zoom-image]")[:80]
    except Exception: subs=[]
    for sub in subs:
        u=_detail_image_url(sub, base)
        if url_is_image(u): out.append(u)
    return out

def gallery_extract(soup: BeautifulSoup, base: str, cfg: Any) -> dict[str, Any]:
    cfg=gallery_normalize_cfg(cfg)
    res={"images":[],"mode":cfg["mode"],"tried":0,"note":""}
    if not cfg["enabled"]:
        res["note"]="خاموش"; return res
    urls: list[str]=[]
    if cfg["mode"]=="auto":
        try: boxes=soup.select(cfg["box"])[:40]
        except Exception:
            res["note"]="سلکتور باکس نامعتبر"; return res
        if not boxes:
            res["note"]="باکس عکس‌ها پیدا نشد"; return res
        res["tried"]=len(boxes)
        for box in boxes: urls.extend(gallery_imgs_inside(box, base))
        res["note"]=f"باکس پیدا شد — {len(boxes)} ظرف"
    elif cfg["mode"]=="manual":
        sels=[x.strip() for x in re.split(r"[\r\n|]+", cfg["selectors"]) if x.strip()]
        if not sels:
            res["note"]="هیچ سلکتوری وارد نشده"; return res
        hit=0
        for sel in sels:
            try: nodes=soup.select(sel)[:40]
            except Exception: continue
            if not nodes: continue
            hit+=1
            for node in nodes:
                u=_detail_image_url(node, base)
                if url_is_image(u): urls.append(u)
                else: urls.extend(gallery_imgs_inside(node, base))
        res["tried"]=len(sels); res["note"]=f"{hit} از {len(sels)} سلکتور نتیجه داد"
    elif cfg["mode"]=="number":
        pat=cfg["pattern"]
        if "{n}" not in pat:
            res["note"]="الگو باید {n} داشته باشد"; return res
        frm, to = cfg["from"], max(cfg["from"], cfg["to"])
        if to-frm > GALLERY_MAX_IMAGES*2: to=frm+GALLERY_MAX_IMAGES*2
        miss=hit=0
        for i in range(frm, to+1):
            res["tried"]+=1
            sel=pat.replace("{n}", str(i))
            try: nodes=soup.select(sel)[:20]
            except Exception: nodes=[]
            if not nodes:
                miss+=1
                if miss>=3 and hit>0: break
                continue
            miss=0; hit+=1
            for node in nodes:
                u=_detail_image_url(node, base)
                if url_is_image(u): urls.append(u)
                else: urls.extend(gallery_imgs_inside(node, base))
        res["note"]=f"{hit} شماره از {res['tried']} امتحان‌شده نتیجه داد"
    imgs=gallery_dedupe(urls, cfg["max"])
    if cfg["skip_first"] and len(imgs)>1: imgs=imgs[1:]
    res["images"]=imgs
    return res

def gallery_apply_to_product(product: dict[str, Any], imgs: list[str], replace: bool=False) -> int:
    main="" if replace else clean_text(product.get("image"))
    all_imgs=gallery_dedupe(([main] if main else [])+list(imgs or []))
    if not all_imgs: return 0
    product["image"]=all_imgs[0]; product["images"]=all_imgs; product["images_count"]=len(all_imgs)
    return len(all_imgs)

def extract_merge_detail(fresh: dict[str, Any], prev: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(prev, dict) or not prev: return fresh
    for field in ("short_desc","short_desc_html","long_desc","long_desc_html","sku","brand","weight","stock","category","tags","variations_text"):
        newv=fresh.get(field)
        if isinstance(newv, str): newv=newv.strip()
        if newv in ("", None, [], {}) and prev.get(field) not in ("", None, [], {}):
            fresh[field]=prev[field]
    for field in ("variations","variation_groups","variation_prices","attributes"):
        if not fresh.get(field) and prev.get(field): fresh[field]=prev[field]
    new_imgs=fresh.get("images") if isinstance(fresh.get("images"), list) else []
    old_imgs=prev.get("images") if isinstance(prev.get("images"), list) else []
    if len(old_imgs)>len(new_imgs):
        fresh["images"]=old_imgs; fresh["images_count"]=len(old_imgs)
        if old_imgs and not fresh.get("image"): fresh["image"]=old_imgs[0]
    if not fresh.get("image") and prev.get("image"): fresh["image"]=prev["image"]
    return fresh

def parse_detail_fields(soup: BeautifulSoup, base: str, selectors: dict[str, str]) -> dict[str, Any]:
    """Extract rich product details from visible DOM only, with PHP-style automatic fallbacks."""
    out: dict[str, Any] = {}
    mapping = {
        "sku": ("[itemprop='sku'],[class*='sku'],[data-product-sku]", 500),
        "weight": ("[class*='weight'],[data-weight]", 500),
        "category": ("[class*='breadcrumb'] a:last-child,[itemprop='category']", 1000),
        "brand": ("[itemprop='brand'],[class*='brand'],[data-brand]", 1000),
        "stock": ("[class*='stock'],[class*='availability'],[itemprop='availability']", 1000),
        "short_desc": ("[class*='short-description'],[class*='short_description'],[class*='excerpt'],[class*='summary'] [class*='description']", 12000),
        "long_desc": ("#tab-description,.woocommerce-Tabs-panel--description,[itemprop='description'],[class*='product-description'],[class*='product_description'],#description,[id*='description'],[class*='product-content']", 30000),
    }
    for field, (fallback, limit) in mapping.items():
        selector = clean_text(selectors.get(field)) or fallback
        try: node = soup.select_one(selector)
        except Exception as exc: raise ValueError(f"سلکتور جزئیات {field} نامعتبر است: {exc}") from exc
        if node:
            text=clean_text(node.get("content") or node.get("data-weight") or node.get_text(" ",strip=True))[:limit]
            if text:out[field]=text
            if field in {"short_desc","long_desc"}:
                html_value=sanitize_rich_html("".join(str(x) for x in node.contents).strip())
                if html_value:out[field+"_html"]=html_value

    variation_selector=clean_text(selectors.get("variations"))
    variation_selectors=[x.strip() for x in re.split(r"[\n|]+",variation_selector) if x.strip()] if variation_selector else ["form.variations select","[class*='variation']","[class*='swatch']","[class*='color-options']","[class*='size-options']"]
    groups: list[dict[str,Any]]=[];flat: list[str]=[];seen_boxes: set[int]=set()
    for selector in variation_selectors:
        try: boxes=soup.select(selector)
        except Exception as exc: raise ValueError(f"سلکتور تنوع نامعتبر است: {exc}") from exc
        for box in boxes[:30]:
            if id(box) in seen_boxes:continue
            if not variation_selector and box.name!="select" and box.select_one("select"):continue
            seen_boxes.add(id(box));name=clean_text(box.get("data-name") or box.get("name") or box.get("aria-label") or "")
            if not name:
                label=box.find_previous(["label","legend","strong"]);name=clean_text(label.get_text(" ",strip=True) if label else "تنوع")
            options=box.select("option:not([disabled]),button:not([disabled]),li,label,[data-value],[data-option],[class*='swatch']")
            if box.name=="select":options=box.select("option:not([disabled])")
            values=[]
            for option in options[:80]:
                value=clean_text(option.get("title") or option.get("aria-label") or option.get_text(" ",strip=True) or option.get("data-value") or option.get("data-option") or option.get("value"))
                if value and value.lower() not in {"انتخاب","انتخاب کنید","choose","select","choose an option"} and len(value)<=100 and value not in values:values.append(value)
            if 1 < len(values) <= 50:
                groups.append({"name":name[:100] or "تنوع","values":values})
                for value in values:
                    if value not in flat:flat.append(value)
    unique_groups=[];group_signatures=set()
    for group in groups:
        signature=(group["name"],tuple(group["values"]))
        if signature not in group_signatures:group_signatures.add(signature);unique_groups.append(group)
    if unique_groups:out["variation_groups"],out["variations"],out["variations_text"]=unique_groups[:20],flat[:200],"، ".join(flat[:200])

    tag_selector=clean_text(selectors.get("tags")) or "[class*='product-tag'] a,[rel='tag']"
    try:tag_nodes=soup.select(tag_selector)
    except Exception as exc:raise ValueError(f"سلکتور برچسب نامعتبر است: {exc}") from exc
    tags=[]
    for node in tag_nodes[:100]:
        value=clean_text(node.get_text(" ",strip=True))
        if value and value not in tags:tags.append(value[:100])
    if tags:out["tags"]=tags[:50]

    price_selector=clean_text(selectors.get("price")) or "[itemprop='price'],[class*='sale-price'],[class*='price']"
    try:price_node=soup.select_one(price_selector)
    except Exception as exc:raise ValueError(f"سلکتور قیمت جزئیات نامعتبر است: {exc}") from exc
    if price_node:
        price=extract_price(price_node.get("content") or price_node.get_text(" ",strip=True))
        if price:out["price"]=price

    gallery_selector=clean_text(selectors.get("gallery")) or "[class*='product-gallery'] img,[class*='product_gallery'] img,[class*='woocommerce-product-gallery'] img,[class*='gallery'] img,[class*='swiper'] img,[class*='slider'] img,main img[itemprop='image'],img[data-large_image],img[data-zoom-image],[data-fancybox] img,a[data-fancybox],.woocommerce-product-gallery__image a"
    try:image_nodes=soup.select(gallery_selector)
    except Exception as exc:raise ValueError(f"سلکتور گالری نامعتبر است: {exc}") from exc
    images=[]
    for node in image_nodes[:120]:
        url=_detail_image_url(node,base)
        if _usable_image(url) and url not in images:images.append(url)
    for meta in soup.select("meta[property='og:image'],meta[property='og:image:secure_url'],meta[name='twitter:image']"):
        meta_url=absolute_url(meta.get("content"),base)
        if _usable_image(meta_url) and meta_url not in images:images.append(meta_url)
    for node in soup.select("[style*='background-image']")[:40]:
        style=clean_text(node.get("style"))
        m=re.search(r"url\((['\"]?)(.+?)\1\)", style)
        if m:
            bg=absolute_url(m.group(2),base)
            if _usable_image(bg) and bg not in images:images.append(bg)
    ld=parse_json_ld_product(soup,base)
    for url in ld.get("images") or ([] if not ld.get("image") else [ld["image"]]):
        if _usable_image(url) and url not in images:images.append(url)
    for key,value in ld.items():
        if key in {"image","images","images_count"}: continue
        if value not in ("",None,[],{}) and not out.get(key): out[key]=value
    if images:out["image"],out["images"],out["images_count"]=images[0],images[:30],min(30,len(images))
    if len(clean_text(out.get("long_desc") or out.get("short_desc") or ""))<40:
        blocks=[]
        for sel in ("#tab-description",".woocommerce-Tabs-panel--description","[itemprop='description']",".product-description","#description","[class*='product-content']","[class*='description']"):
            try: nodes=soup.select(sel)
            except Exception: nodes=[]
            for node in nodes[:8]:
                text=clean_text(node.get_text(" ", strip=True))
                if len(text)>=40: blocks.append((len(text), node, text))
        if blocks:
            blocks.sort(key=lambda x:x[0], reverse=True)
            _len, node, text = blocks[0]
            out["long_desc"]=text[:30000]
            html_value=sanitize_rich_html("".join(str(x) for x in node.contents).strip())
            if html_value: out["long_desc_html"]=html_value

    attributes=[];attribute_selector=clean_text(selectors.get("attributes")) or "table[class*='spec'] tr,table[class*='attribute'] tr,[class*='specification'] li,[class*='product-attribute'] li"
    try:attribute_rows=soup.select(attribute_selector)
    except Exception as exc:raise ValueError(f"سلکتور مشخصات نامعتبر است: {exc}") from exc
    for row in attribute_rows[:100]:
        cells=row.select("th,td,[class*='name'],[class*='label'],[class*='value']")
        if len(cells)>=2:
            name,value=clean_text(cells[0].get_text(" ",strip=True)),clean_text(cells[-1].get_text(" ",strip=True))
            if name and value and name!=value:attributes.append({"name":name[:150],"value":value[:1000]})
    if attributes:out["attributes"]=attributes[:60]
    return {key:value for key,value in out.items() if value not in ("",[],None)}


# ---------------------------------------------------------------------------
# PHP-compatible HTML extraction and optional browser rendering
# ---------------------------------------------------------------------------
def page_url(original: str, page: int, kind: str, value: str) -> str:
    if page <= 1:
        return original
    parsed = urlparse(original)
    if kind == "path":
        # Match PHP build_page_url_custom(path_pattern): append the pattern to
        # the original listing path, not merely to the domain root.
        pattern=value or "/page/{page}/";replacement=pattern.replace("{page}",str(page));root=f"{parsed.scheme}://{parsed.netloc}"
        base_path=re.sub(r"/page/\d+/?$","",parsed.path.rstrip("/"),flags=re.I)
        return root+base_path+(replacement if replacement.startswith("/") else "/"+replacement)
    if kind == "full":
        return value.replace("{page}",str(page)) if value else original
    param = value or "page"
    query = parse_qs(parsed.query, keep_blank_values=True)
    try:
        origin = int((query.get(param) or ["1"])[0] or 1)
    except ValueError:
        origin = 1
    origin = max(1, origin)
    if page <= 1:
        return original
    query[param] = [str(origin + page - 1)]
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))



def temporary_browser_path() -> str:
    user = re.sub(r"[^A-Za-z0-9_.-]", "_", os.path.basename(os.path.expanduser("~")) or "user")
    return os.path.join(tempfile.gettempdir(), f"scraper4-{user}-playwright")


def configured_browser_path() -> str:
    try:
        path = clean_text(load_data().get("runtime", {}).get("playwright_path"))
    except Exception:
        path = ""
    if path and os.path.isdir(path):
        return path
    env_path = clean_text(os.environ.get("PLAYWRIGHT_BROWSERS_PATH"))
    if env_path and os.path.isdir(env_path):
        return env_path
    cache = os.path.expanduser("~/.cache/ms-playwright")
    if VPS_MODE and os.path.isdir(cache):
        return cache
    return os.path.join(BASE_DIR, "ms-playwright")


def find_browser_executable(preferred: str = "") -> str:
    system_bins = [
        os.path.join(BASE_DIR, "chrome-linux64", "chrome"),
        "/opt/scraper4/chrome-linux64/chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/opt/google/chrome/chrome",
    ]
    roots = []
    for root in (preferred, os.path.join(BASE_DIR, "ms-playwright"), temporary_browser_path(), os.path.expanduser("~/.cache/ms-playwright"), "/usr/bin", "/snap/bin", "/opt/google/chrome", "/opt/scraper4"):
        root = os.path.abspath(root) if root else ""
        if root and root not in roots and os.path.isdir(root): roots.append(root)
    names = {"chrome", "chromium", "chrome-headless-shell", "headless_shell", "google-chrome", "google-chrome-stable", "chromium-browser"}
    candidates = []
    if VPS_MODE:
        for path in system_bins:
            if os.path.isfile(path) and os.access(path, os.X_OK):
                candidates.append(path)
    for root in roots:
        for directory, _, files in os.walk(root):
            for name in files:
                path = os.path.join(directory, name)
                if name in names and os.access(path, os.X_OK): candidates.append(path)
    # VPS: prefer full Chromium. PA: prefer the compact headless shell.
    if VPS_MODE:
        candidates.sort(key=lambda x: ("headless" in x.lower(), -os.path.getmtime(x)))
    else:
        candidates.sort(key=lambda x: ("headless" not in x.lower(), -os.path.getmtime(x)))
    return candidates[0] if candidates else ""


def run_cancellable(fn: Callable[[], Any], task_id: str, label: str = "browser") -> Any:
    """Run a blocking call in a daemon thread, abandoning it on stop.

    Browser launches have no timeout of their own, so even the per-phase cancel
    checks inside render_playwright cannot help if chromium never comes up.
    Running the whole render in a helper thread means a stop request is honoured
    in about a second no matter where it is wedged. The thread is a daemon and
    the renderer closes its own browser in a finally block.
    """
    if not task_id:
        return fn()
    if live_task_cancelled(task_id):
        raise CancelledError("استخراج با درخواست کاربر متوقف شد")
    box: dict[str, Any] = {}
    def run() -> None:
        try:
            box["ok"] = fn()
        except BaseException as exc:  # noqa: BLE001 - re-raised in the caller
            box["err"] = exc
    worker = threading.Thread(target=run, name="render-" + label, daemon=True)
    worker.start()
    while True:
        worker.join(0.25)
        if not worker.is_alive():
            break
        if live_task_cancelled(task_id):
            raise CancelledError("استخراج با درخواست کاربر متوقف شد")
    if "err" in box:
        raise box["err"]
    return box["ok"]


def render_playwright(url: str, timeout: int, scrolls: int = 4, task_id: str = "") -> FetchResult:
    browser_path = configured_browser_path()
    if browser_path and os.path.isdir(browser_path):
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = browser_path
    elif VPS_MODE:
        os.environ.pop("PLAYWRIGHT_BROWSERS_PATH", None)
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise FetchError("Playwright نصب نیست؛ از بخش به‌روزرسانی «نصب وابستگی‌ها» را اجرا کنید") from exc
    public_http_url(url)
    try:
        with sync_playwright() as pw:
            expected = pw.chromium.executable_path
            executable = expected if expected and os.path.isfile(expected) else find_browser_executable(browser_path)
            if not executable and not VPS_MODE:
                raise FetchError("فایل اجرایی مرورگر پیدا نشد. دکمه «نصب سبک Playwright» را اجرا کنید؛ در صورت کمبود سهمیه، مرورگر خودکار در فضای موقت نصب می‌شود.")
            network=load_data().get("network",{});network_mode=outbound_mode(network);launch_options={"headless":True,"args":["--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--disable-blink-features=AutomationControlled"]}
            if executable: launch_options["executable_path"]=executable
            if network_mode=="http" and network.get("proxy"):launch_options["proxy"]={"server":str(network["proxy"])}
            if task_id and live_task_cancelled(task_id):
                raise CancelledError("استخراج با درخواست کاربر متوقف شد")
            browser = pw.chromium.launch(**launch_options);page = browser.new_page(user_agent=USER_AGENT,locale="fa-IR",viewport={"width":1366,"height":768},timezone_id="Asia/Tehran")
            page.add_init_script("""Object.defineProperty(navigator,'webdriver',{get:()=>undefined});Object.defineProperty(navigator,'languages',{get:()=>['fa-IR','fa','en-US','en']});Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});window.chrome=window.chrome||{runtime:{}};""")
            try:
                from playwright_stealth import stealth_sync
                stealth_sync(page)
            except Exception:
                pass
            if network_mode=="relay":
                relay_headers={"X-Proxy-UA":USER_AGENT}
                if network.get("worker_key"):relay_headers["X-Proxy-Key"]=str(network["worker_key"])
                page.set_extra_http_headers(relay_headers)
            target=outbound_browser_target(url);snapp="snappshop.ir" in (url or "").lower();timeout_ms=min(20000 if snapp else 35000, max(8000,int(timeout)*1000));goto_ok=False
            def _stop_requested() -> bool:
                return bool(task_id) and live_task_cancelled(task_id)
            def _abort(browser_obj: Any) -> None:
                # Close the browser before unwinding so stopping a job never
                # leaks a chromium process.
                try:browser_obj.close()
                except Exception:pass
                raise CancelledError("استخراج با درخواست کاربر متوقف شد")
            for wait in ("load","domcontentloaded"):
                if _stop_requested():_abort(browser)
                try:
                    page.goto(target, wait_until=wait, timeout=timeout_ms);goto_ok=True;break
                except Exception as exc:
                    if "timeout" not in str(exc).lower() and "Timeout" not in str(exc):
                        raise
            if not goto_ok:
                page.goto(target, wait_until="commit", timeout=timeout_ms)
            snapp="snappshop.ir" in (url or "").lower()
            if _stop_requested():_abort(browser)
            page.wait_for_timeout(1800 if snapp else 500)
            for _ in range(max(0, min(16, scrolls if snapp else scrolls))):
                if _stop_requested():_abort(browser)
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                page.wait_for_timeout(850 if snapp else 600)
            if snapp:
                try:
                    page.wait_for_selector('a[href*="/product/"],a[href*="/snp-"],article, [class*="product"]', timeout=12000)
                except Exception:
                    pass
                try:
                    page.evaluate("""() => document.querySelectorAll('img[data-src],img[data-lazy-src],img[data-original]').forEach(img=>{const u=img.getAttribute('data-src')||img.getAttribute('data-lazy-src')||img.getAttribute('data-original');if(u)img.src=u})""")
                except Exception:
                    pass
            if _stop_requested():_abort(browser)
            html = page.content();final_url = url if network_mode=="relay" else page.url
            try:
                blob=page.evaluate("() => {try{const n=window.__NEXT_DATA__||window.__NUXT__||window.__NUXT_DATA__;return n?JSON.stringify(n):'';}catch(e){return '';}}")
                if blob and "__NEXT_DATA__" not in html and "__NUXT__" not in html:
                    html += '<script id="__NEXT_DATA__" type="application/json">'+blob+'</script>'
            except Exception:
                pass
            sample=clean_text(BeautifulSoup(html[:200000],"html.parser").get_text(" ",strip=True)).lower()
            if any(x in sample for x in ("access denied","موقتا vpn خود را خاموش","temporarily blocked","captcha","درخواست شما مشکوک","دسترسی شما مسدود")):
                raise FetchError("Playwright Stealth نیز صفحه ضدبات/VPN دریافت کرد؛ IP مسیر اتصال توسط سایت رد شده است. مسیر مستقیم یا HTTP Proxy مجاز را در دروازه مرکزی انتخاب کنید")
            browser.close()
        return FetchResult(final_url, html, "text/html", 200, "browser")
    except (FetchError, CancelledError):
        raise
    except Exception as exc:
        raise FetchError(f"مرورگر headless ناموفق بود: {exc}") from exc


@dataclass
class ScrapeReport:
    products: dict[str, dict[str, Any]] = field(default_factory=dict)
    logs: list[str] = field(default_factory=list)
    pages: int = 0
    modes: set[str] = field(default_factory=set)
    diagnostics: dict[str, Any] = field(default_factory=dict)
    job_id: str = ""


def render_selenium(url: str, timeout: int, scrolls: int = 4, task_id: str = "") -> FetchResult:
    """Full Chrome/Chromium via Selenium — VPS only path; Playwright is preferred."""
    public_http_url(url)
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
    except ImportError as exc:
        raise FetchError("کتابخانه Selenium نصب نیست") from exc
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_argument(f"--user-agent={USER_AGENT}")
    opts.add_argument("--lang=fa-IR")
    opts.add_argument("--window-size=1366,768")
    chrome_bin = find_browser_executable(configured_browser_path())
    if chrome_bin:
        opts.binary_location = chrome_bin
    driver = None
    try:
        if task_id and live_task_cancelled(task_id):
            raise CancelledError("استخراج با درخواست کاربر متوقف شد")
        driver = webdriver.Chrome(options=opts)
        driver.set_page_load_timeout(max(15, int(timeout)))
        driver.get(outbound_browser_target(url))
        for _ in range(max(0, min(12, scrolls))):
            if task_id and live_task_cancelled(task_id):
                raise CancelledError("استخراج با درخواست کاربر متوقف شد")
            try:
                driver.execute_script("window.scrollTo(0, document.body.scrollHeight)")
            except Exception:
                break
            time.sleep(0.7)
        html = driver.page_source or ""
        final_url = driver.current_url or url
    except CancelledError:
        # A stop request must unwind, not be reported as a Selenium failure.
        # The finally block below still quits the driver.
        raise
    except Exception as exc:
        raise FetchError(f"Selenium: {exc}") from exc
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass
    sample = clean_text(BeautifulSoup(html[:200000], "html.parser").get_text(" ", strip=True)).lower()
    if any(x in sample for x in ("access denied", "موقتا vpn خود را خاموش", "temporarily blocked", "captcha", "درخواست شما مشکوک", "دسترسی شما مسدود")):
        raise FetchError("Selenium نیز صفحه ضدبات/VPN دریافت کرد؛ IP مسیر اتصال توسط سایت رد شده است")
    return FetchResult(final_url, html, "text/html", 200, "selenium")



def save_extract_checkpoint(job_id: str, config: dict[str, Any], report: ScrapeReport, next_page: int, next_url: str = "", status: str = "running") -> None:
    """Atomic per-page checkpoint, safe even when several profiles run concurrently."""
    with DATA_LOCK:
        data = load_data()
        jobs = data.setdefault("extract_jobs", {})
        public_config = {k: v for k, v in config.items() if not str(k).startswith("_") and k != "job_id"}
        jobs[job_id] = {"id": job_id, "profile": clean_text(config.get("_profile_name")), "status": status, "updated_at": int(time.time()), "next_page": next_page, "next_url": next_url, "total": len(report.products), "config": public_config, "products": list(report.products.values()), "logs": report.logs[-20:]}
        if len(jobs) > EXTRACT_JOB_KEEP:
            for key in sorted(jobs, key=lambda x: int(jobs[x].get("updated_at", 0)))[:-EXTRACT_JOB_KEEP]:jobs.pop(key, None)
        save_data(data)
    task_id=clean_text(config.get("_live_task_id"))
    if task_id:
        pages=max(1,int(config.get("pages",1)));done=max(0,min(pages,next_page-1));percent=min(88,round(done/pages*88));last=report.logs[-1] if report.logs else f"آماده‌سازی صفحه {next_page}"
        current=live_task_read(task_id);elapsed=max(1,int(time.time()-int(current.get("created_at",time.time()))));eta=int(elapsed/done*(pages-done)) if done else 0
        live_task_update(task_id,percent,f"صفحه {done} از {pages}","running","محصول‌ها: "+str(len(report.products))+" · "+last,done=done,total=pages,extracted=len(report.products),elapsed_seconds=elapsed,eta_seconds=eta)


def fetch_engine_installed(engine: str) -> bool:
    if engine in {"requests", "request"}:
        return True
    names = {"httpx": "httpx", "cloudscraper": "cloudscraper", "curl_cffi": "curl_cffi", "playwright": "playwright", "selenium": "selenium"}
    mod = names.get(engine)
    if not mod:
        return True
    try:
        importlib.import_module(mod)
        return True
    except ImportError:
        return False


HTTP_ENGINE_ORDER = ("requests", "httpx", "curl_cffi", "cloudscraper")
KNOWN_ENGINES = HTTP_ENGINE_ORDER + ("playwright", "selenium")


def engine_http_order() -> list[str]:
    out: list[str] = []
    for engine in HTTP_ENGINE_ORDER:
        if engine == "requests" or fetch_engine_installed(engine):
            out.append(engine)
    return out


def engine_try_order(master: str, requested: str, mode: str) -> list[str]:
    """Fastest-first chain: master/pin at the front, the rest are backups."""
    http = engine_http_order()
    browsers = [e for e in ("playwright",) if fetch_engine_installed(e)]
    if requested == "selenium" or master == "selenium":
        if fetch_engine_installed("selenium"):
            browsers.append("selenium")
    pin = requested if requested in KNOWN_ENGINES else ""
    head = pin or (master if master in KNOWN_ENGINES else "")
    if mode == "browser":
        chain = browsers + http
    elif head in {"playwright", "selenium"}:
        chain = [head] + [x for x in browsers if x != head] + http
    elif head in http:
        chain = [head] + [x for x in http if x != head] + browsers
    else:
        chain = http + browsers
    seen: set[str] = set()
    out: list[str] = []
    for engine in chain:
        if engine not in seen:
            seen.add(engine)
            out.append(engine)
    return out


def persist_profile_master_engine(profile_name: str, engine: str, host: str = "", elapsed_ms: int = 0) -> None:
    name = clean_text(profile_name)
    engine = clean_text(engine).lower()
    if not name or engine not in KNOWN_ENGINES:
        return
    try:
        data = load_data()
        prof = data.get("profiles", {}).get(name)
        if not isinstance(prof, dict):
            return
        prof["fetch_engine_master"] = engine
        if host:
            prof["fetch_engine_host"] = host
        if elapsed_ms:
            prof["fetch_engine_ms"] = int(elapsed_ms)
        prof["fetch_engine_learned_at"] = int(time.time())
        save_data(data)
    except Exception as exc:
        report_error("engine_master", exc)


def _is_relay_block_error(text: str) -> bool:
    raw = clean_text(text)
    if any(code in raw for code in ("HTTP 502", "HTTP 503", "HTTP 504", "HTTP 520", "HTTP 521", "HTTP 522", "HTTP 523", "HTTP 524")):
        return True
    low = raw.lower()
    return " 503" in (" " + raw) and any(x in low for x in ("proxy", "relay", "cloudflare", "abrhapaas", "workers.dev"))


def _fetcher_direct(network: dict[str, Any], task_id: str = "") -> "Fetcher":
    cfg = dict(network or {})
    cfg["proxy"] = ""
    cfg["proxy_mode"] = "direct"
    if task_id:
        cfg["_live_task_id"] = task_id
    return Fetcher(cfg)


def picker_http_fetch(url: str, fetcher: "Fetcher", errors: list[str]) -> Any:
    relay_dead = False
    for engine in ("requests", "httpx", "cloudscraper", "curl_cffi"):
        if not fetch_engine_installed(engine):
            continue
        if relay_dead:
            break
        try:
            return fetcher.get(url, engine=engine)
        except FetchError as exc:
            msg = clean_text(exc)
            if "نصب نیست" in msg:
                continue
            errors.append(f"{engine}: {msg}")
            if fetcher.proxy_mode in {"relay", "http"} and _is_relay_block_error(msg):
                relay_dead = True
    return None


def picker_browser_fetch(url: str, timeout: int, scrolls: int, errors: list[str]) -> Any:
    if fetch_engine_installed("playwright"):
        try:
            return render_playwright(url, timeout, scrolls)
        except FetchError as exc:
            msg = clean_text(exc)
            if "نصب نیست" not in msg:
                errors.append(f"playwright: {msg}")
    return None

def scrape(config: dict[str, Any]) -> ScrapeReport:
    source = public_http_url(str(config.get("url", "")))
    try:
        pages = max(1, min(MAX_PAGES_HARD, int(config.get("pages") or 1)))
    except (TypeError, ValueError):
        pages = 1
    mode = str(config.get("render", "auto"))
    selectors = config.get("selectors") if isinstance(config.get("selectors"), dict) else {}
    detail_selectors = config.get("detail_selectors") if isinstance(config.get("detail_selectors"), dict) else {}
    gallery_cfg = config.get("gallery") if isinstance(config.get("gallery"), dict) else {"mode":"auto"}
    pag_kind = str(config.get("pagination", "query"))
    pag_value = str(config.get("page_value", "page"))
    enrich = bool(config.get("enrich", False))
    detail_limit_raw=int(config.get("detail_limit",0) or 0);detail_limit=MAX_PRODUCTS_HARD if detail_limit_raw<=0 else max(1,min(MAX_PRODUCTS_HARD,detail_limit_raw));detail_scope=clean_text(config.get("detail_scope","missing")) or "missing"
    cfg = load_data()
    # Carry the live-task id into the fetcher so a stop request aborts the
    # engine chain instead of waiting for every attempt to time out.
    _net = dict(cfg["network"] or {})
    _net["_live_task_id"] = clean_text(config.get("_live_task_id"))
    fetcher = Fetcher(_net)
    job_id = re.sub(r"[^a-zA-Z0-9_-]", "", clean_text(config.get("job_id")))[:80] or ("job-" + time.strftime("%Y%m%d-%H%M%S") + "-" + hashlib.sha1(source.encode()).hexdigest()[:6])
    report = ScrapeReport(job_id=job_id)
    if config.get("_details_only"):report.pages=max(1,int(config.get("_resume_pages",pages) or pages))
    for old in config.get("_resume_products", []) if isinstance(config.get("_resume_products"), list) else []:
        if isinstance(old, dict): add_product(report.products, old)
    details_only=bool(config.get("_details_only"));start_page=(pages+1 if details_only else max(1,min(pages,int(config.get("_start_page",1)))))
    next_url = str(config.get("_next_url", ""))
    if not details_only:save_extract_checkpoint(job_id,config,report,start_page,next_url)
    task_id=clean_text(config.get("_live_task_id"))
    source_host=(urlparse(source).hostname or "").lower()
    requested_engine=clean_text(config.get("fetch_engine","auto")).lower() or "auto"
    if requested_engine not in {"auto"}|set(KNOWN_ENGINES):
        requested_engine="auto"
    master=clean_text(config.get("fetch_engine_master")).lower()
    saved_host=clean_text(config.get("fetch_engine_host")).lower()
    if saved_host and source_host and saved_host!=source_host:
        master=""
    if requested_engine in KNOWN_ENGINES:
        master=requested_engine
    profile_name=clean_text(config.get("_profile_name"))

    for number in range(start_page, pages + 1):
        if task_id and live_task_cancelled(task_id):raise ValueError("استخراج با درخواست کاربر متوقف شد")
        if pag_kind == "next" and number > 1:
            if not next_url:
                report.logs.append("صفحه‌بندی متوقف شد: لینک صفحه بعد پیدا نشد")
                break
            url = next_url
        else:
            url = page_url(source, number, pag_kind, pag_value)
        rows: list[dict[str, Any]] = []
        soup: Optional[BeautifulSoup] = None
        diag: dict[str, Any] = {}
        fetch_error = ""

        # scraper4.php strategy: fetch the page DOM and run selectors. In auto mode,
        # Playwright is only a DOM renderer fallback; it never calls a product API.
        order=engine_try_order(master, requested_engine if requested_engine!="auto" else "", mode)
        http_engines=[e for e in order if e not in {"playwright","selenium"}]
        browser_engines=[e for e in order if e in {"playwright","selenium"}]
        browser_first=bool(order and order[0] in {"playwright","selenium"})
        engine_errors=[]
        won_engine=""
        won_ms=0
        if mode!="browser" and http_engines and not browser_first:
            engines=http_engines
            def _dom_with(active_fetcher):
                nonlocal rows, soup, diag, fetch_error, won_engine, won_ms
                relay_dead=False
                for engine_index,engine in enumerate(engines):
                    if engine!="requests" and not fetch_engine_installed(engine):
                        continue
                    if relay_dead:
                        break
                    # A page can try several engines; honour stop between them.
                    if task_id and live_task_cancelled(task_id):
                        raise CancelledError("استخراج با درخواست کاربر متوقف شد")
                    try:
                        if task_id:live_task_update(task_id,max(3,round((number-1)/pages*88)+engine_index),f"{'مستر' if engine==master else 'پشتیبان'} {engine} · صفحه {number} از {pages}","running",f"{url}",done=number-1,total=pages,extracted=len(report.products),engine=engine)
                        t0=time.monotonic()
                        result=active_fetcher.get(url,engine=engine);candidate_rows,candidate_soup,candidate_diag=parse_html(result.text,result.url,selectors);engine_errors.append(f"{engine}: HTTP {result.status} · DOM={len(candidate_rows)}")
                        if candidate_rows:
                            won_engine,won_ms=engine,int((time.monotonic()-t0)*1000)
                            rows,soup,diag=candidate_rows,candidate_soup,{**candidate_diag,"engine":engine,"attempts":engine_errors};report.modes.add("dom-"+engine);report.logs.append(f"صفحه {number}: {len(rows)} محصول از DOM با {engine} ({won_ms}ms)");return
                        soup,diag=candidate_soup,{**candidate_diag,"engine":engine,"attempts":engine_errors}
                    except (FetchError,ValueError) as exc:
                        fetch_error=str(exc);engine_errors.append(f"{engine}: {fetch_error}")
                        if active_fetcher.proxy_mode in {"relay","http"} and _is_relay_block_error(fetch_error):
                            relay_dead=True
            _dom_with(fetcher)
            if not rows and fetcher.proxy_mode in {"relay","http"}:
                report.logs.append("رله/پروکسی ناموفق — تلاش مستقیم بدون پروکسی")
                if task_id:live_task_update(task_id,max(4,round((number-1)/pages*88)+1),"تلاش مستقیم بدون پروکسی","running",url,done=number-1,total=pages,extracted=len(report.products))
                _dom_with(_fetcher_direct(cfg.get("network") or {}, task_id))
            if not rows and engine_errors:diag={**diag,"attempts":engine_errors};report.logs.extend(f"صفحه {number} · {x}" for x in engine_errors)

        if not rows and mode in ("auto", "browser") and browser_engines:
            for bengine in browser_engines:
                try:
                    if task_id:live_task_update(task_id,max(4,round((number-1)/pages*88)+2),f"{'مستر' if bengine==master else 'پشتیبان'} {bengine} · صفحه {number} از {pages}","running",("HTML محصولی نداشت"+(" · "+fetch_error if fetch_error else "")+f"؛ {bengine}"),done=number-1,total=pages,extracted=len(report.products))
                    snapp="snappshop.ir" in (urlparse(url).hostname or "").lower();scrolls=int(config.get("scrolls", 8 if snapp else 4));t0=time.monotonic();result = run_cancellable((lambda: render_playwright(url, fetcher.timeout, scrolls, task_id)) if bengine=="playwright" else (lambda: render_selenium(url, fetcher.timeout, scrolls, task_id)), task_id, bengine)
                    rows, soup, diag = parse_html(result.text, result.url, selectors);diag={**diag,"engine":bengine,"attempts":diag.get("attempts",[])}
                    report.modes.add(bengine+"-dom")
                    if rows:
                        won_engine,won_ms=bengine,int((time.monotonic()-t0)*1000)
                        report.logs.append(f"صفحه {number}: {len(rows)} محصول از DOM رندرشده با {bengine} ({won_ms}ms)")
                        break
                    report.logs.append(f"صفحه {number}: {len(rows)} محصول از DOM رندرشده با {bengine}")
                except (FetchError, ValueError) as exc:
                    fetch_error = str(exc)

        if not rows and browser_first and mode!="browser" and http_engines:
            engines=http_engines
            def _dom_with_backup(active_fetcher):
                nonlocal rows, soup, diag, fetch_error, won_engine, won_ms
                for engine_index,engine in enumerate(engines):
                    if engine!="requests" and not fetch_engine_installed(engine):
                        continue
                    try:
                        t0=time.monotonic()
                        result=active_fetcher.get(url,engine=engine)
                        candidate_rows,candidate_soup,candidate_diag=parse_html(result.text,result.url,selectors)
                        if candidate_rows:
                            won_engine,won_ms=engine,int((time.monotonic()-t0)*1000)
                            rows,soup,diag=candidate_rows,candidate_soup,{**candidate_diag,"engine":engine}
                            report.modes.add("dom-"+engine)
                            report.logs.append(f"صفحه {number}: {len(rows)} محصول پشتیبان {engine}")
                            return
                    except (FetchError,ValueError) as exc:
                        fetch_error=str(exc)
            _dom_with_backup(fetcher)

        if won_engine and (not master or master!=won_engine):
            master=won_engine
            config["fetch_engine_master"]=master
            config["fetch_engine_host"]=source_host
            report.diagnostics["fetch_engine_master"]=master
            report.diagnostics["fetch_engine_ms"]=won_ms
            report.logs.append(f"موتور مستر این سایت: {master}"+(f" · {won_ms}ms" if won_ms else ""))
            persist_profile_master_engine(profile_name, master, source_host, won_ms)
        elif won_engine:
            report.diagnostics["fetch_engine_master"]=won_engine
            if won_ms: report.diagnostics["fetch_engine_ms"]=won_ms

        if pag_kind == "next" and soup is not None:
            try:
                next_node = soup.select_one(pag_value or "a[rel='next']")
                next_url = absolute_url(next_node.get("href"), url) if next_node else ""
            except Exception as exc:
                raise ValueError(f"سلکتور صفحه بعد نامعتبر است: {exc}") from exc

        new_count = 0
        for row in rows:
            before = len(report.products)
            add_product(report.products, row)
            new_count += len(report.products) - before
        report.pages = number
        report.diagnostics[f"page_{number}"] = diag
        save_extract_checkpoint(job_id, config, report, number + 1, next_url)
        if not rows:
            report.logs.append(f"صفحه {number}: محصولی پیدا نشد" + (f" — {fetch_error}" if fetch_error else ""))
            if number == 1 and fetch_error:
                report.diagnostics["error"] = fetch_error
            break
        if number > 1 and new_count == 0:
            report.logs.append("صفحه‌بندی متوقف شد: محصول تازه‌ای نبود")
            break

    if not report.products:
        save_extract_checkpoint(job_id,config,report,max(start_page,report.pages or start_page),next_url,"failed")
        hint=clean_text(report.diagnostics.get("error") or " | ".join(report.logs[-8:]))[:1200]
        raise FetchError("هیچ محصولی استخراج نشد"+(("؛ "+hint) if hint else " — آدرس، سلکتور یا اتصال شبکه را بررسی کنید"))

    if enrich and report.products:
        # Reuse already completed rich fields for unchanged products; "all" explicitly refreshes them.
        profile_name=clean_text(config.get("_profile_name"));profile=load_data().get("profiles",{}).get(profile_name,{}) if profile_name else {};old_products={product_key(x):x for x in profile.get("saved_products",[]) if isinstance(x,dict)}
        rich_fields=("images","images_count","short_desc","short_desc_html","long_desc","long_desc_html","variation_groups","variations","variations_text","attributes","tags","brand","category","weight","stock","detail_status","detail_extracted_at")
        for product in report.products.values():
            old=old_products.get(product_key(product),{})
            for field in rich_fields:
                if product.get(field) in (None,"",[],{}) and old.get(field) not in (None,"",[],{}):product[field]=old[field]
        enriched=0;attempted=0;detail_failures=[];candidates=list(report.products.values())
        for position,product in enumerate(candidates,1):
            if attempted>=detail_limit:break
            if not product.get("link"):continue
            if task_id and live_task_cancelled(task_id):raise ValueError("استخراج جزئیات با درخواست کاربر متوقف شد")
            detail_complete=product.get("detail_status")=="complete" and bool(product.get("images") and (product.get("short_desc") or product.get("long_desc")))
            if detail_scope=="missing" and detail_complete:continue
            attempted+=1
            try:
                if task_id:
                    detail_percent=round(attempted/max(1,min(len(candidates),detail_limit))*96) if details_only else 88+round(attempted/max(1,min(len(candidates),detail_limit))*9)
                    live_task_update(task_id,detail_percent,f"جزئیات محصول {attempted} از {min(len(candidates),detail_limit)}","running",clean_text(product.get("title"))[:160],done=position,total=min(len(candidates),detail_limit),extracted=len(report.products))
                requested=clean_text(config.get("fetch_engine","auto")).lower() or "auto";host=(urlparse(product.get("link") or "").hostname or "").lower();spa=any(x in host for x in ("snappshop.ir","snapp.ir"));dmaster=clean_text(master or config.get("fetch_engine_master") or "");
                if spa and not dmaster: dmaster="playwright"
                dorder=engine_try_order(dmaster, requested if requested in KNOWN_ENGINES else "", mode)
                detail_engines=[] if (dorder and dorder[0] in {"playwright","selenium"}) else [e for e in dorder if e not in {"playwright","selenium"}];detail=None;detail_rows=[];detail_soup=None;custom_detail={};detail_errors=[];best_q=-1
                if mode!="browser":
                    for engine in detail_engines:
                        try:
                            candidate_detail=fetcher.get(product["link"],referer=source,engine=engine);candidate_rows,candidate_soup,_=parse_html(candidate_detail.text,candidate_detail.url);candidate_fields=parse_detail_fields(candidate_soup,candidate_detail.url,detail_selectors);q=detail_quality(candidate_fields)
                            if q>best_q and candidate_fields:detail,detail_rows,detail_soup,custom_detail,best_q=candidate_detail,candidate_rows,candidate_soup,candidate_fields,q;report.modes.add("detail-"+engine)
                            if q>=3:break
                            if not candidate_fields:detail_errors.append(f"{engine}: DOM جزئیات خالی بود")
                        except FetchError as exc:detail_errors.append(f"{engine}: {exc}")
                if (detail is None or best_q<3) and mode in ("auto","browser"):
                    try:
                        candidate_detail=run_cancellable(lambda: render_playwright(product["link"],fetcher.timeout,4 if spa else 3,task_id), task_id, "playwright");candidate_rows,candidate_soup,_=parse_html(candidate_detail.text,candidate_detail.url);candidate_fields=parse_detail_fields(candidate_soup,candidate_detail.url,detail_selectors);q=detail_quality(candidate_fields)
                        if q>best_q and candidate_fields:detail,detail_rows,detail_soup,custom_detail,best_q=candidate_detail,candidate_rows,candidate_soup,candidate_fields,q;report.modes.add("detail-playwright-stealth")
                        elif not candidate_fields:detail_errors.append("playwright: DOM جزئیات خالی بود")
                    except FetchError as exc:detail_errors.append(f"playwright: {exc}")
                if detail is None:raise FetchError(" · ".join(detail_errors) or "دریافت جزئیات ناموفق بود")
                incoming=custom_detail.get("images") or ([] if not custom_detail.get("image") else [custom_detail.get("image")])
                existing=product.get("images") or ([] if not product.get("image") else [product.get("image")])
                merged=[]
                for url in list(incoming)+list(existing):
                    if _usable_image(url) and url not in merged:merged.append(url)
                for key,value in custom_detail.items():
                    if key in {"image","images","images_count"}: continue
                    if value not in ("",None,[],{}):product[key]=value
                if merged:
                    product["image"],product["images"],product["images_count"]=merged[0],merged[:30],min(30,len(merged))
                if detail_soup is not None:
                    gal=gallery_extract(detail_soup, getattr(detail,"url","") or product.get("link") or "", gallery_cfg)
                    if gal.get("images"):
                        gallery_apply_to_product(product, gal["images"], replace=(detail_scope=="all"))
                    product["gallery_note"]=gal.get("note") or ""
                extract_merge_detail(product, old_products.get(product_key(product), {}))
                candidate=max(detail_rows,key=lambda x:int(clean_text(x.get("title")) in clean_text(product.get("title"))),default=None)
                if candidate:
                    for key,value in candidate.items():
                        if value not in ("",None,[],{}) and product.get(key) in ("",None,[],{}):product[key]=value
                has_gallery=len(product.get("images") or [])>=2;has_desc=bool(clean_text(product.get("short_desc") or product.get("long_desc") or ""))
                product["detail_extracted_at"]=int(time.time());product["detail_status"]="complete" if (has_gallery or has_desc) else "partial"
                if has_gallery or has_desc:enriched+=1
            except (FetchError,ValueError) as exc:
                product["detail_status"]="failed";product["detail_error"]=str(exc)[:500];detail_failures.append(clean_text(product.get("title"))[:80]+": "+str(exc)[:180])
        report.diagnostics["details"]={"requested":attempted,"completed":enriched,"failed":len(detail_failures),"errors":detail_failures[:20]}
        report.logs.append(f"جزئیات خودکار {enriched} محصول تکمیل شد"+(f"؛ {len(detail_failures)} خطا" if detail_failures else ""))
    rules=config.get("profile_rules") if isinstance(config.get("profile_rules"),dict) else {}
    suffix=clean_text(rules.get("title_suffix"));prefix=clean_text(rules.get("title_prefix"));mode=str(rules.get("price_mode","none"));value=float(rules.get("price_value",0) or 0);step=max(0,int(rules.get("price_round",0) or 0));default_stock=clean_text(rules.get("default_stock"));default_category=clean_text(rules.get("default_category"))
    for product in report.products.values():
        title=clean_text(product.get("title"))
        if prefix and not title.startswith(prefix):title=prefix+" "+title
        if suffix and not title.endswith(suffix):title=title+" "+suffix
        product["title"]=title
        raw=woo_price(product.get("source_price") or product.get("price"));product["source_price"]=raw
        price=float(raw or 0)
        if mode=="percent":price*=1+value/100
        elif mode=="multiplier":price*=value
        elif mode=="fixed":price+=value
        if step:price=round(price/step)*step
        if price>0:product["price"]=str(max(0,round(price)))
        if default_stock and product.get("stock") in (None,""):product["stock"]=default_stock
        if default_category and not product.get("category"):product["category"]=default_category
        if rules.get("bsl_category_id"):product["basalam_category_id"]=int(rules["bsl_category_id"])
        if rules.get("woo_category_id"):product["woo_category_id"]=int(rules["woo_category_id"])
    save_extract_checkpoint(job_id, config, report, report.pages + 1, next_url, "completed")
    return report


# ---------------------------------------------------------------------------
# WooCommerce and exports
# ---------------------------------------------------------------------------
def woo_request(method: str, endpoint: str, payload: Any = None) -> requests.Response:
    cfg=load_data()["woocommerce"];base=str(cfg.get("url","")).rstrip("/");ck,cs=str(cfg.get("consumer_key","")),str(cfg.get("consumer_secret",""))
    if not base or not ck or not cs:raise ValueError("اتصال WooCommerce کامل نیست")
    target=public_http_url(base)+"/wp-json/wc/v3/"+endpoint.lstrip("/");network=load_data().get("network",{});mode=outbound_mode(network);headers={"User-Agent":USER_AGENT,"Accept":"application/json"};auth=(ck,cs)
    if mode=="relay":
        parsed=urlparse(target);query=parse_qs(parsed.query,keep_blank_values=True);query.update({"consumer_key":[ck],"consumer_secret":[cs]});target=urlunparse(parsed._replace(query=urlencode(query,doseq=True)));auth=None
    try:response=outbound_request(method,target,json=payload,auth=auth,headers=headers,timeout=60)
    except requests.RequestException as exc:raise FetchError(f"اتصال ووکامرس از دروازه مرکزی ناموفق بود: {exc}") from exc
    if not response.ok:raise FetchError(f"WooCommerce {getattr(response,'scraper4_transport','gateway')} HTTP {response.status_code}: {clean_text(response.text)[:500]}")
    return response


def woo_price(value: Any) -> str:
    digits = re.sub(r"[^0-9]", "", clean_text(value))
    return digits.lstrip("0") or "0"


def product_for_destination(product: dict[str,Any], rules: dict[str,Any], destination: str) -> dict[str,Any]:
    """Apply the PHP-compatible destination-specific adjustment after profile pricing."""
    out=dict(product);prefix="woo" if destination=="woocommerce" else "bsl";mode=clean_text(rules.get(prefix+"_price_mode","none"));value=float(rules.get(prefix+"_price_value",0) or 0);step=max(0,int(rules.get(prefix+"_price_round",0) or 0));base=float(woo_price(product.get("price")) or 0);price=base
    if base>0:
        if mode=="percent":price=base*(1+max(-99.0,min(10000.0,value))/100)
        elif mode=="multiplier" and value>0:price=base*value
        elif mode=="fixed":price=base+value
        if step:price=int((price+step/2)//step)*step
        out["price"]=str(max(1,round(price)));out["destination_price_base"]=str(round(base));out["destination_price_mode"]=mode
    category=int(rules.get(prefix+"_category_id",0) or 0)
    if category:out["woocommerce_category_id" if destination=="woocommerce" else "basalam_category_id"]=category
    return out


def product_identity_key(product: dict[str,Any]) -> str:
    """Stable local identity used by the PHP-compatible destination ID ledger."""
    sku=clean_text(product.get("sku")).lower();url=clean_text(product.get("link") or product.get("url"));title=clean_text(product.get("title") or product.get("name")).lower()
    seed=("sku:"+sku) if sku else ("url:"+url) if url else "title:"+title
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]


def destination_identity_id(profile_name: str, destination: str, product: dict[str,Any]) -> Any:
    profile=load_data().get("profiles",{}).get(profile_name,{});maps=profile.get("remote_map",{}) if isinstance(profile,dict) else {};ledger=maps.get(destination,{}) if isinstance(maps,dict) else {};row=ledger.get(product_identity_key(product),{}) if isinstance(ledger,dict) else {}
    return row.get("id") if isinstance(row,dict) else None


def record_destination_identity(profile_name: str, destination: str, product: dict[str,Any], result: dict[str,Any]) -> None:
    remote_id=result.get("id") if isinstance(result,dict) else None
    if remote_id in (None,"",0,"0"):return
    with DATA_LOCK:
        data=load_data();profile=data.get("profiles",{}).get(profile_name)
        if not isinstance(profile,dict):return
        ledger=profile.setdefault("remote_map",{}).setdefault(destination,{})
        ledger[product_identity_key(product)]={"id":remote_id,"sku":clean_text(product.get("sku")),"title":clean_text(product.get("title") or product.get("name")),"updated_at":int(time.time())}
        save_data(data)


def woo_product_payload(product: dict[str, Any], status: str = "draft") -> dict[str, Any]:
    groups = product.get("variation_groups") if isinstance(product.get("variation_groups"), list) else []
    payload: dict[str, Any] = {
        "name": clean_text(product.get("title")) or "بدون نام",
        "type": "variable" if groups else "simple", "regular_price": woo_price(product.get("price")),
        "status": status if status in {"draft", "publish", "private", "pending"} else "draft",
    }
    for source,target in (("sku","sku"),("short_desc","short_description"),("long_desc","description")):
        html_source=source+"_html"
        if product.get(html_source) and target in {"short_description","description"}:payload[target]=sanitize_rich_html(str(product[html_source]))
        elif product.get(source):payload[target]=str(product[source])
    images = list(product.get("images", [])) if isinstance(product.get("images"), list) else []
    if product.get("image") and product["image"] not in images: images.insert(0, product["image"])
    if images: payload["images"] = [{"src": str(url)} for url in images[:20] if url]
    if product.get("stock") not in (None, ""):
        stock_text = clean_text(product.get("stock")).lower()
        quantity = re.sub(r"\D", "", stock_text)
        payload["manage_stock"] = bool(quantity)
        if quantity: payload["stock_quantity"] = int(quantity)
        payload["stock_status"] = "outofstock" if stock_text in {"0", "ناموجود", "false"} else "instock"
    normal_attributes=product.get("attributes") if isinstance(product.get("attributes"),list) else []
    payload_attributes=[{"name":clean_text(a.get("name")),"visible":True,"variation":False,"options":[clean_text(a.get("value"))]} for a in normal_attributes[:30] if isinstance(a,dict) and clean_text(a.get("name")) and clean_text(a.get("value"))]
    if groups:payload_attributes += [{"name":clean_text(g.get("name")) or f"گزینه {i+1}","visible":True,"variation":True,"options":[clean_text(v) for v in g.get("values",[])[:50] if clean_text(v)]} for i,g in enumerate(groups[:3])]
    if payload_attributes:payload["attributes"]=payload_attributes
    if product.get("weight"): payload["weight"] = re.sub(r"[^0-9.]", "", clean_text(product.get("weight")))
    if product.get("woocommerce_category_id"):payload["categories"]=[{"id":int(product["woocommerce_category_id"])}]
    elif product.get("category"): payload["categories"] = [{"name": clean_text(product.get("category"))}]
    meta = []
    if product.get("link"): meta.append({"key": "_scraper_source_url", "value": product["link"]})
    if product.get("brand"): meta.append({"key": "_scraper_source_brand", "value": product["brand"]})
    if meta: payload["meta_data"] = meta
    return payload


def woo_send_one(product: dict[str, Any], status: str, update_existing: bool) -> dict[str, Any]:
    payload = woo_product_payload(product, status)
    existing_id = int(product.get("_destination_id") or 0) if update_existing else 0
    sku = clean_text(product.get("sku"))
    if update_existing and not existing_id and sku:
        found = woo_request("GET", "products?per_page=1&sku=" + quote(sku)).json()
        if isinstance(found, list) and found: existing_id = int(found[0].get("id", 0))
    if existing_id and product.get("_preserve_destination_status"):payload.pop("status",None)
    if payload.get("categories"):
        category_name = clean_text(payload["categories"][0].get("name"))
        category_id = int(payload["categories"][0].get("id",0) or 0)
        if category_name and not category_id:
            found_categories = woo_request("GET", "products/categories?per_page=20&search=" + quote(category_name)).json()
            exact = next((row for row in found_categories if clean_text(row.get("name")).lower() == category_name.lower()), None) if isinstance(found_categories, list) else None
            if exact:
                category_id = int(exact.get("id", 0))
            else:
                category_id = int(woo_request("POST", "products/categories", {"name": category_name}).json().get("id", 0))
        payload["categories"] = [{"id": category_id}] if category_id else []
    result = woo_request("PUT" if existing_id else "POST", f"products/{existing_id}" if existing_id else "products", payload).json()
    parent_id = int(result.get("id", 0))
    groups = product.get("variation_groups") if isinstance(product.get("variation_groups"), list) else []
    variation_count = 0
    if parent_id and groups:
        existing_combos = set()
        if existing_id:
            old_variations = woo_request("GET", f"products/{parent_id}/variations?per_page=100").json()
            if isinstance(old_variations, list):
                for row in old_variations:
                    existing_combos.add(tuple((clean_text(a.get("name")), clean_text(a.get("option"))) for a in row.get("attributes", [])))
        # One child per option for one group; bounded Cartesian combinations for multiple groups.
        combinations = [[]]
        for group in groups[:3]:
            combinations = [old + [(clean_text(group.get("name")) or "تنوع", clean_text(value))] for old in combinations for value in group.get("values", [])[:20] if clean_text(value)][:50]
        for combo in combinations:
            combo_key = tuple(combo)
            if combo_key in existing_combos:
                continue
            child = {"regular_price": woo_price(product.get("price")), "attributes": [{"name": name, "option": value} for name, value in combo]}
            woo_request("POST", f"products/{parent_id}/variations", child)
            variation_count += 1
    return {"source": product.get("title"), "id": parent_id, "name": result.get("name"), "action": "updated" if existing_id else "created", "variations": variation_count}


def export_cell(value: Any) -> Any:
    return json.dumps(value,ensure_ascii=False,separators=(",",":")) if isinstance(value,(list,dict)) else value


def export_csv(products: list[dict[str, Any]]) -> Response:
    stream = io.StringIO()
    stream.write("\ufeff")
    writer = csv.writer(stream)
    fields = ["title","price","link","image","images","images_count","sku","stock","brand","category","weight","short_desc","long_desc","variations_text","variation_groups","attributes","tags"]
    writer.writerow(["#"] + fields)
    for index, product in enumerate(products, 1):
        writer.writerow([index] + [export_cell(product.get(field,"")) for field in fields])
    return Response(stream.getvalue(), mimetype="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="products-{time.strftime("%Y%m%d-%H%M%S")}.csv"'
    })


def export_xlsx(products: list[dict[str, Any]]) -> Response:
    fields = ["title","price","link","image","images","images_count","sku","stock","brand","category","weight","short_desc","long_desc","variations_text","variation_groups","attributes","tags"]
    rows = [["#"] + fields] + [[index] + [export_cell(p.get(field,"")) for field in fields] for index,p in enumerate(products,1)]
    sheet_rows = []
    for r_index, row in enumerate(rows, 1):
        cells = []
        for c_index, value in enumerate(row, 1):
            number = c_index
            col = ""
            while number:
                number, remainder = divmod(number - 1, 26)
                col = chr(65 + remainder) + col
            text = escape(clean_text(value), quote=False)
            cells.append(f'<c r="{col}{r_index}" t="inlineStr"><is><t>{text}</t></is></c>')
        sheet_rows.append(f'<row r="{r_index}">{"".join(cells)}</row>')
    sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + "".join(sheet_rows) + '</sheetData></worksheet>'
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        archive.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", sheet)
    return Response(output.getvalue(), mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f'attachment; filename="products-{time.strftime("%Y%m%d-%H%M%S")}.xlsx"'})


# ---------------------------------------------------------------------------
# Atomic GitHub deployer (Python counterpart of deploy.php)
# ---------------------------------------------------------------------------
DEPLOY_LOCK = threading.Lock()
DEPENDENCY_LOCK = threading.Lock()


def git_blob_sha(content: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(content)).encode("ascii") + b"\0" + content).hexdigest()


DEPLOY_MAX_BRANCHES = 8
DEPLOY_BRANCH_RE = re.compile(r"^[A-Za-z0-9._\-/]{1,150}$")


def clean_branch(value: Any) -> str:
    text = clean_text(value).strip()
    if not text or text in {"__CLEAR__", "—", "-"}:
        return ""
    text = text.strip("/")
    if not DEPLOY_BRANCH_RE.fullmatch(text):
        return ""
    if ".." in text.split("/") or "//" in text or text.startswith("/") or text.endswith("/"):
        return ""
    return text


def normalize_branches(raw: Any, fallback: str = "") -> list[str]:
    items: list[str] = []
    if isinstance(raw, (list, tuple)):
        for entry in raw:
            # Each list element is one branch name; an element may itself hold
            # several names separated by commas or newlines (legacy saves).
            for piece in str(entry).replace(",", "\n").splitlines():
                piece = piece.strip()
                if not piece:
                    continue
                # Do not split on spaces: a branch name never contains a space,
                # so spaces mean the whole entry is invalid and must be dropped.
                cleaned = clean_branch(piece)
                if cleaned and cleaned not in items:
                    items.append(cleaned)
    elif isinstance(raw, str):
        for entry in re.split(r"[\s,\n;]+", raw):
            cleaned = clean_branch(entry)
            if cleaned and cleaned not in items:
                items.append(cleaned)
    fallback_cleaned = clean_branch(fallback)
    if not items and fallback_cleaned:
        items.append(fallback_cleaned)
    if not items:
        items.append("arena/01a0640f-amphp")
    return items[:DEPLOY_MAX_BRANCHES]


def deploy_config(data: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    raw = (data or load_data()).get("deploy", {})
    if not isinstance(raw, dict):
        raw = {}
    branches = normalize_branches(raw.get("branches"), clean_text(raw.get("branch")))
    live = "arena/01a06ac3-amphp"
    if live not in branches:
        branches = [live] + branches
    if not branches:
        branches = [live]
    return {
        "repo": clean_text(raw.get("repo")) or "fazilatma/amphp",
        "branch": branches[0],
        "branches": branches,
        "path": clean_text(raw.get("path")) or "scraper4.py",
        "github_token": os.environ.get("GITHUB_TOKEN", "").strip() or clean_text(raw.get("github_token")),
        "reload_file": os.path.expanduser(clean_text(raw.get("reload_file"))),
        "check_on_load": bool(raw.get("check_on_load")),
    }


def parse_version_tuple(value: str) -> tuple[int, ...]:
    parts = re.findall(r"\d+", str(value or ""))
    if not parts:
        return (0,)
    return tuple(int(x) for x in parts[:4])


def compare_versions(left: str, right: str) -> int:
    a = parse_version_tuple(left)
    b = parse_version_tuple(right)
    width = max(len(a), len(b))
    a = a + (0,) * (width - len(a))
    b = b + (0,) * (width - len(b))
    return (a > b) - (a < b)


def extract_version_from_text(text: str) -> str:
    match = re.search(r'^APP_VERSION\s*=\s*["\']([^"\']+)', text, re.MULTILINE)
    return match.group(1).strip() if match else "unknown"


def _scraper_git_dir() -> str:
    for cand in (os.environ.get("SCRAPER_GIT_DIR", ""), "/opt/amphp", BASE_DIR):
        if cand and os.path.isdir(os.path.join(cand, ".git")):
            return cand
    return "/opt/amphp"


def git_file_for(repo: str, branch: str, remote_path: str, include_content: bool = False) -> dict[str, Any]:
    directory = _scraper_git_dir()
    os.makedirs(directory, exist_ok=True)
    url = "https://github.com/" + repo + ".git"
    if not os.path.isdir(os.path.join(directory, ".git")):
        clone = subprocess.run(["git", "clone", "--depth", "1", url, directory], capture_output=True, timeout=180)
        if clone.returncode:
            raise FetchError("git clone ناموفق بود")
    fetch = subprocess.run(["git", "-C", directory, "fetch", "--depth", "1", "origin", branch], capture_output=True, timeout=120)
    if fetch.returncode:
        raise FetchError(f"git fetch {branch} ناموفق بود")
    show = subprocess.run(["git", "-C", directory, "show", f"FETCH_HEAD:{remote_path}"], capture_output=True, timeout=30)
    if show.returncode:
        show = subprocess.run(["git", "-C", directory, "show", f"origin/{branch}:{remote_path}"], capture_output=True, timeout=30)
    if show.returncode:
        raise FetchError(f"فایل {remote_path} در {branch} پیدا نشد")
    content = show.stdout
    out: dict[str, Any] = {"sha": git_blob_sha(content), "size": len(content), "html_url": "", "name": os.path.basename(remote_path), "branch": branch}
    if include_content:
        out["content"] = content
        out["version"] = extract_version_from_text(content.decode("utf-8", errors="replace"))
    return out


def github_file_for(repo: str, branch: str, remote_path: str, token: str = "", include_content: bool = False) -> dict[str, Any]:
    repo = str(repo or "").strip("/")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("نام repository باید به صورت owner/repo باشد")
    branch_cleaned = clean_branch(branch)
    if not branch_cleaned:
        raise ValueError("نام برنچ معتبر نیست")
    remote_path = str(remote_path or "").strip("/")
    if not remote_path or not remote_path.endswith(".py") or ".." in remote_path.split("/"):
        raise ValueError("مسیر منبع باید یک فایل امن با پسوند .py باشد")
    try:
        return git_file_for(repo, branch_cleaned, remote_path, include_content)
    except FetchError as git_exc:
        if os.path.isdir(os.path.join(_scraper_git_dir(), ".git")):
            raise git_exc
    api_url = "https://api.github.com/repos/" + repo + "/contents/" + quote(remote_path, safe="/")
    headers = {"User-Agent": "scraper4-python-deployer", "Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        if VPS_MODE:
            response = requests.get(api_url, params={"ref": branch_cleaned}, headers=headers, timeout=30)
        else:
            response = outbound_request("GET",api_url,params={"ref":branch_cleaned},headers=headers,timeout=30)
    except requests.RequestException as exc:
        raise FetchError(f"ارتباط با GitHub ناموفق بود: {exc}") from exc
    if response.status_code == 401:
        raise FetchError("توکن GitHub نامعتبر یا منقضی است (HTTP 401)")
    if response.status_code == 403:
        raise FetchError("دسترسی GitHub رد شد یا محدودیت نرخ تمام شده است (HTTP 403)")
    if response.status_code == 404:
        raise FetchError("repository، branch یا فایل در GitHub پیدا نشد (HTTP 404)")
    if not response.ok:
        raise FetchError(f"GitHub HTTP {response.status_code}: {response.text[:250]}")
    try:
        meta = response.json()
    except ValueError as exc:
        raise FetchError("پاسخ GitHub معتبر نیست") from exc
    if not isinstance(meta, dict) or meta.get("type") != "file":
        raise FetchError("مسیر GitHub یک فایل نیست")
    if int(meta.get("size") or 0) > 8 * 1024 * 1024:
        raise FetchError("فایل به‌روزرسانی بزرگ‌تر از ۸ مگابایت است")
    out = {"sha": str(meta.get("sha", "")), "size": int(meta.get("size") or 0),
           "html_url": str(meta.get("html_url", "")), "name": str(meta.get("name", "")),
           "branch": branch_cleaned, "repo": repo, "path": remote_path}
    if include_content:
        encoded = str(meta.get("content", "")).replace("\n", "")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError) as exc:
            raise FetchError("محتوای فایل از GitHub قابل خواندن نیست") from exc
        out["content"] = content
        try:
            out["version"] = extract_version_from_text(content.decode("utf-8", errors="replace"))
        except Exception:
            out["version"] = "unknown"
    return out


def github_file(cfg: dict[str, Any], include_content: bool = False) -> dict[str, Any]:
    """Backward-compatible single-branch fetch (uses the first configured branch)."""
    return github_file_for(cfg["repo"], cfg["branch"], cfg["path"], cfg.get("github_token", ""), include_content)


def github_api_json(api_url: str, token: str, params: Optional[dict[str, Any]] = None, timeout: int = 30) -> Any:
    headers = {"User-Agent": "scraper4-python-deployer", "Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        response = outbound_request("GET", api_url, params=params or {}, headers=headers, timeout=timeout)
    except requests.RequestException as exc:
        raise FetchError(f"ارتباط با GitHub ناموفق بود: {exc}") from exc
    if response.status_code == 401:
        raise FetchError("توکن GitHub نامعتبر یا منقضی است (HTTP 401)")
    if response.status_code == 403:
        raise FetchError("دسترسی GitHub رد شد یا محدودیت نرخ تمام شده است (HTTP 403)")
    if response.status_code == 404:
        raise FetchError("repository یا برنچ در GitHub پیدا نشد (HTTP 404)")
    if not response.ok:
        raise FetchError(f"GitHub HTTP {response.status_code}: {response.text[:250]}")
    try:
        return response.json()
    except ValueError as exc:
        raise FetchError("پاسخ GitHub معتبر نیست") from exc


def github_branch_list(repo: str, token: str = "") -> list[dict[str, str]]:
    repo = str(repo or "").strip("/")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("نام repository باید به صورت owner/repo باشد")
    try:
        run = subprocess.run(["git", "ls-remote", "--heads", "https://github.com/" + repo + ".git"], capture_output=True, timeout=60)
        if run.returncode == 0:
            out_heads: list[dict[str, str]] = []
            for line in run.stdout.decode("utf-8", "replace").splitlines():
                parts = line.split()
                if len(parts) == 2 and parts[1].startswith("refs/heads/"):
                    name = clean_branch(parts[1][11:])
                    if name:
                        out_heads.append({"name": name, "protected": ""})
            if out_heads:
                return out_heads[:100]
    except Exception:
        pass
    data = github_api_json("https://api.github.com/repos/" + repo + "/branches", token, params={"per_page": 100})
    out: list[dict[str, str]] = []
    if isinstance(data, list):
        for row in data:
            if isinstance(row, dict) and clean_branch(row.get("name")):
                out.append({"name": clean_branch(row.get("name")), "protected": bool(row.get("protected"))})
    return out[:100]


def github_python_files(repo: str, branch: str, token: str = "") -> list[str]:
    repo = str(repo or "").strip("/")
    branch_cleaned = clean_branch(branch)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo) or not branch_cleaned:
        raise ValueError("ریپو و برنچ لازم است")
    data = github_api_json("https://api.github.com/repos/" + repo + "/git/trees/" + quote(branch_cleaned, safe="") , token, params={"recursive": 1}, timeout=30)
    tree = data.get("tree") if isinstance(data, dict) else None
    files: list[str] = []
    if isinstance(tree, list):
        for node in tree:
            if not isinstance(node, dict) or node.get("type") != "blob":
                continue
            path = str(node.get("path", ""))
            if path.endswith(".py") and ".." not in path.split("/") and len(path) <= 200:
                files.append(path)
    files.sort(key=lambda x: (x != "scraper4.py", x.lower()))
    return files[:200]


def deploy_fetch_candidates(cfg: dict[str, Any], include_content: bool = False) -> tuple[list[dict[str, Any]], str]:
    local_sha = ""
    try:
        with open(os.path.abspath(__file__), "rb") as fh:
            local_sha = git_blob_sha(fh.read())
    except OSError:
        pass
    candidates: list[dict[str, Any]] = []
    for branch in cfg["branches"]:
        try:
            remote = github_file_for(cfg["repo"], branch, cfg["path"], cfg.get("github_token", ""), include_content)
            candidates.append({
                "branch": branch, "version": remote.get("version", "") if include_content else "",
                "sha": remote.get("sha", ""), "size": remote.get("size", 0),
                "html_url": remote.get("html_url", ""), "name": remote.get("name", ""),
                "update_available": bool(local_sha) and local_sha != remote.get("sha", ""),
                "content": remote.get("content") if include_content else None,
            })
        except (ValueError, FetchError) as exc:
            candidates.append({"branch": branch, "version": "", "sha": "", "size": 0, "html_url": "", "name": "", "update_available": False, "error": str(exc), "content": None})
    return candidates, local_sha


def pick_newest_candidate(candidates: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    valid = [c for c in candidates if c.get("sha") and not c.get("error")]
    if not valid:
        return None
    def sort_key(c: dict[str, Any]) -> tuple[tuple[int, ...], str]:
        return (parse_version_tuple(c.get("version") or "0"), str(c.get("version") or ""))
    # Prefer highest parsed version; tie-break by version string then branch name for determinism.
    best = max(valid, key=lambda c: (sort_key(c), str(c.get("branch") or "")))
    # If every candidate reports "unknown" version, fall back to the first reachable branch
    # so single-branch setups keep their previous behaviour.
    if all((c.get("version") or "unknown") == "unknown" for c in valid):
        return valid[0]
    return best


def validate_deploy_source(content: bytes) -> str:
    if not content.startswith((b"#!/", b"#", b'"""', b"'''")):
        raise FetchError("فایل دانلودشده شبیه کد Python نیست")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise FetchError("فایل دانلودشده UTF-8 نیست") from exc
    try:
        compile(text, "scraper4-update.py", "exec")
    except SyntaxError as exc:
        raise FetchError(f"نسخه تازه خطای syntax دارد: خط {exc.lineno}: {exc.msg}") from exc
    required = ("APP_VERSION", "Flask(", '@app.get("/")', "/api/deploy/run")
    missing = [marker for marker in required if marker not in text]
    if missing:
        raise FetchError("نسخه تازه اعتبارسنجی نشد؛ نشانه‌های Scraper4 کامل نیست")
    match = re.search(r'^APP_VERSION\s*=\s*["\']([^"\']+)', text, re.MULTILINE)
    return match.group(1) if match else "unknown"


# Marker that identifies the Node-parity bridge block appended to this fork.
UI_BRIDGE_MARKER = "# >>> scraper4 node-parity dashboard bridge >>>"


def ensure_ui_bridge_block(content: bytes) -> bytes:
    """Keep the Node dashboard bridge attached to a downloaded scraper4.py.

    Updates are fetched from the upstream repository, which knows nothing about
    this fork's ``ui_bridge`` layer. A straight overwrite therefore deletes the
    bridge and ``/ui`` starts answering 404 while the classic UI keeps working
    — a silent regression. Re-append the block whenever it is missing so an
    update can change the scraper without amputating the dashboard.
    """
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return content
    # Match the marker only as a real comment line. A bare substring test would
    # also hit the UI_BRIDGE_MARKER constant above and wrongly conclude the
    # block is present.
    present = re.compile("^" + re.escape(UI_BRIDGE_MARKER) + r"\s*$", re.MULTILINE)
    if present.search(text):
        return content
    try:
        with open(os.path.abspath(__file__), "r", encoding="utf-8") as fh:
            local = fh.read()
    except OSError:
        return content
    found = present.search(local)
    if not found:
        return content
    block = local[found.start():]
    # Re-attach ahead of the __main__ guard so the entrypoint stays last.
    guard = re.search(r'^if __name__ == ["\']__main__["\']:', text, re.MULTILINE)
    if guard:
        merged = text[:guard.start()] + block.rstrip("\n") + "\n\n\n" + text[guard.start():]
    else:
        merged = text.rstrip("\n") + "\n\n\n" + block
    try:
        compile(merged, "scraper4-update.py", "exec")
    except SyntaxError:
        return content
    return merged.encode("utf-8")


def atomic_write(path: str, content: bytes, mode: int = 0o600) -> None:
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".deploy-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def touch_reload_file(path: str) -> bool:
    if not path:
        return False
    # PythonAnywhere's WSGI file is outside this app directory by design. Do
    # not create an arbitrary path from the web UI; only touch an existing file.
    if not os.path.isfile(path):
        raise FetchError("فایل WSGI برای reload پیدا نشد؛ مسیر را بررسی کنید")
    os.utime(path, None)
    return True


def deploy_check() -> dict[str, Any]:
    cfg = deploy_config()
    candidates, local_sha = deploy_fetch_candidates(cfg, include_content=True)
    # Fill versions for candidates fetched without content errors.
    for cand in candidates:
        if cand.get("content") is not None and not cand.get("version"):
            try:
                cand["version"] = extract_version_from_text(cand["content"].decode("utf-8", errors="replace"))
            except Exception:
                cand["version"] = "unknown"
        cand.pop("content", None)
    newest = pick_newest_candidate(candidates)
    if newest is None:
        errors = "; ".join(c.get("error", "خطای نامشخص") for c in candidates[:3])
        raise FetchError(f"هیچ برنچی قابل بررسی نبود: {errors}" if errors else "هیچ برنچی قابل بررسی نبود")
    return {
        "repo": cfg["repo"], "branch": newest["branch"], "branches": cfg["branches"], "path": cfg["path"],
        "local_sha": local_sha, "remote_sha": newest["sha"],
        "update_available": local_sha != newest["sha"],
        "remote_size": newest["size"], "html_url": newest["html_url"],
        "version": APP_VERSION, "newest_version": newest.get("version", "unknown"),
        "newest_branch": newest["branch"], "candidates": candidates,
        "check_on_load": cfg.get("check_on_load", False),
    }


def deploy_install(requested_branch: str = "") -> dict[str, Any]:
    if not DEPLOY_LOCK.acquire(blocking=False):
        raise FetchError("یک نصب دیگر هم‌اکنون در حال اجراست")
    try:
        cfg = deploy_config()
        wanted = clean_branch(requested_branch)
        if wanted and wanted not in cfg["branches"]:
            # Allow one-off installs of a branch that is not in the saved list.
            cfg = dict(cfg)
            cfg["branches"] = ([wanted] + cfg["branches"])[:DEPLOY_MAX_BRANCHES]
        candidates, _local_sha = deploy_fetch_candidates(cfg, include_content=True)
        target_cand: Optional[dict[str, Any]] = None
        if wanted:
            for cand in candidates:
                if cand.get("branch") == wanted and cand.get("content") is not None:
                    target_cand = cand
                    break
            if target_cand is None:
                err = next((c.get("error", "دریافت ناموفق بود") for c in candidates if c.get("branch") == wanted), "دریافت ناموفق بود")
                raise FetchError(f"برنچ {wanted}: {err}")
        else:
            # No explicit branch: install whichever candidate carries the newest APP_VERSION.
            for cand in candidates:
                if cand.get("content") is not None and not cand.get("version"):
                    try:
                        cand["version"] = extract_version_from_text(cand["content"].decode("utf-8", errors="replace"))
                    except Exception:
                        cand["version"] = "unknown"
            target_cand = pick_newest_candidate([c for c in candidates if c.get("content") is not None])
            if target_cand is None:
                errors = "; ".join((c.get("branch", "?") + ": " + c.get("error", "خطا")) for c in candidates[:4])
                raise FetchError(f"هیچ برنچی قابل نصب نبود: {errors}" if errors else "هیچ برنچی قابل نصب نبود")
        content = ensure_ui_bridge_block(target_cand["content"])
        new_version = validate_deploy_source(content)
        target = os.path.abspath(__file__)
        with open(target, "rb") as fh:
            current = fh.read()
        if git_blob_sha(current) == target_cand["sha"]:
            sdk_installed=ensure_basalam_sdk() if b"basalam-sdk" in content else False
            return {"changed": False, "message": "همین نسخه اکنون نصب است"+("؛ SDK باسلام نیز خودکار نصب شد" if sdk_installed else ""), "version": APP_VERSION, "branch": target_cand["branch"], "newest_branch": target_cand["branch"], "newest_version": new_version, "dependencies_repaired":sdk_installed}
        old_mode = os.stat(target).st_mode & 0o777
        backup = target + ".bak"
        atomic_write(backup, current, old_mode)
        atomic_write(target, content, old_mode)
        sdk_installed=ensure_basalam_sdk() if b"basalam-sdk" in content else False
        reloaded = touch_reload_file(cfg["reload_file"]) if cfg["reload_file"] else False
        return {"changed": True, "message": f"نسخه {new_version} از برنچ {target_cand['branch']} اتمیک نصب شد"+(" و SDK باسلام نیز نصب شد" if sdk_installed else ""), "version": new_version,
                "sha": target_cand["sha"], "branch": target_cand["branch"], "newest_branch": target_cand["branch"], "newest_version": new_version,
                "backup": os.path.basename(backup), "reload_requested": reloaded,"dependencies_repaired":sdk_installed}
    finally:
        DEPLOY_LOCK.release()


def deploy_rollback() -> dict[str, Any]:
    if not DEPLOY_LOCK.acquire(blocking=False):
        raise FetchError("یک عملیات نصب دیگر در حال اجراست")
    try:
        target = os.path.abspath(__file__)
        backup = target + ".bak"
        if not os.path.isfile(backup):
            raise FetchError("نسخه پشتیبان scraper4.py.bak وجود ندارد")
        with open(backup, "rb") as fh:
            content = fh.read()
        version = validate_deploy_source(content)
        current_mode = os.stat(target).st_mode & 0o777
        atomic_write(target, content, current_mode)
        cfg = deploy_config()
        reloaded = touch_reload_file(cfg["reload_file"]) if cfg["reload_file"] else False
        return {"changed": True, "message": "نسخه پشتیبان بازیابی شد", "version": version,
                "reload_requested": reloaded}
    finally:
        DEPLOY_LOCK.release()


# ---------------------------------------------------------------------------
# Automatic code updates and browser build detection
# ---------------------------------------------------------------------------
AUTO_UPDATE_STATE = {"last": 0.0, "running": False, "error": ""}
AUTO_UPDATE_LOCK = threading.Lock()


def pythonanywhere_reload() -> bool:
    """Reload the web process: systemd on VPS, PythonAnywhere API when that token exists."""
    marker = os.environ.get("SCRAPER_RELOAD_MARKER", os.path.join(BASE_DIR, ".reload"))
    try:
        open(marker, "a").close()
        os.utime(marker, None)
    except OSError:
        pass
    try:
        run = subprocess.run(["systemctl", "restart", "scraper4"], capture_output=True, timeout=30)
        if run.returncode == 0:
            return True
        run = subprocess.run(["systemctl", "reload", "scraper4"], capture_output=True, timeout=20)
        if run.returncode == 0:
            return True
    except Exception:
        pass
    token_file = os.path.expanduser("~/.pythonanywhere_api_token")
    try:
        token = open(token_file, encoding="utf-8").read().strip()
        if not token:
            return False
        username = os.path.basename(os.path.expanduser("~"))
        domain = username.lower() + ".pythonanywhere.com"
        url = f"https://www.pythonanywhere.com/api/v0/user/{username}/webapps/{domain}/reload/"
        response = outbound_request("POST",url,headers={"Authorization":"Token "+token},timeout=30)
        return response.status_code in (200, 201)
    except Exception:
        return False


def auto_update_worker() -> None:
    global BUILD_ID
    try:
        cfg = deploy_config()
        candidates, _local = deploy_fetch_candidates(cfg, include_content=True)
        ok = [c for c in candidates if c.get("content") is not None]
        for cand in ok:
            if not cand.get("version"):
                try:
                    cand["version"] = extract_version_from_text(cand["content"].decode("utf-8", errors="replace"))
                except Exception:
                    cand["version"] = "unknown"
        remote = pick_newest_candidate(ok)
        if remote is None:
            raise FetchError("no reachable deploy branch")
        target = os.path.abspath(__file__)
        with open(target, "rb") as fh:
            current = fh.read()
        if git_blob_sha(current) != remote["sha"]:
            payload = ensure_ui_bridge_block(remote["content"])
            new_version = validate_deploy_source(payload)
            # Only move forward: never auto-downgrade to an older APP_VERSION.
            if compare_versions(new_version, APP_VERSION) < 0:
                AUTO_UPDATE_STATE["error"] = ""
                return
            mode = os.stat(target).st_mode & 0o777
            atomic_write(target + ".bak", current, mode)
            atomic_write(target, payload, mode)
            AUTO_UPDATE_STATE["error"] = ""
            app.logger.info("Automatically installed Scraper4 %s from %s", new_version, remote.get("branch"))
            reload_file = cfg.get("reload_file", "")
            if reload_file and os.path.isfile(reload_file):
                os.utime(reload_file, None)
            pythonanywhere_reload()
    except Exception as exc:
        AUTO_UPDATE_STATE["error"] = str(exc)[:300]
        app.logger.warning("Automatic update check failed: %s", exc)
    finally:
        AUTO_UPDATE_STATE["last"] = time.time()
        AUTO_UPDATE_STATE["running"] = False
        try:
            AUTO_UPDATE_LOCK.release()
        except RuntimeError:
            pass


@app.before_request
def schedule_auto_update():
    if not AUTO_UPDATE_ENABLED or request.path.startswith("/api/deploy/"):
        return None
    now = time.time()
    if now - float(AUTO_UPDATE_STATE["last"]) < AUTO_UPDATE_INTERVAL:
        return None
    if AUTO_UPDATE_LOCK.acquire(blocking=False):
        AUTO_UPDATE_STATE["running"] = True
        threading.Thread(target=auto_update_worker, name="scraper4-auto-update", daemon=True).start()
    return None


# ---------------------------------------------------------------------------
# VPS supervisors — PHP 10.123 extractBeat / extractChainResume + queue drain
# ---------------------------------------------------------------------------
DRAIN_LOCK = threading.Lock()
DRAIN_RUNNING: set[str] = set()
HEARTBEAT_STATE = {"started": False, "last": 0, "resumes": 0, "error": ""}
CHAIN_COOLDOWN: dict[str, int] = {}


def start_named_worker(name: str, target: Any, args: tuple[Any, ...] = ()) -> bool:
    """Start one background worker per name; skip if that name is already alive."""
    with DRAIN_LOCK:
        if name in DRAIN_RUNNING:
            return False
        DRAIN_RUNNING.add(name)
    def _wrap() -> None:
        try:
            target(*args)
        except Exception as exc:
            report_error("worker:"+name, exc)
            raise
        finally:
            with DRAIN_LOCK:
                DRAIN_RUNNING.discard(name)
    threading.Thread(target=_wrap, name=name, daemon=True).start()
    return True


def start_woo_drain(job_id: str) -> bool:
    return start_named_worker("woo-drain-"+job_id, woo_drain_worker, (job_id,))


def start_bsl_drain(job_id: str) -> bool:
    return start_named_worker("bsl-drain-"+job_id, bsl_drain_worker, (job_id,))


def woo_drain_worker(job_id: str) -> None:
    """Send every remaining WooCommerce queue item; PHP ignore_user_abort equivalent."""
    while True:
        data = load_data()
        job = data.get("woo_jobs", {}).get(job_id)
        if not isinstance(job, dict):
            return
        products = job.get("products") if isinstance(job.get("products"), list) else []
        cursor = int(job.get("cursor", 0) or 0)
        if cursor >= len(products):
            job["status"] = "completed"
            job["updated_at"] = int(time.time())
            save_data(data)
            return
        job["status"] = "running"
        product = products[cursor]
        try:
            result = woo_send_one(product, str(job.get("status_value", "draft")), bool(job.get("update_existing", True)))
            job["sent"] = int(job.get("sent", 0) or 0) + 1
        except Exception as exc:
            result = {"source": product.get("title") if isinstance(product, dict) else "", "error": str(exc)[:500]}
            job["failed"] = int(job.get("failed", 0) or 0) + 1
        job.setdefault("results", []).append(result)
        job["results"] = job["results"][-200:]
        job["cursor"] = cursor + 1
        job["updated_at"] = int(time.time())
        save_data(data)


def bsl_drain_worker(job_id: str) -> None:
    """Send every remaining Basalam queue item in the background."""
    while True:
        data = load_data()
        job = data.get("bsl_jobs", {}).get(job_id)
        if not isinstance(job, dict):
            return
        products = job.get("products") if isinstance(job.get("products"), list) else []
        cursor = int(job.get("cursor", 0) or 0)
        total = int(job.get("total", len(products)) or 0)
        if cursor >= total or cursor >= len(products):
            job["status"] = "completed"
            job["updated_at"] = int(time.time())
            save_data(data)
            return
        job["status"] = "running"
        product = products[cursor]
        try:
            result = basalam_fanout_send(product, selected_vids=job.get("vendor_ids"))
            job.setdefault("results", []).append({"ok": True, **result})
            job["sent"] = int(job.get("sent", 0) or 0) + 1
            if result.get("action") == "updated":
                job["updated"] = int(job.get("updated", 0) or 0) + 1
        except Exception as exc:
            job["failed"] = int(job.get("failed", 0) or 0) + 1
            job.setdefault("results", []).append({"ok": False, "source": product.get("title") if isinstance(product, dict) else "", "error": clean_text(exc)[:500]})
        job["results"] = job["results"][-200:]
        job["cursor"] = cursor + 1
        job["updated_at"] = int(time.time())
        save_data(data)


def extract_chain_resume(job_id: str, job: dict[str, Any]) -> None:
    """PHP extractChainResume: continue a stalled extract from its last checkpoint."""
    now = int(time.time())
    last = int(CHAIN_COOLDOWN.get(job_id, 0) or 0)
    if last and now - last < 45:
        return
    CHAIN_COOLDOWN[job_id] = now
    cfg = dict(job.get("config") or {}) if isinstance(job.get("config"), dict) else {}
    if not cfg:
        return
    cfg["_profile_name"] = clean_text(job.get("profile"))
    cfg["_start_page"] = max(1, int(job.get("next_page", 1) or 1))
    cfg["_next_url"] = job.get("next_url", "") or ""
    cfg["_resume_products"] = job.get("products", []) if isinstance(job.get("products"), list) else []
    cfg["job_id"] = job_id
    try:
        scrape(cfg)
        HEARTBEAT_STATE["resumes"] = int(HEARTBEAT_STATE.get("resumes", 0) or 0) + 1
    except Exception as exc:
        HEARTBEAT_STATE["error"] = clean_text(exc)[:300]


def extract_heartbeat_loop() -> None:
    """PHP extractBeat keeper: if a running extract is silent past stall_after, chain-resume it."""
    while True:
        time.sleep(15)
        HEARTBEAT_STATE["last"] = time.time()
        try:
            data = load_data()
            now = int(time.time())
            jobs = data.get("extract_jobs", {}) if isinstance(data.get("extract_jobs"), dict) else {}
            for job_id, job in list(jobs.items()):
                if not isinstance(job, dict) or job.get("status") != "running":
                    continue
                age = now - int(job.get("updated_at", 0) or 0)
                if age < STALL_AFTER:
                    continue
                start_named_worker("extract-chain-"+str(job_id), extract_chain_resume, (str(job_id), job))
            for job_id, job in list((data.get("woo_jobs") or {}).items()):
                if isinstance(job, dict) and job.get("status") in {"running", "pending", "waiting"} and int(job.get("cursor", 0) or 0) < int(job.get("total", 0) or 0):
                    start_woo_drain(str(job_id))
            for job_id, job in list((data.get("bsl_jobs") or {}).items()):
                if isinstance(job, dict) and job.get("status") in {"running", "waiting"} and int(job.get("cursor", 0) or 0) < int(job.get("total", 0) or 0):
                    start_bsl_drain(str(job_id))
        except Exception as exc:
            HEARTBEAT_STATE["error"] = clean_text(exc)[:300]
            report_error("heartbeat", exc)


def auto_update_loop() -> None:
    time.sleep(40)
    while True:
        try:
            if AUTO_UPDATE_ENABLED and AUTO_UPDATE_LOCK.acquire(blocking=False):
                AUTO_UPDATE_STATE["running"] = True
                try:
                    auto_update_worker()
                except Exception as exc:
                    AUTO_UPDATE_STATE["error"] = str(exc)[:300]
                    report_error("auto_update", exc)
                finally:
                    AUTO_UPDATE_STATE["running"] = False
                    try:
                        AUTO_UPDATE_LOCK.release()
                    except RuntimeError:
                        pass
            time.sleep(AUTO_UPDATE_INTERVAL)
        except Exception as exc:
            report_error("auto_update_loop", exc)
            time.sleep(300)


def start_vps_supervisors() -> None:
    if HEARTBEAT_STATE.get("started"):
        return
    HEARTBEAT_STATE["started"] = True
    threading.Thread(target=extract_heartbeat_loop, name="scraper4-heartbeat", daemon=True).start()
    if AUTO_UPDATE_ENABLED:
        threading.Thread(target=auto_update_loop, name="scraper4-auto-update", daemon=True).start()


start_vps_supervisors()


# ---------------------------------------------------------------------------
# Flask API
# ---------------------------------------------------------------------------
def live_task_disk_write(task: dict[str,Any]) -> None:
    os.makedirs(LIVE_TASK_DIR,mode=0o700,exist_ok=True);atomic_write(os.path.join(LIVE_TASK_DIR,task["id"]+".json"),json.dumps(task,ensure_ascii=False).encode(),0o600)


def live_task_create(kind: str, title: str, private: bool=True) -> dict[str,Any]:
    task={"id":"task-"+secrets.token_hex(8),"kind":kind,"title":title,"private":private,"status":"waiting","progress":0,"step":"در صف اجرا","details":[],"created_at":int(time.time()),"updated_at":int(time.time())}
    with LIVE_TASK_LOCK:
        LIVE_TASKS[task["id"]]=task;live_task_disk_write(task)
        for key in sorted(LIVE_TASKS,key=lambda x:LIVE_TASKS[x]["updated_at"])[:-LIVE_TASK_KEEP]:LIVE_TASKS.pop(key,None)
    return task


def live_task_update(task_id: str, progress: int, step: str, status: str="running", detail: str="", **extra: Any) -> None:
    with LIVE_TASK_LOCK:
        # Rehydrate persisted tasks after a web-app reload so resumable AI and
        # extraction work keeps reporting into its original Task Manager card.
        task=LIVE_TASKS.get(task_id) or live_task_read(task_id)
        if not task:return
        LIVE_TASKS[task_id]=task
        task.update(progress=max(0,min(100,int(progress))),step=clean_text(step),status=status,updated_at=int(time.time()),**extra)
        # Record which machine-readable stage this update belongs to. The UI's
        # step plan needs stage keys ("list", "sync-woo", …); `step` itself is
        # free Persian prose and can never be matched against that plan.
        stage=clean_text(extra.get("stage"))
        if stage:
            history=task.setdefault("stages",[])
            if stage not in history:history.append(stage)
        if detail:task.setdefault("details",[]).append({"at":time.strftime("%H:%M:%S"),"text":clean_text(detail)[:700]});task["details"]=task["details"][-80:]
        live_task_disk_write(task)


def live_task_read(task_id: str) -> dict[str,Any]:
    with LIVE_TASK_LOCK:task=dict(LIVE_TASKS.get(task_id,{ }))
    if not task and re.fullmatch(r"task-[0-9a-f]{16}",task_id):
        try:
            with open(os.path.join(LIVE_TASK_DIR,task_id+".json"),encoding="utf-8") as fh:task=json.load(fh)
        except (OSError,ValueError):task={}
    return task


def live_task_cancelled(task_id: str) -> bool:
    return bool(live_task_read(task_id).get("cancel_requested"))


@app.get("/api/tasks/summary")
def api_live_tasks_summary():
    rows=[]
    try:
        for name in os.listdir(LIVE_TASK_DIR):
            if re.fullmatch(r"task-[0-9a-f]{16}\.json",name):
                try:
                    with open(os.path.join(LIVE_TASK_DIR,name),encoding="utf-8") as fh:row=json.load(fh)
                    if isinstance(row,dict):rows.append(row)
                except (OSError,ValueError):pass
    except OSError:pass
    with LIVE_TASK_LOCK:rows.extend(dict(x) for x in LIVE_TASKS.values())
    unique={x.get("id"):x for x in rows if x.get("id")};now=int(time.time());active=sum(x.get("status") in {"waiting","running"} and now-int(x.get("updated_at",now))<=TASK_STALE_SECONDS for x in unique.values())
    return jsonify(ok=True,active=active,total=len(unique),attention=sum(x.get("status") in {"failed","interrupted"} for x in unique.values()))


@app.get("/api/tasks")
def api_live_tasks():
    if not deploy_authorized():return deploy_auth_error()
    rows: dict[str,dict[str,Any]]={}
    try:
        for name in os.listdir(LIVE_TASK_DIR):
            if re.fullmatch(r"task-[0-9a-f]{16}\.json",name):
                try:
                    with open(os.path.join(LIVE_TASK_DIR,name),encoding="utf-8") as fh:row=json.load(fh)
                    if isinstance(row,dict):rows[row.get("id",name[:-5])]=row
                except (OSError,ValueError):pass
    except OSError:pass
    with LIVE_TASK_LOCK:rows.update({k:dict(v) for k,v in LIVE_TASKS.items()})
    now=int(time.time())
    for row in rows.values():
        if row.get("status") in {"waiting","running"} and now-int(row.get("updated_at",now))>TASK_STALE_SECONDS:
            row["status"]="interrupted";row["step"]="فرآیند سرور قطع شده است؛ نگهبان استخراج در صورت وجود checkpoint ادامه می‌دهد";row["updated_at"]=now
            with LIVE_TASK_LOCK:LIVE_TASKS[row["id"]]=row
            live_task_disk_write(row)
    extract_jobs=load_data().get("extract_jobs",{})
    for row in rows.values():
        if row.get("kind")=="scrape" and not row.get("profile"):
            row["profile"]=clean_text((extract_jobs.get(row.get("id"),{}) or {}).get("profile")) or "پروفایل نامشخص"
    result=sorted(rows.values(),key=lambda x:int(x.get("updated_at",0)),reverse=True)[:100]
    return jsonify(ok=True,tasks=result,summary={"running":sum(x.get("status") in {"waiting","running"} for x in result),"completed":sum(x.get("status")=="completed" for x in result),"failed":sum(x.get("status") in {"failed","interrupted"} for x in result)})


@app.post("/api/tasks/<task_id>/cancel")
def api_live_task_cancel(task_id: str):
    if not deploy_authorized():return deploy_auth_error()
    with LIVE_TASK_LOCK:
        task=LIVE_TASKS.get(task_id) or live_task_read(task_id)
        if not task:return jsonify(ok=False,error="وظیفه پیدا نشد"),404
        if task.get("status") in {"completed","failed","cancelled"}:return jsonify(ok=True,task=task)
        task["cancel_requested"]=True;task["step"]="درخواست توقف ثبت شد";task["updated_at"]=int(time.time());LIVE_TASKS[task_id]=task;live_task_disk_write(task)
    return jsonify(ok=True,task=task)


@app.post("/api/tasks/stop-all")
def api_live_tasks_stop_all():
    """Force-stop every task that is still waiting or running.

    Per-task cancel already existed but there was no way to clear a jammed
    queue in one action. Cancellation is cooperative: we set the flag on every
    live task, and each worker aborts within about a second (see Fetcher.get,
    which polls the flag while its request runs in a helper thread). Tasks that
    are already finished are left alone.
    """
    if not deploy_authorized():return deploy_auth_error()
    stopped=[];skipped=0
    rows={}
    try:
        for name in os.listdir(LIVE_TASK_DIR):
            if re.fullmatch(r"task-[0-9a-f]{16}\.json",name):
                try:
                    with open(os.path.join(LIVE_TASK_DIR,name),encoding="utf-8") as fh:row=json.load(fh)
                    if isinstance(row,dict) and row.get("id"):rows[row["id"]]=row
                except (OSError,ValueError):pass
    except OSError:pass
    with LIVE_TASK_LOCK:
        for tid,task in LIVE_TASKS.items():rows[tid]=task
        for tid,task in rows.items():
            if task.get("status") not in {"waiting","running"}:
                skipped+=1;continue
            task["cancel_requested"]=True
            task["step"]="توقف اجباری همهٔ وظایف"
            task["updated_at"]=int(time.time())
            LIVE_TASKS[tid]=task
            live_task_disk_write(task)
            stopped.append(tid)
    return jsonify(ok=True,stopped=stopped,count=len(stopped),skipped=skipped,
                   message=f"درخواست توقف برای {len(stopped)} وظیفه ثبت شد" if stopped
                           else "هیچ وظیفهٔ فعالی برای توقف نبود")


@app.post("/api/tasks/<task_id>/retry")
def api_live_task_retry(task_id: str):
    if not deploy_authorized():return deploy_auth_error()
    task=live_task_read(task_id)
    if task.get("kind")!="scrape" or task.get("status") not in {"failed","interrupted","cancelled"}:return jsonify(ok=False,error="فقط استخراج قطع‌شده یا ناموفق قابل اجرای مجدد است"),400
    job=load_data().get("extract_jobs",{}).get(task_id)
    if not isinstance(job,dict) or not isinstance(job.get("config"),dict):return jsonify(ok=False,error="checkpoint این استخراج پیدا نشد"),404
    cfg=dict(job["config"]);cfg["_profile_name"]=clean_text(task.get("profile"));cfg.update({"_start_page":max(1,int(job.get("next_page",1))),"_next_url":job.get("next_url",""),"_resume_products":job.get("products",[])})
    task.update(status="waiting",progress=max(0,int(task.get("progress",0))),step="اجرای مجدد مستقل آغاز شد",cancel_requested=False,updated_at=int(time.time()));task.setdefault("details",[]).append({"at":time.strftime("%H:%M:%S"),"text":"ادامه از آخرین checkpoint درخواست شد"})
    with LIVE_TASK_LOCK:LIVE_TASKS[task_id]=task;live_task_disk_write(task)
    threading.Thread(target=scrape_live_worker,args=(task_id,cfg),name="scrape-retry",daemon=True).start();return jsonify(ok=True,task=task)


@app.delete("/api/tasks/<task_id>")
def api_live_task_delete(task_id: str):
    if not deploy_authorized():return deploy_auth_error()
    task=live_task_read(task_id)
    if task.get("status") in {"waiting","running"} and not task.get("cancel_requested"):return jsonify(ok=False,error="ابتدا وظیفه فعال را متوقف کنید"),409
    with LIVE_TASK_LOCK:LIVE_TASKS.pop(task_id,None)
    try:os.unlink(os.path.join(LIVE_TASK_DIR,task_id+".json"))
    except OSError:pass
    return jsonify(ok=True)


@app.get("/api/changelog")
def api_changelog():
    return jsonify(ok=True,current=APP_VERSION,releases=CHANGELOG)


@app.get("/api/tasks/<task_id>")
def api_live_task(task_id: str):
    task=live_task_read(task_id)
    if not task:return jsonify(ok=False,error="وظیفه زنده پیدا نشد یا فایل موقت آن پاک شده است"),404
    if task.get("private",True) and not deploy_authorized():return deploy_auth_error()
    return jsonify(ok=True,task=task)


@app.get("/health")
def health():
    return jsonify(ok=True, version=APP_VERSION, build=BUILD_ID, edition="vps", php_parity="10.123",
                   vps_mode=VPS_MODE, max_pages=MAX_PAGES_HARD, max_products=MAX_PRODUCTS_HARD,
                   stall_after=STALL_AFTER, heartbeat=HEARTBEAT_STATE, url_prefix=URL_PREFIX,
                   auto_update=AUTO_UPDATE_ENABLED, update_error=AUTO_UPDATE_STATE["error"],
                   ui_bridge=globals().get("UI_BRIDGE_READY", False),
                   ui_bridge_error=globals().get("UI_BRIDGE_ERROR", "bridge block missing from this file"),
                   last_error=(recent_errors(1)[-1] if recent_errors(1) else None), error_log=ERROR_LOG_PATH)


@app.get("/api/errors")
def api_errors():
    limit = 40
    try:
        limit = max(1, min(200, int(request.args.get("limit", 40))))
    except (TypeError, ValueError):
        pass
    rows = recent_errors(limit)
    return jsonify(ok=True, count=len(rows), path=ERROR_LOG_PATH, errors=rows)


@app.errorhandler(Exception)
def handle_uncaught(exc):
    from werkzeug.exceptions import HTTPException
    if isinstance(exc, HTTPException):
        return exc
    report_error("flask:" + (request.path if request else ""), exc)
    return jsonify(ok=False, error=str(exc)[:400]), 500


def render_index() -> str:
    """Rewrite UI fetches so the app works under Apache /put while Flask still serves /."""
    html = INDEX_HTML
    html = html.replace(
        "let products=[],profiles={}",
        "const BASE="+json.dumps(URL_PREFIX)+";let products=[],profiles={}",
        1,
    )
    html = html.replace("await fetch(path,{", "await fetch(BASE+path,{", 1)
    html = html.replace("fetch('/", "fetch(BASE+'/")
    html = html.replace("location.href='/api/", "location.href=BASE+'/api/")
    html = html.replace("$('pickerFrame').src='/api/", "$('pickerFrame').src=BASE+'/api/")
    return html


@app.get("/")
def index():
    return Response(render_index(), mimetype="text/html; charset=utf-8")



@app.get("/api/picker/preview")
def api_picker_preview():
    """Return a sandboxed, script-stripped DOM preview with our visual selector inspector."""
    url=public_http_url(clean_text(request.args.get("url")))
    render=clean_text(request.args.get("render","auto"));host=(urlparse(url).hostname or "").lower()
    spa=any(x in host for x in ("snappshop.ir","snapp.ir"))
    if spa: render="browser"
    network=load_data().get("network",{});fetcher=Fetcher(network);result=None;errors=[]
    scrolls=8 if spa else 4
    if render!="browser":
        result=picker_http_fetch(url,fetcher,errors)
        if result is None and fetcher.proxy_mode in {"relay","http"}:
            errors.append("رله/پروکسی پاسخ نداد (مثلاً HTTP 503) — تلاش مستقیم بدون پروکسی")
            result=picker_http_fetch(url,_fetcher_direct(network),errors)
    if result is None or spa:
        browser=picker_browser_fetch(url,fetcher.timeout,scrolls,errors)
        if browser is not None:
            result=browser
        elif result is None and fetcher.proxy_mode in {"relay","http"}:
            errors.append("مرورگر در دسترس نبود — تلاش مستقیم HTTP")
            result=picker_http_fetch(url,_fetcher_direct(network),errors)
    if result is None:
        message="\n".join(errors) or "دریافت صفحه ناموفق بود";payload=json.dumps({"type":"s4-picker-error","error":message},ensure_ascii=False)
        return Response("<h2 dir='rtl'>بارگذاری پیش‌نمایش ناموفق بود</h2><pre dir='rtl'>"+escape(message)+"</pre><script>parent.postMessage("+payload+",'*')</script>",status=502,mimetype="text/html")
    soup=BeautifulSoup(result.text,"lxml")
    for node in soup.select("script,noscript,iframe,object,embed,base,meta[http-equiv]"):node.decompose()
    for node in soup.find_all(True):
        for attr in list(node.attrs):
            if str(attr).lower().startswith("on"):del node.attrs[attr]
        if node.name in {"a","form"}:node.attrs.pop("target",None);node.attrs.pop("action",None)
    head=soup.head or soup.new_tag("head")
    if not soup.head:soup.insert(0,head)
    base_tag=soup.new_tag("base",href=result.url);head.insert(0,base_tag)
    style=soup.new_tag("style");style.string="""html{scroll-behavior:smooth}body{cursor:crosshair!important;padding-top:42px!important}.__s4_hover{outline:3px dashed #38bdf8!important;outline-offset:2px!important;background-color:rgba(56,189,248,.12)!important}.__s4_picked{outline:4px solid #f43f5e!important;outline-offset:2px!important;background-color:rgba(244,63,94,.12)!important}#__s4bar{position:fixed;z-index:2147483647;inset:0 0 auto;background:#07111fee;color:#fff;padding:8px 12px;font:700 14px Tahoma,sans-serif;direction:rtl;box-shadow:0 4px 20px #0008}#__s4bar b{color:#67e8f9}a{cursor:crosshair!important}""";head.append(style)
    script=soup.new_tag("script")
    script.string=r'''(()=>{let picked=null;const bad=/^(active|selected|hover|focus|open|show|hidden|current|disabled|loading)$/i;function esc(x){return CSS.escape(String(x))}function best(el){if(!el||el===document.body)return 'body';if(el.id&&el.id.length<60&&!/\d{5,}/.test(el.id))return '#'+esc(el.id);let cls=[...el.classList].filter(x=>x.length<45&&!bad.test(x)&&!/^(__s4_|css-|jsx-)/.test(x)&&!/^[a-f0-9]{8,}$/i.test(x)).slice(0,3),tag=el.tagName.toLowerCase(),tries=[];if(cls.length)tries.push(tag+'.'+cls.map(esc).join('.'),'.'+cls.map(esc).join('.'));for(const c of cls)tries.push(tag+'.'+esc(c),'.'+esc(c));for(const q of tries){try{let n=document.querySelectorAll(q).length;if(n>0&&n<300)return q}catch(e){}}let p=el.parentElement;if(p&&p!==document.body){let siblings=[...p.children].filter(x=>x.tagName===el.tagName);if(siblings.length>1)return best(p)+' > '+tag+':nth-of-type('+(siblings.indexOf(el)+1)+')'}return tag}function relative(el,root){if(el===root)return best(el);let parts=[];while(el&&el!==root){let tag=el.tagName.toLowerCase(),cls=[...el.classList].filter(x=>x.length<45&&!bad.test(x)&&!/^(__s4_|css-|jsx-)/.test(x)).slice(0,2);if(cls.length){parts.unshift(tag+'.'+cls.map(esc).join('.'));break}let same=el.parentElement?[...el.parentElement.children].filter(x=>x.tagName===el.tagName):[];parts.unshift(tag+(same.length>1?':nth-of-type('+(same.indexOf(el)+1)+')':''));el=el.parentElement}return parts.join(' > ')||best(picked)}function report(){if(!picked)return;let root=null;try{root=window.__s4context?picked.closest(window.__s4context):null}catch(e){}let selector=root&&root!==picked?relative(picked,root):best(picked),matches=0;try{matches=root?root.querySelectorAll(selector).length:document.querySelectorAll(selector).length}catch(e){}parent.postMessage({type:'s4-picker-picked',selector,tag:picked.tagName.toLowerCase(),text:(picked.innerText||picked.getAttribute('alt')||'').trim().slice(0,180),matches},'*')}function choose(el){if(picked)picked.classList.remove('__s4_picked');picked=el;picked.classList.add('__s4_picked');report()}document.addEventListener('mouseover',e=>{if(e.target.id==='__s4bar')return;e.target.classList.add('__s4_hover')},true);document.addEventListener('mouseout',e=>e.target.classList.remove('__s4_hover'),true);document.addEventListener('click',e=>{if(e.target.closest('#__s4bar'))return;e.preventDefault();e.stopPropagation();choose(e.target)},true);window.addEventListener('message',e=>{let a=e.data&&e.data.action;if(a==='context'){window.__s4context=e.data.selector||'';return}if(!picked)return;if(a==='up'&&picked.parentElement)choose(picked.parentElement);if(a==='down'&&picked.firstElementChild)choose(picked.firstElementChild);if(a==='prev'&&picked.previousElementSibling)choose(picked.previousElementSibling);if(a==='next'&&picked.nextElementSibling)choose(picked.nextElementSibling)});let bar=document.createElement('div');bar.id='__s4bar';bar.innerHTML='🎯 <b>انتخابگر Scraper4</b> — روی جزء موردنظر کلیک کنید؛ سپس از کنترل‌های بیرون پیش‌نمایش استفاده کنید.';document.documentElement.append(bar);parent.postMessage({type:'s4-picker-ready'},'*')})()'''
    (soup.body or soup).append(script)
    response=Response(str(soup),mimetype="text/html; charset=utf-8");response.headers["Content-Security-Policy"]="default-src * data: blob: 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'";response.headers["Cache-Control"]="no-store";return response


@app.get("/api/config")
def get_config():
    data = load_data()
    woo = dict(data["woocommerce"])
    if woo.get("consumer_key"):
        woo["consumer_key"] = "••••" + woo["consumer_key"][-4:]
    if woo.get("consumer_secret"):
        woo["consumer_secret"] = "••••" + woo["consumer_secret"][-4:]
    if woo.get("worker_key"):
        woo["worker_key"] = "••••" + str(woo["worker_key"])[-4:]
    deploy = dict(data["deploy"])
    try:
        normalized = deploy_config(data)
        deploy["branch"] = normalized["branch"]
        deploy["branches"] = normalized["branches"]
        deploy["check_on_load"] = normalized["check_on_load"]
    except Exception:
        deploy.setdefault("branches", [deploy.get("branch", "arena/01a0640f-amphp")])
        deploy.setdefault("check_on_load", False)
    deploy["has_github_token"] = bool(os.environ.get("GITHUB_TOKEN", "") or deploy.get("github_token"))
    deploy["github_token"] = ""
    network = dict(data["network"])
    if network.get("worker_key"):
        network["worker_key"] = "••••" + str(network["worker_key"])[-4:]
    active=data.get("active_profile","") if data.get("active_profile","") in data["profiles"] else ""
    return jsonify(ok=True, profiles=data["profiles"], active_profile=active, network=network, woocommerce=woo,
                   deploy=deploy, last_count=len(data["last_result"]), version=APP_VERSION,
                   build=BUILD_ID, auto_update=AUTO_UPDATE_ENABLED, edition="vps", php_parity="10.123",
                   vps_mode=VPS_MODE, max_pages=MAX_PAGES_HARD, max_products=MAX_PRODUCTS_HARD, url_prefix=URL_PREFIX)


@app.post("/api/settings")
def settings():
    if not deploy_authorized():return deploy_auth_error()
    body = request.get_json(silent=True) or {}
    data = load_data()
    if isinstance(body.get("network"), dict):
        for key in ("timeout", "gap_ms", "proxy", "proxy_mode", "worker_key", "verify_tls"):
            if key in body["network"]:
                value = body["network"][key]
                if key == "worker_key" and str(value).startswith("••••"):
                    continue
                data["network"][key] = value
    if isinstance(body.get("woocommerce"), dict):
        for key in ("url", "consumer_key", "consumer_secret", "api_mode", "relay_url", "worker_key"):
            value = body["woocommerce"].get(key)
            if value is not None and not str(value).startswith("••••"):
                data["woocommerce"][key] = str(value).strip()
    if isinstance(body.get("deploy"), dict):
        if not deploy_authorized():
            return deploy_auth_error()
        for key in ("repo", "path", "reload_file"):
            if key in body["deploy"]:
                data["deploy"][key] = str(body["deploy"][key]).strip()
        if "branches" in body["deploy"] or "branch" in body["deploy"]:
            merged = normalize_branches(body["deploy"].get("branches", body["deploy"].get("branch", "")), str(body["deploy"].get("branch", "")))
            # Also accept a legacy single "branch" string appended to the list.
            legacy = clean_branch(body["deploy"].get("branch", ""))
            if legacy and legacy not in merged:
                merged = ([legacy] + merged)[:DEPLOY_MAX_BRANCHES]
            data["deploy"]["branches"] = merged
            data["deploy"]["branch"] = merged[0]
        if "check_on_load" in body["deploy"]:
            data["deploy"]["check_on_load"] = bool(body["deploy"]["check_on_load"])
        # Blank means keep the existing token; explicit clear_token removes it.
        token = str(body["deploy"].get("github_token", "")).strip()
        if token:
            data["deploy"]["github_token"] = token
        if body["deploy"].get("clear_token"):
            data["deploy"]["github_token"] = ""
    # Dashboard preference groups (font, theme, queue limits, watchdog…).
    # This core route is registered before the ui_bridge one and therefore
    # wins, so the persistence has to live here or the font silently resets
    # to the default on every page refresh.
    ui_groups = ("appearance", "general", "watchdog", "notifications",
                 "retire", "dedup", "agent")
    incoming_ui = body.get("settings") if isinstance(body.get("settings"), dict) else body
    stored_ui = data.get("ui_settings")
    if not isinstance(stored_ui, dict):
        stored_ui = {}
    for group in ui_groups:
        if isinstance(incoming_ui.get(group), dict):
            merged = dict(stored_ui.get(group) or {})
            merged.update(incoming_ui[group])
            stored_ui[group] = merged
    data["ui_settings"] = stored_ui
    save_data(data)
    return jsonify(ok=True)


@app.post("/api/network/diagnose")
def api_network_diagnose():
    if not deploy_authorized():return deploy_auth_error()
    cfg=load_data().get("network",{});mode=clean_text(cfg.get("proxy_mode","auto"));canary="Scraper4-Canary-"+secrets.token_hex(4)
    try:
        response=outbound_request("POST","https://httpbin.org/anything",headers={"Authorization":"Bearer "+canary,"User-Agent":"Scraper4-Gateway-Test"},json={"probe":"scraper4","method":"POST"},timeout=30);payload=response.json() if response.ok else {};headers=payload.get("headers",{}) if isinstance(payload,dict) else {};auth=next((str(v) for k,v in headers.items() if k.lower()=="authorization"),"");method=str(payload.get("method","")).upper();json_body=payload.get("json");result={"reachable":response.ok,"authorization":auth=="Bearer "+canary,"method":method=="POST","json":isinstance(json_body,dict) and json_body.get("probe")=="scraper4","status":response.status_code,"transport":getattr(response,"scraper4_transport",mode)};result["ready_for_authenticated_api"]=all(result[k] for k in ("reachable","authorization","method","json"));return jsonify(ok=True,**result)
    except Exception as exc:return jsonify(ok=False,error=f"آزمایش دروازه مرکزی ناموفق بود: {exc}",transport=mode),400


def cleanup_dependency_space() -> int:
    """Remove disposable caches and stale installer backups, never user data."""
    freed = 0
    targets = [os.path.expanduser("~/.cache/pip"), os.path.expanduser("~/.cache/ms-playwright"), os.path.join(BASE_DIR, "__pycache__")]
    for target in targets:
        if not os.path.exists(target): continue
        for root, _, files in os.walk(target):
            for name in files:
                try: freed += os.path.getsize(os.path.join(root, name))
                except OSError: pass
        shutil.rmtree(target, ignore_errors=True)
    for prefix in ("scraper4.py.", "wsgi-"):
        backups = sorted((x for x in os.listdir(BASE_DIR) if x.startswith(prefix) and x.endswith(".bak")), reverse=True)
        for name in backups[2:]:
            path = os.path.join(BASE_DIR, name)
            try: freed += os.path.getsize(path); os.unlink(path)
            except OSError: pass
    return freed


def playwright_browser_ready(root: str) -> bool:
    if not os.path.isdir(root): return False
    executable_names = {"chrome", "chromium", "chrome-headless-shell", "headless_shell"}
    for directory, _, files in os.walk(root):
        if any(name in executable_names and os.access(os.path.join(directory, name), os.X_OK) for name in files): return True
    return False


def playwright_runtime_ready(python_bin: str, env: dict[str, str]) -> bool:
    """Check the executable revision expected by the currently installed package."""
    probe = "from playwright.sync_api import sync_playwright;import os; p=sync_playwright().start(); x=p.chromium.executable_path; p.stop(); raise SystemExit(0 if os.path.isfile(x) else 1)"
    try:
        return subprocess.run([python_bin, "-c", probe], env=env, capture_output=True, timeout=30).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def safe_remove_generated(path: str, allowed_roots: list[str]) -> int:
    """Delete one known generated path without ever following symlinks."""
    absolute = os.path.abspath(os.path.expanduser(path))
    if not any(os.path.commonpath([absolute, root]) == root for root in allowed_roots):
        return 0
    size = 0
    try:
        if os.path.islink(absolute):
            os.unlink(absolute); return 0
        if os.path.isfile(absolute):
            size = os.path.getsize(absolute); os.unlink(absolute); return size
        if not os.path.isdir(absolute): return 0
        for directory, _, files in os.walk(absolute):
            for name in files:
                try: size += os.path.getsize(os.path.join(directory, name))
                except OSError: pass
        shutil.rmtree(absolute, ignore_errors=True)
    except OSError:
        return 0
    return size


def account_cleanup() -> dict[str, Any]:
    """Clean only provably disposable account data; preserve system and user content."""
    home = os.path.abspath(os.path.expanduser("~")); app_root = os.path.abspath(BASE_DIR)
    allowed = [home, app_root]
    candidates = ([] if VPS_MODE else [os.path.join(home, ".cache", "ms-playwright")]) + [
        os.path.join(home, ".cache", "pip"), os.path.join(home, ".cache", "uv"),
        os.path.join(home, ".cache", "pypoetry"),
        os.path.join(home, ".npm", "_cacache"), os.path.join(home, ".npm", "_logs"),
        os.path.join(app_root, "__pycache__"), os.path.join(app_root, ".pytest_cache"),
    ]
    freed, removed = 0, []
    for path in candidates:
        amount = safe_remove_generated(path, allowed)
        if amount or not os.path.exists(path):
            if amount: removed.append(os.path.relpath(path, home))
            freed += amount
    # Interrupted installers and atomic-write leftovers in the dedicated app folder.
    temp_patterns = re.compile(r"^(?:\.download-|\.pa-auth-|\.pa-response-|\.scraper4-|\.wsgi\.tmp)")
    try:
        for name in os.listdir(app_root):
            if temp_patterns.match(name):
                path=os.path.join(app_root,name); amount=safe_remove_generated(path,allowed)
                if amount: freed+=amount;removed.append(os.path.relpath(path,home))
    except OSError: pass
    # Keep two newest application/WSGI backups.
    for prefix in ("scraper4.py.", "wsgi-"):
        try: backups=sorted((x for x in os.listdir(app_root) if x.startswith(prefix) and x.endswith(".bak")),reverse=True)
        except OSError: backups=[]
        for name in backups[2:]:
            path=os.path.join(app_root,name);amount=safe_remove_generated(path,allowed)
            if amount:freed+=amount;removed.append(os.path.relpath(path,home))
    # Remove incomplete browser downloads. If lightweight shell exists, full Chromium copies are redundant.
    browser_root=os.path.join(app_root,"ms-playwright")
    headless_ready=any("headless" in directory.lower() and playwright_browser_ready(directory) for directory,dirs,files in os.walk(browser_root)) if os.path.isdir(browser_root) else False
    if os.path.isdir(browser_root):
        for name in os.listdir(browser_root):
            path=os.path.join(browser_root,name)
            redundant=(not VPS_MODE and headless_ready and name.startswith("chromium-") and "headless" not in name)
            incomplete=os.path.isdir(path) and not playwright_browser_ready(path) and not name.startswith("ffmpeg")
            if redundant or incomplete:
                amount=safe_remove_generated(path,allowed)
                if amount:freed+=amount;removed.append(os.path.relpath(path,home))
    # Dedicated venv only: uninstall packages no longer used by Scraper4.
    candidates_py=[os.path.join(app_root,"venv","bin","python"),os.path.join(sys.prefix,"bin","python")]
    python_bin=next((x for x in candidates_py if os.path.isfile(x) and os.access(x,os.X_OK) and "uwsgi" not in os.path.basename(x).lower()),"")
    uninstall_output=""
    if python_bin:
        try:
            pkgs=["html5lib","trio","trio-websocket"] if VPS_MODE else ["selenium","html5lib","trio","trio-websocket"]
            run=subprocess.run([python_bin,"-m","pip","uninstall","-y",*pkgs],capture_output=True,text=True,timeout=180) if pkgs else None
            uninstall_output=((run.stdout or run.stderr)[-1200:] if run else "")
        except (OSError,subprocess.TimeoutExpired): pass
    return {"freed_bytes":freed,"freed_mb":round(freed/1048576,1),"removed":removed,"uninstall":uninstall_output}


def bounded_path_size(path: str, deadline: float, counter: list[int]) -> tuple[int, bool]:
    """Folder size without following links, bounded to keep a web request responsive."""
    total, complete = 0, True
    try:
        if os.path.islink(path): return os.lstat(path).st_size, True
        if os.path.isfile(path): return os.path.getsize(path), True
        for directory, dirs, files in os.walk(path, followlinks=False):
            dirs[:] = [name for name in dirs if not os.path.islink(os.path.join(directory, name))]
            for name in files:
                if time.monotonic() > deadline or counter[0] >= 150000: return total, False
                try: total += os.path.getsize(os.path.join(directory, name)); counter[0] += 1
                except OSError: pass
    except OSError:
        complete = False
    return total, complete


def safe_home_path(relative: str) -> tuple[str, str]:
    home = os.path.realpath(os.path.expanduser("~"))
    relative = str(relative or "").strip().replace("\\", "/").lstrip("/")
    target = os.path.realpath(os.path.join(home, relative))
    if os.path.commonpath([home, target]) != home: raise ValueError("مسیر خارج از پوشه حساب مجاز نیست")
    return home, target


@app.get("/api/files")
def api_file_explorer():
    if not deploy_authorized(): return deploy_auth_error()
    try: home, target = safe_home_path(request.args.get("path", ""))
    except ValueError as exc: return jsonify(ok=False, error=str(exc)), 400
    if not os.path.isdir(target): return jsonify(ok=False, error="پوشه پیدا نشد"), 404
    deadline=time.monotonic()+8.0; counter=[0]; entries=[]
    try: children=list(os.scandir(target))[:250]
    except OSError as exc: return jsonify(ok=False,error=f"خواندن پوشه ممکن نیست: {exc}"),400
    children.sort(key=lambda item:(not item.is_dir(follow_symlinks=False),item.name.lower()))
    for item in children:
        if time.monotonic()>deadline: break
        try:
            is_dir=item.is_dir(follow_symlinks=False); size,complete=bounded_path_size(item.path,deadline,counter)
            stat=item.stat(follow_symlinks=False)
            rel=os.path.relpath(item.path,home); rel="" if rel=="." else rel
            entries.append({"name":item.name,"path":rel,"directory":is_dir,"symlink":item.is_symlink(),"size":size,"complete":complete,"modified":int(stat.st_mtime),"protected":item.name.startswith(".") or os.path.realpath(item.path)==os.path.realpath(BASE_DIR)})
        except OSError: continue
    disk=shutil.disk_usage(home); account_used,account_complete=bounded_path_size(home,time.monotonic()+8.0,[0])
    quota_text=""
    try:
        q=subprocess.run(["quota","-s"],capture_output=True,text=True,timeout=8)
        quota_text=(q.stdout or q.stderr).strip()[-2000:]
    except (OSError,subprocess.TimeoutExpired): pass
    quota_used = quota_limit = quota_remaining = None
    def quota_number(token: str) -> Optional[int]:
        match=re.fullmatch(r"([0-9.]+)([KMGTP]?)",token.strip(),re.I)
        if not match:return None
        value=float(match.group(1));unit=match.group(2).upper()
        return int(value*(1024**({"":1,"K":1,"M":2,"G":3,"T":4,"P":5}[unit])))
    for line in quota_text.splitlines():
        parts=line.split()
        if len(parts)>=4 and (parts[0].startswith("/") or parts[0].startswith("*") or ":" in parts[0]):
            used=quota_number(parts[1].rstrip("*"));soft=quota_number(parts[2]);hard=quota_number(parts[3])
            limit=hard or soft
            if used is not None and limit:
                quota_used,quota_limit,quota_remaining=used,limit,max(0,limit-used);break
    rel_current=os.path.relpath(target,home);rel_current="" if rel_current=="." else rel_current
    parent="" if not rel_current else os.path.dirname(rel_current)
    return jsonify(ok=True,current=rel_current,parent=parent,home=home,entries=entries,truncated=len(children)>len(entries),scanned_files=counter[0],account_used=account_used,account_complete=account_complete,account_quota_used=quota_used,account_quota_limit=quota_limit,account_quota_remaining=quota_remaining,filesystem={"total":disk.total,"used":disk.used,"free":disk.free},quota=quota_text)


@app.post("/api/deploy/cleanup")
def api_deploy_cleanup():
    if not deploy_authorized(): return deploy_auth_error()
    result=account_cleanup()
    return jsonify(ok=True,message=f"پاکسازی امن انجام شد؛ {result['freed_mb']} مگابایت فایل موقت حذف شد",**result)


@app.post("/api/deploy/dependencies")
def api_deploy_dependencies():
    if not deploy_authorized(): return deploy_auth_error()
    python_bin = runtime_python_bin()
    if not python_bin: return jsonify(ok=False, error="مفسر Python واقعی پیدا نشد؛ uWSGI برای نصب بسته قابل استفاده نیست"), 500
    if VPS_MODE:
        packages = ["flask", "requests", "beautifulsoup4", "lxml", "playwright", "basalam-sdk", "cloudscraper", "curl_cffi", "httpx", "selenium", "playwright-stealth"]
        env = dict(os.environ); env["PIP_NO_CACHE_DIR"] = "1"
        try:
            pip_run = subprocess.run([python_bin, "-m", "pip", "install", "--no-cache-dir", *packages], capture_output=True, text=True, timeout=720, env=env)
            if pip_run.returncode: raise RuntimeError((pip_run.stderr or pip_run.stdout)[-2000:])
            browser_run = subprocess.run([python_bin, "-m", "playwright", "install", "--with-deps", "chromium"], capture_output=True, text=True, timeout=900, env=env)
            if browser_run.returncode:
                browser_run = subprocess.run([python_bin, "-m", "playwright", "install", "chromium"], capture_output=True, text=True, timeout=900, env=env)
            ready = playwright_runtime_ready(python_bin, env)
            warning = "" if ready else (browser_run.stderr or browser_run.stdout or "")[-1200:]
            return jsonify(ok=True, browser_installed=ready, message="وابستگی‌های کامل VPS و Chromium نصب شد" if ready else "کتابخانه‌ها نصب شد اما Chromium کامل نشد", warning=warning)
        except (OSError, subprocess.TimeoutExpired, RuntimeError) as exc:
            return jsonify(ok=False, error=f"نصب وابستگی‌های VPS ناموفق بود: {exc}"), 400
    # PythonAnywhere: keep the quota-safe headless-shell path.
    packages = ["flask", "requests", "beautifulsoup4", "lxml", "playwright", "basalam-sdk", "cloudscraper", "curl_cffi"]
    env = dict(os.environ); browser_root = os.path.join(BASE_DIR, "ms-playwright")
    env["PLAYWRIGHT_BROWSERS_PATH"] = browser_root
    env["PIP_NO_CACHE_DIR"] = "1"
    freed = cleanup_dependency_space()
    try:
        pip_run = subprocess.run([python_bin, "-m", "pip", "install", "--no-cache-dir", *packages], capture_output=True, text=True, timeout=420, env=env)
        if pip_run.returncode: raise RuntimeError((pip_run.stderr or pip_run.stdout)[-2000:])
        if playwright_runtime_ready(python_bin, env):
            return jsonify(ok=True, browser_installed=True, freed_mb=round(freed/1048576,1), message="کتابخانه و نسخه هماهنگ مرورگر Playwright آماده است")
        # Headless Shell is substantially smaller than full Chromium and is enough
        # for headless DOM rendering on PythonAnywhere.
        browser_run = subprocess.run([python_bin, "-m", "playwright", "install", "chromium-headless-shell"], capture_output=True, text=True, timeout=600, env=env)
        ready = browser_run.returncode == 0 and playwright_runtime_ready(python_bin, env)
        selected_root = browser_root
        warning = ""
        if not ready:
            # PythonAnywhere's /tmp does not consume the account home quota. It is
            # ideal for the browser binary when the free-plan disk is full.
            temp_root = temporary_browser_path()
            shutil.rmtree(temp_root, ignore_errors=True); os.makedirs(temp_root, mode=0o700, exist_ok=True)
            temp_env = dict(env); temp_env["PLAYWRIGHT_BROWSERS_PATH"] = temp_root
            temp_run = subprocess.run([python_bin, "-m", "playwright", "install", "chromium-headless-shell"], capture_output=True, text=True, timeout=600, env=temp_env)
            ready = temp_run.returncode == 0 and playwright_runtime_ready(python_bin, temp_env)
            if ready: selected_root = temp_root
            else: warning = (temp_run.stderr or temp_run.stdout or browser_run.stderr or browser_run.stdout)[-1200:]
        if ready:
            data=load_data(); data.setdefault("runtime", {})["playwright_path"]=selected_root; save_data(data)
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = selected_root
            place = "فضای موقت خارج از سهمیه" if selected_root == temporary_browser_path() else "پوشه برنامه"
            return jsonify(ok=True, browser_installed=True, browser_path=selected_root, freed_mb=round(freed/1048576,1), message=f"Playwright و مرورگر سبک در {place} نصب و آماده شد")
        return jsonify(ok=True, browser_installed=False, freed_mb=round(freed/1048576,1), message="کتابخانه نصب شد اما دانلود مرورگر هم در پوشه برنامه و هم در فضای موقت ناموفق بود.", warning=warning)
    except (OSError, subprocess.TimeoutExpired, RuntimeError) as exc:
        hint = " ابتدا فایل‌های غیرضروری حساب را حذف کنید." if "quota" in str(exc).lower() else ""
        return jsonify(ok=False, error=f"نصب سبک وابستگی‌ها ناموفق بود: {exc}{hint}", freed_mb=round(freed/1048576,1)), 400


@app.get("/api/deploy/branches")
def api_deploy_branches():
    if not deploy_authorized():
        return deploy_auth_error()
    try:
        repo = clean_text(request.args.get("repo")) or deploy_config().get("repo", "")
        token = deploy_config().get("github_token", "")
        # Allow an explicit token query only when no token is stored, never log it.
        return jsonify(ok=True, repo=repo, branches=github_branch_list(repo, token))
    except (ValueError, FetchError) as exc:
        return jsonify(ok=False, error=str(exc)), 400


@app.get("/api/deploy/files")
def api_deploy_files():
    if not deploy_authorized():
        return deploy_auth_error()
    try:
        repo = clean_text(request.args.get("repo")) or deploy_config().get("repo", "")
        branch = clean_text(request.args.get("branch")) or deploy_config().get("branch", "")
        token = deploy_config().get("github_token", "")
        return jsonify(ok=True, repo=repo, branch=branch, files=github_python_files(repo, branch, token))
    except (ValueError, FetchError) as exc:
        return jsonify(ok=False, error=str(exc)), 400


@app.post("/api/deploy/check")
def api_deploy_check():
    if not deploy_authorized():
        return deploy_auth_error()
    try:
        return jsonify(ok=True, **deploy_check())
    except (ValueError, FetchError, OSError) as exc:
        return jsonify(ok=False, error=str(exc)), 400


@app.post("/api/deploy/run")
def api_deploy_run():
    if not deploy_authorized():
        return deploy_auth_error()
    try:
        body = request.get_json(silent=True) or {}
        wanted = ""
        if isinstance(body, dict):
            wanted = clean_branch(body.get("branch", ""))
        return jsonify(ok=True, **deploy_install(wanted))
    except (ValueError, FetchError, OSError) as exc:
        return jsonify(ok=False, error=str(exc)), 400


@app.post("/api/deploy/rollback")
def api_deploy_rollback():
    if not deploy_authorized():
        return deploy_auth_error()
    try:
        return jsonify(ok=True, **deploy_rollback())
    except (ValueError, FetchError, OSError) as exc:
        return jsonify(ok=False, error=str(exc)), 400


def ai_key_preview(key: str) -> str:
    key=str(key).strip()
    return (key[:5]+"…"+key[-4:]) if len(key)>10 else ((key[:2]+"••••") if key else "")


def normalize_ai_providers(value: Any) -> dict[str,dict[str,Any]]:
    if isinstance(value,list):value={str(x.get("id") or f"provider-{i+1}"):x for i,x in enumerate(value) if isinstance(x,dict)}
    if not isinstance(value,dict):raise ValueError("ساختار ارائه‌دهندگان باید object یا array باشد")
    out={}
    for raw_id,raw in value.items():
        if not isinstance(raw,dict):continue
        pid=re.sub(r"[^a-zA-Z0-9_.-]+","-",clean_text(raw.get("id") or raw_id)).strip("-")[:80]
        if not pid:continue
        models=[];seen=set()
        source_models=raw.get("models",[])
        if isinstance(source_models,dict):source_models=[dict(v,id=k) if isinstance(v,dict) else {"id":k,"name":str(v)} for k,v in source_models.items()]
        for model in source_models if isinstance(source_models,list) else []:
            if isinstance(model,str):model={"id":model,"name":model}
            if not isinstance(model,dict):continue
            mid=clean_text(model.get("id") or model.get("model"));
            if not mid or mid in seen:continue
            seen.add(mid);m=dict(model);m["id"]=mid;m["name"]=clean_text(m.get("name") or mid);m["enabled"]=m.get("enabled",True) is not False;models.append(m)
        keys=[];seen_keys=set()
        source_keys=raw.get("apiKeys",[])
        if not isinstance(source_keys,list):source_keys=[]
        legacy=raw.get("apiKey",raw.get("api_key",""));source_keys=([{"key":legacy}]+source_keys) if legacy else source_keys
        for item in source_keys:
            row=item if isinstance(item,dict) else {"key":item};key=str(row.get("key","")).strip()
            if not key or key in seen_keys:continue
            seen_keys.add(key);keys.append({"key":key,"label":clean_text(row.get("label")),"acct":clean_text(row.get("acct")),"enabled":row.get("enabled",True) is not False})
        out[pid]={**raw,"id":pid,"name":clean_text(raw.get("name") or pid),"vendor":clean_text(raw.get("vendor")),"url":clean_text(raw.get("url") or raw.get("endpoint")),"endpoint":clean_text(raw.get("endpoint") or raw.get("url")),"enabled":raw.get("enabled",True) is not False,"apiKey":keys[0]["key"] if keys else str(legacy or ""),"apiKeys":keys,"models":models}
    if not out:raise ValueError("هیچ ارائه‌دهنده معتبر و دارای شناسه‌ای پیدا نشد")
    return out


def ai_public_config(data: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    cfg=dict((data or load_data()).get("ai", {}));key=str(cfg.get("api_key", ""));cfg["api_key"]=ai_key_preview(key);cfg["has_key"]=bool(key)
    return cfg


def ai_provider_summary(data: Optional[dict[str,Any]]=None) -> dict[str,Any]:
    data=data or load_data();providers=[]
    try: normalized=normalize_ai_providers(data.get("ai_providers",{})) if data.get("ai_providers") else {}
    except ValueError:normalized={}
    for p in normalized.values():
        keys=p.get("apiKeys",[]);providers.append({"id":p["id"],"name":p["name"],"vendor":p.get("vendor",""),"url":p.get("url",""),"enabled":p.get("enabled",True),"key_count":len(keys),"key_preview":[ai_key_preview(x.get("key","")) for x in keys],"models":p.get("models",[])})
    return {"providers":providers,"selected":{"provider":data.get("ai",{}).get("provider",""),"model":data.get("ai",{}).get("model","")},"total_models":sum(len(x["models"]) for x in providers)}


def ai_endpoint(url: str) -> str:
    url=public_http_url(url);path=urlparse(url).path.rstrip("/")
    if re.search(r"/(chat/completions|messages|generateContent)$",path,re.I) or ":generateContent" in url:return url
    return url.rstrip("/")+"/chat/completions"


def ai_extract_text(body: Any) -> str:
    if not isinstance(body,dict):return ""
    choices=body.get("choices")
    if isinstance(choices,list) and choices:
        row=choices[0] if isinstance(choices[0],dict) else {};msg=row.get("message",{}) if isinstance(row.get("message"),dict) else {}
        content=msg.get("content") or msg.get("reasoning") or row.get("text")
        if isinstance(content,list):content="".join(str(x.get("text",x.get("content",""))) for x in content if isinstance(x,dict))
        if content:return str(content)
    for key in ("result","data"):
        if isinstance(body.get(key),dict):
            text=ai_extract_text(body[key])
            if text:return text
    return str(body.get("response") or body.get("text") or "")


def ai_chat(prompt: str, provider_id: str="", model_id: str="") -> str:
    data=load_data();cfg=data.get("ai",{});pid=provider_id or clean_text(cfg.get("provider"));model=model_id or clean_text(cfg.get("model"));provider=None
    if data.get("ai_providers"):
        providers=normalize_ai_providers(data["ai_providers"]);provider=providers.get(pid)
        if not provider or provider.get("enabled") is False:provider=next((x for x in providers.values() if x.get("enabled",True) and x.get("models")),None)
    base_url=str((provider or {}).get("url") or cfg.get("endpoint", ""))
    if provider and not model:model=clean_text((provider.get("models") or [{}])[0].get("id"))
    key_rows=[x for x in (provider or {}).get("apiKeys",[]) if x.get("enabled",True) and x.get("key")]
    if not key_rows and cfg.get("api_key"):key_rows=[{"key":str(cfg["api_key"]),"acct":""}]
    if not model:raise ValueError("مدل هوش مصنوعی انتخاب نشده است")
    cloudflare="/ai/run" in base_url.lower()
    endpoint=public_http_url(base_url.rstrip("/")+("/"+model if cloudflare and base_url.rstrip("/").lower().endswith("/ai/run") else "")) if cloudflare else ai_endpoint(base_url)
    if not key_rows and "localhost" not in endpoint:raise ValueError("برای ارائه‌دهنده انتخاب‌شده کلید API ثبت نشده است")
    payload={"model":model,"messages":[{"role":"system","content":str(cfg.get("system_prompt") or "You write accurate Persian WooCommerce product content. Return only requested JSON.")},{"role":"user","content":prompt}],"temperature":float(cfg.get("temperature",.3)),"max_tokens":max(64,min(32000,int(cfg.get("max_tokens",1200))))}
    if cloudflare:payload.pop("model",None)
    errors=[]
    for key_row in key_rows or [{"key":"","acct":""}]:
        key=str(key_row.get("key",""));request_endpoint=endpoint;acct=clean_text(key_row.get("acct"))
        if cloudflare and acct:request_endpoint=re.sub(r"(/accounts/)[^/]+(/)",rf"\g<1>{acct}\2",request_endpoint,count=1,flags=re.I)
        headers={"Content-Type":"application/json","User-Agent":USER_AGENT}
        if key:headers["Authorization"]="Bearer "+key
        try:
            response=outbound_request("POST",request_endpoint,json=payload,headers=headers,timeout=90)
            if response.ok:
                text=ai_extract_text(response.json())
                if text:return text
                raise FetchError("پاسخ مدل خالی بود")
            errors.append(f"HTTP {response.status_code}: {response.text[:240]}")
            if response.status_code not in (401,402,403,429):break
        except (requests.RequestException,ValueError) as exc:errors.append(str(exc));break
    raise FetchError(errors[-1] if errors else "فراخوانی مدل ناموفق بود")


@app.get("/api/ai/providers")
def api_ai_providers():
    if not deploy_authorized():return deploy_auth_error()
    return jsonify(ok=True,**ai_provider_summary())


@app.post("/api/ai/providers/import")
def api_ai_providers_import():
    if not deploy_authorized():return deploy_auth_error()
    upload=request.files.get("file")
    if not upload:return jsonify(ok=False,error="فایل ارائه‌دهندگان ارسال نشده است"),400
    try:
        raw=upload.read(2*1024*1024+1)
        if len(raw)>2*1024*1024:raise ValueError("فایل بزرگ‌تر از ۲ مگابایت است")
        payload=json.loads(raw.decode("utf-8-sig"));providers=payload
        if isinstance(payload,dict) and isinstance(payload.get("files"),dict):providers=php_file_json(payload["files"],"ai_providers.json")
        imported=normalize_ai_providers(providers);data=load_data();providers=normalize_ai_providers(data["ai_providers"]) if data.get("ai_providers") else {};providers.update(imported);data["ai_providers"]=providers
        current=data.get("ai",{}).get("provider");first=providers.get(current) or next((x for x in imported.values() if x.get("enabled",True)),next(iter(imported.values())))
        models=first.get("models",[]);model=models[0]["id"] if models else ""
        data["ai"].update({"provider":first["id"],"endpoint":first["url"],"api_key":first.get("apiKey",""),"model":model});save_data(data)
        return jsonify(ok=True,count=len(imported),total=len(providers),models=sum(len(x["models"]) for x in imported.values()),**ai_provider_summary(data))
    except (ValueError,TypeError,json.JSONDecodeError) as exc:return jsonify(ok=False,error=str(exc)),400


@app.post("/api/ai/providers/save")
def api_ai_provider_save():
    if not deploy_authorized():return deploy_auth_error()
    try:
        body=request.get_json(silent=True) or {};row=body.get("provider",{});data=load_data();allp=normalize_ai_providers(data["ai_providers"]) if data.get("ai_providers") else {};pid=str(row.get("id","new"))
        if body.get("preserve_keys") and pid in allp:
            old_keys=allp[pid].get("apiKeys",[]);row=dict(row);row["apiKeys"]=old_keys+list(row.get("apiKeys",[]))
        new=normalize_ai_providers({pid:row});allp.update(new);data["ai_providers"]=allp;save_data(data);return jsonify(ok=True,**ai_provider_summary(data))
    except (ValueError,TypeError) as exc:return jsonify(ok=False,error=str(exc)),400


@app.delete("/api/ai/providers/<path:provider_id>")
def api_ai_provider_delete(provider_id: str):
    if not deploy_authorized():return deploy_auth_error()
    data=load_data();data.get("ai_providers",{}).pop(provider_id,None)
    if data.get("ai",{}).get("provider")==provider_id:data["ai"].update({"provider":"","model":""})
    save_data(data);return jsonify(ok=True,**ai_provider_summary(data))


@app.post("/api/ai/select")
def api_ai_select():
    if not deploy_authorized():return deploy_auth_error()
    body=request.get_json(silent=True) or {};pid=clean_text(body.get("provider"));mid=clean_text(body.get("model"));data=load_data();providers=normalize_ai_providers(data.get("ai_providers",{}))
    if pid not in providers: return jsonify(ok=False,error="ارائه‌دهنده پیدا نشد"),404
    valid={x["id"] for x in providers[pid].get("models",[])}
    if mid not in valid:return jsonify(ok=False,error="مدل در این ارائه‌دهنده پیدا نشد"),404
    p=providers[pid];data["ai"].update({"provider":pid,"model":mid,"endpoint":p["url"],"api_key":p.get("apiKey","")});save_data(data);return jsonify(ok=True,ai=ai_public_config(data))


@app.get("/api/ai/stats")
def api_ai_stats():
    if not deploy_authorized():return deploy_auth_error()
    data=load_data();providers=normalize_ai_providers(data.get("ai_providers",{})) if data.get("ai_providers") else {};models=[(p,m) for p in providers.values() for m in p.get("models",[])];tested=[m for _,m in models if m.get("tested")];available=[m for _,m in models if m.get("available")];latencies=[int(m.get("latencyMs",0)) for m in available if int(m.get("latencyMs",0))>0]
    by_provider=[]
    for p in providers.values():
        rows=p.get("models",[]);by_provider.append({"id":p["id"],"name":p["name"],"total":len(rows),"tested":sum(bool(m.get("tested")) for m in rows),"available":sum(bool(m.get("available")) for m in rows)})
    total=len(models);return jsonify(ok=True,total=total,tested=len(tested),available=len(available),failed=sum(bool(m.get("tested")) and not bool(m.get("available")) for _,m in models),untested=total-len(tested),free=sum(bool(m.get("free")) for _,m in models),reasoning=sum(bool(m.get("reasoning")) for _,m in models),vision=sum(bool(m.get("vision")) for _,m in models),tool_calling=sum(bool(m.get("toolCalling")) for _,m in models),avg_latency=round(sum(latencies)/len(latencies)) if latencies else 0,coverage_pct=round(len(tested)*100/total) if total else 0,health_pct=round(len(available)*100/len(tested)) if tested else 0,providers=by_provider,candidates=data.get("ai_candidates",[]),master=data.get("ai_master",""))


@app.route("/api/ai/candidates",methods=["GET","POST"])
def api_ai_candidates():
    if not deploy_authorized():return deploy_auth_error()
    data=load_data()
    if request.method=="POST":
        body=request.get_json(silent=True) or {};providers=normalize_ai_providers(data.get("ai_providers",{})) if data.get("ai_providers") else {};valid={(p["id"],m["id"]) for p in providers.values() for m in p.get("models",[])};rows=[]
        for item in body.get("candidates",[]):
            if isinstance(item,dict) and (clean_text(item.get("provider")),clean_text(item.get("model"))) in valid:rows.append({"provider":clean_text(item["provider"]),"model":clean_text(item["model"])})
        rows=list({x["provider"]+"\0"+x["model"]:x for x in rows}.values());master=clean_text(body.get("master"));keys={x["provider"]+"/"+x["model"] for x in rows};data["ai_candidates"]=rows;data["ai_master"]=master if master in keys else "";save_data(data)
    return jsonify(ok=True,candidates=data.get("ai_candidates",[]),master=data.get("ai_master",""))


@app.get("/api/ai/config")
def api_ai_config():
    if not deploy_authorized():return deploy_auth_error()
    data=load_data();return jsonify(ok=True,ai=ai_public_config(data),**ai_provider_summary(data))


@app.post("/api/ai/settings")
def api_ai_settings():
    if not deploy_authorized():return deploy_auth_error()
    body=request.get_json(silent=True) or {};incoming=body.get("ai") if isinstance(body.get("ai"),dict) else {};data=load_data();cfg=data.setdefault("ai",default_data()["ai"])
    for field in ("provider","endpoint","model","temperature","max_tokens","system_prompt"):
        if field in incoming:cfg[field]=incoming[field]
    key=str(incoming.get("api_key","")).strip()
    if key and not key.startswith("••"):cfg["api_key"]=key
    save_data(data);return jsonify(ok=True,ai=ai_public_config(data))


@app.post("/api/ai/test")
def api_ai_test():
    if not deploy_authorized():return deploy_auth_error()
    body=request.get_json(silent=True) or {}
    try:return jsonify(ok=True,answer=ai_chat(str(body.get("prompt") or 'فقط این JSON را برگردان: {"status":"ok"}'),clean_text(body.get("provider")),clean_text(body.get("model")))[:2000])
    except (ValueError,FetchError,requests.RequestException) as exc:return jsonify(ok=False,error=str(exc)),400


def ai_nonchat_model(model: dict[str,Any]) -> bool:
    text=(clean_text(model.get("id"))+" "+clean_text(model.get("name"))).lower()
    return any(x in text for x in ("embedding","embed-","whisper","transcri","tts","speech","image","vision-encoder","moderation","rerank"))


def ai_test_public(job: dict[str,Any]) -> dict[str,Any]:
    rows=job.get("rows",[]);done=[x for x in rows if x.get("status") in ("ok","failed")]
    recommended=max(done,key=lambda x:float(x.get("score",0)),default=None)
    return {"id":job.get("id"),"task_id":job.get("task_id"),"status":job.get("status"),"created_at":job.get("created_at"),"cursor":job.get("cursor",0),"total":len(rows),"ok_count":sum(x.get("status")=="ok" for x in rows),"failed_count":sum(x.get("status")=="failed" for x in rows),"waiting":len(rows)-len(done),"reply_ok":sum(bool(x.get("reply_ok")) for x in rows),"category_ok":sum(bool(x.get("category_ok")) for x in rows),"recommended":{"provider":recommended.get("provider"),"provider_name":recommended.get("provider_name"),"model":recommended.get("model"),"model_name":recommended.get("model_name"),"score":recommended.get("score",0)} if recommended else None,"options":job.get("options",{}),"rows":rows}


@app.get("/api/ai/test/jobs")
def api_ai_test_jobs():
    if not deploy_authorized():return deploy_auth_error()
    data=load_data();jobs=sorted((ai_test_public(x) for x in data.get("ai_test_jobs",{}).values()),key=lambda x:x.get("created_at",0),reverse=True)
    return jsonify(ok=True,jobs=jobs[:20])


@app.post("/api/ai/test/jobs")
def api_ai_test_start():
    if not deploy_authorized():return deploy_auth_error()
    body=request.get_json(silent=True) or {};per=max(1,min(5000,int(body.get("per_provider",5000))));only=bool(body.get("only_untested",False));skip=body.get("skip_nonchat",True) is not False;rows=[];data=load_data();providers=normalize_ai_providers(data.get("ai_providers",{}))
    for provider in providers.values():
        if provider.get("enabled") is False:continue
        count=0
        for model in provider.get("models",[]):
            if count>=per:break
            if model.get("enabled",True) is False or (skip and ai_nonchat_model(model)) or (only and model.get("tested")):continue
            rows.append({"provider":provider["id"],"provider_name":provider["name"],"model":model["id"],"model_name":model.get("name",model["id"]),"status":"waiting","free":bool(model.get("free")),"reasoning":bool(model.get("reasoning")),"vision":bool(model.get("vision")),"tool_calling":bool(model.get("toolCalling"))});count+=1
    if not rows:return jsonify(ok=False,error="مدل آزمایش‌نشده‌ای مطابق فیلترها پیدا نشد"),400
    jid="ait-"+time.strftime("%Y%m%d-%H%M%S")+"-"+secrets.token_hex(2);job={"id":jid,"status":"waiting","created_at":int(time.time()),"cursor":0,"rows":rows,"options":{"reply_message":clean_text(body.get("reply_message") or "سلام، این محصول موجود است و چه زمانی ارسال می‌شود؟"),"category_title":clean_text(body.get("category_title") or "ادو پرفیوم مردانه دیور ساواج ۱۰۰ میلی‌لیتر"),"per_provider":per,"only_untested":only,"skip_nonchat":skip,"delay_ms":max(0,min(60000,int(body.get("delay_ms",120))))}}
    task=live_task_create("ai_test",f"آزمایش جامع {len(rows)} مدل هوش مصنوعی",private=True);task.update(total=len(rows),done=0,sent=0,failed=0,step="آماده اجرای آزمون مدل‌ها");live_task_disk_write(task);job["task_id"]=task["id"]
    data.setdefault("ai_test_jobs",{})[jid]=job;save_data(data);return jsonify(ok=True,job=ai_test_public(job),task=task)


@app.post("/api/ai/test/jobs/<job_id>/process")
def api_ai_test_process(job_id: str):
    if not deploy_authorized():return deploy_auth_error()
    body=request.get_json(silent=True) or {};batch=max(1,min(5,int(body.get("batch",3))));data=load_data();job=data.get("ai_test_jobs",{}).get(job_id)
    if not job:return jsonify(ok=False,error="صف آزمون پیدا نشد"),404
    task_id=clean_text(job.get("task_id"));total=len(job.get("rows",[]))
    if task_id and live_task_cancelled(task_id):job["status"]="cancelled";save_data(data);live_task_update(task_id,round(int(job.get("cursor",0))*100/max(1,total)),"آزمون مدل‌ها متوقف شد","cancelled","نتایج انجام‌شده حفظ شدند");return jsonify(ok=True,processed=0,job=ai_test_public(job))
    job["status"]="running";processed=0
    while int(job.get("cursor",0))<len(job["rows"]) and processed<batch:
        if task_id and live_task_cancelled(task_id):
            job["status"]="cancelled";live_task_update(task_id,round(int(job.get("cursor",0))*100/max(1,total)),"آزمون مدل‌ها متوقف شد","cancelled","نتایج انجام‌شده حفظ شدند");break
        i=int(job["cursor"]);row=job["rows"][i];started=time.monotonic()
        if task_id:live_task_update(task_id,round(i*100/max(1,total)),f"آزمون مدل {i+1} از {total}","running",f"{row['provider_name']} · {row['model_name']}",done=i,total=total,sent=sum(x.get("status")=="ok" for x in job["rows"]),failed=sum(x.get("status")=="failed" for x in job["rows"]),current_model=row["model_name"])
        reply_started=time.monotonic();reply="";reply_error="";category="";category_error=""
        try:
            reply=ai_chat("به پیام نمونه مشتری فروشگاه، مؤدبانه، دقیق و کوتاه به فارسی پاسخ بده. اطلاعات ساختگی نساز. پیام مشتری: "+clean_text(job.get("options",{}).get("reply_message") or job.get("options",{}).get("prompt") or "سلام، این محصول موجود است؟"),row["provider"],row["model"])
        except Exception as exc:reply_error=clean_text(exc)[:500]
        reply_ms=round((time.monotonic()-reply_started)*1000);category_started=time.monotonic()
        try:
            category=ai_chat("برای عنوان محصول زیر مناسب‌ترین دسته‌بندی فروشگاهی را تعیین کن. فقط JSON با کلیدهای category و reason برگردان. عنوان: "+clean_text(job.get("options",{}).get("category_title") or "ادو پرفیوم مردانه دیور ساواج"),row["provider"],row["model"])
        except Exception as exc:category_error=clean_text(exc)[:500]
        category_ms=round((time.monotonic()-category_started)*1000);reply=clean_text(reply)[:1000];category=clean_text(category)[:1000];errors=" | ".join(x for x in (reply_error,category_error) if x);both=bool(reply and category)
        row.update(status="ok" if both else "failed",answer=reply,reply=reply,reply_ok=bool(reply),reply_error=reply_error,reply_ms=reply_ms,category=category,category_ok=bool(category),category_error=category_error,category_ms=category_ms,error=errors,latency_ms=round((time.monotonic()-started)*1000))
        row["score"]=round(max(0,(100 if both else 42 if (reply or category) else 0)+(5 if row.get("free") else 0)-min(30,row["latency_ms"]/3000)),1)
        if task_id:live_task_update(task_id,round((i+1)*100/max(1,total)),f"مدل {i+1} از {total} بررسی شد","running",f"{'✓ سالم' if both else '✕ ناموفق/ناقص'} · {row['provider_name']} · {row['model_name']} · {row['latency_ms']} ms",done=i+1,total=total,sent=sum(x.get("status")=="ok" for x in job["rows"]),failed=sum(x.get("status")=="failed" for x in job["rows"]),current_model=row["model_name"])
        # Persist both customer-reply and categorization health like the PHP model laboratory.
        provider=data.get("ai_providers",{}).get(row["provider"],{});model=next((x for x in provider.get("models",[]) if isinstance(x,dict) and clean_text(x.get("id"))==row["model"]),None)
        if model is not None:model.update({"tested":True,"available":both,"replyAvailable":bool(reply),"categoryAvailable":bool(category),"latencyMs":row["latency_ms"],"lastTestAt":int(time.time()),"testError":errors,"testScore":row["score"]})
        job["cursor"]=i+1;processed+=1
        if job["options"].get("delay_ms") and processed<batch:time.sleep(job["options"]["delay_ms"]/1000)
        save_data(data)
    if job["cursor"]>=len(job["rows"]):
        job["status"]="completed"
        if task_id:live_task_update(task_id,100,"آزمایش همه مدل‌ها کامل شد","completed",f"{sum(x.get('status')=='ok' for x in job['rows'])} سالم · {sum(x.get('status')=='failed' for x in job['rows'])} ناموفق",done=total,total=total,sent=sum(x.get("status")=="ok" for x in job["rows"]),failed=sum(x.get("status")=="failed" for x in job["rows"]),eta_seconds=0)
    save_data(data);return jsonify(ok=True,processed=processed,job=ai_test_public(job))


@app.delete("/api/ai/test/jobs/<job_id>")
def api_ai_test_delete(job_id: str):
    if not deploy_authorized():return deploy_auth_error()
    data=load_data();data.get("ai_test_jobs",{}).pop(job_id,None);save_data(data);return jsonify(ok=True)


@app.post("/api/ai/enrich")
def api_ai_enrich():
    if not deploy_authorized():return deploy_auth_error()
    body=request.get_json(silent=True) or {};limit=max(1,min(5,int(body.get("limit",3))))
    data=load_data();done=[];errors=[]
    for product in data.get("last_result",[]):
        if len(done)>=limit:break
        if product.get("short_desc") and product.get("long_desc"):continue
        prompt="محصول زیر را بدون ادعای ساختگی تکمیل کن. فقط JSON با کلیدهای short_desc و long_desc و tags(array) بده:\n"+json.dumps({k:product.get(k) for k in ("title","brand","category","price","variations_text")},ensure_ascii=False)
        try:
            text=ai_chat(prompt);match=re.search(r"\{.*\}",text,re.S);obj=json.loads(match.group(0) if match else text)
            for field in ("short_desc","long_desc","tags"):
                if obj.get(field):product[field]=obj[field]
            done.append(product.get("title"))
        except Exception as exc:errors.append({"title":product.get("title"),"error":str(exc)[:300]})
    save_data(data);return jsonify(ok=not errors,done=done,errors=errors,total=len(done))



_AI_BAD_CAT = {"", "عمومی", "سایر", "دیگر", "متفرقه", "uncategorized", "general", "default", "بدون دسته", "none", "null"}


def ai_parse_json_object(text: str) -> dict[str, Any]:
    raw = clean_text(text)
    if not raw:
        raise ValueError("پاسخ خالی هوش مصنوعی")
    match = re.search(r"\{.*\}", raw, re.S)
    obj = json.loads(match.group(0) if match else raw)
    if not isinstance(obj, dict):
        raise ValueError("پاسخ JSON شیء نبود")
    return obj


def ai_product_needs_content(product: dict[str, Any]) -> bool:
    short = clean_text(product.get("short_desc") or product.get("shortDesc") or "")
    longd = clean_text(product.get("long_desc") or product.get("longDesc") or product.get("long_desc_html") or "")
    return len(short) < 20 or len(longd) < 40


def ai_product_needs_category(product: dict[str, Any]) -> bool:
    cid = int(product.get("basalam_category_id") or product.get("bsl_category_id") or 0)
    name = clean_text(product.get("category") or product.get("bsl_category_name") or "")
    return cid <= 0 or not name


def ai_category_suspect(product: dict[str, Any]) -> bool:
    name = clean_text(product.get("category") or product.get("bsl_category_name") or "").lower()
    cid = int(product.get("basalam_category_id") or product.get("bsl_category_id") or 0)
    return cid <= 0 or name in _AI_BAD_CAT or len(name) < 2


def ai_load_category_rows() -> list[dict[str, Any]]:
    rows = list(BASALAM_CATEGORY_CACHE.get("rows") or [])
    if rows and time.time() - float(BASALAM_CATEGORY_CACHE.get("at") or 0) < 3600:
        return rows
    try:
        payload, _client = basalam_strategy(lambda: basalam_client().get_categories_sync(), lambda: basalam_api_request("GET", "/v1/categories"))
        flat = basalam_flat_categories(payload)
        unique = {str(x["id"]): x for x in flat if isinstance(x, dict) and x.get("id") is not None}
        rows = list(unique.values())
        BASALAM_CATEGORY_CACHE.update(at=time.time(), rows=rows)
    except Exception:
        pass
    return rows


def ai_match_category(name: str, rows: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    needle = clean_text(name).lower()
    if not needle or not rows:
        return None
    for row in rows:
        if clean_text(row.get("name")).lower() == needle:
            return row
    for row in rows:
        path = (clean_text(row.get("path")) + " " + clean_text(row.get("name"))).lower()
        if needle in path or clean_text(row.get("name")).lower() in needle:
            return row
    tokens = [x for x in re.split(r"\s+", needle) if len(x) > 2]
    best = None
    best_n = 0
    for row in rows:
        path = (clean_text(row.get("path")) + " " + clean_text(row.get("name"))).lower()
        n = sum(1 for tok in tokens if tok in path)
        if n > best_n:
            best, best_n = row, n
    return best if best_n >= 2 else None


def ai_collect_products(scope: str) -> list[dict[str, Any]]:
    data = load_data()
    out: list[dict[str, Any]] = []

    def add(source: str, index: int, product: Any) -> None:
        if not isinstance(product, dict):
            return
        title = clean_text(product.get("title") or product.get("name"))
        if not title:
            return
        out.append({"source": source, "index": index, "product": dict(product)})

    if scope == "all":
        for name, prof in (data.get("profiles") or {}).items():
            if not isinstance(prof, dict):
                continue
            for index, product in enumerate(prof.get("saved_products") or []):
                add("profile:" + name, index, product)
        return out
    if scope == "profile":
        name = clean_text(data.get("active_profile"))
        prof = (data.get("profiles") or {}).get(name) if name else None
        rows = (prof.get("saved_products") if isinstance(prof, dict) else None) or data.get("last_result") or []
        source = ("profile:" + name) if name and isinstance(prof, dict) else "results"
        for index, product in enumerate(rows):
            add(source, index, product)
        return out
    for index, product in enumerate(data.get("last_result") or []):
        add("results", index, product)
    return out


def ai_commit_product(item: dict[str, Any]) -> None:
    data = load_data()
    product = item.get("product") if isinstance(item.get("product"), dict) else {}
    source = str(item.get("source") or "results")
    index = int(item.get("index") or 0)
    if source == "results":
        rows = data.setdefault("last_result", [])
        if 0 <= index < len(rows) and isinstance(rows[index], dict):
            rows[index] = product
        active = clean_text(data.get("active_profile"))
        prof = (data.get("profiles") or {}).get(active)
        if isinstance(prof, dict):
            saved = prof.get("saved_products") if isinstance(prof.get("saved_products"), list) else []
            key = product_key(product)
            for i, row in enumerate(saved):
                if isinstance(row, dict) and product_key(row) == key:
                    saved[i] = product
                    break
            prof["saved_products"] = saved
    elif source.startswith("profile:"):
        name = source.split(":", 1)[1]
        prof = (data.get("profiles") or {}).get(name)
        if isinstance(prof, dict):
            saved = prof.get("saved_products") if isinstance(prof.get("saved_products"), list) else []
            if 0 <= index < len(saved) and isinstance(saved[index], dict):
                saved[index] = product
            prof["saved_products"] = saved
        rows = data.get("last_result") or []
        key = product_key(product)
        for i, row in enumerate(rows):
            if isinstance(row, dict) and product_key(row) == key:
                rows[i] = product
                break
        data["last_result"] = rows
    save_data(data)


def ai_generate_product_fields(product: dict[str, Any], mode: str, cat_rows: list[dict[str, Any]]) -> dict[str, Any]:
    title = clean_text(product.get("title") or product.get("name"))
    ctx = {
        "title": title,
        "brand": clean_text(product.get("brand")),
        "category": clean_text(product.get("category")),
        "price": product.get("price") or "",
        "variations_text": clean_text(product.get("variations_text")),
    }
    names = [clean_text(x.get("path") or x.get("name")) for x in cat_rows[:50] if isinstance(x, dict)]
    names = [x for x in names if x]
    parts = [f"محصول: {title}", "فقط یک JSON معتبر فارسی برگردان. بدون متن اضافه."]
    keys: list[str] = []
    if mode in {"desc", "all"}:
        keys += ["short_desc", "long_desc_html", "tags"]
        parts.append("short_desc: یک یا دو جمله معرفی فارسی، بدون ادعای ساختگی.")
        parts.append("long_desc_html: HTML فارسی با p و ul/li و strong و h3 برای معرفی، ویژگی‌ها و جمع‌بندی خرید.")
        parts.append("tags: آرایه ۳ تا ۸ تگ کوتاه فارسی.")
    if mode in {"category", "catfix", "all"}:
        keys.append("category")
        parts.append("category: نام دقیق دسته فروشگاهی (برگ درخت، ترجیحاً سازگار با باسلام).")
        if names:
            parts.append("اگر ممکن است category را عیناً از این فهرست بردار: " + " | ".join(names[:35]))
    parts.append("کلیدها: " + ", ".join(keys))
    parts.append("زمینه محصول: " + json.dumps(ctx, ensure_ascii=False))
    return ai_parse_json_object(ai_chat("\n".join(parts)))


def ai_apply_generated(product: dict[str, Any], obj: dict[str, Any], cat_rows: list[dict[str, Any]], mode: str) -> dict[str, Any]:
    if mode in {"desc", "all"}:
        short = clean_text(obj.get("short_desc") or obj.get("short_description"))
        html = str(obj.get("long_desc_html") or obj.get("description_html") or obj.get("long_desc") or "").strip()
        if short:
            product["short_desc"] = short
        if html:
            product["long_desc_html"] = html
            product["long_desc"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()
        tags = obj.get("tags")
        if isinstance(tags, list):
            product["tags"] = [clean_text(x) for x in tags if clean_text(str(x))][:12]
        product["ai_content_at"] = int(time.time())
    if mode in {"category", "catfix", "all"}:
        name = clean_text(obj.get("category") or obj.get("category_name"))
        if name:
            old = clean_text(product.get("category"))
            product["category_before"] = old
            product["category"] = name
            matched = ai_match_category(name, cat_rows)
            if matched:
                product["basalam_category_id"] = int(matched.get("id") or 0)
                product["bsl_category_name"] = clean_text(matched.get("name") or name)
            product["ai_category_at"] = int(time.time())
            if old and old != name:
                product["category_fixed"] = True
    return product


def ai_content_worker(task_id: str, mode: str, scope: str, limit: int, only_missing: bool) -> None:
    titles = {"desc": "توضیح‌ساز", "category": "دسته‌بندی", "catfix": "اصلاح دسته", "all": "محتوا و دسته"}
    label = titles.get(mode, "هوش مصنوعی")
    try:
        live_task_update(task_id, 2, "آماده‌سازی فهرست محصولات", "running", f"{label} · منبع {scope}")
        items = ai_collect_products(scope)
        selected: list[dict[str, Any]] = []
        for item in items:
            product = item["product"]
            if mode == "desc" and only_missing and not ai_product_needs_content(product):
                continue
            if mode == "category" and only_missing and not ai_product_needs_category(product):
                continue
            if mode == "catfix" and only_missing and not ai_category_suspect(product):
                continue
            if mode == "all" and only_missing and not (ai_product_needs_content(product) or ai_product_needs_category(product)):
                continue
            selected.append(item)
            if len(selected) >= limit:
                break
        if not selected:
            live_task_update(task_id, 100, "محصولی برای این کار نبود", "completed", "فیلتر ناقص/مشکوک چیزی برنگرداند", filled=0, failed=0, total=0)
            return
        cat_rows = ai_load_category_rows() if mode in {"category", "catfix", "all"} else []
        filled = 0
        failed = 0
        total = len(selected)
        for index, item in enumerate(selected, 1):
            if live_task_cancelled(task_id):
                live_task_update(task_id, max(5, int((index - 1) / total * 100)), "متوقف شد", "cancelled", f"{filled} موفق · {failed} خطا", filled=filled, failed=failed, total=total)
                return
            title = clean_text(item["product"].get("title") or item["product"].get("name"))
            live_task_update(task_id, max(4, int((index - 1) / total * 96)), f"{label} {index} از {total}", "running", title[:160], done=index - 1, total=total, filled=filled, failed=failed)
            try:
                obj = ai_generate_product_fields(item["product"], mode, cat_rows)
                item["product"] = ai_apply_generated(item["product"], obj, cat_rows, mode)
                ai_commit_product(item)
                filled += 1
            except Exception as exc:
                failed += 1
                report_error("ai_content", exc)
                live_task_update(task_id, max(4, int(index / total * 96)), f"{label} {index} از {total}", "running", f"✕ {title[:80]} · {clean_text(exc)[:180]}", done=index, total=total, filled=filled, failed=failed)
        live_task_update(task_id, 100, f"{label} تمام شد", "completed", f"{filled} موفق · {failed} خطا از {total}", filled=filled, failed=failed, total=total, done=total)
    except Exception as exc:
        report_error("ai_content_worker", exc)
        live_task_update(task_id, 100, "کار هوش مصنوعی ناموفق بود", "failed", clean_text(exc)[:800], error=clean_text(exc)[:1500])


@app.post("/api/ai/content/start")
def api_ai_content_start():
    if not deploy_authorized():
        return deploy_auth_error()
    body = request.get_json(silent=True) or {}
    mode = clean_text(body.get("mode") or "desc").lower()
    if mode not in {"desc", "category", "catfix", "all"}:
        return jsonify(ok=False, error="حالت نامعتبر است"), 400
    scope = clean_text(body.get("scope") or "results").lower()
    if scope not in {"results", "profile", "all"}:
        scope = "results"
    try:
        limit = max(1, min(80, int(body.get("limit") or 20)))
    except (TypeError, ValueError):
        limit = 20
    only_missing = bool(body.get("only_missing", True))
    titles = {"desc": "توضیح‌ساز هوش مصنوعی", "category": "دسته‌بندی با هوش مصنوعی", "catfix": "اصلاح دسته‌بندی اشتباه", "all": "محتوا و دسته با هوش مصنوعی"}
    task = live_task_create("ai_content", titles[mode], private=False)
    task.update(mode=mode, scope=scope, limit=limit)
    LIVE_TASKS[task["id"]] = task
    live_task_disk_write(task)
    threading.Thread(target=ai_content_worker, args=(task["id"], mode, scope, limit, only_missing), name="ai-content", daemon=True).start()
    return jsonify(ok=True, task=task)


@app.post("/api/profile")
def profile_save():
    body = request.get_json(silent=True) or {}
    name = clean_text(body.get("name"))[:100]
    config = body.get("config")
    if not name or not isinstance(config, dict):
        return jsonify(ok=False, error="نام و تنظیمات پروفایل لازم است"), 400
    public_http_url(str(config.get("url", "")))
    data = load_data()
    previous_profile=data.get("profiles",{}).get(name,{})
    config=dict(config);config["saved_products"]=[dict(x) for x in data.get("last_result",[])[:MAX_PRODUCTS_HARD] if isinstance(x,dict)]
    if not clean_text(config.get("display_name")):
        config["display_name"]=clean_text(previous_profile.get("display_name")) or name
    else:
        config["display_name"]=clean_text(config.get("display_name"))[:100]
    for retained in ("last_comparison","comparison_history"):
        if retained in previous_profile:config[retained]=previous_profile[retained]
    data["profiles"][name] = config
    data["active_profile"] = name
    save_data(data)
    return jsonify(ok=True, profiles=data["profiles"], active_profile=name)


@app.delete("/api/profile/<path:name>")
def profile_delete(name: str):
    data = load_data()
    data["profiles"].pop(name, None)
    if data.get("active_profile")==name:data["active_profile"]=""
    save_data(data)
    return jsonify(ok=True, profiles=data["profiles"], active_profile=data.get("active_profile",""))


@app.post("/api/profile/active")
def profile_activate():
    body=request.get_json(silent=True) or {};name=clean_text(body.get("name"));data=load_data()
    if name and name not in data.get("profiles",{}):return jsonify(ok=False,error="پروفایل پیدا نشد"),404
    data["active_profile"]=name;save_data(data);return jsonify(ok=True,active_profile=name,config=data.get("profiles",{}).get(name))


@app.post("/api/profile/rename")
def profile_rename():
    body = request.get_json(silent=True) or {}
    old = clean_text(body.get("old") or body.get("from") or "")
    new = clean_text(body.get("name") or body.get("new") or "")[:100]
    if not old or not new:
        return jsonify(ok=False, error="نام فعلی و نام جدید لازم است"), 400
    data = load_data()
    profiles = data.get("profiles") or {}
    if old not in profiles:
        return jsonify(ok=False, error="پروفایل پیدا نشد"), 404
    if new != old and new in profiles:
        return jsonify(ok=False, error="این نام از قبل وجود دارد"), 400
    if new != old:
        profiles[new] = profiles.pop(old)
        if data.get("active_profile") == old:
            data["active_profile"] = new
    profiles[new]["display_name"] = new
    data["profiles"] = profiles
    save_data(data)
    return jsonify(ok=True, profiles=data["profiles"], active_profile=data.get("active_profile", new))


def scrape_result(report: ScrapeReport, profile_name: str="") -> dict[str,Any]:
    products=list(report.products.values())
    with DATA_LOCK:
        data=load_data();target=profile_name if profile_name in data.get("profiles",{}) else data.get("active_profile","");previous_rows=data.get("profiles",{}).get(target,{}).get("saved_products",data["last_result"]) if target else data["last_result"];previous={product_key(p):p for p in previous_rows if isinstance(p,dict)}
        rich_fields=("images","images_count","short_desc","short_desc_html","long_desc","long_desc_html","variation_groups","variations","variations_text","attributes","tags","brand","category","weight","stock","detail_status","detail_extracted_at")
        for product in products:
            old=previous.get(product_key(product),{})
            for field in rich_fields:
                if product.get(field) in (None,"",[],{}) and old.get(field) not in (None,"",[],{}):product[field]=old[field]
        current={product_key(p):p for p in products}
        added_rows=[dict(p) for k,p in current.items() if k not in previous];removed_rows=[dict(p) for k,p in previous.items() if k not in current];price_rows=[];changed_rows=[];unchanged_rows=[]
        for key,product in current.items():
            if key not in previous:continue
            old=previous[key];price_changed=str(product.get("price",""))!=str(old.get("price",""));tracked=("stock","image","images","title","category","brand","weight","short_desc","long_desc","variation_groups","attributes");changed_fields=[f for f in tracked if json.dumps(product.get(f,""),ensure_ascii=False,sort_keys=True)!=json.dumps(old.get(f,""),ensure_ascii=False,sort_keys=True)];other_changed=bool(changed_fields)
            if price_changed:row=dict(product);row["previous_price"]=old.get("price","");price_rows.append(row)
            if other_changed:row=dict(product);row["changed_fields"]=changed_fields;row["previous_values"]={f:old.get(f,"") for f in changed_fields};changed_rows.append(row)
            if not price_changed and not other_changed:unchanged_rows.append(dict(product))
        comparison={"at":int(time.time()),"total":len(products),"pages":report.pages,"added":len(added_rows),"removed":len(removed_rows),"price_changed":len(price_rows),"changed":len({product_key(x) for x in price_rows+changed_rows}),"content_changed":len(changed_rows),"unchanged":len(unchanged_rows),"lists":{"added":added_rows,"removed":removed_rows,"price_changed":price_rows,"changed":changed_rows,"unchanged":unchanged_rows}}
        data["last_result"]=products
        if target:
            profile=data["profiles"][target];profile["saved_products"]=[dict(x) for x in products];profile["last_comparison"]=comparison
            summary={k:comparison[k] for k in ("at","total","pages","added","removed","price_changed","changed","content_changed","unchanged")};profile["comparison_history"]=[summary]+[x for x in profile.get("comparison_history",[]) if isinstance(x,dict)][:9]
        save_data(data)
    return {"products":products,"total":len(products),"pages":report.pages,"modes":sorted(report.modes),"logs":report.logs,"diagnostics":report.diagnostics,"comparison":comparison,"job_id":report.job_id,"profile":target}


def detail_live_worker(task_id: str, config: dict[str,Any], products: list[dict[str,Any]], pages: int) -> None:
    try:
        live_task_update(task_id,1,"آماده‌سازی استخراج تفصیلی","running",f"{len(products)} محصول؛ این وظیفه مستقل است و سرعت فهرست را کم نمی‌کند",stage="details")
        detail_config=dict(config);detail_config.update({"enrich":True,"_details_only":True,"_resume_products":[dict(x) for x in products],"_resume_pages":pages,"_live_task_id":task_id,"job_id":task_id})
        report=scrape(detail_config)
        if live_task_cancelled(task_id):live_task_update(task_id,100,"استخراج جزئیات متوقف شد","cancelled","نتایج قبلی پروفایل حفظ شدند");return
        result=scrape_result(report,clean_text(config.get("_profile_name")));live_task_update(task_id,100,"جزئیات محصولات کامل شد","completed",f"{result['diagnostics'].get('details',{}).get('completed',0)} محصول بررسی شد",result=result,done=result['total'],total=result['total'],extracted=result['total'])
    except Exception as exc:
        status="cancelled" if live_task_cancelled(task_id) else "failed";live_task_update(task_id,100,"استخراج جزئیات متوقف شد" if status=="cancelled" else "استخراج جزئیات ناموفق بود",status,str(exc),error=clean_text(exc)[:1500])


def scrape_live_worker(task_id: str, config: dict[str,Any]) -> None:
    if live_task_cancelled(task_id):live_task_update(task_id,0,"پیش از شروع متوقف شد","cancelled","درخواست توقف اجرا شد");return
    try:
        requested_details=bool(config.get("enrich",False));list_config=dict(config);list_config["enrich"]=False
        live_task_update(task_id,2,"اعتبارسنجی آدرس و تنظیمات","running","فاز سریع فهرست آغاز شد؛ جزئیات باعث انتظار این مرحله نمی‌شود",execution="parallel",stage="list");list_config.update({"job_id":task_id,"_live_task_id":task_id});report=scrape(list_config);live_task_update(task_id,94,"ذخیره سریع نتایج فهرست","running",f"{len(report.products)} محصول آماده شد",stage="save");result=scrape_result(report,clean_text(config.get("_profile_name")))
        detail_task=None
        if requested_details and result["products"]:
            profile=clean_text(config.get("_profile_name"));detail_task=live_task_create("detail_extract","استخراج خودکار جزئیات"+(f" · {profile}" if profile else ""),private=False);detail_task["profile"]=profile;LIVE_TASKS[detail_task["id"]]=detail_task;live_task_disk_write(detail_task);result["detail_task"]={"id":detail_task["id"],"status":"waiting","total":len(result["products"])}
        live_task_update(task_id,100,"فهرست با سرعت بالا استخراج شد","completed",f"{result['total']} محصول"+("؛ جزئیات در وظیفه مستقل ادامه دارد" if detail_task else ""),result=result,done=result['pages'],total=result['pages'],extracted=result['total'],eta_seconds=0)
        if detail_task:threading.Thread(target=detail_live_worker,args=(detail_task["id"],config,result["products"],result["pages"]),name="detail-live",daemon=True).start()
    except Exception as exc:
        if live_task_cancelled(task_id):live_task_update(task_id,100,"استخراج متوقف شد","cancelled","نتایج checkpoint تا آخرین صفحه حفظ شدند",error=clean_text(exc)[:1500])
        else:live_task_update(task_id,100,"استخراج ناموفق بود","failed",str(exc),error=clean_text(exc)[:1500])


@app.post("/api/scrape/start")
def api_scrape_start():
    config=request.get_json(silent=True) or {}
    try:public_http_url(str(config.get("url","")))
    except ValueError as exc:return jsonify(ok=False,error=str(exc)),400
    active=load_data().get("active_profile","");config["_profile_name"]=active;title="استخراج محصولات"+(f" · {active}" if active else "");task=live_task_create("scrape",title,private=False);task["profile"]=active;LIVE_TASKS[task["id"]]=task;live_task_disk_write(task);threading.Thread(target=scrape_live_worker,args=(task["id"],config),name="scrape-live",daemon=True).start();return jsonify(ok=True,task=task)


@app.post("/api/scrape")
def api_scrape():
    body=request.get_json(silent=True) or {}
    try:return jsonify(ok=True,**scrape_result(scrape(body)))
    except (ValueError,FetchError) as exc:return jsonify(ok=False,error=str(exc)),400
    except Exception as exc:app.logger.exception("scrape failed");return jsonify(ok=False,error=f"خطای داخلی: {exc}"),500


@app.get("/api/extract/jobs")
def extract_jobs():
    jobs = load_data().get("extract_jobs", {})
    summary = [{k: v for k, v in row.items() if k not in ("products", "config", "logs")} for row in jobs.values()]
    summary.sort(key=lambda row: int(row.get("updated_at", 0)), reverse=True)
    return jsonify(ok=True, jobs=summary)


@app.post("/api/extract/resume/<job_id>")
def extract_resume(job_id: str):
    data = load_data(); job = data.get("extract_jobs", {}).get(job_id)
    if not isinstance(job, dict):
        return jsonify(ok=False, error="نقطه ادامه پیدا نشد"), 404
    if job.get("status") == "completed":
        return jsonify(ok=True, completed=True, products=job.get("products", []), total=job.get("total", 0), job_id=job_id)
    cfg = dict(job.get("config") or {})
    cfg.update({"job_id": job_id, "_start_page": int(job.get("next_page", 1)), "_next_url": job.get("next_url", ""), "_resume_products": job.get("products", [])})
    try:
        report = scrape(cfg); products = list(report.products.values())
        data = load_data(); data["last_result"] = products; save_data(data)
        return jsonify(ok=True, products=products, total=len(products), pages=report.pages, modes=sorted(report.modes), logs=report.logs, job_id=job_id, comparison={})
    except (ValueError, FetchError) as exc:
        return jsonify(ok=False, error=str(exc)), 400


@app.delete("/api/extract/jobs/<job_id>")
def extract_job_delete(job_id: str):
    data = load_data(); data.get("extract_jobs", {}).pop(job_id, None); save_data(data)
    return jsonify(ok=True)


def read_csv_upload(upload: Any) -> tuple[list[str], list[dict[str, str]]]:
    raw = upload.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024: raise ValueError("فایل بزرگ‌تر از ۵ مگابایت است")
    text = raw.decode("utf-8-sig", errors="replace")
    try: dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|")
    except csv.Error: dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    headers = [clean_text(x) for x in (reader.fieldnames or []) if x]
    rows = [{clean_text(k): clean_text(v) for k, v in row.items() if k} for row in reader]
    return headers, rows[:MAX_PRODUCTS_HARD]


def mapped_import_products(rows: list[dict[str, str]], mapping: dict[str, str], options: dict[str, Any]) -> list[dict[str, Any]]:
    products = []
    multiplier = max(0.0, min(1000.0, float(options.get("price_multiplier", 1) or 1)))
    addition = max(-1e12, min(1e12, float(options.get("price_addition", 0) or 0)))
    prefix, suffix = clean_text(options.get("title_prefix"))[:100], clean_text(options.get("title_suffix"))[:100]
    for row in rows:
        product = {field: clean_text(row.get(column, "")) for field, column in mapping.items() if column}
        product["title"] = clean_text(" ".join(x for x in (prefix, product.get("title", ""), suffix) if x))[:300]
        if product.get("price"):
            number = woo_price(product["price"])
            product["price"] = str(max(0, round(float(number) * multiplier + addition)))
        if product.get("images"):
            product["images"] = [clean_text(x) for x in re.split(r"[|,\n]+", product["images"]) if clean_text(x)][:20]
            product["image"] = product["images"][0] if product["images"] else product.get("image", "")
        if product.get("title") or product.get("link"):
            product["key"] = product_key(product); products.append(product)
    return products


@app.post("/api/import/preview")
def import_preview():
    upload=request.files.get("file")
    if not upload: return jsonify(ok=False,error="فایل CSV ارسال نشده است"),400
    try:
        headers,rows=read_csv_upload(upload)
        return jsonify(ok=True,headers=headers,sample=rows[:5],total=len(rows))
    except ValueError as exc: return jsonify(ok=False,error=str(exc)),400


@app.post("/api/import/apply")
def import_apply():
    upload=request.files.get("file")
    if not upload: return jsonify(ok=False,error="فایل CSV ارسال نشده است"),400
    try:
        headers,rows=read_csv_upload(upload)
        mapping=json.loads(request.form.get("mapping","{}")); options=json.loads(request.form.get("options","{}"))
        if not isinstance(mapping,dict) or not isinstance(options,dict): raise ValueError("تنظیمات نگاشت نامعتبر است")
        products=mapped_import_products(rows,mapping,options)
        data=load_data()
        if options.get("mode")=="append":
            merged={product_key(x):x for x in data["last_result"] if isinstance(x,dict)}
            for product in products: merged[product_key(product)]=product
            products=list(merged.values())[:MAX_PRODUCTS_HARD]
        data["last_result"]=products;save_data(data)
        return jsonify(ok=True,products=products,total=len(products),imported=len(rows))
    except (ValueError,TypeError,json.JSONDecodeError) as exc: return jsonify(ok=False,error=str(exc)),400


@app.post("/api/settings/backup")
def settings_backup():
    if not deploy_authorized(): return deploy_auth_error()
    payload={"format":"scraper4-settings","version":APP_VERSION,"created_at":int(time.time()),"data":load_data()}
    return Response(json.dumps(payload,ensure_ascii=False,indent=2),mimetype="application/json",headers={"Content-Disposition":f'attachment; filename="scraper4-settings-{time.strftime("%Y%m%d-%H%M%S")}.json"',"Cache-Control":"no-store"})


def php_file_json(files: dict[str, Any], name: str) -> Any:
    meta=files.get(name)
    if not isinstance(meta,dict) or not meta.get("b64"):return None
    try:return json.loads(base64.b64decode(str(meta["b64"]),validate=True).decode("utf-8-sig"))
    except (ValueError,TypeError,UnicodeDecodeError,json.JSONDecodeError):return None


def convert_php_profile(row: dict[str, Any]) -> dict[str, Any]:
    selectors=row.get("selectors") if isinstance(row.get("selectors"),dict) else {}
    detail=row.get("detailSelectors") or row.get("detail_selectors") or {}
    if isinstance(detail,dict):
        detail={str(k):(str(v.get("selector",'')) if isinstance(v,dict) and v.get("enabled",True) else (str(v) if not isinstance(v,dict) else '')) for k,v in detail.items()}
    rules={"title_suffix":row.get("titleSuffix",row.get("title_suffix","")),"title_prefix":row.get("titlePrefix",row.get("title_prefix","")),"price_mode":row.get("priceMode",row.get("price_mode","none")),"price_value":row.get("priceVal",row.get("price_value",0)),"price_round":row.get("roundPrice",row.get("price_round",0)),"default_stock":row.get("stock_quantity",row.get("default_stock","")),"default_category":row.get("category",row.get("bslCategoryId","")),"bsl_category_id":row.get("bslCategoryId",0),"woo_category_id":row.get("wooCategoryId",0),"woo_price_mode":row.get("woo_price_mode","none"),"woo_price_value":row.get("woo_price_val",0),"woo_price_round":row.get("woo_price_round",0),"bsl_price_mode":row.get("bsl_price_mode",row.get("basalam_price_mode","none")),"bsl_price_value":row.get("bsl_price_val",row.get("basalam_price_val",0)),"bsl_price_round":row.get("bsl_price_round",row.get("basalam_price_round",0))}
    pag_type=str(row.get("pagType",row.get("pagination","query")));pag_map={"param":"query","query":"query","query_custom":"query","path":"path","path_pattern":"path","full_pattern":"full","full":"full","next":"next"}
    saved=[];raw_products=row.get("products",[])
    if isinstance(raw_products,dict):raw_products=list(raw_products.values())
    if isinstance(raw_products,list):
        for item in raw_products:
            product=item[1] if isinstance(item,list) and len(item)==2 and isinstance(item[1],dict) else item
            if isinstance(product,dict):saved.append(product)
    return {"url":row.get("url",row.get("list_url","")),"pages":int(row.get("pages",row.get("maxPages",1)) or 1),"render":"auto","fetch_engine":"auto","pagination":pag_map.get(pag_type,"query"),"page_value":row.get("pagVal",row.get("pageParam","page")),"scrolls":4,"enrich":bool(detail),"detail_limit":int(row.get("detailLimit",20) or 20),"selectors":selectors,"detail_selectors":detail if isinstance(detail,dict) else {},"profile_rules":rules,"saved_products":saved[:MAX_PRODUCTS_HARD]}


def convert_php_bundle(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    files=payload.get("files") if isinstance(payload.get("files"),dict) else {};data=load_data();restored=[]
    profiles=php_file_json(files,"profiles.json")
    if isinstance(profiles,dict):
        data["profiles"]={str(k):convert_php_profile(v) for k,v in profiles.items() if isinstance(v,dict)};data["active_profile"]=next(iter(data["profiles"]),"");restored.append("profiles.json")
    connections=php_file_json(files,"connections.json")
    if isinstance(connections,dict):
        woo=connections.get("woocommerce",{});bsl=connections.get("basalam",{})
        if isinstance(woo,dict):data["woocommerce"].update({"url":woo.get("store_url",woo.get("url","")),"consumer_key":woo.get("consumer_key",""),"consumer_secret":woo.get("consumer_secret","")})
        if isinstance(bsl,dict):data["basalam"].update({k:bsl[k] for k in data["basalam"] if k in bsl})
        restored.append("connections.json")
    providers=php_file_json(files,"ai_providers.json")
    if isinstance(providers,dict):
        data["ai_providers"]=providers
        first=next((v for v in providers.values() if isinstance(v,dict) and v.get("enabled",True)),None)
        if first:
            models=first.get("models",[]);model=models[0].get("id","") if models and isinstance(models[0],dict) else ""
            data["ai"].update({"provider":first.get("id",first.get("name","custom")),"endpoint":first.get("endpoint",first.get("url","")),"api_key":first.get("apiKey",first.get("api_key","")),"model":model})
        restored.append("ai_providers.json")
    return data,restored


@app.post("/api/settings/restore")
def settings_restore():
    if not deploy_authorized(): return deploy_auth_error()
    upload=request.files.get("file")
    if not upload:return jsonify(ok=False,error="فایل پشتیبان ارسال نشده است"),400
    fd,tmp=tempfile.mkstemp(prefix=".s4-restore-",suffix=".json",dir=os.path.dirname(DATA_FILE) or ".")
    try:
        with os.fdopen(fd,"wb") as fh:
            while True:
                chunk=upload.stream.read(1024*1024)
                if not chunk:break
                fh.write(chunk)
        with open(tmp,"r",encoding="utf-8-sig") as fh:
            payload=json.load(fh)
        restored=payload.get("data") if isinstance(payload,dict) else None
        if isinstance(payload,dict) and isinstance(payload.get("files"),dict):
            clean,php_restored=convert_php_bundle(payload)
            if not php_restored:raise ValueError("بسته PHP خوانده شد اما profiles.json، connections.json یا ai_providers.json معتبر نداشت")
        else:
            if payload.get("format")!="scraper4-settings" or not isinstance(restored,dict):raise ValueError("فایل تنظیمات معتبر Python یا بسته PHP نیست")
            defaults=default_data(); clean={}
            for key,default in defaults.items():clean[key]=restored.get(key,default) if isinstance(restored.get(key,default),type(default)) else default
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE,"rb") as src: atomic_write(DATA_FILE+".restore.bak",src.read())
        save_data(clean)
        return jsonify(ok=True,message="همه تنظیمات و صف‌ها بازیابی شدند")
    except (ValueError,TypeError,json.JSONDecodeError,OSError) as exc:
        return jsonify(ok=False,error=str(exc)),400
    finally:
        try:
            if os.path.exists(tmp): os.unlink(tmp)
        except OSError:
            pass


@app.route("/api/export.csv", methods=["GET", "POST"])
def api_export():
    body = request.get_json(silent=True) or {}
    products = body.get("products") if isinstance(body.get("products"), list) else load_data()["last_result"]
    return export_csv(products)


@app.get("/api/export.json")
def api_export_json():
    payload = json.dumps(load_data()["last_result"], ensure_ascii=False, indent=2)
    return Response(payload, mimetype="application/json; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="products-{time.strftime("%Y%m%d-%H%M%S")}.json"'})


@app.get("/api/export.xlsx")
def api_export_xlsx():
    return export_xlsx(load_data()["last_result"])


@app.post("/api/import.csv")
def api_import_csv():
    upload=request.files.get("file")
    if not upload:return jsonify(ok=False,error="فایل CSV ارسال نشده است"),400
    try:
        headers,rows=read_csv_upload(upload)
        aliases={"title":["title","name","عنوان","نام"],"price":["price","قیمت"],"link":["link","url","لینک"],"image":["image","تصویر"],"sku":["sku","کد"],"stock":["stock","موجودی"],"brand":["brand","برند"]}
        lowered={h.lower():h for h in headers};mapping={field:next((lowered[a] for a in names if a in lowered),"") for field,names in aliases.items()}
        products=mapped_import_products(rows,mapping,{})
        data=load_data();data["last_result"]=products;save_data(data)
        return jsonify(ok=True,products=products,total=len(products))
    except ValueError as exc:return jsonify(ok=False,error=str(exc)),400



def runtime_python_bin() -> str:
    """Find a real Python binary; under PythonAnywhere sys.executable is uWSGI."""
    candidates=[os.path.join(BASE_DIR,"venv","bin","python"),os.path.join(os.environ.get("VIRTUAL_ENV",""),"bin","python") if os.environ.get("VIRTUAL_ENV") else "",os.path.join(sys.prefix,"bin","python"),str(getattr(sys,"_base_executable","")),shutil.which("python3") or ""]
    return next((os.path.abspath(x) for x in candidates if x and os.path.isfile(x) and os.access(x,os.X_OK) and "uwsgi" not in os.path.basename(os.path.realpath(x)).lower()),"")


def basalam_sdk_status() -> dict[str,Any]:
    try:return {"installed":True,"version":importlib.metadata.version("basalam-sdk"),"python":runtime_python_bin(),"uwsgi":os.path.basename(sys.executable).lower().startswith("uwsgi")}
    except importlib.metadata.PackageNotFoundError:return {"installed":False,"version":"","python":runtime_python_bin(),"uwsgi":os.path.basename(sys.executable).lower().startswith("uwsgi")}


def ensure_basalam_sdk(progress: Optional[Any]=None) -> bool:
    """Install the official SDK, with PyPI/GitHub fallbacks and progress events."""
    if basalam_sdk_status()["installed"]:
        if progress:progress(100,"SDK از قبل نصب است","نسخه نصب‌شده شناسایی شد")
        return False
    if not DEPENDENCY_LOCK.acquire(blocking=False):raise ValueError("نصب SDK باسلام هم‌اکنون در درخواست دیگری در حال اجراست؛ چند لحظه بعد دوباره تست کنید")
    try:
        if basalam_sdk_status()["installed"]:return False
        python_bin=runtime_python_bin()
        if not python_bin:raise ValueError("مفسر Python واقعی پیدا نشد؛ مسیر uWSGI برای نصب قابل استفاده نیست")
        app_venv=os.path.abspath(os.path.join(BASE_DIR,"venv"));inside_app_venv=os.path.commonpath([app_venv,os.path.abspath(python_bin)])==app_venv
        base_cmd=[python_bin,"-m","pip","install","--disable-pip-version-check","--no-cache-dir"]
        if not inside_app_venv:
            os.makedirs(LOCAL_DEPS_DIR,mode=0o700,exist_ok=True);base_cmd.extend(["--target",LOCAL_DEPS_DIR])
        attempts=[("PyPI تنظیم‌شده",["basalam-sdk"]),("PyPI رسمی",["--index-url","https://pypi.org/simple","basalam-sdk"]),("GitHub رسمی",["https://github.com/basalam/python-sdk/archive/refs/heads/main.zip"])]
        details=[]
        for index,(label,args) in enumerate(attempts):
            if progress:progress(12+index*25,f"تلاش از {label}",f"مفسر واقعی: {python_bin}")
            result=subprocess.run([*base_cmd,*args],capture_output=True,text=True,timeout=240,env={**os.environ,"PIP_NO_CACHE_DIR":"1"})
            if os.path.isdir(LOCAL_DEPS_DIR):site.addsitedir(LOCAL_DEPS_DIR)
            importlib.invalidate_caches();output=clean_text((result.stderr or result.stdout)[-900:])
            if result.returncode==0 and basalam_sdk_status()["installed"]:
                if progress:progress(100,"نصب SDK کامل شد",f"منبع موفق: {label} · نسخه {basalam_sdk_status()['version']}")
                return True
            details.append(label+": "+output)
            if progress:progress(28+index*25,f"{label} ناموفق بود",output[-350:])
        raise ValueError("هر سه مسیر نصب SDK ناموفق بود: "+" | ".join(details))
    except subprocess.TimeoutExpired as exc:raise ValueError("نصب خودکار SDK باسلام بیشتر از ۴ دقیقه طول کشید؛ دوباره تلاش کنید") from exc
    finally:DEPENDENCY_LOCK.release()


def probe_gateway_authorization() -> dict[str,Any]:
    """Use a disposable canary, never a real token, to prove relay header forwarding."""
    canary="Scraper4-Auth-Probe-"+secrets.token_hex(5)
    try:
        response=outbound_request("GET","https://httpbin.org/anything",headers={"Authorization":"Bearer "+canary,"User-Agent":"Scraper4-Gateway-Probe"},timeout=25)
        payload=response.json() if response.ok else {};headers=payload.get("headers",{}) if isinstance(payload,dict) else {};received=next((clean_text(v) for k,v in headers.items() if str(k).lower()=="authorization"),"")
        return {"tested":True,"forwarded":hmac.compare_digest(received,"Bearer "+canary),"status":response.status_code,"transport":getattr(response,"scraper4_transport","gateway")}
    except Exception as exc:return {"tested":False,"forwarded":False,"error":clean_text(exc)[:400],"transport":outbound_mode()}


def normalize_basalam_token(value: Any) -> str:
    """Accept a raw Personal Token or a copied Authorization header, never Bearer Bearer."""
    token=str(value or "").strip().strip('"\'').strip()
    token=re.sub(r"^Authorization\s*:\s*", "", token, flags=re.I).strip()
    token=re.sub(r"^(?:(?:Bearer|Token)\s+)+", "", token, flags=re.I).strip().strip('"\'').strip()
    token=re.sub(r"\s+", "", token)
    if not token or token.lower() in {"bearer","token","null","none"}:raise ValueError("Personal Token باسلام خالی یا نامعتبر است؛ فقط متن خود توکن را وارد کنید")
    return token


def basalam_api_request(method: str, path: str, *, params: Optional[dict[str,Any]]=None, json_data: Any=None, data: Any=None, files: Any=None) -> Any:
    """Direct SalamAPI REST client routed exclusively by the global connection gateway."""
    cfg=basalam_active_cfg();token=normalize_basalam_token(cfg.get("token"));base=public_http_url(clean_text(cfg.get("api_base_url")) or "https://openapi.basalam.com").rstrip("/");target=base+"/"+path.lstrip("/");headers={"Authorization":"Bearer "+token,"Accept":"application/json","User-Agent":"Scraper4-REST/"+APP_VERSION}
    try:response=outbound_request(method,target,params=params,headers=headers,json=json_data,data=data,files=files,timeout=60)
    except requests.RequestException as exc:raise FetchError(f"REST API باسلام از دروازه مرکزی قابل دسترسی نیست: {exc}") from exc
    transport=getattr(response,"scraper4_transport","gateway")
    if not response.ok:
        body=clean_text(response.text)[:700];hint=""
        if transport=="relay" and response.status_code in {401,403}:
            probe=probe_gateway_authorization()
            if probe.get("tested") and not probe.get("forwarded"):hint="؛ تشخیص قطعی: Worker مرکزی Authorization را عبور نمی‌دهد. توکن واقعی آزمایش نشد؛ مسیر مستقیم یا HTTP Proxy سازگار را در تنظیمات مرکزی انتخاب کنید"
            elif probe.get("forwarded"):hint="؛ Worker هدر آزمایشی را درست عبور داد؛ توکن منقضی، نامعتبر یا فاقد scope لازم است"
            else:hint="؛ آزمون مستقل عبور Authorization نیز از این مسیر قابل انجام نبود"
        raise FetchError(f"Basalam REST {transport} HTTP {response.status_code}: {body}{hint}")
    try:return response.json()
    except ValueError:raise FetchError("REST API باسلام پاسخ JSON معتبر برنگرداند")


def basalam_strategy(sdk_call: Any, api_call: Any) -> tuple[Any,str]:
    mode=clean_text(load_data().get("basalam",{}).get("client_mode","auto")) or "auto";errors=[]
    network_mode=outbound_mode(load_data().get("network",{}))
    if mode=="sdk" and network_mode=="http":raise FetchError("SDK رسمی از HTTP CONNECT Proxy مرکزی پشتیبانی نمی‌کند؛ روش مدیریت باسلام را روی خودکار یا REST API قرار دهید")
    if mode in {"auto","sdk"} and network_mode!="http":
        try:return sdk_call(),"sdk"
        except Exception as exc:
            errors.append("SDK: "+clean_text(exc)[:600])
            if mode=="sdk":raise
    try:return api_call(),"api"
    except Exception as exc:
        errors.append("REST API: "+clean_text(exc)[:700]);raise FetchError(" | ".join(errors)) from exc


def basalam_api_rows(payload: Any) -> list[dict[str,Any]]:
    if isinstance(payload,list):return [x for x in payload if isinstance(x,dict)]
    if isinstance(payload,dict):
        for key in ("data","items","results","chats","messages","parcels","products"):
            value=payload.get(key)
            if isinstance(value,list):return [x for x in value if isinstance(x,dict)]
            if isinstance(value,dict):
                nested=basalam_api_rows(value)
                if nested:return nested
    return []


def rewind_upload_files(files: Any) -> None:
    if not files:return
    values=files.values() if isinstance(files,dict) else files if isinstance(files,(list,tuple)) else [files]
    for value in values:
        candidate=value[-1] if isinstance(value,tuple) and value else value
        if isinstance(candidate,(list,tuple,dict)):rewind_upload_files(candidate)
        elif hasattr(candidate,"seek"):
            try:candidate.seek(0)
            except (OSError,ValueError):pass


def install_basalam_relay_transport() -> None:
    """Teach the official SDK to send its synchronous calls through our URL relay."""
    from basalam_sdk.base_client import BaseClient
    if getattr(BaseClient.request_sync,"_scraper4_relay",False):return
    original=BaseClient.request_sync
    def request_sync(self,method,path,params=None,data=None,json_data=None,files=None,headers=None,response_model=None,require_auth=True):
        relay=clean_text(getattr(self.config,"scraper4_relay_url",""))
        if not relay:return original(self,method,path,params,data,json_data,files,headers,response_model,require_auth)
        target=urljoin(self.base_url,path)
        if params:target=requests.Request("GET",target,params=params).prepare().url
        request_headers=self.config.get_headers().copy()
        if require_auth:request_headers.update(self.auth.get_auth_headers_sync())
        if headers:request_headers.update(headers)
        authorization=clean_text(request_headers.get("Authorization"))
        if authorization:
            raw=normalize_basalam_token(authorization);authorization="Bearer "+raw;request_headers["Authorization"]=authorization
            # New dedicated Workers can map this explicit control header; old Workers simply ignore it.
            request_headers["X-Proxy-Authorization"]=authorization;request_headers["X-Upstream-Authorization"]=authorization;request_headers["X-Target-Authorization"]=authorization;request_headers["X-Authorization"]=authorization
        request_headers["X-Proxy-UA"]=request_headers.get("User-Agent",USER_AGENT);request_headers["X-Proxy-Method"]=method.upper();worker_key=clean_text(getattr(self.config,"scraper4_worker_key",""))
        if worker_key:request_headers["X-Proxy-Key"]=worker_key
        response=outbound_request(method,target,headers=request_headers,data=data,json=json_data,files=files,timeout=float(self.config.timeout))
        if not response.ok:
            body=clean_text(response.text)[:700];hint="؛ دروازه مرکزی هدر احراز هویت را عبور نداده است" if response.status_code==401 and "authorization" in body.lower() else ""
            raise ValueError(f"Basalam SDK relay HTTP {response.status_code}: {body}{hint}")
        setattr(self.config,"scraper4_last_transport","relay");return self._parse_response_data(response,response_model)
    request_sync._scraper4_relay=True;BaseClient.request_sync=request_sync


def basalam_client():
    cfg=basalam_active_cfg();token=normalize_basalam_token(cfg.get("token",""));refresh=str(cfg.get("refresh_token","")).strip()
    ensure_basalam_sdk()
    try:
        from basalam_sdk import BasalamClient, PersonalToken
        from basalam_sdk.config import BasalamConfig
    except ImportError as exc:raise ValueError("SDK نصب شد اما فرآیند وب هنوز آن را نمی‌بیند؛ یک بار دیگر تست اتصال را بزنید") from exc
    sdk_cfg=BasalamConfig(timeout=45,user_agent="Scraper4/"+APP_VERSION);network=load_data().get("network",{});mode=outbound_mode(network);relay=clean_text(network.get("proxy"))
    if mode=="relay" and relay:
        install_basalam_relay_transport();sdk_cfg.scraper4_relay_url=relay;sdk_cfg.scraper4_worker_key=clean_text(network.get("worker_key"))
    return BasalamClient(auth=PersonalToken(token=token,refresh_token=refresh,config=sdk_cfg),config=sdk_cfg)


def basalam_photo_files(product: dict[str,Any]) -> list[io.BytesIO]:
    urls=list(product.get("images",[])) if isinstance(product.get("images"),list) else []
    if product.get("image") and product["image"] not in urls:urls.insert(0,product["image"])
    files=[]
    for index,url in enumerate(urls[:5]):
        try:
            public_http_url(url);response=outbound_request("GET",url,headers={"User-Agent":USER_AGENT},timeout=30)
            if not response.ok or len(response.content)>10*1024*1024:continue
            stream=io.BytesIO(response.content);ext=os.path.splitext(urlparse(url).path)[1].lower()
            stream.name=f"product-{index}{ext if ext in {'.jpg','.jpeg','.png','.webp'} else '.jpg'}";files.append(stream)
        except Exception:continue
    return files


def basalam_status_value(cfg: dict[str,Any]) -> int:
    """Basalam ProductStatusInputEnum.PUBLISHED = 2976 (docs sample status=1 is stale)."""
    raw = cfg.get("status") if isinstance(cfg, dict) else None
    if raw in (None, "", 0, "0"):
        return 2976
    try:
        return int(raw)
    except (TypeError, ValueError):
        return {"published": 2976, "publish": 2976, "draft": 3790, "unpublished": 3790}.get(str(raw).lower(), 2976)


def basalam_weight_fields(product: dict[str,Any], cfg: dict[str,Any]) -> tuple[float, int]:
    weight = float(re.sub(r"[^0-9.]", "", clean_text(product.get("weight"))) or cfg.get("weight", 500) or 500)
    pkg = int(cfg.get("package_weight", 0) or 0) or max(1, int(weight) + 100)
    return weight, pkg


def basalam_price_rial(product: dict[str, Any]) -> int:
    """Basalam primary_price is Rial. Scraped/Woo prices are Toman unless price_unit is rial."""
    raw = product.get("price") or product.get("final_price") or product.get("source_price") or "0"
    amount = int(woo_price(raw) or 0)
    unit = clean_text(product.get("price_unit")).lower()
    if unit in {"rial", "irr", "ریال"}:
        return max(0, amount)
    return max(0, amount * 10)


def basalam_product_kwargs(product: dict[str,Any], cfg: dict[str,Any], category: int, sku: str) -> dict[str,Any]:
    weight, pkg = basalam_weight_fields(product, cfg)
    kw: dict[str, Any] = {
        "name": clean_text(product.get("title"))[:250],
        "brief": clean_text(product.get("short_desc"))[:600],
        "description": clean_text(product.get("long_desc"))[:10000],
        "category_id": category,
        "preparation_days": max(1, int(cfg.get("preparation_days", 3))),
        "weight": weight,
        "package_weight": pkg,
        "primary_price": basalam_price_rial(product),
        "stock": int(re.sub(r"\D", "", clean_text(product.get("stock"))) or cfg.get("stock", 10)),
        "sku": sku or None,
        "status": basalam_status_value(cfg),
        "is_wholesale": False,
    }
    try:
        from basalam_sdk.core.models import ProductStatusInputEnum
        kw["status"] = ProductStatusInputEnum(int(kw["status"]))
    except Exception:
        pass
    return kw


def basalam_rest_payload(product: dict[str,Any], cfg: dict[str,Any], category: int, sku: str) -> dict[str,Any]:
    kw = basalam_product_kwargs(product, cfg, category, sku)
    if hasattr(kw.get("status"), "value"):
        kw["status"] = int(kw["status"].value)
    payload = {k: v for k, v in kw.items() if v is not None}
    if sku:
        payload["sku"] = sku
    return payload


def basalam_send_one_sdk(product: dict[str,Any]) -> dict[str,Any]:
    ensure_basalam_sdk()
    from basalam_sdk.core.models import ProductRequestSchema, GetVendorProductsSchema
    cfg=basalam_active_cfg();vendor=int(cfg.get("vendor_id",0));category=int(product.get("basalam_category_id") or cfg.get("category_id",0))
    if not vendor or not category:raise ValueError("شناسه غرفه و دسته‌بندی پیش‌فرض باسلام لازم است")
    client=basalam_client();sku=clean_text(product.get("sku"));can_update=bool(cfg.get("update_existing",True) or product.get("_force_destination_update"));existing_id=int(product.get("_destination_id") or 0) if can_update else 0
    if can_update and not existing_id and sku:
        found=client.get_vendor_products_sync(vendor,GetVendorProductsSchema(skus=[sku],per_page=10));existing=next((x for x in (found.data or []) if clean_text(getattr(x,"sku",""))==sku),None);existing_id=int(getattr(existing,"id",0) or 0) if existing else 0
    kw=basalam_product_kwargs(product,cfg,category,sku)
    try:
        req=ProductRequestSchema(**kw)
    except TypeError:
        kw.pop("status", None)
        req=ProductRequestSchema(**kw)
    photos=basalam_photo_files(product)
    try:
        result=client.update_product_sync(existing_id,req,photo_files=photos or None) if existing_id else client.create_product_sync(vendor,req,photo_files=photos or None)
        return {"source":product.get("title"),"id":getattr(result,"id",None),"action":"updated" if existing_id else "created","photos":len(photos)}
    except Exception as exc:
        text=clean_text(exc);response=getattr(exc,"response",None);status=getattr(response,"status_code",0);body=""
        if response is not None:
            try:body=clean_text(response.text)[:800]
            except Exception:pass
        if status==403 or "403" in text:
            mode=clean_text(cfg.get("api_mode","relay"));scope="ایجاد/ویرایش محصول"+(" و بارگذاری تصویر" if photos else "")
            raise ValueError(f"باسلام دسترسی {scope} را با 403 رد کرد. مسیر={mode}؛ شناسه غرفه={vendor}؛ دسته={category}. اگر تست اتصال موفق است، Personal Token مجوز مدیریت محصول/آپلود این غرفه را ندارد. پاسخ: {body or text}") from exc
        raise
    finally:
        for photo in photos:
            try: photo.close()
            except Exception: pass


def basalam_send_one_api(product: dict[str,Any]) -> dict[str,Any]:
    cfg=basalam_active_cfg();vendor=int(cfg.get("vendor_id",0));category=int(product.get("basalam_category_id") or cfg.get("category_id",0));sku=clean_text(product.get("sku"))
    if not vendor or not category:raise ValueError("شناسه غرفه و دسته‌بندی پیش‌فرض باسلام لازم است")
    can_update=bool(cfg.get("update_existing",True) or product.get("_force_destination_update"));existing_id=int(product.get("_destination_id") or 0) if can_update else 0
    existing=None
    if can_update and not existing_id and sku:
        rows=basalam_api_rows(basalam_api_request("GET",f"/v1/vendors/{vendor}/products",params={"skus":sku,"per_page":10}))
        existing=next((x for x in rows if clean_text(x.get("sku"))==sku),None)
    photos=basalam_photo_files(product);photo_ids=[]
    try:
        for photo in photos:
            upload=basalam_api_request("POST","/v1/files",data={"file_type":"product.photo"},files={"file":(getattr(photo,"name","product.jpg"),photo,"image/jpeg")});file_data=upload.get("data",upload) if isinstance(upload,dict) else {};file_id=file_data.get("id") if isinstance(file_data,dict) else None
            if file_id:photo_ids.append(int(file_id))
        payload=basalam_rest_payload(product,cfg,category,sku)
        if photo_ids:payload.update(photo=photo_ids[0],photos=photo_ids[1:] or None)
        if not existing_id:existing_id=int((existing or {}).get("id",0))
        result=basalam_api_request("PATCH" if existing_id else "POST",f"/v1/products/{existing_id}" if existing_id else f"/v1/vendors/{vendor}/products",json_data=payload);row=result.get("data",result) if isinstance(result,dict) else {}
        return {"source":product.get("title"),"id":row.get("id") if isinstance(row,dict) else None,"action":"updated" if existing_id else "created","photos":len(photo_ids),"client":"rest-api"}
    finally:
        for photo in photos:
            try:photo.close()
            except Exception:pass



_BSL_TLS = threading.local()


def basalam_active_cfg() -> dict[str, Any]:
    ov = getattr(_BSL_TLS, "cfg", None)
    if isinstance(ov, dict) and ov:
        return ov
    return load_data().get("basalam") or {}


class _BasalamCfgCtx:
    def __init__(self, cfg: dict[str, Any]):
        self.cfg = cfg
        self.prev = None
    def __enter__(self):
        self.prev = getattr(_BSL_TLS, "cfg", None)
        _BSL_TLS.cfg = self.cfg
        return self.cfg
    def __exit__(self, *exc):
        _BSL_TLS.cfg = self.prev


def basalam_use_cfg(cfg: dict[str, Any]) -> _BasalamCfgCtx:
    return _BasalamCfgCtx(cfg)


def bsl_merge_vendors(old_rows: list, incoming: list) -> list[dict[str, Any]]:
    old_by_vid: dict[int, dict[str, Any]] = {}
    for row in old_rows or []:
        if not isinstance(row, dict):
            continue
        vid = int(row.get("vendor_id") or 0)
        if vid > 0:
            old_by_vid[vid] = row
    out: list[dict[str, Any]] = []
    seen: set[int] = set()
    for row in incoming or []:
        if not isinstance(row, dict):
            continue
        vid = int(row.get("vendor_id") or 0)
        tok = str(row.get("token") or "").strip()
        if tok.startswith("••••"):
            tok = str((old_by_vid.get(vid) or {}).get("token") or "").strip()
        if vid <= 0 or not tok:
            continue
        if vid in seen:
            continue
        seen.add(vid)
        out.append({
            "vendor_id": vid,
            "token": tok,
            "shop_name": clean_text(row.get("shop_name") or row.get("name") or f"غرفه {vid}"),
            "name": clean_text(row.get("name") or ""),
            "price_mode": str(row.get("price_mode") or "none"),
            "price_val": float(row.get("price_val") or 0),
        })
    return out


def bsl_all_shops(cfg: Optional[dict[str, Any]] = None, selected_vids: Any = None) -> list[dict[str, Any]]:
    cfg = cfg if isinstance(cfg, dict) else (load_data().get("basalam") or {})
    out: list[dict[str, Any]] = []
    tok = str(cfg.get("token") or "").strip()
    vid = int(cfg.get("vendor_id") or 0)
    if tok and not tok.startswith("••••") and vid > 0:
        out.append({
            "vendor_id": vid,
            "token": tok,
            "shop_name": clean_text(cfg.get("shop_name") or "غرفهٔ پیش‌فرض") or "غرفهٔ پیش‌فرض",
            "is_default": True,
            "price_mode": str(cfg.get("price_mode") or "none"),
            "price_val": float(cfg.get("price_val") or 0),
        })
    for row in cfg.get("vendors") or []:
        if not isinstance(row, dict):
            continue
        vid2 = int(row.get("vendor_id") or 0)
        tok2 = str(row.get("token") or "").strip()
        if vid2 <= 0 or not tok2 or tok2.startswith("••••"):
            continue
        if any(s["vendor_id"] == vid2 for s in out):
            continue
        out.append({
            "vendor_id": vid2,
            "token": tok2,
            "shop_name": clean_text(row.get("shop_name") or row.get("name") or f"غرفه {vid2}") or f"غرفه {vid2}",
            "is_default": False,
            "price_mode": str(row.get("price_mode") or "none"),
            "price_val": float(row.get("price_val") or 0),
        })
    if selected_vids not in (None, "", []):
        want = set()
        for x in selected_vids if isinstance(selected_vids, (list, tuple)) else [selected_vids]:
            try:
                want.add(int(x))
            except (TypeError, ValueError):
                continue
        if want:
            out = [s for s in out if s["vendor_id"] in want]
    return out


def bsl_apply_shop_price(product: dict[str, Any], shop: Optional[dict[str, Any]]) -> dict[str, Any]:
    p = dict(product or {})
    if not shop:
        return p
    mode = str(shop.get("price_mode") or "none")
    if mode in ("", "none"):
        return p
    raw = p.get("price") or p.get("final_price") or p.get("sale_price") or p.get("regular_price") or "0"
    digits = "".join(ch for ch in str(raw) if ch.isdigit())
    base = int(digits or "0")
    val = float(shop.get("price_val") or 0)
    if mode == "percent":
        base = int(round(base * (1 + val / 100.0)))
    elif mode == "multiplier":
        base = int(round(base * val)) if val else base
    elif mode in ("amount", "add"):
        base = int(base + val)
    if base > 0:
        p["price"] = str(base)
        p["final_price"] = str(base)
    return p


def basalam_send_one(product: dict[str, Any], shop: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    cfg = dict(load_data().get("basalam") or {})
    item = dict(product or {})
    if shop:
        if int(shop.get("vendor_id") or 0) > 0:
            cfg["vendor_id"] = int(shop["vendor_id"])
        if shop.get("token") and not str(shop.get("token")).startswith("••••"):
            cfg["token"] = shop["token"]
        item = bsl_apply_shop_price(item, shop)
    with basalam_use_cfg(cfg):
        result, client = basalam_strategy(lambda: basalam_send_one_sdk(item), lambda: basalam_send_one_api(item))
    if isinstance(result, dict):
        result["client"] = client
        result["vendor_id"] = int(cfg.get("vendor_id") or 0)
        result["shop_name"] = clean_text((shop or {}).get("shop_name") or cfg.get("shop_name") or "")
        result["is_default"] = bool((shop or {}).get("is_default", shop is None))
    return result


def basalam_send_to_shops(product: dict[str, Any], shops: list[dict[str, Any]], mode: str = "sequential") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not shops:
        return out
    mode = "parallel" if str(mode).strip().lower() in {"parallel", "simultaneous", "همزمان"} else "sequential"

    def _one(sh: dict[str, Any]) -> dict[str, Any]:
        try:
            row = basalam_send_one(product, sh)
            if not isinstance(row, dict):
                row = {"ok": True}
            else:
                row = {"ok": True, **row}
            return row
        except Exception as exc:
            return {"ok": False, "error": clean_text(exc)[:400], "vendor_id": int(sh.get("vendor_id") or 0), "shop_name": clean_text(sh.get("shop_name") or ""), "source": product.get("title")}

    if mode == "parallel" and len(shops) > 1:
        with ThreadPoolExecutor(max_workers=min(4, len(shops))) as pool:
            futs = [pool.submit(_one, sh) for sh in shops]
            for fut in futs:
                out.append(fut.result())
        return out
    for sh in shops:
        out.append(_one(sh))
    return out


def basalam_fanout_send(product: dict[str, Any], selected_vids: Any = None) -> dict[str, Any]:
    cfg = load_data().get("basalam") or {}
    shops = bsl_all_shops(cfg, selected_vids=selected_vids)
    if not shops:
        raise ValueError("هیچ غرفهٔ فعالی با توکن و شناسه تنظیم نشده")
    if selected_vids in (None, "", []) and not bool(cfg.get("send_all_shops", True)):
        shops = [s for s in shops if s.get("is_default")] or shops[:1]
    mode = str(cfg.get("send_mode") or "parallel")
    rows = basalam_send_to_shops(product, shops, mode)
    ok_rows = [r for r in rows if r.get("ok")]
    if not ok_rows:
        err = (rows[0].get("error") if rows else "") or "ارسال به غرفه‌های باسلام ناموفق بود"
        raise ValueError(err)
    primary = next((r for r in ok_rows if r.get("is_default")), ok_rows[0])
    out = dict(primary)
    out["shops"] = rows
    out["shop_ok"] = len(ok_rows)
    out["shop_fail"] = len(rows) - len(ok_rows)
    return out




@app.get("/api/basalam/config")
def api_basalam_config():
    if not deploy_authorized():return deploy_auth_error()
    cfg=dict(load_data().get("basalam",{}))
    for k in ("token","refresh_token","worker_key"):
        if cfg.get(k):cfg[k]="••••"+str(cfg[k])[-4:]
    masked=[]
    for row in cfg.get("vendors") or []:
        if not isinstance(row,dict):
            continue
        item=dict(row)
        if item.get("token"):item["token"]="••••"+str(item["token"])[-4:]
        masked.append(item)
    cfg["vendors"]=masked
    cfg["shop_count"]=len(bsl_all_shops())
    return jsonify(ok=True,basalam=cfg,sdk=basalam_sdk_status())


@app.post("/api/basalam/settings")
def api_basalam_settings():
    if not deploy_authorized():return deploy_auth_error()
    incoming=(request.get_json(silent=True) or {}).get("basalam",{});data=load_data();cfg=data.setdefault("basalam",default_data()["basalam"])
    if not isinstance(incoming, dict):
        incoming = {}
    if isinstance(incoming.get("vendors"), list):
        cfg["vendors"]=bsl_merge_vendors(cfg.get("vendors") or [], incoming.get("vendors") or [])
    for k,v in incoming.items():
        if k=="vendors":
            continue
        if k in {"send_all_shops"}:
            cfg[k]=bool(v)
            continue
        if k in {"send_mode"}:
            cfg[k]="sequential" if str(v).strip().lower() in {"sequential","ترتیبی","seq"} else "parallel"
            continue
        if k in cfg and not (k in {"token","refresh_token","worker_key"} and str(v).startswith("••••")):cfg[k]=v
        elif k in default_data()["basalam"]:
            cfg[k]=v
    save_data(data);return jsonify(ok=True)


def basalam_install_worker(task_id: str) -> None:
    def progress(value: int, step: str, detail: str="") -> None:live_task_update(task_id,value,step,"running",detail)
    try:
        live_task_update(task_id,5,"بررسی محیط Python","running",f"uWSGI={sys.executable} · Python={runtime_python_bin()}")
        installed=ensure_basalam_sdk(progress);live_task_update(task_id,100,"SDK رسمی باسلام آماده است","completed","نصب تازه انجام شد" if installed else "نسخه موجود معتبر بود",sdk=basalam_sdk_status())
    except Exception as exc:live_task_update(task_id,100,"نصب SDK ناموفق بود","failed",str(exc),error=clean_text(exc)[:1800],sdk=basalam_sdk_status())


@app.post("/api/basalam/sdk/install/start")
def api_basalam_sdk_install_start():
    if not deploy_authorized():return deploy_auth_error()
    task=live_task_create("basalam_sdk","نصب SDK رسمی باسلام");threading.Thread(target=basalam_install_worker,args=(task["id"],),name="basalam-sdk-install",daemon=True).start();return jsonify(ok=True,task=task)


@app.post("/api/basalam/sdk/install")
def api_basalam_sdk_install():
    if not deploy_authorized():return deploy_auth_error()
    try:
        installed=ensure_basalam_sdk();return jsonify(ok=True,installed_now=installed,sdk=basalam_sdk_status(),message="SDK رسمی باسلام نصب و آماده است" if installed else "SDK رسمی باسلام از قبل آماده بود")
    except Exception as exc:return jsonify(ok=False,error=str(exc),stage="install",sdk=basalam_sdk_status()),400


@app.post("/api/basalam/test")
def api_basalam_test():
    if not deploy_authorized():return deploy_auth_error()
    try:
        was_missing=not basalam_sdk_status()["installed"]
        body=request.get_json(silent=True) or {}
        cfg=dict(load_data().get("basalam") or {})
        probe=clean_text(body.get("token"))
        persist=True
        vid=int(body.get("vendor_id") or 0)
        if probe.startswith("••••") or (not probe and vid>0 and vid!=int(cfg.get("vendor_id") or 0)):
            persist=False
            found=""
            if vid and vid==int(cfg.get("vendor_id") or 0):
                found=str(cfg.get("token") or "")
            for row in cfg.get("vendors") or []:
                if isinstance(row,dict) and int(row.get("vendor_id") or 0)==vid:
                    found=str(row.get("token") or "");break
            if not found:
                return jsonify(ok=False,error="توکن این غرفه ذخیره نشده؛ توکن کامل را وارد کنید"),400
            cfg["token"]=found
            if vid>0: cfg["vendor_id"]=vid
        elif probe:
            cfg["token"]=probe
            persist=False
            if vid>0: cfg["vendor_id"]=vid
        with basalam_use_cfg(cfg):
            result,client=basalam_strategy(lambda:basalam_client().get_current_user_sync(),lambda:basalam_api_request("GET","/v1/users/me"))
        raw=result.model_dump() if hasattr(result,"model_dump") else result.get("data",result) if isinstance(result,dict) else {};user_name=clean_text(raw.get("name") or raw.get("title") or raw.get("id") or "connected") if isinstance(raw,dict) else "connected"
        vendor_id=0;vendor_title=""
        if isinstance(raw,dict):
            vendor_id=int(raw.get("vendor_id") or raw.get("id") or cfg.get("vendor_id") or 0)
            vendor_title=clean_text(raw.get("vendor_title") or raw.get("title") or user_name)
        sdk=basalam_sdk_status()
        if persist:
            data=load_data();data["basalam"].update(last_test_at=int(time.time()),last_test_user=user_name,last_client=client);save_data(data)
        return jsonify(ok=True,user=user_name,client=client,sdk=sdk,installed_now=was_missing and sdk["installed"],vendor_id=vendor_id,vendor_title=vendor_title)
    except Exception as exc:
        text=clean_text(exc);sdk=basalam_sdk_status();mode=clean_text(load_data().get("basalam",{}).get("client_mode","auto"));return jsonify(ok=False,error=text,detail=text[:1200],stage="connection",client_mode=mode,sdk=sdk),400


@app.get("/api/basalam/products")
def api_basalam_products():
    if not deploy_authorized():return deploy_auth_error()
    try:
        cfg=load_data().get("basalam",{});vendor=int(cfg.get("vendor_id",0))
        if not vendor:raise ValueError("شناسه غرفه باسلام تنظیم نشده است")
        def sdk_products():
            ensure_basalam_sdk();from basalam_sdk.core.models import GetVendorProductsSchema
            return basalam_client().get_vendor_products_sync(vendor,GetVendorProductsSchema(page=1,per_page=20))
        result,client=basalam_strategy(sdk_products,lambda:basalam_api_request("GET",f"/v1/vendors/{vendor}/products",params={"page":1,"per_page":20}));source=getattr(result,"data",None) or basalam_api_rows(result);rows=[]
        for product in source:
            row=product if isinstance(product,dict) else product.model_dump() if hasattr(product,"model_dump") else {};rows.append({"id":row.get("id"),"name":clean_text(row.get("name") or row.get("title")),"sku":clean_text(row.get("sku")),"price":row.get("primary_price",row.get("price")),"stock":row.get("stock"),"status":clean_text(row.get("status"))})
        return jsonify(ok=True,products=rows,total=len(rows),client=client,sdk=basalam_sdk_status())
    except Exception as exc:return jsonify(ok=False,error=str(exc)),400


@app.get("/api/basalam/vendor")
def api_basalam_vendor():
    if not deploy_authorized():return deploy_auth_error()
    try:
        cfg=load_data().get("basalam",{});vendor_id=int(cfg.get("vendor_id",0))
        if not vendor_id:raise ValueError("شناسه غرفه باسلام تنظیم نشده است")
        vendor,client=basalam_strategy(lambda:basalam_client().get_vendor_sync(vendor_id,prefer="return=representation"),lambda:basalam_api_request("GET",f"/v1/vendors/{vendor_id}"));raw=vendor.model_dump() if hasattr(vendor,"model_dump") else vendor.get("data",vendor) if isinstance(vendor,dict) else {}
        def pick(*names):
            for name in names:
                value=raw.get(name) if isinstance(raw,dict) else None
                if value not in (None,""):return value
            return ""
        public={"id":pick("id"),"title":clean_text(pick("title","name")),"identifier":clean_text(pick("identifier","slug")),"status":clean_text(pick("status")),"city":clean_text(pick("city_name","city")),"score":pick("score","rating"),"url":clean_text(pick("url"))}
        return jsonify(ok=True,vendor=public,client=client,sdk=basalam_sdk_status())
    except Exception as exc:return jsonify(ok=False,error=str(exc)),400


BASALAM_CATEGORY_CACHE={"at":0.0,"rows":[]}


def basalam_flat_categories(value: Any, trail: str="") -> list[dict[str,Any]]:
    if hasattr(value,"model_dump"):value=value.model_dump()
    out=[]
    if isinstance(value,list):
        for item in value:out.extend(basalam_flat_categories(item,trail))
    elif isinstance(value,dict):
        title=clean_text(value.get("title") or value.get("name"));cid=value.get("id")
        here=(trail+" ← "+title).strip(" ←") if title else trail
        if cid is not None and title:out.append({"id":cid,"name":title,"path":here})
        for key,item in value.items():
            if key not in {"id","title","name","description","icon","photo","image","url","slug"}:out.extend(basalam_flat_categories(item,here))
    return out


@app.get("/api/basalam/categories")
def api_basalam_categories():
    if not deploy_authorized():return deploy_auth_error()
    try:
        query=clean_text(request.args.get("q")).lower()
        if not BASALAM_CATEGORY_CACHE["rows"] or time.time()-BASALAM_CATEGORY_CACHE["at"]>3600:
            payload,client=basalam_strategy(lambda:basalam_client().get_categories_sync(),lambda:basalam_api_request("GET","/v1/categories"));rows=basalam_flat_categories(payload);unique={str(x["id"]):x for x in rows};BASALAM_CATEGORY_CACHE.update(at=time.time(),rows=list(unique.values()))
        rows=BASALAM_CATEGORY_CACHE["rows"]
        if query:rows=[x for x in rows if query in (clean_text(x["path"])+" "+str(x["id"])).lower()]
        return jsonify(ok=True,categories=rows[:80],total=len(rows),cached_at=int(BASALAM_CATEGORY_CACHE["at"]))
    except Exception as exc:return jsonify(ok=False,error=str(exc)),400


@app.get("/api/basalam/operations")
def api_basalam_operations():
    if not deploy_authorized():return deploy_auth_error()
    results={};checks={"chats":("/v1/chats",{"limit":20,"order_by":"updated_at"}),"unseen":("/v1/chats/unseen-count",None),"orders":("/v1/vendor-parcels",{"per_page":20})}
    for key,(path,params) in checks.items():
        try:
            payload=basalam_api_request("GET",path,params=params);results[key]=payload;results[key+"_count"]=len(basalam_api_rows(payload)) if key!="unseen" else payload.get("data",payload) if isinstance(payload,dict) else payload
        except Exception as exc:results[key+"_error"]=clean_text(exc)[:700]
    successes=sum(1 for key in checks if key in results)
    return jsonify(ok=successes>0,successes=successes,**results)


@app.get("/api/basalam/chats/<int:chat_id>/messages")
def api_basalam_chat_messages(chat_id: int):
    if not deploy_authorized():return deploy_auth_error()
    try:
        payload=basalam_api_request("GET",f"/v1/chats/{chat_id}/messages",params={"limit":50});return jsonify(ok=True,messages=basalam_api_rows(payload),raw=payload if not basalam_api_rows(payload) else None)
    except Exception as exc:return jsonify(ok=False,error=str(exc)),400


@app.post("/api/basalam/chats/<int:chat_id>/messages")
def api_basalam_chat_send(chat_id: int):
    if not deploy_authorized():return deploy_auth_error()
    text=clean_text((request.get_json(silent=True) or {}).get("text"))
    if not text:return jsonify(ok=False,error="متن پیام خالی است"),400
    try:
        payload={"chat_id":chat_id,"content":{"text":text},"message_type":"text","temp_id":int(time.time()*1000)};result=basalam_api_request("POST",f"/v1/chats/{chat_id}/messages",json_data=payload);return jsonify(ok=True,message=result)
    except Exception as exc:return jsonify(ok=False,error=str(exc)),400


def basalam_job_public(job: dict[str,Any]) -> dict[str,Any]:
    out={k:v for k,v in job.items() if k not in {"products","results"}};out["results"]=job.get("results",[])[-20:];return out


@app.get("/api/basalam/jobs")
def api_basalam_jobs():
    if not deploy_authorized():return deploy_auth_error()
    rows=[basalam_job_public(x) for x in load_data().get("bsl_jobs",{}).values()];rows.sort(key=lambda x:int(x.get("updated_at",0)),reverse=True);return jsonify(ok=True,jobs=rows[:DEST_QUEUE_KEEP])


@app.post("/api/basalam/jobs")
def api_basalam_job_create():
    if not deploy_authorized():return deploy_auth_error()
    body=request.get_json(silent=True) or {};data=load_data();products=body.get("products") if isinstance(body.get("products"),list) else data.get("last_result",[]);products=[dict(x) for x in products[:MAX_PRODUCTS_HARD] if isinstance(x,dict)]
    if not products:return jsonify(ok=False,error="محصولی برای صف باسلام وجود ندارد"),400
    jid="bsl-"+time.strftime("%Y%m%d-%H%M%S")+"-"+secrets.token_hex(2);now=int(time.time());vids=body.get("vendor_ids") if isinstance(body.get("vendor_ids"),list) else [];job={"id":jid,"status":"waiting","created_at":now,"updated_at":now,"cursor":0,"total":len(products),"sent":0,"updated":0,"failed":0,"products":products,"results":[],"vendor_ids":[int(x) for x in vids if str(x).lstrip("-").isdigit()]}
    jobs=data.setdefault("bsl_jobs",{});jobs[jid]=job
    for old in sorted(jobs,key=lambda x:int(jobs[x].get("updated_at",0)))[:-DEST_QUEUE_KEEP]:jobs.pop(old,None)
    save_data(data);start_bsl_drain(jid);return jsonify(ok=True,job=basalam_job_public(job),draining=True)


@app.post("/api/basalam/jobs/<job_id>/process")
def api_basalam_job_process(job_id: str):
    if not deploy_authorized():return deploy_auth_error()
    body=request.get_json(silent=True) or {}
    drain=bool(body.get("drain", VPS_MODE))
    batch_cap=MAX_PRODUCTS_HARD if VPS_MODE else 5
    batch=max(1,min(batch_cap,int(body.get("batch", 50 if VPS_MODE else 3))))
    data=load_data();job=data.get("bsl_jobs",{}).get(job_id)
    if not job:return jsonify(ok=False,error="صف باسلام پیدا نشد"),404
    if drain:
        start_bsl_drain(job_id)
        return jsonify(ok=True,processed=0,draining=True,job=basalam_job_public(job))
    job["status"]="running";processed=0
    while job["cursor"]<job["total"] and processed<batch:
        product=job["products"][job["cursor"]]
        try:
            result=basalam_fanout_send(product, selected_vids=job.get("vendor_ids"));job["results"].append({"ok":True,**result});job["sent"]+=1
            if result.get("action")=="updated":job["updated"]+=1
        except Exception as exc:job["failed"]+=1;job["results"].append({"ok":False,"source":product.get("title"),"error":clean_text(exc)[:500]})
        job["cursor"]+=1;processed+=1;job["updated_at"]=int(time.time());save_data(data)
    if job["cursor"]>=job["total"]:job["status"]="completed"
    save_data(data);return jsonify(ok=True,processed=processed,job=basalam_job_public(job))


@app.delete("/api/basalam/jobs/<job_id>")
def api_basalam_job_delete(job_id: str):
    if not deploy_authorized():return deploy_auth_error()
    data=load_data();data.get("bsl_jobs",{}).pop(job_id,None);save_data(data);return jsonify(ok=True)


@app.post("/api/basalam/send")
def api_basalam_send():
    if not deploy_authorized():return deploy_auth_error()
    body=request.get_json(silent=True) or {};limit=max(1,min(MAX_PRODUCTS_HARD if VPS_MODE else 5,int(body.get("limit",MAX_PRODUCTS_HARD if VPS_MODE else 3))));data=load_data();sent=[];failed=[]
    for product in data.get("last_result",[])[:limit]:
        try:sent.append(basalam_fanout_send(product, selected_vids=body.get("vendor_ids")))
        except Exception as exc:failed.append({"title":product.get("title"),"error":str(exc)[:400]})
    return jsonify(ok=not failed,sent=sent,failed=failed)


def destination_remote_rows(destination: str) -> list[dict[str,Any]]:
    """Fetch a bounded destination catalogue through the configured central route."""
    rows=[]
    if destination=="woocommerce":
        for page in range(1,REMOTE_CATALOG_PAGES+1):
            batch=woo_request("GET",f"products?per_page=100&page={page}").json()
            if not isinstance(batch,list):break
            rows.extend(x for x in batch if isinstance(x,dict))
            if len(batch)<100:break
        return rows
    if destination!="basalam":raise ValueError("مقصد نامعتبر است")
    vendor=int(load_data().get("basalam",{}).get("vendor_id",0))
    if not vendor:raise ValueError("شناسه غرفه باسلام تنظیم نشده است")
    for page in range(1,REMOTE_CATALOG_PAGES+1):
        payload=basalam_api_request("GET",f"/v1/vendors/{vendor}/products",params={"per_page":100,"page":page})
        batch=basalam_api_rows(payload);rows.extend(batch)
        if len(batch)<100:break
    return rows


def remote_product_view(row: dict[str,Any], destination: str) -> dict[str,Any]:
    title=clean_text(row.get("name") or row.get("title"));raw_price=(row.get("regular_price") or row.get("price")) if destination=="woocommerce" else (row.get("primary_price") or row.get("price"))
    if isinstance(raw_price,dict):raw_price=raw_price.get("amount") or raw_price.get("value") or raw_price.get("price")
    price_text=woo_price(raw_price) if raw_price not in (None,"") else ""
    return {"id":row.get("id"),"sku":clean_text(row.get("sku")),"title":title,"price":int(price_text) if price_text else None,"status":clean_text(row.get("status") or row.get("state"))}


def build_destination_report(profile_name: str, destination: str, profile: dict[str,Any], remote_rows: list[dict[str,Any]]) -> dict[str,Any]:
    local=[x for x in profile.get("saved_products",[]) if isinstance(x,dict)];rules=profile.get("profile_rules",{}) if isinstance(profile.get("profile_rules"),dict) else {};ledger=(profile.get("remote_map",{}).get(destination,{}) if isinstance(profile.get("remote_map"),dict) else {})
    remote=[remote_product_view(x,destination) for x in remote_rows];by_id={str(x["id"]):x for x in remote if x.get("id") not in (None,"")};by_sku={x["sku"].lower():x for x in remote if x["sku"]};by_title={x["title"].lower():x for x in remote if x["title"]};used=set();lists={"same":[],"mismatch":[],"missing":[]};learned={}
    for source in local:
        key=product_identity_key(source);mapped=ledger.get(key,{}) if isinstance(ledger,dict) else {};sku=clean_text(source.get("sku")).lower();title=clean_text(source.get("title") or source.get("name"));found=by_id.get(str(mapped.get("id"))) if isinstance(mapped,dict) and mapped.get("id") not in (None,"") else None
        match="id" if found else ""
        if not found and sku:found=by_sku.get(sku);match="sku" if found else ""
        if not found and title:found=by_title.get(title.lower());match="title" if found else ""
        expected=product_for_destination(source,rules,destination);item={"key":key,"title":title,"sku":clean_text(source.get("sku")),"expected_price":int(woo_price(expected.get("price")) or 0),"match":match}
        if not found:lists["missing"].append(item);continue
        used.add(str(found.get("id")));item.update(remote_id=found.get("id"),remote_title=found.get("title"),remote_price=found.get("price"),remote_status=found.get("status"));diff=[]
        if item["expected_price"] and found.get("price") is not None and item["expected_price"]!=found["price"]:diff.append("price")
        if title and found.get("title") and title.lower()!=found["title"].lower():diff.append("title")
        item["differences"]=diff;lists["mismatch" if diff else "same"].append(item);learned[key]={"id":found.get("id"),"sku":item["sku"],"title":title,"updated_at":int(time.time())}
    extra=[x for x in remote if str(x.get("id")) not in used];counts={k:len(v) for k,v in lists.items()};counts["extra"]=len(extra)
    return {"profile":profile_name,"destination":destination,"created_at":int(time.time()),"local_total":len(local),"remote_total":len(remote),"counts":counts,"lists":{**{k:v[:300] for k,v in lists.items()},"extra":extra[:300]},"learned":learned}


def destination_reconcile_worker(task_id: str, profile_name: str, destination: str) -> None:
    label="ووکامرس" if destination=="woocommerce" else "باسلام"
    try:
        live_task_update(task_id,5,f"دریافت محصولات {label}","running",f"مغایرت‌گیری پروفایل {profile_name}",profile=profile_name,destination=destination)
        data=load_data();profile=data.get("profiles",{}).get(profile_name)
        if not isinstance(profile,dict):raise ValueError("پروفایل پیدا نشد")
        remote=destination_remote_rows(destination);live_task_update(task_id,55,"تطبیق محصولات","running",f"{len(remote)} محصول مقصد دریافت شد")
        report=build_destination_report(profile_name,destination,profile,remote)
        with DATA_LOCK:
            data=load_data();stored=data.get("profiles",{}).get(profile_name)
            if not isinstance(stored,dict):raise ValueError("پروفایل هنگام ذخیره گزارش پیدا نشد")
            stored.setdefault("remote_map",{}).setdefault(destination,{}).update(report.pop("learned",{}));stored.setdefault("destination_reports",{})[destination]=report;save_data(data)
        c=report["counts"];live_task_update(task_id,100,"مغایرت‌گیری کامل شد","completed",f"یکسان {c['same']} · مغایرت {c['mismatch']} · در مقصد نیست {c['missing']} · اضافی {c['extra']}",profile=profile_name,destination=destination,report=report,done=report["local_total"],total=report["local_total"])
    except Exception as exc:live_task_update(task_id,100,"مغایرت‌گیری ناموفق بود","failed",str(exc),profile=profile_name,destination=destination,error=clean_text(exc)[:1500])


def profile_dispatch_worker(task_id: str, profile_name: str, products: list[dict[str,Any]], destinations: list[str], woo_status: str, woo_update: bool, profile_rules: dict[str,Any], force_update: bool=False) -> None:
    """Send every saved product for one profile, checkpointing after each destination item."""
    started=time.time();total=max(1,len(products)*len(destinations));done=sent=failed=0;counts={x:{"sent":0,"failed":0} for x in destinations}
    try:
        live_task_update(task_id,1,"آماده‌سازی ارسال کامل پروفایل","running",f"پروفایل {profile_name} · {len(products)} محصول · مقصد: {'، '.join(destinations)}",profile=profile_name,total=total,done=0,sent=0,failed=0,destinations=counts,stage="sync")
        for destination in destinations:
            label="ووکامرس" if destination=="woocommerce" else "باسلام"
            live_task_update(task_id,max(1,int(done/total*100)),f"شروع ارسال به {label}","running",f"{len(products)} محصول این پروفایل برای {label} بررسی می‌شود",stage="sync-woo" if destination=="woocommerce" else "sync-basalam")
            for index,product in enumerate(products,1):
                if live_task_cancelled(task_id):
                    elapsed=max(1,int(time.time()-started));live_task_update(task_id,int(done/total*100),"ارسال توسط کاربر متوقف شد","cancelled",f"پس از {done} عملیات و {elapsed} ثانیه متوقف شد",done=done,total=total,sent=sent,failed=failed,destinations=counts,elapsed_seconds=elapsed);return
                title=clean_text(product.get("title") or product.get("name") or f"محصول {index}")
                try:
                    destination_product=product_for_destination(product,profile_rules,destination);known_id=destination_identity_id(profile_name,destination,product)
                    if known_id:destination_product["_destination_id"]=known_id
                    if force_update:destination_product["_force_destination_update"]=True;destination_product["_preserve_destination_status"]=True
                    if destination=="woocommerce":result=woo_send_one(destination_product,woo_status,woo_update or force_update)
                    else:result=basalam_fanout_send(destination_product)
                    if isinstance(result,dict):record_destination_identity(profile_name,destination,product,result)
                    sent+=1;counts[destination]["sent"]+=1;message=f"✓ {label} · {index}/{len(products)} · {title}"
                    if isinstance(result,dict) and result.get("action"):message+=f" · {result['action']}"
                    if isinstance(result,dict) and int(result.get("shop_ok") or 0)>1:message+=f" · {int(result.get('shop_ok') or 0)} غرفه"
                except Exception as exc:
                    failed+=1;counts[destination]["failed"]+=1;message=f"✕ {label} · {index}/{len(products)} · {title} · {clean_text(exc)[:350]}"
                done+=1;elapsed=max(.001,time.time()-started);rate=done/elapsed;remaining=int((total-done)/rate) if rate else 0
                live_task_update(task_id,max(2,int(done/total*100)),f"{label}: محصول {index} از {len(products)}","running",message,profile=profile_name,done=done,total=total,sent=sent,failed=failed,destinations=counts,elapsed_seconds=int(elapsed),eta_seconds=remaining,current_product=title)
        status="completed";step="ارسال کامل پروفایل پایان یافت";detail=f"{sent} عملیات موفق و {failed} خطا در {int(time.time()-started)} ثانیه"
        live_task_update(task_id,100,step,status,detail,profile=profile_name,done=done,total=total,sent=sent,failed=failed,destinations=counts,elapsed_seconds=int(time.time()-started),eta_seconds=0)
    except Exception as exc:
        live_task_update(task_id,max(1,int(done/total*100)),"ارسال کامل پروفایل ناموفق بود","failed",str(exc),profile=profile_name,done=done,total=total,sent=sent,failed=failed,error=clean_text(exc)[:1500],destinations=counts)


def start_profile_dispatch(profile_name: str, body: dict[str,Any]) -> dict[str,Any]:
    data=load_data();profile=data.get("profiles",{}).get(profile_name)
    if not isinstance(profile,dict):raise ValueError(f"پروفایل «{profile_name}» پیدا نشد")
    products=[dict(x) for x in profile.get("saved_products",[])[:MAX_PRODUCTS_HARD] if isinstance(x,dict)]
    if not products:raise ValueError(f"پروفایل «{profile_name}» محصول ذخیره‌شده ندارد؛ ابتدا آن را استخراج کنید")
    requested=body.get("destinations",["woocommerce","basalam"]);destinations=[x for x in ("woocommerce","basalam") if x in requested]
    if not destinations:raise ValueError("حداقل یک مقصد انتخاب کنید")
    task=live_task_create("profile_dispatch",f"ارسال کامل پروفایل «{profile_name}»",private=True)
    task.update(profile=profile_name,total=len(products)*len(destinations),done=0,sent=0,failed=0,destinations={x:{"sent":0,"failed":0} for x in destinations});live_task_disk_write(task)
    threading.Thread(target=profile_dispatch_worker,args=(task["id"],profile_name,products,destinations,str(body.get("woo_status","draft")),bool(body.get("woo_update",True)),profile.get("profile_rules",{}) if isinstance(profile.get("profile_rules"),dict) else {}),name="profile-dispatch",daemon=True).start()
    return task


@app.post("/api/destinations/reconcile/<destination>/<path:profile_name>")
def api_destination_reconcile(destination: str, profile_name: str):
    if not deploy_authorized():return deploy_auth_error()
    if destination not in {"woocommerce","basalam"}:return jsonify(ok=False,error="مقصد نامعتبر است"),400
    profile=load_data().get("profiles",{}).get(profile_name)
    if not isinstance(profile,dict):return jsonify(ok=False,error="پروفایل پیدا نشد"),404
    task=live_task_create("destination_reconcile",f"مغایرت‌گیری {profile_name} · "+("ووکامرس" if destination=="woocommerce" else "باسلام"),private=True);task.update(profile=profile_name,destination=destination);live_task_disk_write(task)
    threading.Thread(target=destination_reconcile_worker,args=(task["id"],profile_name,destination),name="destination-reconcile",daemon=True).start();return jsonify(ok=True,task=task)


def start_destination_repair(profile_name: str, destination: str, scope: str) -> dict[str,Any]:
    if destination not in {"woocommerce","basalam"}:raise ValueError("مقصد نامعتبر است")
    if scope not in {"missing","mismatch"}:raise ValueError("گروه ترمیم نامعتبر است")
    data=load_data();profile=data.get("profiles",{}).get(profile_name)
    if not isinstance(profile,dict):raise ValueError("پروفایل پیدا نشد")
    report=(profile.get("destination_reports",{}).get(destination,{}) if isinstance(profile.get("destination_reports"),dict) else {});rows=(report.get("lists",{}).get(scope,[]) if isinstance(report,dict) else [])
    keys={clean_text(x.get("key")) for x in rows if isinstance(x,dict) and clean_text(x.get("key"))};products=[dict(x) for x in profile.get("saved_products",[]) if isinstance(x,dict) and product_identity_key(x) in keys]
    if not products:raise ValueError("در آخرین گزارش، محصولی برای این عملیات وجود ندارد؛ ابتدا مغایرت‌گیری را اجرا کنید")
    label="ووکامرس" if destination=="woocommerce" else "باسلام";action="ارسال محصولات جامانده" if scope=="missing" else "ترمیم مغایرت‌ها"
    task=live_task_create("destination_repair",f"{action} · {profile_name} · {label}",private=True);task.update(profile=profile_name,destination=destination,repair_scope=scope,total=len(products),done=0,sent=0,failed=0,destinations={destination:{"sent":0,"failed":0}});live_task_disk_write(task)
    rules=profile.get("profile_rules",{}) if isinstance(profile.get("profile_rules"),dict) else {}
    threading.Thread(target=profile_dispatch_worker,args=(task["id"],profile_name,products,[destination],"draft",True,rules,True),name="destination-repair",daemon=True).start();return task


@app.post("/api/destinations/repair/<destination>/<scope>/<path:profile_name>")
def api_destination_repair(destination: str, scope: str, profile_name: str):
    if not deploy_authorized():return deploy_auth_error()
    try:return jsonify(ok=True,task=start_destination_repair(profile_name,destination,scope))
    except ValueError as exc:return jsonify(ok=False,error=str(exc)),400


@app.get("/api/destinations/report/<destination>/<path:profile_name>")
def api_destination_report(destination: str, profile_name: str):
    if not deploy_authorized():return deploy_auth_error()
    profile=load_data().get("profiles",{}).get(profile_name)
    if not isinstance(profile,dict):return jsonify(ok=False,error="پروفایل پیدا نشد"),404
    report=(profile.get("destination_reports",{}).get(destination,{}) if isinstance(profile.get("destination_reports"),dict) else {})
    return jsonify(ok=True,report=report)


@app.post("/api/dispatch/profile/<path:profile_name>")
def api_profile_dispatch(profile_name: str):
    if not deploy_authorized():return deploy_auth_error()
    try:return jsonify(ok=True,task=start_profile_dispatch(profile_name,request.get_json(silent=True) or {}))
    except ValueError as exc:return jsonify(ok=False,error=str(exc)),400


@app.post("/api/dispatch/profiles")
def api_profiles_dispatch():
    if not deploy_authorized():return deploy_auth_error()
    body=request.get_json(silent=True) or {};data=load_data();names=body.get("profiles")
    if not isinstance(names,list) or not names:names=list(data.get("profiles",{}))
    tasks=[];errors=[]
    for name in names:
        try:tasks.append(start_profile_dispatch(clean_text(name),body))
        except ValueError as exc:errors.append(str(exc))
    if not tasks:return jsonify(ok=False,error="؛ ".join(errors) or "پروفایل قابل ارسالی وجود ندارد"),400
    return jsonify(ok=True,tasks=tasks,errors=errors)


@app.post("/api/woo/test")
def woo_test():
    if not deploy_authorized():return deploy_auth_error()
    try:
        response = woo_request("GET", "system_status")
        return jsonify(ok=True, status=response.json())
    except (ValueError, FetchError, requests.RequestException) as exc:
        return jsonify(ok=False, error=str(exc)), 400


@app.post("/api/woo/queue")
def woo_queue_create():
    if not deploy_authorized():return deploy_auth_error()
    body = request.get_json(silent=True) or {}
    products = body.get("products") if isinstance(body.get("products"), list) else load_data()["last_result"]
    products = [p for p in products[:MAX_PRODUCTS_HARD] if isinstance(p, dict)]
    if not products: return jsonify(ok=False, error="محصولی برای ارسال وجود ندارد"), 400
    job_id = "woo-" + time.strftime("%Y%m%d-%H%M%S") + "-" + hashlib.sha1(str(time.time_ns()).encode()).hexdigest()[:5]
    job = {"id": job_id, "status": "pending", "created_at": int(time.time()), "updated_at": int(time.time()), "cursor": 0, "total": len(products), "sent": 0, "failed": 0, "status_value": str(body.get("status", "draft")), "update_existing": bool(body.get("update_existing", True)), "products": products, "results": []}
    data = load_data(); jobs = data.setdefault("woo_jobs", {}); jobs[job_id] = job
    if len(jobs) > DEST_QUEUE_KEEP:
        for key in sorted(jobs, key=lambda x: int(jobs[x].get("updated_at", 0)))[:-DEST_QUEUE_KEEP]: jobs.pop(key, None)
    save_data(data)
    start_woo_drain(job_id)
    return jsonify(ok=True, job={k:v for k,v in job.items() if k not in ("products","results")}, draining=True)


@app.get("/api/woo/jobs")
def woo_jobs_list():
    if not deploy_authorized():return deploy_auth_error()
    jobs = load_data().get("woo_jobs", {})
    rows = [{k:v for k,v in job.items() if k not in ("products","results")} for job in jobs.values()]
    rows.sort(key=lambda x: int(x.get("updated_at", 0)), reverse=True)
    return jsonify(ok=True, jobs=rows)


@app.post("/api/woo/process/<job_id>")
def woo_queue_process(job_id: str):
    if not deploy_authorized():return deploy_auth_error()
    body = request.get_json(silent=True) or {}
    drain = bool(body.get("drain", VPS_MODE))
    batch_cap = MAX_PRODUCTS_HARD if VPS_MODE else 25
    batch = max(1, min(batch_cap, int(body.get("batch", 50 if VPS_MODE else 10))))
    data = load_data(); job = data.get("woo_jobs", {}).get(job_id)
    if not isinstance(job, dict): return jsonify(ok=False, error="صف ووکامرس پیدا نشد"), 404
    if drain:
        start_woo_drain(job_id)
        public = {k:v for k,v in job.items() if k not in ("products","results")}
        return jsonify(ok=True, job=public, draining=True, recent=[])
    products = job.get("products", []); cursor = int(job.get("cursor", 0)); job["status"] = "running"
    for index in range(cursor, min(len(products), cursor + batch)):
        try:
            result = woo_send_one(products[index], str(job.get("status_value", "draft")), bool(job.get("update_existing", True)))
            job["sent"] = int(job.get("sent", 0)) + 1
        except Exception as exc:
            result = {"source": products[index].get("title"), "error": str(exc)}
            job["failed"] = int(job.get("failed", 0)) + 1
        job.setdefault("results", []).append(result); job["cursor"] = index + 1; job["updated_at"] = int(time.time())
        save_data(data)  # PHP-style atomic per-product checkpoint
    job["status"] = "completed" if int(job.get("cursor", 0)) >= len(products) else "pending"
    save_data(data)
    public = {k:v for k,v in job.items() if k not in ("products","results")}
    return jsonify(ok=True, job=public, recent=job.get("results", [])[-batch:])


@app.delete("/api/woo/jobs/<job_id>")
def woo_job_delete(job_id: str):
    if not deploy_authorized():return deploy_auth_error()
    data=load_data(); data.get("woo_jobs", {}).pop(job_id, None); save_data(data); return jsonify(ok=True)


@app.post("/api/woo/send")
def woo_send():
    if not deploy_authorized():return deploy_auth_error()
    """Backward-compatible one-request sender, now using Phase 3 upsert logic."""
    body=request.get_json(silent=True) or {}; products=body.get("products") if isinstance(body.get("products"),list) else load_data()["last_result"]
    sent=[];failed=[]
    for product in products[:max(1,min(MAX_PRODUCTS_HARD if VPS_MODE else 25,int(body.get("limit",MAX_PRODUCTS_HARD if VPS_MODE else 20))))]:
        try: sent.append(woo_send_one(product,str(body.get("status","draft")),bool(body.get("update_existing",True))))
        except Exception as exc: failed.append({"source":product.get("title"),"error":str(exc)})
    return jsonify(ok=not failed,sent=sent,failed=failed)


# ---------------------------------------------------------------------------
# Inline interface (keeps deployment genuinely single-file)
# ---------------------------------------------------------------------------
INDEX_HTML = r'''<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="theme-color" content="#07111f">
<title>اسکرپر</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
<style>
:root{--bg:#07111f;--bg2:#0a1830;--card:rgba(15,28,48,.82);--card2:#13243d;--line:rgba(148,177,216,.16);--text:#f4f8ff;--muted:#9db0ca;--blue:#38bdf8;--blue2:#2563eb;--green:#34d399;--red:#fb7185;--amber:#fbbf24;--shadow:0 18px 55px rgba(0,0,0,.28);--radius:20px;--font-scale:1}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-height:100vh;background:radial-gradient(circle at 85% -10%,rgba(37,99,235,.28),transparent 34%),radial-gradient(circle at 5% 18%,rgba(14,165,233,.13),transparent 26%),linear-gradient(155deg,var(--bg),var(--bg2));background-attachment:fixed;color:var(--text);font-family:Tahoma,"Segoe UI",Arial,sans-serif;font-size:14px;line-height:1.55}body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.22;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:34px 34px}.wrap{position:relative;max-width:1200px;margin:auto;padding:28px 22px 70px}.hero{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px;padding:24px 26px;border:1px solid var(--line);border-radius:26px;background:linear-gradient(125deg,rgba(15,38,68,.92),rgba(16,31,53,.76));box-shadow:var(--shadow);overflow:hidden;position:relative}.hero:after{content:"";position:absolute;width:220px;height:220px;border-radius:50%;left:-70px;top:-110px;background:rgba(56,189,248,.11);filter:blur(2px)}.hero-main{display:flex;align-items:center;gap:16px;position:relative;z-index:1}.logo{width:58px;height:58px;display:grid;place-items:center;flex:none;border-radius:18px;font-size:29px;background:linear-gradient(145deg,#0ea5e9,#2563eb);box-shadow:0 10px 28px rgba(37,99,235,.34)}.eyebrow{font-size:10px;letter-spacing:.8px;color:#75d5ff;margin-bottom:2px}h1{font-size:clamp(21px,4vw,30px);margin:0;letter-spacing:-.5px}h1 small{font-size:10px;font-weight:500;color:#7f96b4;background:#09182c;border:1px solid var(--line);padding:3px 7px;border-radius:20px;vertical-align:middle}.sub{color:var(--muted);margin:5px 0 0}.hero-badge{position:relative;z-index:1;white-space:nowrap;padding:8px 13px;border-radius:999px;border:1px solid rgba(52,211,153,.25);background:rgba(52,211,153,.09);color:#8af0c9;font-size:12px}.hero-badge:before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-left:7px;box-shadow:0 0 10px var(--green)}
.app-footer{height:74px}.tabs{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:min(100%,1200px);z-index:20;display:flex;gap:7px;margin:0;padding:7px;border:1px solid var(--line);border-radius:16px;background:rgba(7,17,31,.82);backdrop-filter:blur(16px);box-shadow:0 8px 28px rgba(0,0,0,.2);overflow-x:auto;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}.tabs button{flex:1;min-width:max-content;background:transparent;border:1px solid transparent;color:var(--muted);box-shadow:none;display:flex;align-items:center;justify-content:center;gap:7px}.tabs button i{font-style:normal;font-size:17px;line-height:1}.tabs button.on{color:white;border-color:rgba(56,189,248,.23);background:linear-gradient(135deg,rgba(14,165,233,.22),rgba(37,99,235,.2))}.pane{display:none;animation:rise .28s ease}.pane.on{display:block}@keyframes rise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}.card{background:var(--card);backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:var(--radius);padding:20px;margin-bottom:14px;box-shadow:var(--shadow)}.card h3{margin:0;font-size:18px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}.grid4{grid-template-columns:repeat(4,minmax(0,1fr))}.wide{grid-column:1/-1}label{display:block;color:#b9c8dc;font-size:12px;font-weight:600;margin:0 2px 6px}input,select,textarea,button{font-family:inherit;font-size:16px;touch-action:manipulation;border-radius:12px;border:1px solid var(--line);padding:11px 13px;background:rgba(5,14,27,.72);color:var(--text);width:100%;outline:none;transition:.2s ease}input:hover,select:hover,textarea:hover{border-color:rgba(56,189,248,.3)}input:focus,select:focus,textarea:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(56,189,248,.12);background:#081426}input::placeholder{color:#627895}select{cursor:pointer}button{width:auto;min-height:42px;cursor:pointer;background:linear-gradient(135deg,#0284c7,#2563eb);border-color:rgba(125,211,252,.28);font-weight:700;box-shadow:0 7px 18px rgba(37,99,235,.16)}button:hover{filter:brightness(1.1);transform:translateY(-1px)}button:active{transform:translateY(0)}button:disabled{opacity:.62;cursor:wait;transform:none}button.gray{background:#17263d;border-color:#33465f;box-shadow:none}button.green{background:linear-gradient(135deg,#059669,#047857);border-color:#34d399}.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:17px}.primary-actions{margin:0 0 14px;padding:12px;border:1px solid var(--line);border-radius:16px;background:rgba(10,23,42,.8);box-shadow:var(--shadow)}details.advanced summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;list-style:none}details.advanced summary::-webkit-details-marker{display:none}details.advanced summary small{display:block;color:var(--muted);font-weight:400;margin-top:2px}details.advanced summary>i{font-style:normal;font-size:22px;color:var(--blue);transition:.2s}details.advanced[open] summary>i{transform:rotate(180deg)}.advanced-body{padding-top:15px}.advanced-body>.note{margin-bottom:14px}.section-mini{font-size:14px!important;margin:18px 0 10px!important;color:#8edfff}.file-btn{display:inline-flex!important;align-items:center;justify-content:center;margin:0!important;padding:10px 13px;border:1px solid #33465f;border-radius:12px;background:#17263d;color:white!important;cursor:pointer;font-weight:700}.file-btn input{display:none}.note{padding:12px 14px;border-radius:13px;border:1px solid rgba(56,189,248,.12);background:rgba(19,42,70,.68);color:#bfd0e5;line-height:1.85}.status{white-space:pre-wrap;line-height:1.9;color:#b9cae0;border-right:3px solid var(--blue);min-height:58px}.error{color:var(--red)}.ok{color:var(--green)}code{direction:ltr;display:inline-block;color:#a5e4ff;background:#061426;border-radius:6px;padding:1px 5px}table{width:100%;border-collapse:separate;border-spacing:0;direction:rtl}th,td{padding:11px 10px;border-bottom:1px solid var(--line);text-align:right;vertical-align:middle}th{color:#96ddfb;position:sticky;top:0;background:#112139;z-index:2;font-size:12px}tbody tr{transition:.2s}tbody tr:hover{background:rgba(56,189,248,.045)}td img{width:62px;height:62px;object-fit:contain;background:#fff;border-radius:12px;padding:3px;box-shadow:0 4px 14px #0004}.tablebox{max-height:620px;overflow:auto;padding:0;border-radius:var(--radius)}a{color:#78d7ff;text-decoration:none}a:hover{text-decoration:underline}.badge{display:inline-block;padding:4px 8px;border:1px solid #36516f;border-radius:12px;color:#b6d6ef;margin:3px}.empty{padding:42px 14px!important;text-align:center!important;color:var(--muted)}.spinner{display:inline-block;width:16px;height:16px;border:2px solid #fff5;border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:-3px;margin-left:7px}@keyframes spin{to{transform:rotate(360deg)}}
.engine-roadmap{display:flex;align-items:center;justify-content:center;gap:7px;padding:10px!important;border:1px dashed #38bdf855;border-radius:12px;background:#061426}.engine-roadmap span{padding:4px 7px;border-radius:8px;background:#172a46;color:#bdeaff;font-size:10px}.engine-roadmap i{font-style:normal;color:#34d399}.anti-bot-hint{border-color:#fbbf2444;background:#42200633}@media(max-width:640px){.engine-roadmap{flex-wrap:wrap}.engine-roadmap i{transform:rotate(-90deg)}}
.gateway-card{border-color:#22d3ee55;background:linear-gradient(145deg,rgba(8,47,73,.93),rgba(15,28,48,.94))}.gateway-flow{display:flex;align-items:center;justify-content:center;gap:10px;margin:4px 0 16px;padding:12px;border:1px solid #38bdf833;border-radius:14px;background:#061426}.gateway-flow i{font-style:normal;color:#38bdf8}.gateway-flow strong{padding:6px 10px;border-radius:10px;background:#164e63;color:#cffafe}.gateway-services{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:14px}.gateway-services span{padding:8px;text-align:center;border:1px solid var(--line);border-radius:10px;background:#081528;color:#c8ddf3;font-size:11px}@media(max-width:640px){.gateway-services{grid-template-columns:repeat(2,1fr)}.gateway-flow{font-size:11px;gap:6px}}
.settings-panel{width:460px}.settings-panel-body>.admin-section>.card{border-radius:16px;padding:16px}.settings-panel-body>.admin-section>.card:before{content:"";display:block;width:42px;height:3px;border-radius:9px;background:linear-gradient(90deg,var(--blue),var(--green));margin-bottom:13px}.grid>div{padding:2px}.operations-card{background:linear-gradient(145deg,rgba(10,34,55,.94),rgba(20,27,51,.92))}.operation-columns{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.operation-columns h4{color:#8edfff;margin:0 0 8px}.operation-list{display:grid;gap:7px;max-height:320px;overflow:auto}.operation-item{padding:10px;border:1px solid var(--line);border-radius:12px;background:#081528;cursor:pointer;transition:.2s}.operation-item:hover{border-color:#38bdf866;transform:translateY(-1px)}.operation-item small{display:block;color:var(--muted);margin-top:3px}.chat-panel{margin-top:14px;border:1px solid #38bdf844;border-radius:15px;background:#071321;padding:12px}.message-list{display:flex;flex-direction:column;gap:7px;max-height:350px;overflow:auto;padding:8px}.message{max-width:88%;padding:9px 11px;border-radius:13px;background:#172a46;color:#dcecff}.message:nth-child(even){align-self:flex-end;background:#0f513d}.message small{display:block;color:#91a9c5;font-size:9px}.chat-compose{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:8px}.chat-compose button{height:100%}@media(max-width:640px){.operation-columns{grid-template-columns:1fr}.settings-panel{width:100%;max-width:100vw}.chat-compose{grid-template-columns:1fr}.operation-list{max-height:240px}}
.result-hero{display:flex;align-items:center;justify-content:space-between;gap:12px;background:linear-gradient(135deg,#0c4a6e55,#064e3b44)}.clickable-counts{margin:12px 0}.clickable-counts button{min-height:92px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;background:linear-gradient(145deg,#10243d,#0a1729);box-shadow:0 8px 22px #0003}.clickable-counts button:hover{border-color:#38bdf8}.clickable-counts button b{font-size:24px;color:#7dd3fc}.clickable-counts button span{font-size:10px;color:var(--muted)}.clickable-counts button:nth-child(2) b{color:#34d399}.clickable-counts button:nth-child(3) b{color:#fbbf24}.clickable-counts button:nth-child(5) b{color:#fb7185}.change-modal .result-modal-card{width:min(920px,100%);height:min(88vh,850px)}.change-product-list{overflow:auto;padding:14px;display:grid;gap:8px}.change-product{display:grid;grid-template-columns:62px minmax(0,1fr) auto;gap:11px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:13px;background:#081528}.change-product img{width:62px;height:62px;object-fit:contain;background:white;border-radius:10px}.change-product small{color:var(--muted)}.price-before{text-decoration:line-through;color:#fb7185}.price-after{color:#34d399;font-weight:800}@media(max-width:640px){.clickable-counts{grid-template-columns:repeat(2,1fr)!important}.change-product{grid-template-columns:48px 1fr}.change-product img{width:48px;height:48px}.change-product>div:last-child{grid-column:1/-1}}
.task-center{display:grid;gap:10px}.task-card{padding:14px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(145deg,rgba(11,28,50,.94),rgba(14,24,42,.85));position:relative;overflow:hidden}.task-card.running{border-color:#38bdf866}.task-card.completed{border-color:#34d39955}.task-card.failed{border-color:#fb718555}.task-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}.task-top small{color:var(--muted);display:block;margin-top:4px}.profile-task-chip{color:#cffafe;border-color:#22d3ee55;background:#164e6355;font-size:10px}.task-pct{margin:6px 0 0;font-weight:800;color:#7dd3fc;font-size:20px;letter-spacing:-.5px}.task-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0;color:#b9cbe1}.task-metrics span{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:12px;background:#081528;min-width:0;overflow-wrap:anywhere}.task-metrics small{color:#8aa0bb;font-size:10px}.task-metrics b{font-size:14px;color:#e8f1ff}.task-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.task-actions button{width:100%}.task-progress{height:11px;border-radius:99px;background:#06101e;overflow:hidden;border:1px solid #29405d;margin:9px 0}.task-progress i{display:block;height:100%;min-width:2px;border-radius:inherit;background:linear-gradient(90deg,#0ea5e9,#38bdf8,#34d399);background-size:200% 100%;animation:progressGlow 2s linear infinite;transition:width .45s ease}.task-card.failed .task-progress i{background:#fb7185}.task-step{display:block;width:100%;font-weight:700;color:#d9f2ff;margin-top:8px;line-height:1.7;overflow-wrap:anywhere}.task-repeat{margin-right:6px;background:#1e3a5f;border-color:#38bdf866;color:#bae6fd}.task-timeline{max-height:155px;overflow:auto;margin-top:9px;padding-right:8px;border-right:2px solid #244665}.task-event{font-size:11px;color:#aebfd5;padding:4px 8px;overflow-wrap:anywhere}.task-event b{color:#70d7ff}.task-actions button{font-size:12px;min-height:42px;padding:8px 10px}.changelog{display:grid;gap:10px}.release{padding:14px;border:1px solid var(--line);border-radius:16px;background:#09172a}.release.current{border-color:#34d39966;background:linear-gradient(140deg,#0b2929,#10223b)}.release-head{display:flex;justify-content:space-between;gap:8px}.release ul{margin:9px 0 0;padding-right:20px;color:#b8c9dd}.dispatch-hero{border-color:#38bdf855;background:linear-gradient(135deg,rgba(2,132,199,.16),rgba(16,185,129,.10))}@keyframes progressGlow{to{background-position:-200% 0}}
::-webkit-scrollbar{width:9px;height:9px}::-webkit-scrollbar-track{background:#06101e}::-webkit-scrollbar-thumb{background:linear-gradient(#155e75,#1d4ed8);border-radius:20px;border:2px solid #06101e}button:focus-visible,a:focus-visible{outline:2px solid #67e8f9;outline-offset:2px}.pane>.card{animation:cardIn .3s ease both}.pane>.card:nth-child(2){animation-delay:.04s}.pane>.card:nth-child(3){animation-delay:.08s}.section-head h3,.result-hero h3{letter-spacing:-.2px}.card{transition:border-color .2s ease,box-shadow .2s ease}.card:hover{border-color:rgba(125,211,252,.22)}@keyframes cardIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
@media(max-width:900px){.grid4{grid-template-columns:repeat(2,minmax(0,1fr))}.hero{padding:20px}.wrap{padding:18px 14px 60px}}
@media(max-width:640px){html,body{max-width:100%;overflow-x:hidden}body{font-size:13px}.wrap{padding:10px 8px calc(28px + env(safe-area-inset-bottom))}.hero{border-radius:18px;padding:14px 12px;margin-bottom:10px}.hero-main{gap:10px}.logo{width:43px;height:43px;border-radius:13px;font-size:22px}.eyebrow{display:none}.hero h1{font-size:20px}.sub{font-size:10px;line-height:1.55;max-width:230px}.hero-badge{display:none}.tabs{position:fixed;top:auto;right:auto;left:50%;bottom:0;width:100%;margin:0;border-radius:15px;padding:5px;justify-content:flex-start;z-index:50;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x proximity}.tabs button{flex:1 0 62px;min-width:62px;min-height:48px;padding:5px 3px;font-size:9px;white-space:nowrap;flex-direction:column;gap:1px;scroll-snap-align:start}.tabs button i{font-size:18px}.card{padding:14px 12px;border-radius:16px;margin-bottom:10px}.grid,.grid4{grid-template-columns:1fr;gap:12px}.wide{grid-column:auto}input,select,textarea{font-size:16px;min-height:48px}.actions{display:grid;grid-template-columns:1fr}.actions button{width:100%;padding:11px 8px;min-height:46px}.actions button:first-child:last-child{grid-column:1/-1}.note{font-size:12px;padding:10px}.tablebox{max-height:none;overflow:visible;background:transparent;border:0;box-shadow:none;padding:0}table,thead,tbody,tr,td{display:block}thead{display:none}tbody{display:grid;gap:10px}tbody tr{position:relative;padding:13px 88px 13px 12px;min-height:104px;border:1px solid var(--line);border-radius:16px;background:var(--card);box-shadow:0 8px 24px #0003}tbody tr:hover{background:var(--card)}td{padding:3px 0;border:0;text-align:right}td:before{content:attr(data-label);color:var(--muted);font-size:10px;margin-left:6px}td:nth-child(1){position:absolute;left:9px;top:8px;color:#7188a5;font-size:10px}td:nth-child(1):before,td:nth-child(2):before{display:none}td:nth-child(2){position:absolute;right:12px;top:13px}td:nth-child(2) img{width:64px;height:76px;border-radius:11px}td:nth-child(3){font-weight:700;font-size:13px;line-height:1.65;margin-bottom:4px}td:nth-child(4){color:#7ce6ba;font-weight:700;direction:ltr;text-align:right}td:empty{display:none}.empty{padding:35px 10px!important}.empty:before{display:none}}
@media(max-height:480px) and (max-width:900px){.hero{display:none}.tabs{bottom:0}.tabs button{min-height:40px;flex-direction:row;font-size:10px}.tabs button i{font-size:15px}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}

.deploy-banner{display:none;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;border-radius:14px;margin-bottom:12px;background:linear-gradient(135deg,#b45309,#ea580c);color:#fff7ed;font-weight:800;box-shadow:0 10px 30px #0006}.deploy-banner button{width:auto;min-height:36px;padding:7px 14px;font-size:12px;border-radius:9px}.deploy-banner .ghost{background:transparent;border:1px solid #fff8;color:#fff;box-shadow:none}.deploy-local{background:#0f172a;border:1px solid #334155;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-family:monospace;font-size:11px;color:#67e8f9;line-height:1.9}.deploy-local span{color:#64748b}.branch-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.branch-chip{display:inline-flex;align-items:center;gap:7px;padding:6px 6px 6px 11px;border:1px solid #33465f;border-radius:99px;background:#0b1a2e;color:#dcecff;font-size:12px;direction:ltr}.branch-chip button{width:auto;min-height:0;padding:2px 8px;font-size:11px;border-radius:99px;background:#3b1d24;border-color:#fb718555;color:#fecaca;box-shadow:none}.branch-chip.newest{border-color:#34d39988;background:#052e22;color:#a7f3d0}.cand-table{display:grid;gap:7px;margin-top:10px}.cand-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#081528}.cand-row.newest{border-color:#34d39977;background:linear-gradient(140deg,#0b2929,#10223b)}.cand-row small{color:var(--muted);display:block;font-size:10.5px;margin-top:3px}.cand-row code{font-size:10px}.cand-row .row-actions{display:flex;gap:6px}.cand-row .row-actions button{font-size:11px;min-height:34px;padding:6px 10px}.vc-drop{position:absolute;top:100%;right:0;left:0;z-index:30;max-height:220px;overflow:auto;background:#0b1a2e;border:1px solid #38bdf855;border-radius:10px;margin-top:4px;display:none}.vc-drop.open{display:block}.vc-opt{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;cursor:pointer;font-size:12px;direction:ltr;text-align:left}.vc-opt:hover{background:#164e63}.vc-meta{color:#64748b;font-size:10px}.hidden{display:none!important}#toast{position:fixed;bottom:86px;left:50%;transform:translateX(-50%) translateY(20px);z-index:99999;max-width:min(92vw,520px);padding:11px 18px;border-radius:12px;background:#0f172a;border:1px solid #38bdf866;color:#e2e8f0;font-size:13px;font-weight:700;opacity:0;pointer-events:none;transition:.25s;box-shadow:0 12px 34px #000a;text-align:center}#toast.show{opacity:1;transform:translateX(-50%)}#toast.err{border-color:#fb718588;color:#fecaca}#appVersion{cursor:pointer}#appVersion.upd{background:#b45309!important;border-color:#fbbf24!important;color:#fff!important;animation:updPulse 1.6s infinite}@keyframes updPulse{50%{box-shadow:0 0 0 6px #f59e0b33}}.checkline{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:#e2e8f0;cursor:pointer}.checkline input{width:auto;min-height:0;accent-color:#38bdf8}.file-list{display:grid;gap:6px}.file-row{display:grid;grid-template-columns:minmax(0,1fr) 130px 120px;align-items:center;gap:8px;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:9px 11px}.file-row button{background:transparent;border:0;padding:0;min-height:0;text-align:right;color:#93c5fd;box-shadow:none}.file-row .fsize{text-align:left;direction:ltr;color:#fbbf24}.file-row small{color:#64748b;text-align:left}.space-card{background:#0f172a;border:1px solid #334155;border-radius:10px;padding:10px;text-align:center}.space-card b{display:block;font-size:18px;color:#67e8f9}.space-card span{font-size:10px;color:#94a3b8}@media(max-width:640px){.file-row{grid-template-columns:minmax(0,1fr) 90px}.file-row small{display:none}}
.task-manager-btn{position:fixed;top:10px;right:62px;z-index:10049;width:auto;min-width:132px;height:44px;padding:0 12px;display:flex;align-items:center;justify-content:center;gap:7px;border-radius:12px;background:linear-gradient(135deg,#0f766e,#0369a1);border:1px solid #67e8f955;box-shadow:0 10px 28px #02061788}.task-manager-btn b{display:grid;place-items:center;min-width:23px;height:23px;padding:0 5px;border-radius:99px;background:#020617;color:#7dd3fc;font-size:11px}.task-manager-btn.has-active b{background:#052e16;color:#86efac;box-shadow:0 0 12px #22c55e77}.task-btn-icon{font-size:18px}.hamburger-btn{position:fixed;top:10px;right:10px;z-index:10050;width:44px;height:44px;padding:0;border-radius:12px;background:#1e293b;border:1px solid #475569;color:#e2e8f0;font-size:22px;display:grid;place-items:center}.settings-overlay{position:fixed;inset:0;background:#0009;z-index:9998;display:none}.settings-overlay.open{display:block}.settings-panel{position:fixed;top:0;right:-430px;width:410px;max-width:94vw;height:100dvh;background:#0f172a;border-left:1px solid #334155;z-index:10000;overflow-y:auto;transition:right .25s}.settings-panel.open{right:0}.settings-panel-head{position:sticky;top:0;z-index:5;background:#1e293b;padding:12px 205px 12px 12px;min-height:64px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #334155}.settings-panel-head h2{margin:0;font-size:16px}.settings-panel-body{padding:10px}.admin-nav{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:10px}.admin-nav button{font-size:12px;padding:8px}.admin-section{display:none}.admin-section.admin-on{display:block}.hamburger-btn.active{background:#3b82f6;color:#08111e}.section-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px}.section-head small{color:var(--muted)}.ai-tabs{display:flex;gap:6px;overflow:auto;margin:10px 0 14px;padding:5px;background:#091426;border-radius:14px}.ai-tabs button{font-size:11px;flex:1;white-space:nowrap;background:transparent;box-shadow:none}.ai-tabs button.on{background:#1d4ed8}.ai-pane{display:none}.ai-pane.on{display:block}.provider-list{display:grid;gap:8px;margin-top:12px}.provider-row{padding:11px;border:1px solid var(--line);border-radius:13px;background:#091426;display:grid;grid-template-columns:1fr auto;gap:7px}.provider-row small{color:var(--muted)}.provider-row .models{grid-column:1/-1;display:flex;gap:4px;flex-wrap:wrap}.model-chip{font-size:10px;padding:3px 7px;border-radius:99px;background:#172a46;color:#bce9ff}.backup-hero{border-color:#10b98155;background:linear-gradient(145deg,#0c2d2b,#10243c)}.admin-nav button.nav-on{border-color:#38bdf8;background:#164e63}.test-results{display:grid;gap:8px;margin-top:10px;max-height:min(62vh,560px);overflow:auto;-webkit-overflow-scrolling:touch}.test-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;padding:11px;border:1px solid var(--line);border-radius:12px;background:#091426}.test-row-top{display:flex;align-items:center;justify-content:space-between;gap:8px;grid-column:1/-1}.test-row b,.test-row strong{overflow-wrap:anywhere;line-height:1.4}.test-row code{grid-column:1/-1;font-size:10px;color:#7dd3fc;overflow-wrap:anywhere}.test-row.ok{border-right:3px solid var(--green)}.test-row.failed{border-right:3px solid var(--red)}.test-row small{grid-column:1/-1;color:var(--muted);overflow-wrap:anywhere}.inline-search{display:grid;grid-template-columns:1fr auto;gap:6px}.category-results{display:grid;gap:5px;max-height:230px;overflow:auto;margin-top:7px}.category-item{display:flex;align-items:center;justify-content:space-between;gap:7px;padding:7px 9px;border:1px solid var(--line);border-radius:10px;background:#091426}.category-item button{padding:4px 8px;min-height:32px;font-size:11px}.settings-panel .grid4{grid-template-columns:repeat(2,minmax(0,1fr))}.result-modal{display:none;position:fixed;inset:0;z-index:11000;background:#020617dd;padding:clamp(8px,3vw,30px);backdrop-filter:blur(8px)}.result-modal.open{display:flex}.result-modal-card{width:min(1500px,100%);height:100%;margin:auto;display:flex;flex-direction:column;background:#0b1528;border:1px solid #334155;border-radius:20px;overflow:hidden;box-shadow:0 25px 80px #000a}.result-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;background:linear-gradient(135deg,#172554,#0f2944);border-bottom:1px solid #334155}.result-modal-head h2{margin:0;font-size:18px}.result-modal-head small{color:#9db0ca}.result-modal-head .actions{margin:0}.modal-tools{display:grid;grid-template-columns:1fr 220px;gap:8px;padding:10px 14px}.modal-tools.pro-filters{grid-template-columns:minmax(240px,2fr) repeat(6,minmax(125px,1fr))}.modal-pagination{display:flex;align-items:center;justify-content:center;gap:8px;padding:8px;border-top:1px solid var(--line);background:#0b1528}.modal-pagination select{width:auto}.model-catalog,.candidate-list{display:grid;gap:6px;max-height:460px;overflow:auto}.model-row,.candidate-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--line);border-radius:11px;background:#091426}.model-row:hover{border-color:#38bdf855}.health-meter{width:70px;height:6px;border-radius:10px;background:#1e293b;overflow:hidden}.health-meter i{display:block;height:100%;background:var(--green)}.candidate-row.master{border-color:#fbbf2466;background:#2a220d}.stats+.model-catalog{margin-top:10px}.result-modal .stats{padding:0 14px 10px}.modal-table{overflow:auto;flex:1;min-height:240px;border-top:1px solid var(--line);-webkit-overflow-scrolling:touch}.modal-table table{min-width:1100px}.ai-lab-search{padding:8px 12px;flex:0 0 auto}.ai-lab-search input{width:100%;min-height:40px}.ai-lab-hint{display:none;margin-top:6px;font-size:11px;color:#7dd3fc}.modal-table td{max-width:330px;white-space:normal;line-height:1.7}.answer-cell{font-size:11px;color:#dbeafe}.cap-dot{display:inline-block;padding:2px 5px;margin:2px;border-radius:5px;background:#1e293b;font-size:9px}.ai-pro-table thead th{top:0;background:linear-gradient(180deg,#172b48,#102039);text-transform:none;letter-spacing:.1px}.ai-pro-table tbody tr{border-right:3px solid transparent}.ai-pro-table tbody tr.row-ok{border-right-color:var(--green);background:#052e1b22}.ai-pro-table tbody tr.row-partial{border-right-color:var(--amber)}.ai-pro-table tbody tr.row-failed{border-right-color:var(--red)}.rank-medal{display:grid;place-items:center;width:31px;height:31px;border-radius:10px;background:#172a46;color:#9bdfff;font-weight:800}.rank-medal.top{background:linear-gradient(145deg,#92400e,#f59e0b);color:#fff}.score-box{min-width:110px}.score-line{display:flex;justify-content:space-between;font-weight:800}.score-meter{height:6px;background:#1e293b;border-radius:9px;overflow:hidden;margin-top:5px}.score-meter i{display:block;height:100%;background:linear-gradient(90deg,#ef4444,#fbbf24,#34d399);border-radius:inherit}.answer-preview{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.answer-cell details{margin-top:5px}.answer-cell summary{cursor:pointer;color:#7dd3fc;font-size:10px}.answer-full{white-space:pre-wrap;padding:8px;margin-top:5px;border-radius:8px;background:#06111f;max-height:180px;overflow:auto}.ai-compare-bar{display:none;margin:0 14px 10px;padding:10px 12px;border:1px solid #a78bfa55;border-radius:13px;background:linear-gradient(135deg,#2e1065aa,#172554aa);align-items:center;justify-content:space-between;gap:10px}.ai-compare-bar.show{display:flex}.ai-compare-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;width:100%}.ai-compare-card{padding:10px;border:1px solid #ffffff1a;border-radius:11px;background:#071426}.ai-compare-card b,.ai-compare-card small{display:block}.ai-compare-card small{color:var(--muted)}.latency-pill{display:inline-flex;padding:3px 7px;border-radius:8px;background:#172a46;font-size:10px}.result-modal-card{position:relative}.result-modal-head{flex:none}.result-modal .modal-tools{flex:none;background:#081426;border-bottom:1px solid var(--line)}.ai-select{width:18px;height:18px;accent-color:#38bdf8}.progress-pulse{animation:pulse 1s infinite}.profile-picker{position:relative;border-color:#38bdf844;background:linear-gradient(145deg,rgba(12,38,65,.95),rgba(13,27,48,.88))}.profile-picker select{font-weight:700;border-color:#38bdf866}.profile-picker .note{margin-top:10px}.profile-card{cursor:pointer;transition:.2s}.profile-card:hover{border-color:#38bdf8;transform:translateY(-1px)}.live-task{margin:12px 0;padding:13px;border:1px solid #38bdf855;border-radius:15px;background:linear-gradient(145deg,#071a30,#0d2540);box-shadow:inset 0 1px #ffffff0a}.live-task-head{display:flex;justify-content:space-between;gap:10px;color:#dff6ff}.progress-track{height:10px;margin:9px 0;border-radius:99px;overflow:hidden;background:#020817;border:1px solid #28435f}.progress-track i{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#06b6d4,#3b82f6,#8b5cf6);background-size:200% 100%;animation:flow 1.4s linear infinite;transition:width .45s ease}.live-step{font-size:12px;color:#7dd3fc;font-weight:700}.live-details{max-height:150px;overflow:auto;margin-top:7px;font:10px/1.8 ui-monospace,monospace;color:#94a3b8;direction:rtl}.live-detail{padding:2px 0;border-bottom:1px dashed #33415555}@keyframes flow{to{background-position:-200% 0}}@keyframes pulse{50%{opacity:.55}}@media(max-width:640px){.settings-panel{width:100%;max-width:100%;right:-100%}.settings-panel .grid4,.modal-tools,.modal-tools.pro-filters{grid-template-columns:1fr}.result-modal{padding:0}.result-modal-card{border-radius:0}.result-modal-head{padding:9px;align-items:flex-start}.result-modal-head h2{font-size:15px}.settings-panel-head{padding-right:120px;min-height:62px}.hamburger-btn{top:8px;right:8px}.task-manager-btn{top:8px;right:60px;min-width:48px;width:48px;padding:0}.task-btn-text{display:none}.task-manager-btn b{position:absolute;top:-5px;left:-5px;min-width:18px;height:18px;font-size:9px}.result-modal{padding:0}.result-modal-card{width:100%;height:100%;max-height:100dvh;border-radius:0}.result-modal-head{flex-wrap:wrap;gap:8px}.result-modal-head .actions{width:100%;flex-wrap:wrap}.result-modal-head .actions button{flex:1 1 30%}.result-modal-head small{display:none}.result-modal #aiModalStats,.result-modal .ai-compare-bar{display:none!important}.ai-lab-search{padding:6px 10px}.test-results{max-height:none}.test-row{grid-template-columns:1fr}.test-row .badge{justify-self:start}.result-modal .modal-table{overflow-x:auto;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}.result-modal .modal-table table,.result-modal .modal-table .ai-pro-table{display:table;min-width:1080px!important;width:max-content;max-width:none;border-collapse:collapse}.result-modal .modal-table thead{display:table-header-group}.result-modal .modal-table tbody{display:table-row-group;padding:0}.result-modal .modal-table tr{display:table-row;padding:0;margin:0;border-radius:0;background:transparent;grid-template-columns:none;grid-template-areas:none}.result-modal .modal-table th,.result-modal .modal-table td{display:table-cell;position:static;padding:8px 10px;max-width:280px;vertical-align:top}.result-modal .modal-table td:before{display:none!important}.result-modal .modal-table .score-box{min-width:90px}.ai-lab-hint{display:block!important}.modal-pagination{flex-wrap:wrap}}
/* v1.6: visual parity with scraper4.php */
body{background:#0f172a;background-image:none;color:#e2e8f0;padding:12px 12px 90px}body:before{display:none}.wrap{max-width:1400px;padding:0;margin:auto}.hero{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:12px 64px 12px 14px;margin:0 0 14px;box-shadow:none}.hero:after{display:none}.logo{width:40px;height:40px;border-radius:8px;font-size:20px;box-shadow:none}.eyebrow{display:none}.hero h1{font-size:18px}.sub{font-size:11px}.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px;margin-bottom:14px;box-shadow:none;backdrop-filter:none}input,select,textarea{background:#0f172a;border:1px solid #475569;border-radius:8px;color:#fff}button,.file-btn{border-radius:8px;box-shadow:none}.primary-actions{background:#1e293b;border-color:#334155;border-radius:12px;box-shadow:none}.note,.status{background:#0f172a;border-color:#334155;border-radius:10px}.tabs{left:0;right:0;bottom:0;transform:none;width:100%;max-width:none;background:#0f172a;border:0;border-top:1px solid #334155;border-radius:0;padding:0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);gap:0;box-shadow:0 -4px 20px rgba(0,0,0,.5)}.tabs button{flex:1 0 64px;min-height:60px;border:0;border-radius:0;color:#64748b;flex-direction:column;gap:2px;padding:8px 4px;font-size:11px}.tabs button.on{color:#3b82f6;background:#1e293b;border:0}.tabs button.on i{transform:translateY(-2px) scale(1.15);filter:drop-shadow(0 3px 8px rgba(59,130,246,.7))}.tabs button i{font-size:21px}.tablebox{background:#1e293b}.app-footer{height:72px}

.selector-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0;padding:6px;border-radius:14px;background:#0b1528}.selector-tabs button{background:transparent;box-shadow:none}.selector-tabs button.on{background:linear-gradient(135deg,#7c3aed,#2563eb);border-color:#c4b5fd66}.selector-panel{display:none}.selector-panel.on{display:block}.visual-picker{margin-top:18px;padding:16px;border:1px solid #a855f766;border-radius:18px;background:linear-gradient(145deg,#1d1535,#0b1d35)}.picker-toolbar{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(260px,2fr) repeat(4,auto);gap:8px}.picker-controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:10px 0}.picker-controls button{background:#4c1d95}.picker-controls span{flex:1;min-width:220px;padding:9px 12px;border:1px solid #a855f766;border-radius:10px;background:#0f172a;color:#f0abfc;direction:ltr;overflow-wrap:anywhere}.picker-height{display:flex;align-items:center;gap:7px;margin:0}.picker-height input{width:130px;min-height:auto;padding:0}.picker-frame-wrap{display:none;height:720px;border:1px solid #64748b;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 18px 45px #0007}.picker-frame-wrap.open{display:block}.picker-frame-wrap iframe{width:100%;height:100%;border:0;background:#fff}.picker-chips{display:flex;gap:6px;flex-wrap:wrap;margin:9px 0}.picker-chip{padding:5px 9px;border:1px solid #475569;border-radius:99px;background:#0f172a;color:#94a3b8;cursor:pointer}.picker-chip.done{border-color:#34d39977;color:#86efac}.detail-coverage-card{background:linear-gradient(135deg,#172554,#0f2f35)}.product-detail-body{padding:18px;overflow:auto}.product-detail-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,.7fr);gap:16px}.detail-section{padding:14px;border:1px solid #334155;border-radius:14px;background:#0f172a;margin-bottom:12px}.detail-section h3{color:#7dd3fc;margin:0 0 9px}.product-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}.product-gallery img{width:100%;aspect-ratio:1;object-fit:contain;background:#fff;border-radius:10px}.variation-group,.attribute-row{display:flex;gap:8px;justify-content:space-between;padding:7px;border-bottom:1px solid #334155}.variation-values{display:flex;gap:5px;flex-wrap:wrap}.variation-values i{font-style:normal;padding:3px 7px;border-radius:8px;background:#1e3a5f}.rich-description{line-height:2;color:#dbeafe}.coverage-card{cursor:pointer}.coverage-card b{font-size:25px;color:#67e8f9}@media(max-width:760px){.picker-toolbar{grid-template-columns:1fr}.picker-frame-wrap{height:620px}.picker-controls span{min-width:100%}.product-detail-grid{grid-template-columns:1fr}.product-gallery{grid-template-columns:repeat(3,1fr)}}
.start-journey{display:flex;align-items:center;gap:8px;margin-bottom:14px;padding:14px 18px;border:1px solid #334155;border-radius:16px;background:linear-gradient(135deg,#111d33,#172554);box-shadow:0 12px 30px #02061755}.journey-step{display:flex;align-items:center;gap:9px;min-width:0}.journey-step i{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:11px;background:#1e293b;color:#94a3b8;font-style:normal;font-weight:900}.journey-step.active i{background:linear-gradient(135deg,#06b6d4,#2563eb);color:white;box-shadow:0 5px 16px #0284c766}.journey-step span{display:grid}.journey-step small{color:#94a3b8}.journey-line{height:2px;min-width:20px;flex:1;background:linear-gradient(90deg,#2563eb55,#475569)}.source-card{border-color:#38bdf844;background:linear-gradient(145deg,#1e293b,#14233a)}.source-card>.grid{grid-template-columns:minmax(0,2fr) minmax(150px,.55fr) minmax(230px,.8fr);align-items:end}.start-advanced{margin-top:14px;border-top:1px solid #334155;padding-top:12px}.start-advanced summary{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;border-radius:12px;background:#0f172a;cursor:pointer;color:#cbd5e1}.start-advanced summary span{display:grid}.start-advanced summary small{color:#94a3b8}.start-advanced summary i{font-style:normal;color:#67e8f9;font-size:22px;transition:.2s}.start-advanced[open] summary i{transform:rotate(180deg)}.start-advanced-grid{padding-top:14px}#scrape>.primary-actions{display:grid;grid-template-columns:minmax(220px,2fr) 1fr;position:relative;overflow:hidden}#scrape>.primary-actions:before{content:"";position:absolute;inset:0 auto 0 0;width:5px;background:linear-gradient(#22d3ee,#3b82f6)}#runBtn{min-height:58px;font-size:calc(18px * var(--font-scale))!important;background:linear-gradient(135deg,#0891b2,#2563eb,#7c3aed);background-size:180% 100%;box-shadow:0 12px 28px #2563eb44}.appearance-card{background:linear-gradient(145deg,#172554,#164e63)}.font-preview{display:grid;gap:6px;margin:14px 0;padding:15px;border:1px solid #67e8f955;border-radius:14px;background:#0f172a}.font-preview b{color:#7dd3fc}.font-preview button{justify-self:start}.engine-roadmap{opacity:.85}.anti-bot-hint{margin-top:2px}@media(max-width:760px){.start-journey{overflow-x:auto;padding:11px}.journey-step{min-width:112px}.journey-line{min-width:14px}.journey-step small{display:none}#scrape>.primary-actions{grid-template-columns:1fr}.source-card>.grid{grid-template-columns:1fr}.source-card .grid4{gap:10px}}
/* v3.9 readability layer: deliberately last so compact legacy rules cannot shrink words. */
body{font-size:calc(16px * var(--font-scale));line-height:1.72}small,.section-head small,.provider-row small,.task-top small,.ai-compare-card small{font-size:calc(13px * var(--font-scale))!important;line-height:1.65}label{font-size:calc(14px * var(--font-scale))!important;margin-bottom:8px}input,select,textarea,button,.file-btn{font-size:calc(16px * var(--font-scale))!important;line-height:1.5}button,.file-btn{min-height:46px}.card h3{font-size:calc(20px * var(--font-scale))}.hero h1{font-size:calc(24px * var(--font-scale))}.sub{font-size:calc(14px * var(--font-scale))}.tabs button,.admin-nav button,.ai-tabs button{font-size:calc(13px * var(--font-scale))!important}.tabs button{min-height:64px}.note,.status{font-size:calc(15px * var(--font-scale))}.badge,.model-chip,.latency-pill,.task-metrics,.task-event,.operation-item small,.answer-cell,.answer-cell summary,.live-step,.live-details,.clickable-counts button span,.space-card span{font-size:calc(13px * var(--font-scale))!important}th{font-size:calc(14px * var(--font-scale))}td{font-size:calc(15px * var(--font-scale))}.clickable-counts button b,.space-card b{font-size:calc(25px * var(--font-scale))}.comparison-history{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:9px}.history-item{padding:12px;border:1px solid #334155;border-radius:12px;background:#0f172a}.history-item b{display:block;color:#7dd3fc;margin-bottom:6px}.history-item span{display:inline-block;margin:2px 0 2px 8px;color:#cbd5e1}.history-item.current{border-color:#34d39966;background:linear-gradient(145deg,#052e2a,#10243c)}
@media(max-width:640px){body{font-size:16px}.hero h1{font-size:22px}.sub{font-size:13px}.tabs button{font-size:13px!important;min-height:62px}.tabs button i{font-size:22px}.card{padding:16px 14px}.card h3{font-size:18px}.note,.status{font-size:14px}.actions button{font-size:16px;min-height:50px}td,td:nth-child(3){font-size:15px}td:before{font-size:12px}.comparison-history{grid-template-columns:1fr}}
@media(max-width:640px){body{font-size:calc(16px * var(--font-scale))}.hero h1{font-size:calc(22px * var(--font-scale))}.sub{font-size:calc(13px * var(--font-scale))}.tabs button{font-size:calc(13px * var(--font-scale))!important}.card h3{font-size:calc(18px * var(--font-scale))}.note,.status{font-size:calc(14px * var(--font-scale))}.actions button{font-size:calc(16px * var(--font-scale))!important}td,td:nth-child(3){font-size:calc(15px * var(--font-scale))}td:before{font-size:calc(12px * var(--font-scale))}}

/* v4.2 — visual parity layer inspired by the mature PHP mobile interface. */
body{background:#0c1528;background-image:none;color:#e8edf7}.wrap{max-width:1080px;padding-top:18px}.hero{min-height:86px;background:#17233a;border:1px solid #53627a;border-radius:20px;box-shadow:none;padding:16px 250px 16px 22px}.hero:after{display:none}.hero-main{width:100%;justify-content:space-between}.hero h1{color:#f8fafc}.hero h1 small{position:absolute;left:50%;transform:translateX(-50%);background:#101a2d;border-color:#34445e;color:#5ee3f3}.logo{display:none}.sub{color:#9ba9bd}.card{background:#1b293f;border:1px solid #53627a;border-radius:18px;box-shadow:none;backdrop-filter:none}.card:hover{border-color:#6b7d99}.card h3,.section-mini,.section-head h3{color:#5ee3f3!important}.profile-picker,.source-card{background:#1b293f}.start-journey{display:none}.source-card>.grid{padding:4px 0}.start-advanced summary{background:#101a2d;border:1px solid #34445e}.start-advanced[open] summary{border-color:#38bdf877}.note,.status{background:#101a2d;border:1px solid #44556f;color:#c2cede}.status{border-right:3px solid #22c1dc}.primary-actions{background:#152239;border:1px solid #53627a;box-shadow:none}.actions button,.file-btn{font-weight:800}button{box-shadow:none;background:linear-gradient(135deg,#2687eb,#3478e5)}button.green{background:linear-gradient(135deg,#14b866,#20c96c)}button.gray{background:#526177;border-color:#66768d}#runBtn{background:linear-gradient(135deg,#8b2ee8,#b344ee);border-color:#ca7cff}.clickable-counts button{background:#17263d;border-color:#4d5e77;box-shadow:none}.clickable-counts button:hover{background:#203451}.result-hero{background:#1b293f}.comparison-history-card,.detail-coverage-card{background:#1b293f}.gateway-card{background:#1b293f}.tabs{height:78px;background:#0d172a;border:0;border-top:1px solid #3f4f68;border-radius:0;padding:0;gap:0;box-shadow:0 -8px 25px #020617aa}.tabs button{border:0;border-radius:0;min-height:77px;flex-direction:column;color:#aab6c8;gap:3px}.tabs button.on{color:#45a2ff;background:#1c2b43;border:0}.tabs button i{font-size:25px}.hamburger-btn,.fullscreen-btn{position:fixed;top:12px;z-index:10050;width:48px;height:48px;padding:0;display:grid;place-items:center;border-radius:14px;background:#24344b;border:1px solid #60708a;color:#fff;font-size:25px}.hamburger-btn{right:12px}.fullscreen-btn{right:206px}.task-manager-btn{top:12px;right:68px;height:48px;background:#24344b;border-color:#60708a;box-shadow:none}.settings-panel{background:#0e192d;border-color:#53627a}.settings-panel-head{background:#18263d;border-color:#53627a}.admin-nav{background:#111d31;padding:7px;border-radius:14px}.admin-nav button{background:#1c2b43;border-color:#3d4e68}.result-view-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:7px;margin-bottom:14px;border:1px solid #53627a;border-radius:14px;background:#101a2d}.result-view-tabs button{background:transparent;color:#aab6c8}.result-view-tabs button.on{background:#347ff0;color:#fff}.product-card-grid{display:none;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.product-card-grid.on{display:grid}.result-product-card{position:relative;padding:12px;border:1px solid #53627a;border-radius:17px;background:#1b293f;overflow:hidden}.result-product-card img{width:100%;height:190px;object-fit:contain;border-radius:12px;background:#fff}.result-product-card h3{font-size:calc(16px * var(--font-scale));color:#f1f5f9!important;min-height:52px}.result-product-card .product-price{color:#52e6a6;font-weight:900}.result-product-card .actions{display:grid;grid-template-columns:1fr 1fr}.result-text-view{display:none;white-space:pre-wrap;direction:rtl;padding:18px;border:1px solid #53627a;border-radius:17px;background:#101a2d;color:#dbe6f5;line-height:2;overflow:auto}.result-text-view.on{display:block}#resultsMount.hidden{display:none}.appearance-card{background:#1b293f}.visual-picker{background:#16243a}.result-modal-card{background:#121e32;border-color:#60708a}@media(max-width:640px){.wrap{padding:8px 14px calc(96px + env(safe-area-inset-bottom))}.hero{min-height:108px;margin:52px 0 14px;padding:15px;border-radius:20px}.hero-main{justify-content:flex-end}.hero h1 small{top:17px}.sub{display:none}.hamburger-btn{right:14px}.task-manager-btn{right:70px}.fullscreen-btn{right:126px}.card{border-radius:17px;padding:16px;margin-bottom:16px}.profile-picker .actions{grid-template-columns:1fr 1fr}.source-card>.grid{grid-template-columns:1fr}.engine-roadmap{display:none}.tabs{height:82px}.tabs button{min-width:66px;min-height:81px}.tabs button i{font-size:26px}.product-card-grid{grid-template-columns:1fr}.result-product-card{display:grid;grid-template-columns:108px 1fr;gap:12px}.result-product-card img{width:108px;height:130px;grid-row:1/5}.result-product-card h3{margin:0;min-height:0}.result-product-card .actions{grid-column:1/-1}.settings-panel-head{padding:14px 185px 14px 14px}.settings-panel{max-width:100vw}.result-view-tabs{position:sticky;top:6px;z-index:8}}

.reconcile-card{border-color:#38bdf855}.reconcile-report{margin-top:10px}.reconcile-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.reconcile-stats button{padding:10px 5px;background:#0a1729;border:1px solid #334155}.reconcile-stats b{display:block;font-size:20px}.reconcile-repair{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.reconcile-repair button{font-size:11px}.reconcile-list{max-height:260px;overflow:auto;margin-top:9px}.reconcile-item{padding:8px;border-bottom:1px solid #263951;font-size:11px}.reconcile-item small{display:block;color:#94a3b8}@media(max-width:640px){.reconcile-stats{grid-template-columns:repeat(2,1fr)}}
/* v4.3 — modern control center and genuinely separate destinations. */
.settings-panel{width:520px;right:-540px;background:linear-gradient(180deg,#0d172a,#111d31)}.settings-panel.open{right:0}.settings-panel-head{background:linear-gradient(135deg,#1e293b,#172554);box-shadow:0 8px 24px #02061788}.settings-panel-head h2{display:grid;color:#67e8f9}.settings-panel-head h2 small{font-size:11px!important;color:#94a3b8;font-weight:500}.admin-nav{grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;padding:10px;background:#0b1426;border:1px solid #334155;position:sticky;top:65px;z-index:4}.admin-nav button{position:relative;display:flex;min-height:82px;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:9px 6px;border-radius:14px;background:linear-gradient(145deg,#17263d,#111d31);border:1px solid #344760;color:#b9c7d9;overflow:hidden}.admin-nav button i{font-style:normal;font-size:24px;line-height:1}.admin-nav button span{font-size:12px}.admin-nav button:hover{border-color:#38bdf8;transform:translateY(-2px)}.admin-nav button.nav-on{color:#fff;border-color:#38bdf8;background:linear-gradient(145deg,#075985,#1d4ed8);box-shadow:0 8px 22px #0369a155}.admin-nav button.nav-on:after{content:"";position:absolute;inset:auto 18px 0;height:3px;border-radius:8px 8px 0 0;background:#67e8f9}.admin-section.admin-on{animation:controlPane .25s ease}.admin-section>.card{border-color:#435672;background:linear-gradient(145deg,#1b293f,#152238)}@keyframes controlPane{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}.destination-price-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0}.destination-price-card{padding:16px;border:1px solid #53627a;border-radius:16px;background:#101a2d}.destination-price-card h3{margin:0 0 13px}.woo-price-card{border-color:#a855f766}.bsl-price-card{border-color:#22d3ee66}.basalam-dispatch-hero{border-color:#22d3ee66;background:linear-gradient(145deg,#153047,#16343b)}#basalamSendMount>.card{border-color:#22d3ee55}#woo .dispatch-hero{border-color:#a855f766;background:linear-gradient(145deg,#262044,#1b293f)}#woo .dispatch-hero h3{color:#c4b5fd!important}.tabs button[data-tab="woo"].on{color:#c4b5fd;background:#282344}.tabs button[data-tab="basalamSend"].on{color:#67e8f9;background:#123342}@media(max-width:640px){.settings-panel{width:100%;right:-100%}.admin-nav{grid-template-columns:repeat(3,1fr);top:64px}.admin-nav button{min-height:76px}.admin-nav button i{font-size:22px}.admin-nav button span{font-size:11px}.destination-price-grid{grid-template-columns:1fr}.tabs{justify-content:flex-start}.tabs button{flex:1 0 68px}.basalam-dispatch-hero .actions,.dispatch-hero .actions{display:grid;grid-template-columns:1fr;gap:8px}.basalam-dispatch-hero .actions button,.dispatch-hero .actions button{width:100%}.task-metrics{grid-template-columns:1fr 1fr}.task-actions{grid-template-columns:1fr}.live-details,.task-timeline{max-height:240px}}

/* === v10.133 app shell: last so it wins over stacked legacy rules === */
:root{--bg:#070b14;--bg2:#0b1220;--card:#101827ee;--line:#243044;--text:#f3f6fb;--muted:#93a4bb;--accent:#5eead4;--accent2:#38bdf8;--danger:#fb7185;--ok:#34d399;--chrome:56px;--tabbar:74px}
html,body{font-family:"Vazirmatn",Tahoma,"Segoe UI",sans-serif!important;background:#070b14!important;color:var(--text)}
body{padding-top:0}
.app-chrome{position:fixed;top:0;left:0;right:0;z-index:10080;display:flex;align-items:center;gap:8px;min-height:var(--chrome);padding:calc(6px + env(safe-area-inset-top,0px)) 10px 6px;background:rgba(7,11,20,.92);backdrop-filter:blur(18px) saturate(1.2);border-bottom:1px solid #1f2a3c;box-shadow:0 8px 28px #0006}
.app-chrome .chrome-title{flex:1;min-width:0;font-weight:800;font-size:15px;letter-spacing:-.2px}
.app-chrome .chrome-title small{display:inline-block;margin-right:6px;padding:2px 7px;border-radius:999px;background:#132033;border:1px solid #2a3b55;color:#7dd3fc;font-size:10px;font-weight:700}
.chrome-btn,.hamburger-btn,.task-manager-btn,.fullscreen-btn{position:static!important;top:auto!important;right:auto!important;left:auto!important;width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;margin:0!important;padding:0!important;display:grid!important;place-items:center!important;border-radius:12px!important;background:#152033!important;border:1px solid #2b3c55!important;color:#e8eef8!important;box-shadow:none!important;font-size:18px!important}
.task-manager-btn{width:auto!important;min-width:42px!important;padding:0 10px!important;display:flex!important;flex-direction:row!important;align-items:center!important;gap:6px!important}
.task-btn-text{display:none!important}
.task-manager-btn b,#taskTopCount{position:static!important;top:auto!important;left:auto!important;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#134e4a;color:#5eead4;font-size:10px;display:grid;place-items:center}
.task-manager-btn.has-active{border-color:#2dd4bf!important}
.hamburger-btn.active{background:#1d4ed8!important;color:#fff!important}
.wrap{padding:calc(var(--chrome) + env(safe-area-inset-top,0px) + 12px) 14px calc(var(--tabbar) + env(safe-area-inset-bottom,0px) + 18px)!important;max-width:980px}
.hero{margin:0 0 14px!important;padding:16px 16px!important;border-radius:18px!important;background:#101827!important;border:1px solid #243044!important;box-shadow:none!important}
.hero:after{display:none}
.hero-badge{white-space:nowrap}
.card{border-radius:18px!important;background:#101827cc!important;border:1px solid #243044!important;box-shadow:none!important}
.actions,.primary-actions,.dispatch-hero .actions,.basalam-dispatch-hero .actions,.profile-picker .actions,.result-product-card .actions{display:grid!important;grid-template-columns:1fr!important;gap:8px!important}
.actions button,.primary-actions button,.dispatch-hero .actions button,.basalam-dispatch-hero .actions button{width:100%!important;min-height:48px!important;border-radius:14px!important}
button{border:0;border-radius:14px}
.settings-panel{top:0!important;width:min(420px,100vw)!important;max-width:100vw!important;padding-top:env(safe-area-inset-top,0px);background:#0b1220!important;border-color:#1f2a3c!important;z-index:10085}
.settings-panel-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px!important;background:#0b1220!important;border-bottom:1px solid #1f2a3c}
.settings-panel-head h2{font-size:16px!important;display:flex;flex-direction:column;gap:2px}
.settings-panel-head h2 small{display:block;font-weight:500;color:var(--muted);font-size:11px}
.admin-nav{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important;position:static!important;top:auto!important;padding:10px!important;margin:0 0 12px!important;background:transparent!important;border:0!important}
.admin-nav button{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:6px!important;width:100%!important;min-height:74px!important;height:auto!important;padding:8px 6px!important;white-space:normal!important;border-radius:14px!important;background:#152033!important;border:1px solid #2b3c55!important;color:#dbe7f5!important;box-shadow:none!important}
.admin-nav button i{display:block!important;font-style:normal!important;font-size:22px!important;line-height:1}
.admin-nav button span{display:block!important;font-size:11px!important;line-height:1.35!important;text-align:center;white-space:normal!important;max-width:100%}
.admin-nav button.nav-on{background:linear-gradient(180deg,#0f766e,#115e59)!important;border-color:#2dd4bf!important;color:#fff!important}
.tabs{position:fixed!important;left:0!important;right:0!important;bottom:0!important;transform:none!important;width:100%!important;max-width:none!important;display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr))!important;gap:0!important;margin:0!important;padding:6px 4px calc(8px + env(safe-area-inset-bottom,0px))!important;border:0!important;border-top:1px solid #1f2a3c!important;border-radius:16px 16px 0 0!important;background:rgba(7,11,20,.94)!important;backdrop-filter:blur(16px);overflow:hidden!important;z-index:10070}
.tabs button{flex:none!important;min-width:0!important;width:auto!important;min-height:58px!important;height:auto!important;padding:6px 2px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:3px!important;border-radius:12px!important;background:transparent!important;color:#9db0ca!important;font-size:10px!important}
.tabs button i{font-style:normal;font-size:18px!important;line-height:1}
.tabs button span{display:block!important;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tabs button.on{color:#5eead4!important;background:#132a33!important}
.modal-tools{display:grid!important;grid-template-columns:1fr!important;gap:8px!important;padding:0!important}
.modal-tools input,.modal-tools select{width:100%!important;min-height:44px}
.task-metrics{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
.task-actions{display:grid!important;grid-template-columns:1fr!important;gap:8px!important}
.task-actions button{width:100%!important;min-height:44px!important}
.task-step,.task-pct{display:block!important;width:100%}
.task-card{border-radius:18px}
select,input,textarea{border-radius:12px!important;background:#0d1624!important;border:1px solid #2b3c55!important;color:#e8eef8!important}
.sub{display:block!important;color:var(--muted)!important}
@media(min-width:760px){
  .actions,.dispatch-hero .actions,.basalam-dispatch-hero .actions,.primary-actions{grid-template-columns:repeat(auto-fit,minmax(168px,1fr))!important}
  .task-actions{grid-template-columns:1fr 1fr!important}
  .modal-tools{grid-template-columns:minmax(0,1.4fr) minmax(0,.8fr) minmax(0,.8fr)!important}
  .admin-nav{grid-template-columns:repeat(3,minmax(0,1fr))!important}
}


/* === v10.134 mobile-first React-like shell === */
html,body{overflow-x:hidden!important;max-width:100%!important}
*,*::before,*::after{min-width:0}
img,svg,video,iframe,canvas,table{max-width:100%}
.wrap,.pane,.card,.hero,.grid,.grid4,.actions,.primary-actions,.start-journey,.picker-toolbar,.modal-tools,.tablebox{max-width:100%!important;overflow-x:hidden}
input,select,textarea{width:100%!important;max-width:100%!important;min-width:0!important;min-height:40px!important;font-size:16px!important}
button,.file-btn,.ghost{min-height:40px!important;font-size:13px!important;padding:8px 10px!important;font-weight:700}
.start-journey,.engine-roadmap,.anti-bot-hint,.hero-badge,.section-head small,.journey-line{display:none!important}
.hero{padding:10px 12px!important;margin-bottom:10px!important}
.hero h1{font-size:18px!important}
.card,.start-block{padding:12px!important;margin:0 0 10px!important;border-radius:14px!important}
.row-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.row-head h3{margin:0;font-size:14px!important}
.quiet{color:var(--muted);font-size:11px;margin:6px 0 0}
.text-actions{display:flex;gap:12px;margin-top:8px}
button.linkish{min-height:auto!important;height:auto!important;padding:0!important;background:none!important;border:0!important;box-shadow:none!important;color:#5eead4!important;font-size:12px!important;width:auto!important}
button.linkish.danger{color:#fb7185!important}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.start-more{margin-top:8px;border:1px solid #243044;border-radius:12px;padding:0 10px;background:#0d1624}
.start-more summary{list-style:none;cursor:pointer;padding:10px 0;font-size:13px;font-weight:700;color:#9db0ca}
.start-more .more-grid{display:grid;grid-template-columns:1fr;gap:8px;padding:0 0 10px}
.primary-actions{display:flex;flex-direction:column;gap:8px;padding:0!important;margin:10px 0!important;background:none!important;border:0!important;box-shadow:none!important}
#runBtn{width:100%;min-height:44px!important;font-size:15px!important;border-radius:12px!important;box-shadow:none!important;background:#2563eb!important}
.export-row{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px}
.ghost,.export-row .file-btn{display:grid;place-items:center;min-height:36px!important;padding:4px 2px!important;font-size:11px!important;background:#152033!important;border:1px solid #2b3c55!important;color:#dbe7f5!important;border-radius:10px!important;width:100%}
.clickable-counts{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:6px!important;margin:8px 0!important}
.clickable-counts button{min-height:48px!important;padding:6px 4px!important;box-shadow:none!important;border-radius:12px!important}
.clickable-counts button b{font-size:15px!important}
.clickable-counts button span{font-size:9px!important;line-height:1.2}
.grid,.grid4,.source-card>.grid{display:grid!important;grid-template-columns:1fr!important;gap:8px!important}
.admin-nav.nav-list,.admin-nav{display:flex!important;flex-direction:column!important;gap:2px!important;padding:6px!important;margin:0!important;background:transparent!important;border:0!important;position:static!important}
.admin-nav button{display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:flex-start!important;gap:10px!important;width:100%!important;min-height:44px!important;height:44px!important;padding:0 12px!important;border-radius:10px!important;background:transparent!important;border:0!important;box-shadow:none!important;color:#e8eef8!important;white-space:nowrap!important}
.admin-nav button i{font-size:16px!important;width:22px;text-align:center;line-height:1}
.admin-nav button span{font-size:13px!important;text-align:start!important;font-weight:600}
.admin-nav button.nav-on{background:#132a33!important;color:#5eead4!important}
.settings-panel-head h2{font-size:15px!important}
.settings-panel-head h2 small{display:none!important}
.tabs{grid-template-columns:repeat(7,minmax(0,1fr))!important;overflow:hidden!important}
.tabs button{min-height:52px!important;padding:4px 1px!important;font-size:9px!important}
.tabs button i{font-size:16px!important}
.chrome-btn,.hamburger-btn,.fullscreen-btn{width:36px!important;height:36px!important;min-width:36px!important;min-height:36px!important}
.task-manager-btn{height:36px!important;min-height:36px!important}
.app-chrome{min-height:48px;padding:4px 8px calc(4px)!important}
.actions{grid-template-columns:1fr 1fr!important;gap:6px!important}
.actions button{min-height:40px!important}
.task-actions{grid-template-columns:1fr 1fr!important}
.picker-toolbar{display:grid!important;grid-template-columns:1fr!important;gap:6px!important}
.tablebox{overflow-x:auto;max-width:100%}
@media(max-width:760px){
  table{width:100%;border:0}
  thead{display:none}
  table tr{display:block;margin:0 0 8px;border:1px solid #243044;border-radius:12px;padding:8px;background:#0d1624}
  table td{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border:0;font-size:13px}
}
@media(min-width:760px){
  .start-more .more-grid{grid-template-columns:1fr 1fr}
  .export-row{grid-template-columns:repeat(5,minmax(0,1fr))}
}


/* === v10.135 start color + profile sync === */
.profile-picker.start-block{background:linear-gradient(160deg,#11332f 0%,#0f1b2d 70%)!important;border-color:#1f6f64!important;box-shadow:inset 3px 0 0 #2dd4bf}
.source-card.start-block{background:linear-gradient(160deg,#1e3a8a 0%,#0f172a 62%)!important;border-color:#3b82f6!important;box-shadow:inset 3px 0 0 #60a5fa}
.primary-actions #runBtn{background:linear-gradient(90deg,#059669,#2563eb 55%,#7c3aed)!important;color:#fff!important}
.start-more{background:#0b1c33!important;border-color:#1e40af!important}
.profile-picker .badge.ok{background:#115e59;color:#5eead4;border-color:#2dd4bf55}
#status.card{border-color:#334155}


.admin-nav,.admin-nav.nav-list{display:flex!important;flex-direction:column!important;flex-wrap:nowrap!important;gap:2px!important}
.admin-nav button{display:flex!important;flex-direction:row!important;width:100%!important;min-height:42px!important;height:42px!important;white-space:nowrap!important}

</style></head><body>
<header class="app-chrome" id="appChrome">
<button type="button" class="chrome-btn hamburger-btn" id="hamburgerBtn" onclick="toggleSettingsPanel()" aria-label="تنظیمات">☰</button>
<div class="chrome-title">اسکرپر <small id="chromeVer">v10.141</small></div>
<button type="button" class="chrome-btn task-manager-btn" id="taskManagerTopBtn" onclick="openTaskManager()" aria-label="وظایف"><span class="task-btn-icon">◷</span><span class="task-btn-text">وظایف</span><b id="taskTopCount">۰</b></button>
<button type="button" class="chrome-btn fullscreen-btn" id="fullscreenBtn" onclick="toggleFullscreen()" aria-label="تمام‌صفحه">⛶</button>
</header><div class="settings-overlay" id="settingsOverlay" onclick="toggleSettingsPanel(false)"></div><aside class="settings-panel" id="settingsPanel"><div class="settings-panel-head"><h2>☰ تنظیمات عمومی <small>مرکز کنترل</small></h2><button class="gray" onclick="toggleSettingsPanel(false)">✕</button></div><div class="settings-panel-body"><div class="admin-nav nav-list"><button onclick="showAdmin('appearanceAdmin')"><i>🔠</i><span>نمایش و فونت</span></button><button onclick="showAdmin('backupAdmin')"><i>💾</i><span>پشتیبان سایت</span></button><button onclick="showAdmin('settings')"><i>🌐</i><span>اتصال مرکزی</span></button><button onclick="showAdmin('aiAdmin');loadAI()"><i>🤖</i><span>هوش مصنوعی</span></button><button onclick="showAdmin('basalamAdmin');loadBasalam()"><i>🏪</i><span>اتصال باسلام</span></button><button onclick="showAdmin('profiles')"><i>☆</i><span>پروفایل‌ها</span></button><button onclick="showAdmin('changelogAdmin');loadChangelog()"><i>📋</i><span>تغییرات نسخه</span></button><button onclick="showAdmin('deploy')"><i>↻</i><span>بروزرسانی</span></button><button onclick="showAdmin('files');browseFiles('')"><i>📁</i><span>فایل‌ها</span></button></div><section id="appearanceAdmin" class="admin-section"><div class="card appearance-card"><div class="section-head"><div><h3>🔠 اندازه نوشته‌ها</h3><small>اندازه تمام بخش‌های سایت فوراً تغییر می‌کند و در همین مرورگر می‌ماند.</small></div><span id="fontScaleBadge" class="badge">۱۰۰٪</span></div><label>اندازه فونت و کنترل‌ها</label><select id="fontScale" onchange="applyFontScale(this.value)"><option value="0.9">کوچک — ۹۰٪</option><option value="1">معمولی — ۱۰۰٪</option><option value="1.1">درشت — ۱۱۰٪</option><option value="1.2">خیلی درشت — ۱۲۰٪</option><option value="1.3">بسیار درشت — ۱۳۰٪</option></select><div class="font-preview"><b>نمونه عنوان محصول</b><span>این یک متن نمونه برای بررسی خوانایی رابط است.</span><button>نمونه دکمه</button></div><button class="gray" onclick="applyFontScale(1)">بازگردانی اندازه پیش‌فرض</button></div></section><section id="backupAdmin" class="admin-section"><div class="card backup-hero"><h3>💾 ذخیره و بازیابی همه تنظیمات سایت</h3><p class="note">این همان بخش پشتیبان کلی سایت است و شامل پروفایل‌ها، اتصال‌ها، صف‌ها، ارائه‌دهندگان، مدل‌ها و کلیدهای خصوصی می‌شود. فایل را امن نگه دارید.</p><div class="actions"><button class="green" onclick="backupSettings()">⬇ دانلود پشتیبان کامل</button><label class="file-btn">♻ بارگذاری و بازیابی فایل<input type="file" accept=".json,application/json" onchange="restoreSettings(this)"></label></div><div id="backupStatus" class="status">آماده دانلود یا بازیابی تنظیمات Python و بسته‌های PHP</div></div></section><section id="basalamAdmin" class="admin-section"><div class="card"><div class="section-head"><div><h3>🛍️ اتصال هوشمند باسلام</h3><small>SDK رسمی با fallback خودکار به REST API مستقل</small></div><span id="bslSdkBadge" class="badge">در حال بررسی…</span></div><div class="grid"><div><label>شناسه غرفه</label><input id="bsl_vendor" type="number"></div><div><label>شناسه دسته‌بندی پیش‌فرض</label><input id="bsl_category" type="number"></div><div class="wide"><label>جستجوی دسته‌بندی رسمی باسلام</label><div class="inline-search"><input id="bsl_category_query" placeholder="نام یا شناسه دسته"><button class="gray" onclick="searchBasalamCategories()">جستجو</button></div><div id="bslCategoryResults" class="category-results"></div></div><div class="wide"><label>Personal Token</label><input id="bsl_token" type="password" dir="ltr"></div><div class="wide"><label>Refresh Token</label><input id="bsl_refresh" type="password" dir="ltr"></div><div><label>روش مدیریت باسلام</label><select id="bsl_client_mode"><option value="auto">خودکار: SDK ← REST API</option><option value="api">فقط REST API مستقیم</option><option value="sdk">فقط SDK رسمی</option></select></div><div class="wide"><label>Base URL رسمی REST API</label><input id="bsl_api_base_url" dir="ltr" value="https://openapi.basalam.com"></div><div><label>زمان آماده‌سازی</label><input id="bsl_days" type="number" value="3"></div><div><label>وزن پیش‌فرض گرم</label><input id="bsl_weight" type="number" value="500"></div><div><label>موجودی پیش‌فرض</label><input id="bsl_stock" type="number" value="10"></div><div><label><input id="bsl_update" type="checkbox" checked style="width:auto"> بروزرسانی محصول هم‌SKU</label></div></div><div class="note" style="margin-top:12px">حالت خودکار ابتدا SDK و سپس REST API را امتحان می‌کند. مسیر شبکه از «دروازه اتصال مرکزی» خوانده می‌شود. Worker باید هدر <code>X-Proxy-Authorization</code> را به <code>Authorization</code> تبدیل و method/body را حفظ کند.</div><div class="wide" style="margin-top:12px;padding:10px;border:1px solid #334155;border-radius:10px">
<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px"><div><b>👥 غرفه‌های باسلام</b><div style="font-size:11px;opacity:.75;margin-top:2px">غرفه پیش‌فرض همان توکن بالاست. غرفه‌های اضافی در ارسال به همه استفاده می‌شوند.</div></div>
<button class="green" type="button" onclick="addBslVendor()">➕ افزودن غرفه</button></div>
<div id="bslVendorsList"></div>
<div class="grid" style="margin-top:8px">
<div><label>ارسال به غرفه‌ها</label><select id="bsl_send_all" onchange="bslRenderShopsHint()"><option value="1">همه غرفه‌های فعال</option><option value="0">فقط غرفه پیش‌فرض</option></select></div>
<div><label>روش ارسال چندغرفه</label><select id="bsl_send_mode" onchange="bslRenderShopsHint()"><option value="parallel">همزمان (موازی)</option><option value="sequential">ترتیبی</option></select></div>
</div>
<div id="bsShopsHint" class="status"></div>
</div>
<div class="actions"><button onclick="saveBasalam()">ذخیره</button><button class="gray" onclick="installBasalamSdk()">نصب/ترمیم SDK</button><button class="gray" onclick="testBasalam()">تست اتصال باسلام</button><button class="green" onclick="loadBasalamVendor()">اطلاعات غرفه</button><button class="green" onclick="loadBasalamProducts()">محصولات غرفه</button></div><div id="bslAdminStatus" class="status">توکن را بدون عبارت Bearer وارد کنید؛ در خطای 401 یک canary بی‌خطر مشخص می‌کند مشکل از Worker است یا خود توکن. هیچ fallback مخفی به اتصال مستقیم انجام نمی‌شود.</div><div id="bslLiveTask" class="live-task" style="display:none"><div class="live-task-head"><b id="bslTaskTitle">در حال اجرا</b><span id="bslTaskPercent">۰٪</span></div><div class="progress-track"><i id="bslTaskBar"></i></div><div id="bslTaskStep" class="live-step"></div><div id="bslTaskDetails" class="live-details"></div></div><div id="bslVendorCard"></div><div id="bslProductList" class="provider-list"></div></div><div class="card operations-card"><div class="section-head"><div><h3>💬 مرکز عملیات باسلام</h3><small>REST API مستقل برای گفت‌وگوها، پیام‌ها و سفارش‌های غرفه</small></div><span class="badge">فاز عملیات</span></div><div class="actions"><button class="green" onclick="loadBasalamOperations()">دریافت داشبورد</button><button class="gray" onclick="loadBasalamOperations()">↻ بروزرسانی</button></div><div id="bslOperationStats" class="stats"></div><div class="operation-columns"><div><h4>گفت‌وگوهای اخیر</h4><div id="bslChatList" class="operation-list"><div class="note">داشبورد را دریافت کنید.</div></div></div><div><h4>سفارش‌های غرفه</h4><div id="bslOrderList" class="operation-list"><div class="note">داشبورد را دریافت کنید.</div></div></div></div><div id="bslChatPanel" class="chat-panel" style="display:none"><div class="section-head"><b id="bslChatTitle">گفت‌وگو</b><button class="gray" onclick="$('bslChatPanel').style.display='none'">✕</button></div><div id="bslMessages" class="message-list"></div><div class="chat-compose"><textarea id="bslMessageText" rows="2" placeholder="پاسخ به مشتری…"></textarea><button onclick="sendBasalamMessage()">ارسال پیام</button></div></div><div id="bslOperationStatus" class="status">این بخش از REST API استفاده می‌کند و به نصب SDK وابسته نیست.</div></div></section><section id="aiAdmin" class="admin-section"><div class="card"><div class="section-head"><div><h3>🤖 مرکز هوش مصنوعی</h3><small>مدیریت چند ارائه‌دهنده، مدل‌ها و چند کلید API مانند نسخه PHP</small></div><span id="aiSummary" class="badge">در حال خواندن…</span></div><div class="ai-tabs"><button class="on" onclick="aiPane('providers',this)">🧠 ارائه‌دهنده‌ها</button><button onclick="aiPane('editor',this)">✏️ ویرایش</button><button onclick="aiPane('models',this);loadAIStats()">📋 مدل‌ها</button><button onclick="aiPane('candidates',this);loadAICandidates()">🏆 کاندید + مستر</button><button onclick="aiPane('test',this)">⚙️ مدل</button><button onclick="aiPane('content',this)">✍️ محتوا و دسته</button><button onclick="aiPane('health',this);loadAITestJobs()">🧪 تست مدل‌ها</button></div><div id="aiPaneProviders" class="ai-pane on"><div class="grid"><div><label>ارائه‌دهنده فعال</label><select id="ai_provider" onchange="aiSelectProvider()"><option value="">— ارائه‌دهنده‌ای نیست —</option></select></div><div><label>مدل فعال</label><select id="ai_model" onchange="aiSelectModel()"><option value="">—</option></select></div></div><div id="aiProviderList" class="provider-list"></div><div class="actions"><label class="file-btn">⬆ بارگذاری ai_providers.json<input type="file" accept=".json,application/json" onchange="importAIProviders(this)"></label><button class="gray" onclick="loadAI()">↻ تازه‌سازی</button></div></div><div id="aiPaneEditor" class="ai-pane"><div class="grid"><div><label>شناسه یکتا</label><input id="ai_edit_id" dir="ltr" placeholder="openrouter"></div><div><label>نام نمایشی</label><input id="ai_edit_name" placeholder="OpenRouter"></div><div><label>Vendor اختیاری</label><input id="ai_edit_vendor" dir="ltr"></div><div><label><input id="ai_edit_enabled" type="checkbox" checked style="width:auto"> ارائه‌دهنده فعال باشد</label></div><div class="wide"><label>Base URL یا Endpoint</label><input id="ai_endpoint" dir="ltr" placeholder="https://.../v1/chat/completions"></div><div class="wide"><label>کلیدهای API — هر خط: کلید | برچسب | Account ID کلادفلر</label><textarea id="ai_keys" rows="4" dir="ltr" placeholder="sk-... | حساب اول"></textarea></div><div class="wide"><label>مدل‌ها — هر خط: model-id | نام نمایشی | free</label><textarea id="ai_models" rows="7" dir="ltr" placeholder="model/id | نام مدل | free"></textarea></div></div><div class="actions"><button onclick="saveAIProvider()">ذخیره ارائه‌دهنده</button><button class="gray" onclick="newAIProvider()">ارائه‌دهنده تازه</button><button class="gray" onclick="deleteAIProvider()">حذف</button></div></div><div id="aiPaneModels" class="ai-pane"><div id="aiStatsCards" class="stats"></div><div id="aiStatsBars"></div><div class="modal-tools" style="padding:10px 0"><input id="aiCatalogSearch" placeholder="جستجوی مدل یا ارائه‌دهنده…" oninput="renderAIModelCatalog()"><select id="aiCatalogFilter" onchange="renderAIModelCatalog()"><option value="all">همه مدل‌ها</option><option value="available">سالم</option><option value="failed">ناموفق</option><option value="untested">تست‌نشده</option><option value="free">رایگان</option></select></div><div id="aiModelCatalog" class="model-catalog"></div></div><div id="aiPaneCandidates" class="ai-pane"><div class="note">مانند نسخه PHP، مدل‌های سالم را به کاندیدها اضافه کنید و یک مدل مستر برای دسته‌بندی و پاسخ خودکار تعیین کنید.</div><div class="grid"><div><label>ارائه‌دهنده</label><select id="aiCandProvider" onchange="renderCandidateModels()"></select></div><div><label>مدل سالم</label><select id="aiCandModel"></select></div></div><div class="actions"><button onclick="addAICandidate()">افزودن کاندید</button><button class="green" onclick="addAllHealthyCandidates()">افزودن همه سالم‌ها</button><button class="gray" onclick="saveAICandidates()">ذخیره</button></div><div id="aiCandidateList" class="candidate-list"></div><div class="grid"><div class="wide"><label>مدل مستر</label><select id="aiMasterModel" onchange="saveAICandidates()"><option value="">خودکار — بهترین امتیاز</option></select></div></div></div><div id="aiPaneTest" class="ai-pane"><div class="grid"><div><label>Temperature</label><input id="ai_temperature" type="number" min="0" max="2" step="0.1"></div><div><label>Max tokens</label><input id="ai_max_tokens" type="number" min="64" max="32000"></div><div class="wide"><label>System prompt</label><textarea id="ai_system_prompt" rows="3"></textarea></div><div class="wide"><label>پیام آزمایش</label><textarea id="ai_test_prompt" rows="3">فقط این JSON را برگردان: {"status":"ok"}</textarea></div></div><div class="actions"><button onclick="saveAIOptions()">ذخیره گزینه‌ها</button><button class="gray" onclick="testAI()">تست مدل فعال</button><button class="green" onclick="enrichAI()">تکمیل ۳ محصول</button></div></div><div id="aiPaneContent" class="ai-pane"><div class="note">توضیح‌ساز، دسته‌بندی و اصلاح دسته با <b>مدل فعال</b>. کار روی سرور می‌ماند.</div><div class="grid"><div><label>منبع محصولات</label><select id="ai_c_scope"><option value="results">نتایج همین استخراج</option><option value="profile">پروفایل فعال</option><option value="all">همه پروفایل‌ها</option></select></div><div><label>سقف هر اجرا</label><input id="ai_c_limit" type="number" min="1" max="80" value="20"></div><div class="wide"><label><input id="ai_c_missing" type="checkbox" checked style="width:auto"> فقط ناقص / دسته مشکوک</label></div></div><div class="actions" style="flex-wrap:wrap"><button class="green" onclick="startAIContent('desc')">✍️ توضیح‌ساز</button><button onclick="startAIContent('category')">📂 دسته‌بندی</button><button onclick="startAIContent('catfix')">🛠️ اصلاح دسته اشتباه</button><button class="gray" onclick="startAIContent('all')">همه با هم</button></div><div id="aiContentStatus" class="status">مدل و کلید را از تب ارائه‌دهنده‌ها انتخاب کنید.</div><div id="aiContentTask" class="card live-task" style="display:none"><div class="live-task-head"><b id="aiContentTitle">هوش مصنوعی</b><span id="aiContentPercent">۰٪</span></div><div class="progress-track"><i id="aiContentBar"></i></div><div id="aiContentStep" class="live-step"></div><div id="aiContentDetails" class="live-details"></div></div></div>
<div id="aiPaneHealth" class="ai-pane"><div class="grid grid4"><div><label>حداکثر مدل هر ارائه‌دهنده</label><input id="ai_test_per" type="number" min="1" max="5000" value="5000"></div><div><label>تأخیر بین مدل‌ها (ms)</label><input id="ai_test_delay" type="number" min="0" max="60000" value="120"></div><div><label>مدل در هر درخواست</label><input id="ai_test_batch" type="number" min="1" max="3" value="1"></div><div><label><input id="ai_test_only" type="checkbox" style="width:auto"> فقط تست‌نشده‌ها</label><label><input id="ai_test_skip" type="checkbox" checked style="width:auto"> ردکردن مدل غیرچت</label></div><div class="wide"><label>پیام نمونه مشتری</label><textarea id="ai_reply_sample" rows="2">سلام، این محصول موجود است و چه زمانی ارسال می‌شود؟</textarea></div><div class="wide"><label>عنوان نمونه برای دسته‌بندی</label><input id="ai_category_sample" value="ادو پرفیوم مردانه دیور ساواج ۱۰۰ میلی‌لیتر"></div></div><div class="actions"><button class="green" onclick="startAutoAITests()">▶ تست خودکار همه مدل‌ها</button><button onclick="processAITests()">اجرای فقط یک مرحله</button><button class="gray" onclick="stopAutoAITests()">توقف خودکار</button><button class="gray" onclick="openAITestModal()">جدول پیشرفته نتایج</button></div><div id="aiTestSummary" class="stats"></div><div id="aiTestRows" class="test-results"></div></div><div id="aiStatus" class="status">فایل PHP را بارگذاری کنید؛ ارائه‌دهنده‌ها و مدل‌ها فوراً در فهرست ظاهر می‌شوند.</div></div></section><div id="adminMount"></div></div></aside><div class="wrap">
<div id="deployBanner" class="deploy-banner"><span id="deployBannerText" style="flex:1;min-width:200px">⬆ نسخه جدید موجود است</span><button onclick="deployGoTo()">نصب کن</button><button class="ghost" onclick="dismissDeployBanner()">بعداً</button></div><header class="hero"><div class="hero-main"><div class="logo">🕸️</div><div><div class="eyebrow">مرکز استخراج محصول</div><h1>🛒 اسکرپر <small id="appVersion" onclick="deployGoTo()" title="برای بررسی به‌روزرسانی کلیک کنید">v10.141</small></h1><div class="sub">استخراج و مدیریت هوشمند محصولات</div></div></div><div class="hero-badge"><span>●</span> آنلاین و آماده</div></header><div id="toast"></div>

<section id="scrape" class="pane on"><div class="start-journey"><div class="journey-step active"><i>۱</i><span><b>پروفایل</b><small>انتخاب فروشگاه</small></span></div><div class="journey-line"></div><div class="journey-step"><i>۲</i><span><b>منبع</b><small>آدرس و صفحات</small></span></div><div class="journey-line"></div><div class="journey-step"><i>۳</i><span><b>استخراج سریع</b><small>فهرست بدون انتظار</small></span></div><div class="journey-line"></div><div class="journey-step"><i>۴</i><span><b>جزئیات</b><small>وظیفه پس‌زمینه</small></span></div></div><div class="card profile-picker start-block"><div class="row-head"><h3>پروفایل</h3><span id="activeProfileBadge" class="badge">جدید</span></div><select id="profileSelect" onchange="loadSelectedProfile()"><option value="">— پروفایل جدید —</option></select><div id="activeProfileInfo" class="quiet">با انتخاب، روی سرور ذخیره می‌شود.</div><div class="text-actions"><button type="button" class="linkish" onclick="saveProfilePrompt()">ذخیره</button><button type="button" class="linkish" onclick="renameSelectedProfile()">تغییر نام</button><button type="button" class="linkish danger" onclick="deleteSelectedProfile()">حذف</button></div></div><div class="card source-card start-block"><div class="row-head"><h3>منبع</h3></div>
<label>آدرس فهرست</label>
<input id="url" placeholder="https://example.com/category" dir="ltr">
<div class="pair">
<div><label>صفحات</label><input id="pages" type="number" min="1" max="50" value="1"></div>
<div><label>روش</label><select id="render"><option value="auto">خودکار</option><option value="http">فقط HTML</option><option value="browser">فقط مرورگر</option></select></div>
</div>
<details class="start-more"><summary>پیشرفته</summary>
<div class="more-grid">
<div><label>موتور ضدبات</label><select id="fetch_engine" onchange="onFetchEngineChange()"><option value="auto">خودکار · مستر + پشتیبان</option><option value="requests">Requests</option><option value="httpx">httpx</option><option value="cloudscraper">Cloudscraper</option><option value="curl_cffi">curl_cffi</option><option value="playwright">Playwright</option><option value="selenium">Selenium</option></select><input type="hidden" id="fetch_engine_master"><div id="engineMasterHint" class="quiet" style="font-size:11px;margin-top:4px">استخراج اول سریع‌ترین موتور این سایت را مستر می‌کند</div></div>
<div><label>صفحه‌بندی</label><select id="pagination"><option value="query">Query</option><option value="path">مسیر</option><option value="full">URL کامل</option><option value="next">لینک بعد</option></select></div>
<div><label>پارامتر صفحه</label><input id="page_value" value="page" dir="ltr" placeholder="page"></div>
<div><label>اسکرول مرورگر</label><input id="scrolls" type="number" value="4" min="0" max="12"></div>
<div><label>جزئیات خودکار</label><select id="enrich"><option value="1" selected>روشن</option><option value="0">خاموش</option></select></div>
<div><label>دامنه جزئیات</label><select id="detail_scope"><option value="missing">فقط ناقص</option><option value="all">همه</option></select></div>
<div class="wide"><label>سقف جزئیات</label><input id="detail_limit" type="number" value="0" min="0" max="2000"></div>
</div></details></div>
<details class="card advanced"><summary><span><b>🎨 مرکز سلکتورها و انتخابگر بصری</b><small>انتخاب دستی فهرست و جزئیات محصول، مطابق نسخه PHP</small></span><i>⌄</i></summary><div class="advanced-body"><div class="note">مانند نسخه PHP، استخراج فقط از DOM و سلکتورها انجام می‌شود. برای سایت‌های JavaScript حالت Playwright را انتخاب کنید.</div><div class="selector-tabs"><button id="selectorTabList" class="on" onclick="selectorTab('list')">🛍️ فهرست محصولات</button><button id="selectorTabDetail" onclick="selectorTab('detail')">🔎 جزئیات محصول</button></div><div id="selectorListPanel" class="selector-panel on"><h3 class="section-mini">سلکتورهای فهرست محصولات</h3><div class="grid grid4"><div><label>ظرف محصول *</label><input id="sel_container" dir="ltr" placeholder="article.product"></div><div><label>عنوان</label><input id="sel_title" dir="ltr" placeholder="h2.title"></div><div><label>قیمت</label><input id="sel_price" dir="ltr" placeholder=".price"></div><div><label>لینک</label><input id="sel_link" dir="ltr" placeholder="a"></div><div><label>تصویر</label><input id="sel_image" dir="ltr" placeholder="img"></div><div><label>SKU</label><input id="sel_sku" dir="ltr"></div></div></div><div id="selectorDetailPanel" class="selector-panel"><h3 class="section-mini">سلکتورهای صفحه جزئیات</h3><div class="grid grid4"><div><label>گالری تصاویر</label><input id="det_gallery" dir="ltr" placeholder=".gallery img"></div><div><label>تنوع‌ها</label><input id="det_variations" dir="ltr" placeholder=".variations | .sizes"></div><div><label>وزن</label><input id="det_weight" dir="ltr"></div><div><label>دسته‌بندی</label><input id="det_category" dir="ltr"></div><div><label>قیمت جزئیات</label><input id="det_price" dir="ltr"></div><div><label>موجودی</label><input id="det_stock" dir="ltr"></div><div><label>برند</label><input id="det_brand" dir="ltr"></div><div><label>SKU</label><input id="det_sku" dir="ltr"></div><div><label>توضیح کوتاه</label><input id="det_short_desc" dir="ltr"></div><div><label>توضیح بلند</label><input id="det_long_desc" dir="ltr"></div><div><label>برچسب‌ها</label><input id="det_tags" dir="ltr"></div><div><label>جدول مشخصات</label><input id="det_attributes" dir="ltr" placeholder="table.specs tr"></div></div></div>
<div class="card" id="galleryCard"><h3 class="section-mini">گالری چندعکسی · هم‌تراز PHP</h3>
<div class="grid"><div><label>روش گالری</label><select id="galMode" onchange="galModeChanged()"><option value="auto" selected>خودکار از باکس عکس‌ها</option><option value="off">خاموش — فقط یک عکس</option><option value="manual">سلکتورهای دستی</option><option value="number">الگوی شماره‌دار {n}</option></select></div>
<div id="galAutoBox"><label>ظرف گالری</label><input id="galBox" dir="ltr" placeholder=".woocommerce-product-gallery"></div>
<div id="galManualBox" class="hidden"><label>سلکتورها (هر خط یا |)</label><textarea id="galSelectors" rows="3" dir="ltr" placeholder=".gallery img | .thumb img"></textarea></div>
<div id="galNumberBox" class="hidden"><label>الگو با {n}</label><input id="galPattern" dir="ltr" placeholder=".thumb-{n} img"><div class="pair"><input id="galFrom" type="number" value="1" min="0"><input id="galTo" type="number" value="12" min="0"></div></div>
<label class="checkline"><input type="checkbox" id="galSkipFirst"> عکس اول را رد کن</label></div></div>
<div class="visual-picker"><div class="section-head"><div><h3>🎯 انتخابگر بصری DOM</h3><small>مانند نسخه PHP: جزء را روی صفحه انتخاب کنید و با والد/فرزند/هم‌سطح سلکتور را اصلاح کنید.</small></div><span id="pickerReady" class="badge">آماده بارگذاری</span></div><div class="picker-toolbar"><select id="pickerField" onchange="pickerContext()"></select><input id="pickerUrl" dir="ltr" placeholder="آدرس فهرست یا صفحه محصول"><button onclick="loadVisualPicker()">بارگذاری</button><button class="green" onclick="loadSnappPicker()">اسنپ‌شاپ / SPA</button><button class="green" onclick="nextPickerField()">⏭ فیلد بعدی</button><button class="gray" onclick="closeVisualPicker()">✕ بستن</button><button class="green" onclick="saveProfilePrompt()">💾 ذخیره در پروفایل</button></div><div id="pickerChips" class="picker-chips"></div><div id="pickerControls" class="picker-controls"><button onclick="pickerMove('up')">⬆ والد</button><button onclick="pickerMove('down')">⬇ فرزند</button><button onclick="pickerMove('prev')">→ قبلی</button><button onclick="pickerMove('next')">← بعدی</button><span id="pickerSelection">یک جزء را انتخاب کنید</span><label class="picker-height">ارتفاع <input type="range" min="350" max="1400" value="720" oninput="setPickerHeight(this.value)"></label></div><div id="pickerFrameWrap" class="picker-frame-wrap"><iframe id="pickerFrame" sandbox="allow-scripts" title="پیش‌نمایش انتخابگر سلکتور"></iframe></div><div id="pickerStatus" class="status">در تب فهرست، ظرف محصول و اجزای کارت را انتخاب کنید؛ در تب جزئیات، صفحه یکی از محصولات را باز کنید.</div></div></div></details><div class="primary-actions"><button id="runBtn" type="button" onclick="runScrape()">شروع برداشت</button><div class="export-row"><button type="button" class="ghost" onclick="saveProfilePrompt()">ذخیره</button><button type="button" class="ghost" onclick="downloadCSV()">CSV</button><button type="button" class="ghost" onclick="downloadJSON()">JSON</button><button type="button" class="ghost" onclick="downloadXLSX()">Excel</button><label class="ghost file-btn">ورود<input id="csvImport" type="file" accept=".csv,text/csv" onchange="importCSV(this)"></label></div></div>
<div id="status" class="card status">آماده برای برداشت محصولات</div><div id="extractLiveTask" class="card live-task" style="display:none"><div class="live-task-head"><b id="extractTaskTitle">استخراج محصولات</b><span id="extractTaskPercent">۰٪</span></div><div class="progress-track"><i id="extractTaskBar"></i></div><div id="extractTaskMetrics" class="task-metrics"></div><div id="extractTaskStep" class="live-step"></div><div id="extractTaskDetails" class="live-details"></div></div><div id="extractCounters" class="stats clickable-counts"><button onclick="openChangeList('all')"><b>۰</b><span>کل محصولات</span></button><button onclick="openChangeList('added')"><b>۰</b><span>محصول جدید</span></button><button onclick="openChangeList('price_changed')"><b>۰</b><span>تغییر قیمت</span></button><button onclick="openChangeList('changed')"><b>۰</b><span>تغییر محتوا</span></button><button onclick="openChangeList('removed')"><b>۰</b><span>حذف‌شده</span></button><button onclick="openChangeList('unchanged')"><b>۰</b><span>بدون تغییر</span></button></div><div class="card tablebox"><table><thead><tr><th>#</th><th>تصویر</th><th>عنوان</th><th>قیمت</th><th>SKU</th><th>جزئیات</th><th>لینک</th></tr></thead><tbody id="rows"><tr><td class="empty" colspan="6">پس از شروع برداشت، محصولات اینجا نمایش داده می‌شوند.</td></tr></tbody></table></div></section>
<section id="profileSettings" class="pane"><div class="card"><h3>⚙️ تنظیمات پروفایل</h3><div class="grid grid4"><div><label>پیشوند عنوان</label><input id="rule_title_prefix"></div><div><label>پسوند عنوان</label><input id="rule_title_suffix"></div><div><label>نوع تعدیل قیمت</label><select id="rule_price_mode"><option value="none">بدون تغییر</option><option value="percent">درصد</option><option value="multiplier">ضریب</option><option value="fixed">مبلغ ثابت</option></select></div><div><label>مقدار تعدیل</label><input id="rule_price_value" type="number" step="0.01" value="0"></div><div><label>گردکردن قیمت</label><input id="rule_price_round" type="number" value="0" placeholder="مثلاً 1000"></div><div><label>موجودی پیش‌فرض</label><input id="rule_default_stock" type="number"></div><div><label>دسته‌بندی پیش‌فرض</label><input id="rule_default_category"></div><div><label>شناسه دسته باسلام</label><input id="rule_bsl_category_id" type="number"></div><div><label>شناسه دسته ووکامرس</label><input id="rule_woo_category_id" type="number"></div></div><div class="destination-price-grid"><div class="destination-price-card woo-price-card"><h3>🛒 تعدیل قیمت ووکامرس</h3><div class="grid"><div><label>روش</label><select id="rule_woo_price_mode"><option value="none">بدون تغییر</option><option value="percent">درصد</option><option value="multiplier">ضریب</option><option value="fixed">مبلغ ثابت</option></select></div><div><label>مقدار</label><input id="rule_woo_price_value" type="number" step="0.01" value="0"></div><div class="wide"><label>گرد کردن</label><input id="rule_woo_price_round" type="number" value="0" placeholder="مثلاً 1000"></div></div></div><div class="destination-price-card bsl-price-card"><h3>🏪 تعدیل قیمت باسلام</h3><div class="grid"><div><label>روش</label><select id="rule_bsl_price_mode"><option value="none">بدون تغییر</option><option value="percent">درصد</option><option value="multiplier">ضریب</option><option value="fixed">مبلغ ثابت</option></select></div><div><label>مقدار</label><input id="rule_bsl_price_value" type="number" step="0.01" value="0"></div><div class="wide"><label>گرد کردن</label><input id="rule_bsl_price_round" type="number" value="0" placeholder="مثلاً 1000"></div></div></div></div><div class="note">تنظیم عمومی روی نتیجه استخراج اعمال می‌شود؛ تعدیل هر مقصد فقط هنگام ارسال همان پروفایل محاسبه خواهد شد.</div></div></section>
<section id="selectors" class="pane"><div id="selectorsMount"></div></section>
<section id="results" class="pane"><div class="card result-hero"><div><h3>📊 محصولات استخراج‌شده</h3><small>جدول کامل محصولات فقط در این تب نمایش داده می‌شود.</small></div><span id="resultCountBadge" class="badge">۰ محصول</span></div><div class="result-view-tabs"><button id="resultViewTable" onclick="setResultView('table')">📋 جدول</button><button id="resultViewCards" onclick="setResultView('cards')">📊 کارت</button><button id="resultViewText" onclick="setResultView('text')">📝 متن</button></div><div class="card comparison-history-card"><div class="section-head"><div><h3>🕘 تاریخچه مقایسه پروفایل</h3><small>خلاصه ده استخراج اخیر روی سرور نگهداری می‌شود.</small></div></div><div id="comparisonHistory" class="comparison-history"><div class="note">پس از اولین استخراج، تاریخچه اینجا نمایش داده می‌شود.</div></div></div><div class="card detail-coverage-card"><div class="section-head"><div><h3>✨ پوشش اطلاعات تفصیلی</h3><small>وضعیت توضیحات، تصاویر گالری، تنوع‌ها و مشخصات استخراج‌شده</small></div></div><div id="detailCoverage" class="stats"></div></div><div class="primary-actions actions"><button onclick="openTab('scrape');$('enrich').value='1';$('detail_scope').value='all'">🔍 آماده‌سازی استخراج تفصیلی همه</button><button class="green" onclick="downloadCSV()">↓ CSV</button><button class="gray" onclick="downloadJSON()">↓ JSON</button><button class="gray" onclick="downloadXLSX()">↓ Excel</button></div><div id="resultsMount"></div><div id="resultCardsMount" class="product-card-grid"></div><pre id="resultTextMount" class="result-text-view"></pre></section>
<section id="imports" class="pane"><div class="card"><h3>📥 درون‌ریزی و نگاشت CSV</h3><div class="note">ابتدا فایل را پیش‌نمایش کنید، سپس ستون هر فیلد و تعدیل قیمت/عنوان را مشخص کنید.</div><div class="actions"><label class="file-btn">انتخاب CSV<input id="advancedCsv" type="file" accept=".csv,text/csv" onchange="previewImport(this)"></label></div><div id="importMap" class="grid grid4" style="margin-top:14px"></div><div id="importOptions" class="grid" style="display:none;margin-top:14px"><div><label>ضریب قیمت</label><input id="impMul" type="number" step="0.01" value="1"></div><div><label>مبلغ ثابت افزوده</label><input id="impAdd" type="number" value="0"></div><div><label>پیشوند عنوان</label><input id="impPrefix"></div><div><label>پسوند عنوان</label><input id="impSuffix"></div><div><label>شیوه ورود</label><select id="impMode"><option value="replace">جایگزینی نتایج</option><option value="append">افزودن/بروزرسانی نتایج</option></select></div></div><div id="importPreview" class="status" style="display:none;margin-top:14px"></div><div class="actions"><button id="applyImportBtn" style="display:none" onclick="applyImport()">اجرای درون‌ریزی</button></div></div></section>

<section id="jobs" class="pane"><div class="card"><div class="section-head"><div><h3>◷ مرکز مدیریت وظایف</h3><small>همه عملیات بلندمدت، حتی پس از refresh، با زمان‌بندی و جزئیات قابل پیگیری‌اند</small></div><span id="taskManagerBadge" class="badge">—</span></div><div id="taskManagerStats" class="stats"></div><div class="note">استخراج‌ها مستقل و موازی اجرا می‌شوند؛ توقف یک سایت، پروفایل‌های دیگر را معطل نمی‌کند.</div><div class="modal-tools" style="margin-top:10px"><input id="taskSearch" placeholder="جستجو در پروفایل، مرحله یا خطا…" oninput="renderTaskManager()"><select id="taskStatusFilter" onchange="renderTaskManager()"><option value="all">همه وضعیت‌ها</option><option value="active">فعال</option><option value="completed">کامل</option><option value="failed">ناموفق/قطع‌شده</option></select><select id="taskKindFilter" onchange="renderTaskManager()"><option value="all">همه عملیات</option><option value="scrape">استخراج سریع</option><option value="detail_extract">جزئیات محصولات</option><option value="profile_dispatch">ارسال مقصدها</option><option value="destination_reconcile">مغایرت‌گیری مقصد</option><option value="destination_repair">ترمیم مقصد</option><option value="basalam_sdk">SDK باسلام</option><option value="ai_test">آزمون مدل‌های AI</option></select></div><div class="actions"><button onclick="loadTaskManager()">↻ تازه‌سازی</button><button class="gray" onclick="taskAutoRefresh=!taskAutoRefresh;loadTaskManager()" id="taskAutoBtn">پایش خودکار: روشن</button></div><div id="taskManagerList" class="task-center"></div></div><div class="card"><h3>صف استخراج و نقاط ادامه</h3><div class="note">پس از هر صفحه یک checkpoint اتمیک ذخیره می‌شود؛ عملیات قطع‌شده را بدون شروع از ابتدا ادامه دهید.</div><div class="actions"><button onclick="loadJobs()">تازه‌سازی نقاط ادامه</button></div><div id="jobList"></div></div></section><section id="changelogAdmin" class="admin-section"><div class="card"><div class="section-head"><div><h3>📋 گزارش تغییرات نسخه‌ها</h3><small>تاریخچه قابلیت‌های نصب‌شده این فایل</small></div><span id="changeCurrent" class="badge"></span></div><div id="changelogList" class="changelog"></div></div></section>
<section id="files" class="pane"><div class="card"><h3>📁 فایل اکسپلورر فضای حساب</h3><div class="note">نمایش فقط‌خواندنی پوشه خانگی؛ فایل‌های سیستمی، توکن‌ها و اطلاعات شخصی از این بخش حذف یا باز نمی‌شوند.</div><div id="spaceSummary" class="stats" style="margin-top:12px"></div><div id="quotaInfo" class="status" style="margin-top:12px"></div><div class="actions"><button class="gray" onclick="browseFiles(fileParent)">⬆ پوشه بالاتر</button><button onclick="browseFiles(fileCurrent)">تازه‌سازی</button></div><div id="filePath" class="status" dir="ltr"></div><div id="fileRows" class="file-list"></div></div></section>
<section id="profiles" class="pane"><div class="card"><h3>پروفایل‌های ذخیره‌شده</h3><div id="profileList"></div></div></section>
<section id="settings" class="pane"><div class="card gateway-card"><div class="section-head"><div><h3>🌐 دروازه مرکزی اتصال‌های خروجی</h3><small>یک مسیر مشترک برای استخراج، باسلام، ووکامرس، هوش مصنوعی، GitHub و Reload</small></div><span id="gatewayModeBadge" class="badge">—</span></div><div class="gateway-flow"><span>Scraper4</span><i>←</i><strong id="gatewayFlowMode">دروازه</strong><i>←</i><span>سرویس‌های بیرونی</span></div><div class="grid"><div><label>Timeout ثانیه</label><input id="timeout" type="number"></div><div><label>فاصله درخواست‌ها، ms</label><input id="gap_ms" type="number"></div><div class="wide"><label>آدرس Cloudflare Worker یا HTTP Proxy</label><input id="proxy" dir="ltr" placeholder="https://proxy.example.workers.dev"></div><div><label>نوع اتصال همه سرویس‌ها</label><select id="proxy_mode" onchange="updateGatewayUI()"><option value="relay">Cloudflare Worker با پارامتر url</option><option value="direct">اتصال مستقیم</option><option value="http">HTTP CONNECT Proxy</option><option value="auto">تشخیص خودکار</option></select></div><div><label>کلید محافظتی Worker، اختیاری</label><input id="worker_key" type="password" dir="ltr"></div><div><label><input id="verify_tls" type="checkbox" style="width:auto"> بررسی گواهی TLS</label></div></div><div class="gateway-services"><span>🎯 استخراج</span><span>🛍️ باسلام</span><span>🛒 ووکامرس</span><span>🤖 هوش مصنوعی</span><span>↻ GitHub</span><span>🖥️ VPS</span></div><div class="actions"><button onclick="saveSettings()">ذخیره مسیر مرکزی</button><button class="green" onclick="diagnoseGateway()">آزمایش کامل Worker</button><button class="gray" onclick="useMyWorker()">Worker پیش‌فرض</button></div><div id="networkStatus" class="status">آزمایش کامل مشخص می‌کند Worker هدر Authorization، متد POST و بدنه JSON را واقعاً عبور می‌دهد یا خیر.</div></div></section>
<section id="basalamSend" class="pane"><div class="card dispatch-hero basalam-dispatch-hero"><div class="section-head"><div><h3>🏪 ارسال محصولات به باسلام</h3><small>ارسال کامل محصولات ذخیره‌شده پروفایل فقط به باسلام</small></div><span class="badge ok">مقصد مستقل</span></div><div class="grid"><div class="wide"><label>پروفایل مقصد</label><select id="dispatchProfileBasalam"></select></div></div><div class="actions"><button class="green" onclick="dispatchBasalamProfile()">🚀 ارسال این پروفایل به باسلام</button><button onclick="dispatchAllBasalamProfiles()">ارسال همه پروفایل‌ها</button><button class="gray" onclick="openTaskManager()">مشاهده تسک منیجر</button></div><div id="bslDispatchStatus" class="status">این تب فقط عملیات باسلام را اجرا می‌کند و هیچ ارسال ووکامرسی انجام نمی‌شود.</div></div><div id="basalamSendMount"></div><div class="card reconcile-card"><h3>🔍 مغایرت‌گیری غرفه باسلام</h3><small>تطبیق با دفترچه شناسه، SKU و عنوان؛ بدون تغییر محصولات مقصد</small><div class="actions"><button onclick="startDestinationReconcile('basalam')">بررسی این پروفایل</button><button class="gray" onclick="loadDestinationReport('basalam')">آخرین گزارش</button></div><div id="reconcileBasalam" class="reconcile-report note">هنوز گزارشی اجرا نشده است.</div></div></section><section id="woo" class="pane"><div class="card dispatch-hero"><div class="section-head"><div><h3>🚀 ارسال کامل محصولات پروفایل</h3><small>کل محصولات ذخیره‌شده پروفایل، بدون نیاز به بازماندن صفحه، روی سرور ارسال می‌شوند</small></div><span class="badge">خودکار</span></div><div class="grid"><div><label>پروفایل مقصد</label><select id="dispatchProfile"></select></div><div><label>مقصدها</label><label><input id="dispatchWoo" type="checkbox" checked style="width:auto"> ووکامرس</label><label><input id="dispatchBasalam" type="checkbox" checked style="width:auto"> باسلام</label></div></div><div class="actions"><button class="green" onclick="dispatchSelectedProfile()">▶ ارسال کامل این پروفایل</button><button onclick="dispatchAllProfiles()">ارسال کامل همه پروفایل‌ها</button><button class="gray" onclick="openTaskManager()">مشاهده تسک منیجر</button></div><div id="dispatchStatus" class="status">هر پروفایل از محصولات ذخیره‌شده خودش استفاده می‌کند؛ پیشرفت و خطاها در تسک منیجر ثبت می‌شوند.</div></div><div class="card reconcile-card"><h3>🔍 مغایرت‌گیری ووکامرس</h3><small>تطبیق با دفترچه شناسه، SKU و عنوان؛ بدون تغییر محصولات مقصد</small><div class="actions"><button onclick="startDestinationReconcile('woocommerce')">بررسی این پروفایل</button><button class="gray" onclick="loadDestinationReport('woocommerce')">آخرین گزارش</button></div><div id="reconcileWoo" class="reconcile-report note">هنوز گزارشی اجرا نشده است.</div></div><div class="card"><h3>اتصال و صف ووکامرس</h3><div class="grid"><div class="wide"><label>URL فروشگاه</label><input id="woo_url" dir="ltr"></div><div><label>Consumer key</label><input id="woo_ck" dir="ltr"></div><div><label>Consumer secret</label><input id="woo_cs" type="password" dir="ltr"></div><div><label>وضعیت محصول</label><select id="woo_product_status"><option value="draft">پیش‌نویس</option><option value="publish">انتشار</option><option value="pending">در انتظار بررسی</option><option value="private">خصوصی</option></select></div><div><label>تعداد هر مرحله</label><input id="woo_batch" type="number" min="1" max="500" value="50"></div><div><label><input id="woo_update" type="checkbox" checked style="width:auto"> بروزرسانی محصول هم‌SKU</label></div></div><div class="actions"><button onclick="saveSettings(true)">ذخیره اتصال</button><button class="gray" onclick="wooTest()">تست</button><button class="green" onclick="wooQueue()">افزودن نتایج به صف</button><button class="gray" onclick="loadWooJobs()">تازه‌سازی صف</button></div><div id="wooStatus" class="status">صف کامل روی VPS در پس‌زمینه تا انتها خالی می‌شود</div><div id="wooJobList"></div></div><div class="card"><div class="section-head"><div><h3>🛍️ صف حرفه‌ای باسلام</h3><small>ایجاد یا ویرایش براساس SKU، همراه تصاویر و ادامه‌پذیر بعد از قطع صفحه</small></div><span class="badge">SDK رسمی</span></div><div class="grid"><div><label>تعداد در هر مرحله</label><input id="bsl_batch" type="number" min="1" max="200" value="20"></div><div><label>عملیات</label><button class="green" onclick="createBasalamQueue()">افزودن همه نتایج به صف</button></div></div><div class="actions"><button onclick="processBasalamQueue()">▶ تخلیه کامل صف</button><button class="gray" onclick="loadBasalamJobs()">↻ تازه‌سازی صف‌ها</button></div><div id="bslSendStatus" class="status">صف کامل باسلام روی سرور تا انتها ارسال می‌شود</div><div id="bslJobList" class="provider-list"></div></div></section>
<section id="deploy" class="pane"><div class="card"><h3>🔄 نسخهٔ کد و نصب از GitHub</h3><div class="note">همه برنچ‌های کاندید بررسی می‌شوند و برنچی که <b>جدیدترین <code>APP_VERSION</code></b> را داشته باشد نصب می‌شود. نسخه تازه پیش از نصب با کامپایل Python بررسی و نسخه فعلی در <code>scraper4.py.bak</code> نگه داشته می‌شود. برای repository خصوصی بهتر است متغیر محیطی <code>GITHUB_TOKEN</code> را در WSGI تنظیم کنید.</div><div id="deployLocal" class="deploy-local">—</div><button class="green" onclick="deployCheckInstall(true)" id="deployMainBtn" style="width:100%;padding:12px;font-size:14px;margin-top:10px">🔍 بررسی و نصب نسخهٔ جدید</button><button class="gray" onclick="deployRun()" id="deployUpdateBtn" style="width:100%;padding:11px;margin-top:8px;display:none">⬇ نصب جدیدترین نسخه</button><div id="deployStatus" class="status" style="margin-top:8px">ابتدا تنظیمات را ذخیره و سپس نسخه را بررسی کنید.</div><label class="checkline"><input type="checkbox" id="dep_autocheck" onchange="saveDeploy(true)"> بررسی خودکار هنگام باز/رفرش شدن صفحه (فقط اطلاع می‌دهد؛ نصب با تأیید شماست)</label><div class="smenu-hdr" style="padding:10px 0;border-top:1px solid var(--line);margin-top:12px"><h3 style="font-size:12px;color:var(--muted)">⚙️ منبع و نصب‌کننده</h3></div><div class="grid" style="margin-top:6px"><div><label>Repository (owner/repo)</label><div style="display:flex;gap:6px"><input id="dep_repo" dir="ltr" style="flex:1"><button class="gray" onclick="loadDeployBranches(true)" id="depRepoBtn" style="flex:0 0 auto;width:auto;padding:8px 12px">🔄</button></div></div><div><label>مسیر فایل در repository</label><div style="position:relative"><input id="dep_path" dir="ltr" autocomplete="off" oninput="filterDeployFiles()" onfocus="filterDeployFiles()"><div class="vc-drop" id="depFileDrop"></div></div><small id="depFileCount" style="color:var(--muted);font-size:10px"></small></div><div class="wide"><label>برنچ‌های کاندید — هر خط یک برنچ (جدیدترین نسخه نصب می‌شود)</label><textarea id="dep_branches" dir="ltr" rows="3" placeholder="arena/01a06ac3-amphp&#10;arena/01a0640f-amphp"></textarea><div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><div style="flex:1;position:relative;min-width:150px"><input id="dep_branch_pick" dir="ltr" autocomplete="off" placeholder="کلیک یا تایپ برای انتخاب برنچ…" oninput="filterDeployBranches()" onfocus="filterDeployBranches()"><div class="vc-drop" id="depBranchDrop"></div></div><button class="gray" onclick="addDeployBranch()" style="width:auto">＋ افزودن برنچ</button></div><div id="depBranchChips" class="branch-chips"></div><input id="dep_branch" type="hidden"></div><div><label>GitHub token اختیاری</label><input id="dep_token" type="password" dir="ltr" placeholder="خالی = نگه‌داشتن قبلی / استفاده از GITHUB_TOKEN"></div><div><label>مسیر کامل WSGI برای Reload اختیاری</label><input id="dep_reload" dir="ltr" placeholder="/var/www/USERNAME_pythonanywhere_com_wsgi.py"></div></div><div style="font-size:10px;color:var(--muted);margin-top:6px">برای حذف توکن ذخیره‌شده، عبارت <code>__CLEAR__</code> را در فیلد توکن بنویسید و ذخیره کنید.</div><div class="actions"><button onclick="saveDeploy()">💾 ذخیره تنظیمات</button><button class="gray" onclick="deployCheck()">بررسی نسخه‌ها</button><button class="green" onclick="deployRun()">⬇ نصب جدیدترین</button><button class="gray" onclick="deployRollback()">بازگشت به .bak</button><button class="gray" onclick="cleanupAccount()">پاکسازی فضای بلااستفاده</button><button class="gray" onclick="installDeps()">پاکسازی و نصب سبک Playwright</button></div><div id="deployCandidates" class="cand-table"></div></div></section>
<footer class="app-footer"><nav class="tabs" aria-label="مراحل پروفایل"><button class="on" data-tab="scrape"><i>🎯</i><span>شروع</span></button><button data-tab="profileSettings"><i>⚙️</i><span>تنظیمات</span></button><button data-tab="selectors"><i>🎨</i><span>سلکتورها</span></button><button data-tab="results"><i>📊</i><span>نتایج</span></button><button data-tab="woo"><i>🛒</i><span>ووکامرس</span></button><button data-tab="basalamSend"><i>🏪</i><span>باسلام</span></button><button data-tab="imports"><i>📥</i><span>درون‌ریزی</span></button></nav></footer></div><div id="productDetailModal" class="result-modal" onclick="if(event.target===this)closeProductDetail()"><div class="result-modal-card product-detail-card"><div class="result-modal-head"><div><h2 id="productDetailTitle">جزئیات محصول</h2><small id="productDetailMeta"></small></div><button class="gray" onclick="closeProductDetail()">✕ بستن</button></div><div id="productDetailBody" class="product-detail-body"></div></div></div><div id="changeModal" class="result-modal change-modal" onclick="if(event.target===this)closeChangeList()"><div class="result-modal-card"><div class="result-modal-head"><div><h2 id="changeModalTitle">جزئیات تغییرات</h2><small id="changeModalSub"></small></div><button class="gray" onclick="closeChangeList()">✕ بستن</button></div><div id="changeModalList" class="change-product-list"></div></div></div><div id="aiTestModal" class="result-modal" onclick="if(event.target===this)closeAITestModal()"><div class="result-modal-card"><div class="result-modal-head"><div><h2>🧪 آزمایشگاه پیشرفته مدل‌ها</h2><small id="aiModalSubtitle">پاسخ مشتری و دسته‌بندی نمونه برای همه مدل‌ها</small></div><div class="actions"><button class="green" onclick="activateBestAIModel()">★ فعال‌سازی بهترین</button><button class="gray" onclick="downloadAITestResults()">↓ JSON</button><button class="gray" onclick="closeAITestModal()">✕</button></div></div><div class="ai-lab-search"><input id="aiResultSearch" placeholder="جستجوی مدل…" oninput="aiResultPage=1;renderAITestModal()"><div class="ai-lab-hint">جدول را افقی بکشید تا ستون مدل‌ها دیده شود</div></div><div id="aiModalStats" class="stats"></div><div id="aiCompareBar" class="ai-compare-bar"></div><div class="modal-table"><table class="ai-pro-table"><thead><tr><th>انتخاب</th><th>رتبه</th><th>ارائه‌دهنده / مدل</th><th>امتیاز و قابلیت</th><th>پاسخ مشتری</th><th>دسته‌بندی محصول</th><th>کارایی</th><th>نتیجه</th></tr></thead><tbody id="aiModalRows"></tbody></table></div><div class="modal-pagination"><button class="gray" onclick="aiResultPage=Math.max(1,aiResultPage-1);renderAITestModal()">قبلی</button><span id="aiResultPageInfo"></span><button class="gray" onclick="aiResultPage++;renderAITestModal()">بعدی</button></div></div></div><script>
let products=[],profiles={},activeProfile='',currentBuild='',lastComparison={lists:{}}; const $=id=>document.getElementById(id); function applyFontScale(value){let scale=Math.max(.9,Math.min(1.3,Number(value)||1));document.documentElement.style.setProperty('--font-scale',scale);localStorage.setItem('scraperFontScale',scale);if($('fontScale'))$('fontScale').value=String(scale);if($('fontScaleBadge'))$('fontScaleBadge').textContent=Math.round(scale*100)+'٪'} const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
(function phpLayout(){const scrape=$('scrape'),adv=scrape.querySelector('details.advanced'),table=scrape.querySelector('.tablebox');if(adv){adv.open=true;$('selectorsMount').appendChild(adv);}if(table)$('resultsMount').appendChild(table);scrape.querySelectorAll('[onclick^="download"],label.file-btn').forEach(x=>x.remove())})();
(function tidyStart(){const card=document.querySelector('#scrape .source-card'),grid=card?.querySelector('.grid');if(!grid)return;const details=document.createElement('details');details.className='start-advanced';details.innerHTML='<summary><span><b>⚙️ تنظیمات پیشرفته و سرعت</b><small>موتور دریافت، صفحه‌بندی، مرورگر و دامنه جزئیات</small></span><i>⌄</i></summary><div class="grid grid4 start-advanced-grid"></div>';const target=details.querySelector('.grid');['render','fetch_engine','pagination','page_value','scrolls','detail_scope','detail_limit'].forEach(id=>{const node=$(id)?.parentElement;if(node)target.appendChild(node)});card.querySelectorAll('.engine-roadmap,.anti-bot-hint').forEach(x=>target.appendChild(x));grid.after(details)})();
(function globalDrawer(){const mount=$('adminMount');['settings','profiles','jobs','changelogAdmin','deploy','files'].forEach((id,i)=>{const node=$(id);if(node){node.classList.remove('pane','on');node.classList.add('admin-section');;mount.appendChild(node)}});const woo=$('woo'),grid=$('woo_url')?.closest('.grid'),settings=$('settings');if(grid&&settings){const card=document.createElement('div');card.className='card';card.innerHTML='<h3>🛒 اتصال ووکامرس</h3><div id="wooConnectionMount"></div><div class="actions"><button onclick="saveSettings(true)">ذخیره اتصال</button><button class="gray" onclick="wooTest()">تست اتصال</button></div><div id="wooConnectionStatus" class="status"></div>';settings.appendChild(card);card.querySelector('#wooConnectionMount').appendChild(grid);woo.querySelectorAll('button[onclick="saveSettings(true)"],button[onclick="wooTest()"]').forEach(x=>x.remove())}})();
(function splitDestinations(){const woo=$('woo'),hero=woo?.querySelector('.dispatch-hero'),basalamCard=$('bsl_batch')?.closest('.card');if(basalamCard)$('basalamSendMount').appendChild(basalamCard);if(hero){hero.querySelector('h3').textContent='🛒 ارسال محصولات به ووکامرس';hero.querySelector('small').textContent='ارسال کامل محصولات ذخیره‌شده پروفایل فقط به ووکامرس';const destinationBox=$('dispatchWoo')?.closest('.grid>div');if(destinationBox)destinationBox.style.display='none';$('dispatchWoo').checked=true;$('dispatchBasalam').checked=false;hero.querySelector('.status').textContent='این تب فقط عملیات ووکامرس را اجرا می‌کند و هیچ ارسال باسلامی انجام نمی‌شود.'}})();
function toggleSettingsPanel(force){const open=force===undefined?!$('settingsPanel').classList.contains('open'):force;$('settingsPanel').classList.toggle('open',open);$('settingsOverlay').classList.toggle('open',open);$('hamburgerBtn').classList.toggle('active',open);document.body.style.overflow=(open||$('aiTestModal')?.classList.contains('open'))?'hidden':''}
applyFontScale(localStorage.getItem('scraperFontScale')||1);showAdmin('backupAdmin');
function showAdmin(id){document.querySelectorAll('.admin-section').forEach(x=>x.classList.toggle('admin-on',x.id===id));document.querySelectorAll('.admin-nav button').forEach(x=>x.classList.toggle('nav-on',(x.getAttribute('onclick')||'').includes("'"+id+"'")))}
function openTab(name){const b=document.querySelector(`.tabs button[data-tab="${name}"]`),target=$(name);if(!target)return;document.querySelectorAll('.tabs button,.pane').forEach(x=>x.classList.remove('on'));if(b)b.classList.add('on');target.classList.add('on');localStorage.setItem('scraperActiveTab',b?name:'more');if(name==='selectors'){syncProfileAcrossTabs();if($('pickerUrl')&&!$('pickerUrl').value.trim()&&$('url'))$('pickerUrl').value=$('url').value}if(name==='basalamSend'||name==='woo')syncProfileAcrossTabs();window.scrollTo({top:0,behavior:'smooth'})}document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>openTab(b.dataset.tab));
function toggleFullscreen(){const root=document.documentElement;if(!document.fullscreenElement){let go=root.requestFullscreen||root.webkitRequestFullscreen;if(go)go.call(root)}else{let exit=document.exitFullscreen||document.webkitExitFullscreen;if(exit)exit.call(document)}}
document.addEventListener('fullscreenchange',()=>{$('fullscreenBtn').textContent=document.fullscreenElement?'⊠':'⛶'});
let resultView=localStorage.getItem('scraperResultView')||'table';
function setResultView(view){resultView=['table','cards','text'].includes(view)?view:'table';localStorage.setItem('scraperResultView',resultView);$('resultsMount').classList.toggle('hidden',resultView!=='table');$('resultCardsMount').classList.toggle('on',resultView==='cards');$('resultTextMount').classList.toggle('on',resultView==='text');['Table','Cards','Text'].forEach(x=>$('resultView'+x)?.classList.toggle('on',x.toLowerCase()===resultView))}
function renderResultAlternatives(){if(!$('resultCardsMount'))return;$('resultCardsMount').innerHTML=products.map((p,i)=>`<article class="result-product-card">${p.image?`<img src="${esc(p.image)}" loading="lazy" alt="">`:'<div></div>'}<h3>${esc(p.title||'بدون عنوان')}</h3><div class="product-price">${esc(p.price||'بدون قیمت')}</div><small>SKU: ${esc(p.sku||'—')} · ${p.images?.length||(+!!p.image)} تصویر</small><div class="actions"><button onclick="openProductDetail(${i})">جزئیات</button>${p.link?`<a class="file-btn" href="${esc(p.link)}" target="_blank" rel="noopener">صفحه محصول</a>`:''}</div></article>`).join('')||'<div class="note">محصولی وجود ندارد.</div>';$('resultTextMount').textContent=products.map((p,i)=>`${i+1}. ${p.title||'بدون عنوان'}
قیمت: ${p.price||'—'} | SKU: ${p.sku||'—'}
${p.link||''}`).join('\\n\\n');setResultView(resultView)}
const pickerFields={list:[['container','ظرف محصول'],['title','عنوان'],['price','قیمت'],['link','لینک'],['image','تصویر'],['sku','SKU']],detail:[['gallery','گالری تصاویر'],['variations','تنوع‌ها'],['short_desc','توضیح کوتاه'],['long_desc','توضیح بلند'],['price','قیمت'],['stock','موجودی'],['brand','برند'],['sku','SKU'],['weight','وزن'],['category','دسته‌بندی'],['tags','برچسب‌ها'],['attributes','جدول مشخصات']]};let pickerKind='list';
function selectorTab(kind){pickerKind=kind;document.querySelectorAll('.selector-panel').forEach(x=>x.classList.toggle('on',x.id===(kind==='list'?'selectorListPanel':'selectorDetailPanel')));$('selectorTabList').classList.toggle('on',kind==='list');$('selectorTabDetail').classList.toggle('on',kind==='detail');let fields=pickerFields[kind];$('pickerField').innerHTML=fields.map(([k,n])=>`<option value="${k}">${n}</option>`).join('');let suggested=kind==='detail'?(products.find(x=>x.link)?.link||''):$('url').value.trim();if(suggested)$('pickerUrl').value=suggested;renderPickerChips()}
function pickerInputId(field){return (pickerKind==='list'?'sel_':'det_')+field}
function renderPickerChips(){$('pickerChips').innerHTML=pickerFields[pickerKind].map(([k,n])=>{let done=$(pickerInputId(k))?.value.trim();return `<button class="picker-chip ${done?'done':''}" onclick="$('pickerField').value='${k}';pickerContext()">${done?'✓':'○'} ${n}</button>`}).join('')}
function nextPickerField(){let fields=pickerFields[pickerKind],at=fields.findIndex(x=>x[0]===$('pickerField').value),next=fields.slice(at+1).find(x=>!$(pickerInputId(x[0]))?.value.trim())||fields.find(x=>!$(pickerInputId(x[0]))?.value.trim())||fields[(at+1)%fields.length];$('pickerField').value=next[0];pickerContext();$('pickerStatus').textContent='اکنون «'+next[1]+'» را روی صفحه انتخاب کنید.'}
function loadVisualPicker(forceBrowser){let url=($('pickerUrl').value.trim()||$('url')?.value||'').trim();if(!url){$('pickerStatus').innerHTML='<span class="error">آدرس صفحه را وارد کنید.</span>';return}$('pickerUrl').value=url;$('pickerReady').textContent='در حال دریافت…';$('pickerReady').className='badge';$('pickerFrameWrap').classList.add('open');let mode=forceBrowser||/snappshop\.ir/i.test(url)?'browser':($('render')?.value||'auto');$('pickerFrame').src='/api/picker/preview?render='+encodeURIComponent(mode)+'&url='+encodeURIComponent(url);$('pickerStatus').textContent=/snappshop/i.test(url)?'اسنپ‌شاپ: رندر Playwright با اسکرول و انتظار کارت محصول…':'صفحه از مسیر مرکزی دریافت می‌شود…'}
function loadSnappPicker(){if($('render'))$('render').value='browser';if(!$('pickerUrl').value.trim()&&$('url'))$('pickerUrl').value=$('url').value;loadVisualPicker(true)}
function closeVisualPicker(){$('pickerFrame').src='about:blank';$('pickerFrameWrap').classList.remove('open');$('pickerReady').textContent='بسته شد'}
function pickerMove(action){$('pickerFrame').contentWindow?.postMessage({action},'*')}
function pickerContext(){$('pickerFrame').contentWindow?.postMessage({action:'context',selector:pickerKind==='list'&&$('pickerField').value!=='container'?$('sel_container').value.trim():''},'*')}
function setPickerHeight(value){$('pickerFrameWrap').style.height=value+'px'}
window.addEventListener('message',event=>{if(event.source!==$('pickerFrame').contentWindow)return;let d=event.data||{};if(d.type==='s4-picker-ready'){pickerContext();$('pickerReady').textContent='آماده انتخاب';$('pickerReady').className='badge ok';$('pickerStatus').textContent='فیلد را انتخاب کنید، سپس روی جزء متناظر در پیش‌نمایش بزنید.'}if(d.type==='s4-picker-error'){$('pickerReady').textContent='خطای بارگذاری';$('pickerReady').className='badge error';$('pickerStatus').innerHTML='<span class="error">'+esc(d.error||'بارگذاری ناموفق بود')+'</span>'}if(d.type==='s4-picker-picked'){let field=$('pickerField').value,input=$(pickerInputId(field));if(input){input.value=d.selector;input.dispatchEvent(new Event('change'));$('pickerSelection').textContent=d.selector;$('pickerStatus').innerHTML='<span class="ok">✓ '+esc(d.tag)+' · '+d.matches+' تطابق · '+esc(d.text||'')+'</span>';renderPickerChips()}}});selectorTab('list');
function config(){const g=id=>$(id)||{value:'',checked:false};const num=(id,d)=>{const n=+(g(id).value);return Number.isFinite(n)?n:d};let selectors={},detail_selectors={};['container','title','price','link','image','sku'].forEach(k=>selectors[k]=g('sel_'+k).value.trim());['gallery','variations','weight','category','price','stock','brand','sku','short_desc','long_desc','tags','attributes'].forEach(k=>detail_selectors[k]=g('det_'+k).value.trim());let profile_rules={title_prefix:g('rule_title_prefix').value.trim(),title_suffix:g('rule_title_suffix').value.trim(),price_mode:g('rule_price_mode').value||'none',price_value:num('rule_price_value',0),price_round:num('rule_price_round',0),default_stock:g('rule_default_stock').value,default_category:g('rule_default_category').value.trim(),bsl_category_id:num('rule_bsl_category_id',0),woo_category_id:num('rule_woo_category_id',0),woo_price_mode:g('rule_woo_price_mode').value||'none',woo_price_value:num('rule_woo_price_value',0),woo_price_round:num('rule_woo_price_round',0),bsl_price_mode:g('rule_bsl_price_mode').value||'none',bsl_price_value:num('rule_bsl_price_value',0),bsl_price_round:num('rule_bsl_price_round',0)};return {url:g('url').value.trim(),pages:Math.max(1,num('pages',1)),render:g('render').value||'auto',fetch_engine:g('fetch_engine').value||'auto',fetch_engine_master:g('fetch_engine_master').value||((profiles[activeProfile]&&profiles[activeProfile].fetch_engine_master)||''),fetch_engine_host:(profiles[activeProfile]&&profiles[activeProfile].fetch_engine_host)||'',pagination:g('pagination').value||'query',page_value:g('page_value').value.trim(),scrolls:num('scrolls',4),enrich:g('enrich').value!=='0',detail_scope:g('detail_scope').value||'missing',detail_limit:num('detail_limit',0),selectors,detail_selectors,profile_rules,display_name:(profiles[activeProfile]&&profiles[activeProfile].display_name)||'',gallery:{mode:g('galMode').value||'auto',box:g('galBox').value.trim(),selectors:g('galSelectors').value.trim(),pattern:g('galPattern').value.trim(),from:num('galFrom',1),to:num('galTo',10),skip_first:!!g('galSkipFirst').checked}}}
function galModeChanged(){const m=$('galMode')?$('galMode').value:'auto';['galAutoBox','galManualBox','galNumberBox'].forEach(id=>{const e=$(id);if(!e)return;e.classList.toggle('hidden', (id==='galAutoBox'&&m!=='auto')||(id==='galManualBox'&&m!=='manual')||(id==='galNumberBox'&&m!=='number'))})}
function apply(c){if(!c)return;['url','pages','render','fetch_engine','pagination','page_value','scrolls','detail_scope','detail_limit'].forEach(k=>{if(c[k]!==undefined&&$(k))$(k).value=c[k]});if($('fetch_engine_master'))$('fetch_engine_master').value=c.fetch_engine_master||'';if(typeof updateEngineHint==='function')updateEngineHint();if($('enrich'))$('enrich').value=c.enrich?'1':'0';Object.entries(c.selectors||{}).forEach(([k,v])=>{if($('sel_'+k))$('sel_'+k).value=v||''});Object.entries(c.detail_selectors||{}).forEach(([k,v])=>{if($('det_'+k))$('det_'+k).value=v||''});(function(g){g=c.gallery||{};if($('galMode'))$('galMode').value=g.mode||'auto';if($('galBox'))$('galBox').value=g.box||'';if($('galSelectors'))$('galSelectors').value=g.selectors||'';if($('galPattern'))$('galPattern').value=g.pattern||'';if($('galFrom'))$('galFrom').value=g.from||1;if($('galTo'))$('galTo').value=g.to||10;if($('galSkipFirst'))$('galSkipFirst').checked=!!g.skip_first;if(typeof galModeChanged==='function')galModeChanged()})();let r=c.profile_rules||{};['title_prefix','title_suffix','price_mode','price_value','price_round','default_stock','default_category','bsl_category_id','woo_category_id','woo_price_mode','woo_price_value','woo_price_round','bsl_price_mode','bsl_price_value','bsl_price_round'].forEach(k=>{if($('rule_'+k)&&r[k]!==undefined)$('rule_'+k).value=r[k]});if($('pickerUrl'))$('pickerUrl').value=c.url||$('url')?.value||'';syncProfileAcrossTabs()}
function syncProfileAcrossTabs(){const u=$('url')?.value||'';if($('pickerUrl')&&u)$('pickerUrl').value=u;if($('dispatchProfile')&&activeProfile)$('dispatchProfile').value=activeProfile;if($('dispatchProfileBasalam')&&activeProfile)$('dispatchProfileBasalam').value=activeProfile}
function asciiFile(file,fallback){if(!file)return file;let n=String(file.name||fallback||'upload.bin'),s='';for(let i=0;i<n.length;i++){const c=n.charCodeAt(i);s+=(c>=32&&c<=126)?n[i]:'_'}if(!/[A-Za-z0-9]/.test(s))s=fallback||'upload.bin';return new File([file],s,{type:file.type||'application/octet-stream'})}
function headerLatin(v){const s=String(v??'');for(let i=0;i<s.length;i++) if(s.charCodeAt(i)>255) return encodeURIComponent(s);return s}
function deployHeaders(extra){const h={...(extra||{})};if(deploySecret) h['X-Deploy-Password']=headerLatin(deploySecret);return h}
async function api(path,opt={}){const headers={...(opt.headers||{})};if(!(opt.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type']='application/json';let r=await fetch(path,{...opt,headers});let j=await r.json();if(!r.ok||j.ok===false)throw Error(j.error||'خطای درخواست');return j}
let deploySecret=sessionStorage.getItem('scraperDeployPassword')||'';
function needDeploySecret(){if(deploySecret)return deploySecret;let v=prompt('رمز مدیریت نصب را وارد کنید:\nروی گوشی لوکال خالی بگذارید');if(v===null)throw Error('لغو شد');deploySecret=String(v);if(deploySecret)sessionStorage.setItem('scraperDeployPassword',deploySecret);return deploySecret}
async function deployApi(path,opt={}){needDeploySecret();try{return await api(path,{...opt,headers:deployHeaders(opt.headers)})}catch(e){if(/رمز مدیریت نصب/.test(e.message)){deploySecret='';sessionStorage.removeItem('scraperDeployPassword')}throw e}}
const taskStatusLabel=s=>({waiting:'در صف',running:'در حال اجرا',completed:'کامل',failed:'ناموفق',cancelled:'متوقف',interrupted:'قطع‌شده'}[s]||s||'—');
const taskKindLabel=k=>({scrape:'استخراج DOM',detail_extract:'جزئیات محصولات',profile_dispatch:'ارسال مقصدها',destination_reconcile:'مغایرت‌گیری مقصد',destination_repair:'ترمیم مقصد',basalam_sdk:'SDK باسلام',ai_test:'آزمایش مدل‌های AI'}[k]||k||'—');
const shortDuration=n=>{n=Math.max(0,Math.round(Number(n||0)));if(n<60)return toFa(n)+' ثانیه';if(n<3600)return toFa(Math.floor(n/60))+' دقیقه و '+toFa(n%60)+' ثانیه';return toFa(Math.floor(n/3600))+' ساعت و '+toFa(Math.floor(n%3600/60))+' دقیقه'};
function compactTaskDetails(details){const out=[];for(const x of details||[]){const text=String(x.text||'');let k=text;if(/باسلام/.test(text)&&(/API error 400/.test(text)||/HTTP 400/.test(text)||/Field required/.test(text)))k='basalam-400';else if(/باسلام/.test(text)&&(/API error 422/.test(text)||/HTTP 422/.test(text)||/Unprocessable/.test(text)))k='basalam-422';else if(/باسلام/.test(text)&&(/HTTP 403/.test(text)||/API error 403/.test(text)))k='basalam-403';else k=text.replace(/\d+/g,'#').slice(0,90);if(out.length&&out[out.length-1].k===k){out[out.length-1].n++;continue}out.push({at:x.at,text,n:1,k})}return out}
function clipTaskText(text){text=String(text||'');return text.length>180?text.slice(0,170)+'…':text}
let taskAutoRefresh=true,taskRefreshTimer=0,taskRowsData=[];
function taskCard(t){const p=Math.max(0,Math.min(100,Number(t.progress||0))),elapsed=t.elapsed_seconds??Math.max(0,Math.floor(Date.now()/1000-Number(t.created_at||Date.now()/1000))),active=['waiting','running'].includes(t.status);let destination=Object.entries(t.destinations||{}).map(([k,v])=>(k==='woocommerce'?'ووکامرس':'باسلام')+' · موفق '+toFa(v.sent||0)+' · خطا '+toFa(v.failed||0)).join(' | ');const events=compactTaskDetails(t.details);return `<article class="task-card ${esc(t.status)}"><div class="task-top"><div><b>${esc(t.title||t.kind)}</b>${['scrape','detail_extract','destination_reconcile','destination_repair'].includes(t.kind)?` <span class="badge profile-task-chip">👤 ${esc(prettyProfile(t.profile||'پروفایل نامشخص'))}</span>`:''}<small>${esc(taskKindLabel(t.kind))} · ${toFa(new Date((t.created_at||0)*1000).toLocaleString('fa-IR'))} ${t.execution==='parallel'?' · اجرای مستقل':''}</small></div><span class="badge ${t.status==='completed'?'ok':t.status==='failed'?'error':''}">${esc(taskStatusLabel(t.status))}</span></div><div class="task-progress"><i style="width:${p}%"></i></div><div class="task-pct">${toFa(Math.round(p))}٪</div><div class="task-step">${esc(t.step||'—')}</div><div class="task-metrics"><span><small>انجام</small><b>${toFa(t.done??'—')} / ${toFa(t.total??'—')}</b></span><span class="ok"><small>موفق</small><b>${toFa(t.sent??'—')}</b></span><span class="error"><small>خطا</small><b>${toFa(t.failed??'—')}</b></span><span><small>سپری‌شده</small><b>${esc(shortDuration(elapsed))}</b></span>${t.current_model?`<span><small>مدل جاری</small><b>${esc(t.current_model)}</b></span>`:''}${active&&t.eta_seconds!=null?`<span><small>باقی‌مانده</small><b>≈ ${esc(shortDuration(t.eta_seconds))}</b></span>`:''}</div>${destination?`<small>${esc(destination)}</small>`:''}<div class="task-timeline">${events.map(x=>`<div class="task-event"><b>${esc(x.at)}</b> · ${esc(clipTaskText(x.text))}${x.n>1?` <span class="badge task-repeat">×${toFa(x.n)}</span>`:''}</div>`).join('')||'<div class="task-event">هنوز رویدادی ثبت نشده است.</div>'}</div><div class="task-actions">${active?`<button class="gray" onclick="cancelTask('${esc(t.id)}')">توقف امن</button>`:(t.kind==='scrape'&&['failed','interrupted','cancelled'].includes(t.status)?`<button onclick="retryTask('${esc(t.id)}')">↻ ادامه از checkpoint</button>`:'')}<button class="gray" onclick="deleteTask('${esc(t.id)}')">حذف گزارش</button></div></article>`}
function renderTaskManager(){let q=($('taskSearch')?.value||'').toLowerCase(),sf=$('taskStatusFilter')?.value||'all',kf=$('taskKindFilter')?.value||'all';let rows=taskRowsData.filter(t=>{let active=['waiting','running'].includes(t.status),statusOk=sf==='all'||sf==='active'&&active||sf==='completed'&&t.status==='completed'||sf==='failed'&&['failed','interrupted','cancelled'].includes(t.status),text=[t.title,t.profile,t.step,t.error,...(t.details||[]).map(x=>x.text)].join(' ').toLowerCase();return statusOk&&(kf==='all'||t.kind===kf)&&(!q||text.includes(q))});$('taskManagerList').innerHTML=rows.map(taskCard).join('')||'<div class="note">وظیفه‌ای مطابق این فیلتر پیدا نشد.</div>'}
async function loadTaskManager(){clearTimeout(taskRefreshTimer);try{let d=await deployApi('/api/tasks');taskRowsData=d.tasks||[];$('taskManagerBadge').textContent=(d.summary.running||0)+' اجرای مستقل';$('taskTopCount').textContent=d.summary.running||0;$('taskManagerTopBtn').classList.toggle('has-active',d.summary.running>0);$('taskManagerStats').innerHTML=`<div class="space-card"><b>${toFa(d.tasks.length)}</b><span>کل گزارش‌ها</span></div><div class="space-card"><b>${toFa(d.summary.running)}</b><span>هم‌زمان فعال</span></div><div class="space-card"><b>${toFa(d.summary.completed)}</b><span>کامل</span></div><div class="space-card"><b>${toFa(d.summary.failed)}</b><span>نیازمند بررسی</span></div>`;renderTaskManager();$('taskAutoBtn').textContent='پایش خودکار: '+(taskAutoRefresh?'روشن':'خاموش')}catch(e){$('taskManagerList').innerHTML='<span class="error">'+esc(e.message)+'</span>'}if(taskAutoRefresh&&$('jobs')?.classList.contains('admin-on'))taskRefreshTimer=setTimeout(loadTaskManager,1800)}
async function cancelTask(id){if(!confirm('وظیفه پس از پایان عملیات جاری متوقف شود؟'))return;await deployApi('/api/tasks/'+encodeURIComponent(id)+'/cancel',{method:'POST',body:'{}'});loadTaskManager()}
async function retryTask(id){await deployApi('/api/tasks/'+encodeURIComponent(id)+'/retry',{method:'POST',body:'{}'});loadTaskManager()}
async function deleteTask(id){await deployApi('/api/tasks/'+encodeURIComponent(id),{method:'DELETE'});loadTaskManager()}
function openTaskManager(){toggleSettingsPanel(true);showAdmin('jobs');loadTaskManager()}
function reconcileProfile(dest){return $(dest==='woocommerce'?'dispatchProfile':'dispatchProfileBasalam').value||activeProfile}
function renderDestinationReport(dest,r){const el=$(dest==='woocommerce'?'reconcileWoo':'reconcileBasalam');if(!r||!r.counts){el.className='reconcile-report note';el.textContent='هنوز گزارشی برای این پروفایل ثبت نشده است.';return}el.className='reconcile-report';let c=r.counts,groups=[['same','یکسان','ok'],['mismatch','مغایرت','error'],['missing','در مقصد نیست',''],['extra','اضافی مقصد','error']];el.innerHTML=`<div class="reconcile-stats">${groups.map(x=>`<button class="${x[2]}" onclick="showReconcileGroup('${dest}','${x[0]}')"><b>${c[x[0]]||0}</b>${x[1]}</button>`).join('')}</div><small>محلی ${r.local_total||0} · مقصد ${r.remote_total||0} · ${new Date((r.created_at||0)*1000).toLocaleString('fa-IR')}</small><div class="reconcile-repair"><button class="green" ${c.missing?'':'disabled'} onclick="repairDestinationGroup('${dest}','missing',${c.missing||0})">📤 ارسال ${c.missing||0} جامانده</button><button ${c.mismatch?'':'disabled'} onclick="repairDestinationGroup('${dest}','mismatch',${c.mismatch||0})">🛠 ترمیم ${c.mismatch||0} مغایرت</button></div><div class="note">محصولات اضافی مقصد برای ایمنی هرگز خودکار حذف نمی‌شوند.</div><div class="reconcile-list" data-report='${esc(JSON.stringify(r.lists||{}))}'></div>`}
function showReconcileGroup(dest,group){const el=$(dest==='woocommerce'?'reconcileWoo':'reconcileBasalam'),box=el.querySelector('.reconcile-list');if(!box)return;let lists={};try{lists=JSON.parse(box.dataset.report||'{}')}catch(e){}let rows=lists[group]||[];box.innerHTML=rows.map(x=>`<div class="reconcile-item"><b>${esc(x.title||x.remote_title||'بدون عنوان')}</b><small>SKU: ${esc(x.sku||'—')} · قیمت محلی: ${esc(x.expected_price??'—')} · قیمت مقصد: ${esc(x.remote_price??x.price??'—')} · تطبیق: ${esc(x.match||'—')}</small></div>`).join('')||'<div class="note">موردی در این گروه نیست.</div>'}
async function startDestinationReconcile(dest){let profile=reconcileProfile(dest),el=$(dest==='woocommerce'?'reconcileWoo':'reconcileBasalam');if(!profile){el.textContent='ابتدا یک پروفایل انتخاب کنید.';return}try{el.innerHTML='<span class="spinner"></span> دریافت و تطبیق سرورساید محصولات مقصد…';let d=await deployApi('/api/destinations/reconcile/'+dest+'/'+encodeURIComponent(profile),{method:'POST',body:'{}'}),task=await watchLiveTask(d.task.id);if(task.status!=='completed')throw Error(task.error||'مغایرت‌گیری ناموفق بود');renderDestinationReport(dest,task.report)}catch(e){el.innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function repairDestinationGroup(dest,scope,count){let profile=reconcileProfile(dest),el=$(dest==='woocommerce'?'reconcileWoo':'reconcileBasalam'),label=scope==='missing'?'ارسال محصولات جامانده':'ترمیم مغایرت‌ها';if(!profile||!count)return;if(!confirm(`${label} برای ${count} محصول پروفایل «${profile}» انجام شود؟\nاین عملیات فقط روی ${dest==='woocommerce'?'ووکامرس':'باسلام'} اجرا می‌شود و محصولات اضافی را حذف نمی‌کند.`))return;try{el.innerHTML='<span class="spinner"></span> '+label+' به‌صورت سرورساید در حال اجراست…';let d=await deployApi('/api/destinations/repair/'+dest+'/'+scope+'/'+encodeURIComponent(profile),{method:'POST',body:'{}'}),task=await watchLiveTask(d.task.id);if(task.status!=='completed')throw Error(task.error||'عملیات ترمیم ناموفق بود');el.innerHTML='<span class="ok">✓ ترمیم تمام شد؛ در حال بررسی مجدد نتیجه…</span>';await startDestinationReconcile(dest)}catch(e){el.innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function loadDestinationReport(dest){let profile=reconcileProfile(dest),el=$(dest==='woocommerce'?'reconcileWoo':'reconcileBasalam');if(!profile){el.textContent='ابتدا یک پروفایل انتخاب کنید.';return}try{let d=await deployApi('/api/destinations/report/'+dest+'/'+encodeURIComponent(profile));renderDestinationReport(dest,d.report)}catch(e){el.innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
function basalamDispatchPayload(){return {destinations:['basalam'],woo_status:$('woo_product_status').value,woo_update:$('woo_update').checked}}
async function dispatchBasalamProfile(){let n=$('dispatchProfileBasalam').value;if(!n){$('bslDispatchStatus').innerHTML='<span class="error">پروفایل دارای محصول را انتخاب کنید.</span>';return}try{let d=await deployApi('/api/dispatch/profile/'+encodeURIComponent(n),{method:'POST',body:JSON.stringify(basalamDispatchPayload())});$('bslDispatchStatus').innerHTML='<span class="ok">وظیفه مستقل باسلام برای «'+esc(n)+'» آغاز شد.</span>';openTaskManager()}catch(e){$('bslDispatchStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function dispatchAllBasalamProfiles(){if(!confirm('همه پروفایل‌ها فقط به باسلام ارسال شوند؟'))return;try{let d=await deployApi('/api/dispatch/profiles',{method:'POST',body:JSON.stringify(basalamDispatchPayload())});$('bslDispatchStatus').innerHTML='<span class="ok">'+d.tasks.length+' وظیفه مستقل باسلام ساخته شد.</span>';openTaskManager()}catch(e){$('bslDispatchStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
function dispatchPayload(){let destinations=[];if($('dispatchWoo').checked)destinations.push('woocommerce');if($('dispatchBasalam').checked)destinations.push('basalam');return {destinations,woo_status:$('woo_product_status').value,woo_update:$('woo_update').checked}}
async function dispatchSelectedProfile(){let n=$('dispatchProfile').value;if(!n){$('dispatchStatus').innerHTML='<span class="error">پروفایل دارای محصول را انتخاب کنید.</span>';return}try{let d=await deployApi('/api/dispatch/profile/'+encodeURIComponent(n),{method:'POST',body:JSON.stringify(dispatchPayload())});$('dispatchStatus').innerHTML='<span class="ok">وظیفه کامل «'+esc(n)+'» روی سرور آغاز شد.</span> شناسه: '+esc(d.task.id);openTaskManager()}catch(e){$('dispatchStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function dispatchAllProfiles(){if(!confirm('محصولات ذخیره‌شده همه پروفایل‌ها به مقصدهای انتخاب‌شده ارسال شوند؟'))return;try{let d=await deployApi('/api/dispatch/profiles',{method:'POST',body:JSON.stringify(dispatchPayload())});$('dispatchStatus').innerHTML='<span class="ok">'+d.tasks.length+' وظیفه مستقل روی سرور ساخته شد.</span>'+((d.errors||[]).length?'\nردشده: '+esc(d.errors.join(' · ')):'');openTaskManager()}catch(e){$('dispatchStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function loadChangelog(){try{let d=await api('/api/changelog');$('changeCurrent').textContent='نسخه جاری '+d.current;$('changelogList').innerHTML=(d.releases||[]).map((r,i)=>`<article class="release ${i===0?'current':''}"><div class="release-head"><b>نسخه ${esc(r.version)} · ${esc(r.title)}</b><small>${esc(r.date)}</small></div><ul>${(r.items||[]).map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></article>`).join('')}catch(e){$('changelogList').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function loadTaskTopSummary(){try{let d=await api('/api/tasks/summary');$('taskTopCount').textContent=d.active||0;$('taskManagerTopBtn').classList.toggle('has-active',d.active>0);$('taskManagerTopBtn').title=(d.active||0)+' وظیفه فعال · '+(d.attention||0)+' نیازمند بررسی'}catch(e){}}
async function init(){loadTaskTopSummary();let d=await api('/api/config');currentBuild=d.build||'';$('appVersion').textContent='v'+(d.version||'10.123');profiles=d.profiles||{};$('timeout').value=d.network.timeout;$('gap_ms').value=d.network.gap_ms;$('proxy').value=d.network.proxy||'';$('proxy_mode').value=d.network.proxy_mode||'auto';$('worker_key').value=d.network.worker_key||'';$('verify_tls').checked=d.network.verify_tls!==false;updateGatewayUI();$('woo_url').value=d.woocommerce.url||'';$('woo_ck').value=d.woocommerce.consumer_key||'';$('woo_cs').value=d.woocommerce.consumer_secret||'';$('dep_repo').value=d.deploy.repo||'';let _brs=(d.deploy.branches&&d.deploy.branches.length?d.deploy.branches:[d.deploy.branch].filter(Boolean));$('dep_branches').value=_brs.join('\n');$('dep_branch').value=_brs[0]||'';$('dep_path').value=d.deploy.path||'';$('dep_reload').value=d.deploy.reload_file||'';if($('dep_autocheck'))$('dep_autocheck').checked=!!d.deploy.check_on_load;$('dep_token').placeholder=d.deploy.has_github_token?'توکن تنظیم شده است؛ خالی = نگه‌داشتن':'GitHub token اختیاری';renderBranchChips();loadDeployBranches(false).then(()=>loadDeployFiles()).catch(()=>{});activeProfile=d.active_profile||'';renderProfiles();if(activeProfile&&profiles[activeProfile])loadProfile(activeProfile,false,false);else{updateActiveProfileUI();renderComparisonHistory([])}loadJobs();loadWooJobs();let saved=localStorage.getItem('scraperActiveTab');openTab(['scrape','profileSettings','selectors','results','woo','basalamSend','imports'].includes(saved)?saved:'scrape');setResultView(resultView)}
async function loadBasalam(){try{let d=await deployApi('/api/basalam/config'),b=d.basalam,s=d.sdk||{};$('bsl_vendor').value=b.vendor_id||0;$('bsl_category').value=b.category_id||0;$('bsl_token').value=b.token||'';$('bsl_refresh').value=b.refresh_token||'';$('bsl_client_mode').value=b.client_mode||'auto';$('bsl_api_base_url').value=b.api_base_url||'https://openapi.basalam.com';$('bsl_days').value=b.preparation_days||3;$('bsl_weight').value=b.weight||500;$('bsl_stock').value=b.stock||10;$('bsl_update').checked=b.update_existing!==false;bslExtraVendors=Array.isArray(b.vendors)?b.vendors.map(v=>({vendor_id:+(v.vendor_id||0),token:v.token||'',shop_name:v.shop_name||v.name||'',name:v.name||'',price_mode:v.price_mode||'none',price_val:+(v.price_val||0)})):[];if($('bsl_send_all'))$('bsl_send_all').value=b.send_all_shops===false?'0':'1';if($('bsl_send_mode'))$('bsl_send_mode').value=b.send_mode==='sequential'?'sequential':'parallel';bslSelectedShopVids=null;renderBslVendors();$('bslSdkBadge').textContent=s.installed?'SDK '+s.version:'نصب نشده';$('bslSdkBadge').className='badge '+(s.installed?'ok':'error');if(b.last_test_at)$('bslAdminStatus').innerHTML='<span class="ok">آخرین اتصال موفق: '+esc(b.last_test_user||'باسلام')+' · '+new Date(b.last_test_at*1000).toLocaleString('fa-IR')+'</span>'}catch(e){$('bslAdminStatus').textContent=e.message}}
async function saveBasalam(){try{let basalam={vendor_id:+$('bsl_vendor').value,category_id:+$('bsl_category').value,token:$('bsl_token').value.trim(),refresh_token:$('bsl_refresh').value.trim(),client_mode:$('bsl_client_mode').value,api_base_url:$('bsl_api_base_url').value.trim(),preparation_days:+$('bsl_days').value,weight:+$('bsl_weight').value,stock:+$('bsl_stock').value,update_existing:$('bsl_update').checked,vendors:bslExtraVendors,send_all_shops:$('bsl_send_all')?$('bsl_send_all').value!=='0':true,send_mode:$('bsl_send_mode')?$('bsl_send_mode').value:'parallel'};await deployApi('/api/basalam/settings',{method:'POST',body:JSON.stringify({basalam})});$('bslAdminStatus').innerHTML='<span class="ok">اتصال ذخیره شد.</span>'}catch(e){$('bslAdminStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
function renderLiveTask(task){$('bslLiveTask').style.display='block';$('bslTaskTitle').textContent=task.title||'وظیفه سرور';$('bslTaskPercent').textContent=toFa(Math.round(task.progress||0))+'٪';$('bslTaskBar').style.width=(task.progress||0)+'%';$('bslTaskStep').textContent=task.step||'';const events=compactTaskDetails(task.details).slice().reverse();$('bslTaskDetails').innerHTML=events.map(x=>`<div class="live-detail"><b>${esc(x.at)}</b> · ${esc(clipTaskText(x.text))}${x.n>1?` ×${toFa(x.n)}`:''}</div>`).join('')}
async function watchLiveTask(id){for(;;){let d=await deployApi('/api/tasks/'+encodeURIComponent(id));renderLiveTask(d.task);if(['completed','failed'].includes(d.task.status))return d.task;await new Promise(r=>setTimeout(r,850))}}
async function installBasalamSdk(){try{$('bslAdminStatus').innerHTML='<span class="spinner"></span> وظیفه نصب روی سرور آغاز می‌شود…';let d=await deployApi('/api/basalam/sdk/install/start',{method:'POST',body:'{}'}),task=await watchLiveTask(d.task.id);if(task.status==='failed')throw Error(task.error||'نصب ناموفق بود');$('bslAdminStatus').innerHTML='<span class="ok">SDK روی سرور نصب و آماده شد · نسخه '+esc(task.sdk?.version||'')+'</span>';$('bslSdkBadge').textContent='SDK '+(task.sdk?.version||'آماده');$('bslSdkBadge').className='badge ok'}catch(e){$('bslAdminStatus').innerHTML='<span class="error">خطای نصب: '+esc(e.message)+'</span>'}}
async function testBasalam(){try{$('bslAdminStatus').innerHTML='<span class="spinner"></span> SDK آماده است؛ در حال آزمایش مجوز توکن و اتصال API باسلام…';let d=await deployApi('/api/basalam/test',{method:'POST',body:'{}'});$('bslAdminStatus').innerHTML='<span class="ok">اتصال باسلام موفق: '+esc(d.user)+' · کلاینت '+esc(d.client||'—')+(d.installed_now?' · SDK نیز نصب شد':'')+'</span>';$('bslSdkBadge').textContent='SDK '+(d.sdk?.version||'آماده');$('bslSdkBadge').className='badge ok'}catch(e){$('bslAdminStatus').innerHTML='<span class="error">خطای اتصال: '+esc(e.message)+'</span>'}}
async function loadBasalamVendor(){try{$('bslAdminStatus').textContent='در حال دریافت اطلاعات رسمی غرفه…';let d=await deployApi('/api/basalam/vendor'),v=d.vendor||{};$('bslVendorCard').innerHTML=`<div class="provider-row vendor-card"><div><b>${esc(v.title||'غرفه')} <code>#${esc(v.id)}</code></b><br><small>${esc(v.identifier||'')} · ${esc(v.city||'')} · امتیاز ${esc(v.score??'—')}</small></div><span class="badge">${esc(v.status||'—')}</span></div>`;$('bslAdminStatus').innerHTML='<span class="ok">اطلاعات غرفه با کلاینت '+esc(d.client||'—')+' دریافت شد.</span>'}catch(e){$('bslAdminStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function loadBasalamProducts(){try{$('bslAdminStatus').textContent='در حال دریافت محصولات غرفه…';let d=await deployApi('/api/basalam/products');$('bslProductList').innerHTML=(d.products||[]).map(p=>`<div class="provider-row"><div><b>${esc(p.name||'بدون نام')}</b> <code>#${esc(p.id)}</code><br><small>SKU: ${esc(p.sku||'—')} · موجودی: ${esc(p.stock??'—')} · قیمت: ${esc(p.price??'—')}</small></div><span class="badge">${esc(p.status||'—')}</span></div>`).join('')||'<div class="note">محصولی در غرفه پیدا نشد.</div>';$('bslAdminStatus').innerHTML='<span class="ok">'+d.total+' محصول نخست غرفه با '+esc(d.client||'—')+' دریافت شد.</span>'}catch(e){$('bslAdminStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
function bslApiList(v){if(Array.isArray(v))return v;if(v&&typeof v==='object'){for(const k of ['data','items','results','chats','messages','parcels','products']){let x=v[k];if(Array.isArray(x))return x;if(x&&typeof x==='object'){let y=bslApiList(x);if(y.length)return y}}}return []}
let activeBasalamChat=0;
async function loadBasalamOperations(){try{$('bslOperationStatus').innerHTML='<span class="spinner"></span> دریافت هم‌زمان گفت‌وگوها و سفارش‌ها از REST API…';let d=await deployApi('/api/basalam/operations'),chats=bslApiList(d.chats),orders=bslApiList(d.orders),unseen=d.unseen_count?.count??d.unseen_count?.data?.count??d.unseen_count??0;$('bslOperationStats').innerHTML=`<div class="space-card"><b>${chats.length}</b><span>گفت‌وگوی اخیر</span></div><div class="space-card"><b>${typeof unseen==='object'?'—':unseen}</b><span>پیام خوانده‌نشده</span></div><div class="space-card"><b>${orders.length}</b><span>سفارش/مرسوله</span></div>`;$('bslChatList').innerHTML=chats.map(c=>{let contact=c.contact||{},last=c.last_message||{},txt=last.content?.text||last.text||'';return `<div class="operation-item" onclick="openBasalamChat(${Number(c.id)||0},'${esc(contact.name||contact.title||'گفت‌وگو')}')"><b>${esc(contact.name||contact.title||'گفت‌وگو #'+c.id)}</b><small>${esc(txt||c.chat_type||'')} · خوانده‌نشده ${c.unseen_message_count||0}</small></div>`}).join('')||'<div class="note">گفت‌وگویی برگردانده نشد.</div>';$('bslOrderList').innerHTML=orders.map(o=>`<div class="operation-item"><b>سفارش/مرسوله #${esc(o.id||o.order_id||'—')}</b><small>${esc(o.status||o.state||'')} · ${esc(o.created_at||o.estimate_send_at||'')}</small></div>`).join('')||'<div class="note">سفارشی برگردانده نشد.</div>';$('bslOperationStatus').innerHTML=(d.chats_error?'<span class="error">چت: '+esc(d.chats_error)+'</span><br>':'')+(d.orders_error?'<span class="error">سفارش: '+esc(d.orders_error)+'</span>':'<span class="ok">داشبورد REST API بروزرسانی شد.</span>')}catch(e){$('bslOperationStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function openBasalamChat(id,title){if(!id)return;activeBasalamChat=id;$('bslChatPanel').style.display='block';$('bslChatTitle').textContent=title+' · #'+id;$('bslMessages').innerHTML='<span class="spinner"></span>';try{let d=await deployApi('/api/basalam/chats/'+id+'/messages'),rows=d.messages||[];$('bslMessages').innerHTML=rows.map(m=>`<div class="message">${esc(m.content?.text||m.text||m.message_type||'پیام')}<small>${esc(m.created_at||'')} · ${esc(m.sender?.id||'')}</small></div>`).join('')||'<div class="note">پیامی برگردانده نشد.</div>';$('bslMessages').scrollTop=$('bslMessages').scrollHeight}catch(e){$('bslMessages').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function sendBasalamMessage(){let text=$('bslMessageText').value.trim();if(!activeBasalamChat||!text)return;try{await deployApi('/api/basalam/chats/'+activeBasalamChat+'/messages',{method:'POST',body:JSON.stringify({text})});$('bslMessageText').value='';await openBasalamChat(activeBasalamChat,$('bslChatTitle').textContent.split('·')[0]);$('bslOperationStatus').innerHTML='<span class="ok">پیام با REST API ارسال شد.</span>'}catch(e){$('bslOperationStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function searchBasalamCategories(){try{$('bslCategoryResults').innerHTML='<div class="status">در حال دریافت درخت دسته‌ها…</div>';let d=await deployApi('/api/basalam/categories?q='+encodeURIComponent($('bsl_category_query').value.trim()));$('bslCategoryResults').innerHTML=(d.categories||[]).map(x=>`<div class="category-item"><span>${esc(x.path)} <code>${esc(x.id)}</code></span><button onclick="chooseBasalamCategory('${esc(x.id)}','${esc(x.name)}')">انتخاب</button></div>`).join('')||'<div class="note">دسته‌ای پیدا نشد.</div>'}catch(e){$('bslCategoryResults').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
function chooseBasalamCategory(id,name){$('bsl_category').value=id;$('bsl_category_query').value=name;$('bslCategoryResults').innerHTML='<span class="ok">دسته انتخاب شد؛ اکنون تنظیمات باسلام را ذخیره کنید.</span>'}
let activeBasalamJob='';
let bslExtraVendors=[],bslSelectedShopVids=null;
function bslAllShopEntries(){const shops=[];const defVid=parseInt(($('bsl_vendor')||{}).value)||0;const defTok=String(($('bsl_token')||{}).value||'').trim();if(defVid>0&&defTok)shops.push({vendor_id:defVid,token:defTok,shop_name:'غرفهٔ پیش‌فرض',is_default:true});(Array.isArray(bslExtraVendors)?bslExtraVendors:[]).forEach(v=>{const vid=parseInt(v&&v.vendor_id)||0,tok=String(v&&v.token||'').trim();if(vid>0&&tok)shops.push({vendor_id:vid,token:tok,shop_name:v.shop_name||v.name||('غرفه '+vid),is_default:false,price_mode:v.price_mode||'none',price_val:parseFloat(v.price_val||0)});});return shops;}
function bslGetSelectedVids(){const shops=bslAllShopEntries();if($('bsl_send_all')&&$('bsl_send_all').value==='0'){const d=shops.find(s=>s.is_default);return d?[d.vendor_id]:[];}if(!bslSelectedShopVids||bslSelectedShopVids.length===shops.length)return null;return bslSelectedShopVids.slice();}
function bslRenderShopsHint(){const el=$('bsShopsHint');if(!el)return;const n=bslAllShopEntries().length;const mode=$('bsl_send_mode')?$('bsl_send_mode').value:'parallel';const all=$('bsl_send_all')?$('bsl_send_all').value!=='0':true;el.textContent=n?((all?'ارسال به ':'فقط غرفه پیش‌فرض · ')+toFa(n)+' غرفه فعال · '+(mode==='sequential'?'ترتیبی':'همزمان')):'غرفه فعالی با توکن و شناسه نیست';}
function addBslVendor(){bslExtraVendors.push({vendor_id:0,token:'',shop_name:'',name:'',price_mode:'none',price_val:0});renderBslVendors();}
function removeBslVendor(idx){if(!confirm('حذف این غرفه؟'))return;bslExtraVendors.splice(idx,1);renderBslVendors();}
async function testBslVendor(idx){const v=bslExtraVendors[idx];if(!v)return;const btn=$('bslVTestBtn_'+idx);if(btn){btn.disabled=true;btn.textContent='…';}try{const d=await deployApi('/api/basalam/test',{method:'POST',body:JSON.stringify({token:v.token||'',vendor_id:+(v.vendor_id||0)})});if(d.vendor_id)bslExtraVendors[idx].vendor_id=d.vendor_id;if(d.vendor_title)bslExtraVendors[idx].shop_name=d.vendor_title;if(d.user)bslExtraVendors[idx].name=d.user;renderBslVendors();if($('bslAdminStatus'))$('bslAdminStatus').innerHTML='<span class="ok">✓ '+(esc(d.vendor_title||d.user||'غرفه'))+'</span>';}catch(e){if($('bslAdminStatus'))$('bslAdminStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>';}if(btn){btn.disabled=false;btn.textContent='تست';}}
function renderBslVendors(){const list=$('bslVendorsList');if(!list)return;bslRenderShopsHint();if(!bslExtraVendors.length){list.innerHTML='<div style="font-size:11px;opacity:.7;text-align:center;padding:8px">غرفه اضافی وجود ندارد</div>';return;}list.innerHTML=bslExtraVendors.map((v,idx)=>'<div style="background:#0f172a;border:1px solid #475569;border-radius:8px;padding:10px;margin-bottom:6px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="font-size:12px">غرفه '+toFa(idx+1)+(v.shop_name?(' · '+esc(v.shop_name)):'')+'</b><button class="gray" type="button" onclick="removeBslVendor('+idx+')">حذف</button></div><input type="text" placeholder="نام غرفه" value="'+esc(v.shop_name||v.name||'')+'" oninput="bslExtraVendors['+idx+'].shop_name=this.value" style="width:100%;margin-bottom:6px"><input type="password" dir="ltr" placeholder="Personal Token" value="'+esc(v.token||'')+'" oninput="bslExtraVendors['+idx+'].token=this.value" style="width:100%;margin-bottom:6px"><div class="grid"><div><input type="number" placeholder="شناسه غرفه" value="'+(v.vendor_id||'')+'" oninput="bslExtraVendors['+idx+'].vendor_id=parseInt(this.value)||0"></div><div><button class="gray" type="button" id="bslVTestBtn_'+idx+'" onclick="testBslVendor('+idx+')">تست</button></div><div><label>تعدیل قیمت</label><select onchange="bslExtraVendors['+idx+'].price_mode=this.value"><option value="none"'+(v.price_mode==='none'?' selected':'')+'>بدون تعدیل</option><option value="percent"'+(v.price_mode==='percent'?' selected':'')+'>درصد</option><option value="multiplier"'+(v.price_mode==='multiplier'?' selected':'')+'>ضریب</option></select></div><div><label>مقدار</label><input type="number" step="0.01" value="'+(v.price_val||0)+'" oninput="bslExtraVendors['+idx+'].price_val=parseFloat(this.value)||0"></div></div></div>').join('');}
function renderBasalamJobs(jobs){let list=jobs||[];if(list[0])activeBasalamJob=list[0].id;$('bslJobList').innerHTML=list.map(j=>`<div class="provider-row"><div><b>${esc(j.id)}</b><br><small>${esc(j.status)} · ${j.cursor}/${j.total} · موفق ${j.sent} · ویرایش ${j.updated} · خطا ${j.failed}</small><div class="progress-track"><i style="width:${j.total?Math.round(j.cursor/j.total*100):0}%"></i></div></div><div><button class="gray" onclick="deleteBasalamJob('${esc(j.id)}')">حذف</button></div>${(j.results||[]).slice(-3).map(r=>`<small class="${r.ok?'ok':'error'}">${r.ok?'✓':'✕'} ${esc(r.source||'')} ${esc(r.error||'')}</small>`).join('')}</div>`).join('')||'<div class="note">صفی وجود ندارد.</div>'}
async function loadBasalamJobs(){try{let d=await deployApi('/api/basalam/jobs');renderBasalamJobs(d.jobs)}catch(e){$('bslSendStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function createBasalamQueue(){if(!products.length){$('bslSendStatus').innerHTML='<span class="error">ابتدا محصول استخراج یا وارد کنید.</span>';return}try{let d=await deployApi('/api/basalam/jobs',{method:'POST',body:JSON.stringify({products,vendor_ids:bslGetSelectedVids()})});activeBasalamJob=d.job.id;$('bslSendStatus').innerHTML='<span class="ok">صف '+d.job.total+' محصولی ساخته شد.</span>';await loadBasalamJobs()}catch(e){$('bslSendStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function processBasalamQueue(){if(!activeBasalamJob){await loadBasalamJobs();if(!activeBasalamJob)return}try{$('bslSendStatus').innerHTML='<span class="spinner"></span> تخلیه کامل صف باسلام روی سرور…';let d=await deployApi('/api/basalam/jobs/'+encodeURIComponent(activeBasalamJob)+'/process',{method:'POST',body:JSON.stringify({batch:+$('bsl_batch').value||20,drain:true})});$('bslSendStatus').innerHTML='<span class="ok">صف روی سرور در حال ارسال است · '+(d.job.cursor||0)+'/'+(d.job.total||0)+'</span>';await loadBasalamJobs()}catch(e){$('bslSendStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function deleteBasalamJob(id){if(!confirm('صف باسلام حذف شود؟'))return;await deployApi('/api/basalam/jobs/'+encodeURIComponent(id),{method:'DELETE'});if(activeBasalamJob===id)activeBasalamJob='';await loadBasalamJobs()}
let aiProviders=[];
function aiPane(id,btn){document.querySelectorAll('.ai-pane').forEach(x=>x.classList.toggle('on',x.id==='aiPane'+id[0].toUpperCase()+id.slice(1)));document.querySelectorAll('.ai-tabs button').forEach(x=>x.classList.toggle('on',x===btn))}
function aiCurrent(){return aiProviders.find(x=>x.id===$('ai_provider').value)}
function renderAI(){let selected=$('ai_provider').value,sel=$('ai_provider');sel.innerHTML='<option value="">— انتخاب —</option>'+aiProviders.map(p=>`<option value="${esc(p.id)}">${p.enabled?'●':'○'} ${esc(p.name)} (${p.models.length})</option>`).join('');sel.value=aiProviders.some(x=>x.id===selected)?selected:(sel.dataset.selected||aiProviders[0]?.id||'');renderAIModels();$('aiSummary').textContent=aiProviders.length+' ارائه‌دهنده · '+aiProviders.reduce((n,p)=>n+p.models.length,0)+' مدل';$('aiProviderList').innerHTML=aiProviders.map(p=>`<div class="provider-row"><div><b>${esc(p.name)}</b> <code>${esc(p.id)}</code><br><small>${esc(p.url)} · ${p.key_count} کلید ${p.key_preview.map(esc).join('، ')}</small></div><button class="gray" onclick="editAIProvider('${esc(p.id)}')">ویرایش</button><div class="models">${p.models.slice(0,12).map(m=>`<span class="model-chip">${esc(m.name||m.id)}</span>`).join('')}${p.models.length>12?`<span class="badge">+${p.models.length-12}</span>`:''}</div></div>`).join('')||'<div class="note">هنوز ارائه‌دهنده‌ای ثبت نشده است. فایل PHP را بارگذاری یا ارائه‌دهنده تازه بسازید.</div>'}
function renderAIModels(){let p=aiCurrent(),sel=$('ai_model'),wanted=sel.dataset.selected||sel.value;sel.innerHTML=(p?.models||[]).filter(m=>m.enabled!==false).map(m=>`<option value="${esc(m.id)}">${esc(m.name||m.id)}${m.free?' · رایگان':''}</option>`).join('')||'<option value="">— مدلی نیست —</option>';if(p?.models.some(m=>m.id===wanted))sel.value=wanted}
async function importAIProviders(input){if(!input.files[0])return;try{$('aiStatus').textContent='در حال درون‌ریزی و ساخت فهرست مدل‌ها…';let secret=await needDeploySecret(),f=new FormData();f.append('file',asciiFile(input.files[0],'ai-providers.json'));let r=await fetch((typeof BASE==='string'?BASE:'')+'/api/ai/providers/import',{method:'POST',headers:deployHeaders(),body:f}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error);$('aiStatus').innerHTML='<span class="ok">'+d.count+' ارائه‌دهنده و '+d.models+' مدل وارد شد.</span>';await loadAI()}catch(e){$('aiStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}finally{input.value=''}}
async function loadAI(){try{let d=await deployApi('/api/ai/config');aiProviders=d.providers||[];$('ai_provider').dataset.selected=d.selected?.provider||'';$('ai_model').dataset.selected=d.selected?.model||'';$('ai_temperature').value=d.ai.temperature??.3;$('ai_max_tokens').value=d.ai.max_tokens||1200;$('ai_system_prompt').value=d.ai.system_prompt||'';renderAI()}catch(e){$('aiStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function aiSelectProvider(){renderAIModels();let p=aiCurrent(),m=p?.models?.[0]?.id;if(p&&m)await selectAI(p.id,m)}
async function aiSelectModel(){let p=aiCurrent();if(p&&$('ai_model').value)await selectAI(p.id,$('ai_model').value)}
async function selectAI(provider,model){try{await deployApi('/api/ai/select',{method:'POST',body:JSON.stringify({provider,model})});$('aiStatus').innerHTML='<span class="ok">مدل فعال ذخیره شد.</span>'}catch(e){$('aiStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
function newAIProvider(){['ai_edit_id','ai_edit_name','ai_edit_vendor','ai_endpoint','ai_keys','ai_models'].forEach(x=>$(x).value='');$('ai_keys').dataset.preserve='';$('ai_edit_enabled').checked=true;aiPane('editor',document.querySelectorAll('.ai-tabs button')[1])}
function editAIProvider(id){let p=aiProviders.find(x=>x.id===id);if(!p)return;$('ai_edit_id').value=p.id;$('ai_edit_name').value=p.name;$('ai_edit_vendor').value=p.vendor||'';$('ai_endpoint').value=p.url||'';$('ai_edit_enabled').checked=p.enabled!==false;$('ai_keys').value='';$('ai_keys').placeholder=(p.key_count||0)+' کلید محفوظ است؛ کلید تازه را برای افزودن وارد کنید';$('ai_keys').dataset.preserve='1';$('ai_models').value=p.models.map(m=>m.id+' | '+(m.name||m.id)+(m.free?' | free':'')).join('\n');aiPane('editor',document.querySelectorAll('.ai-tabs button')[1])}
async function saveAIProvider(){try{let id=$('ai_edit_id').value.trim();if(!id)throw Error('شناسه ارائه‌دهنده لازم است');let preserve=$('ai_keys').dataset.preserve==='1',prior=aiProviders.find(x=>x.id===id);let keys=$('ai_keys').value.split(/\n+/).map(x=>{let [key,label,acct]=x.split('|');return {key:key.trim(),label:(label||'').trim(),acct:(acct||'').trim(),enabled:true}}).filter(x=>x.key);let models=$('ai_models').value.split(/\n+/).map(x=>{let [mid,name,free]=x.split('|');mid=(mid||'').trim();return {...(prior?.models.find(m=>m.id===mid)||{}),id:mid,name:(name||mid||'').trim(),free:/free|رایگان|true|1/i.test(free||''),enabled:true}}).filter(x=>x.id);let provider={id,name:$('ai_edit_name').value.trim()||id,vendor:$('ai_edit_vendor').value.trim(),url:$('ai_endpoint').value.trim(),enabled:$('ai_edit_enabled').checked,models};provider.apiKeys=keys;let d=await deployApi('/api/ai/providers/save',{method:'POST',body:JSON.stringify({provider,preserve_keys:preserve})});aiProviders=d.providers||[];$('ai_keys').dataset.preserve='';renderAI();$('aiStatus').innerHTML='<span class="ok">ارائه‌دهنده و '+models.length+' مدل ذخیره شد.</span>'}catch(e){$('aiStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function deleteAIProvider(){let id=$('ai_edit_id').value.trim();if(!id||!confirm('ارائه‌دهنده و مدل‌هایش حذف شوند؟'))return;try{let d=await deployApi('/api/ai/providers/'+encodeURIComponent(id),{method:'DELETE'});aiProviders=d.providers||[];renderAI();newAIProvider();$('aiStatus').innerHTML='<span class="ok">حذف شد.</span>'}catch(e){$('aiStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function saveAIOptions(){try{let ai={temperature:+$('ai_temperature').value,max_tokens:+$('ai_max_tokens').value,system_prompt:$('ai_system_prompt').value};await deployApi('/api/ai/settings',{method:'POST',body:JSON.stringify({ai})});$('aiStatus').innerHTML='<span class="ok">گزینه‌های تولید ذخیره شد.</span>'}catch(e){$('aiStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function testAI(){try{$('aiStatus').textContent='در حال تست مدل انتخاب‌شده…';let d=await deployApi('/api/ai/test',{method:'POST',body:JSON.stringify({provider:$('ai_provider').value,model:$('ai_model').value,prompt:$('ai_test_prompt').value})});$('aiStatus').innerHTML='<span class="ok">اتصال موفق: '+esc(d.answer)+'</span>'}catch(e){$('aiStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function startAIContent(mode){const names={desc:'توضیح‌ساز',category:'دسته‌بندی',catfix:'اصلاح دسته',all:'محتوا و دسته'};try{$('aiContentStatus').innerHTML='<span class="spinner"></span> شروع '+names[mode]+'…';let d=await deployApi('/api/ai/content/start',{method:'POST',body:JSON.stringify({mode,scope:($('ai_c_scope')||{}).value||'results',limit:+(($('ai_c_limit')||{}).value||20),only_missing:!($('ai_c_missing')&&$('ai_c_missing').checked===false)})});await watchAIContentTask(d.task.id)}catch(e){if($('aiContentStatus'))$('aiContentStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function watchAIContentTask(id){if($('aiContentTask'))$('aiContentTask').style.display='block';for(;;){let d=await deployApi('/api/tasks/'+encodeURIComponent(id));const t=d.task||{};if($('aiContentTitle'))$('aiContentTitle').textContent=t.title||'هوش مصنوعی';if($('aiContentPercent'))$('aiContentPercent').textContent=toFa(Math.round(t.progress||0))+'٪';if($('aiContentBar'))$('aiContentBar').style.width=(t.progress||0)+'%';if($('aiContentStep'))$('aiContentStep').textContent=t.step||'';const ev=compactTaskDetails(t.details).slice().reverse().slice(0,8);if($('aiContentDetails'))$('aiContentDetails').innerHTML=ev.map(x=>'<div class="live-line">'+esc(x.text||'')+'</div>').join('');if(['completed','failed','cancelled'].includes(t.status)){const ok=t.status==='completed';if($('aiContentStatus'))$('aiContentStatus').innerHTML='<span class="'+(ok?'ok':'error')+'">'+(ok?('انجام شد · موفق '+toFa(t.filled||0)+' · خطا '+toFa(t.failed||0)):esc(t.error||t.step||'ناموفق'))+'</span>';break}await new Promise(r=>setTimeout(r,800))}}
async function enrichAI(){if(!confirm('توضیحات حداکثر ۳ محصول ناقص با مدل فعال ساخته شود؟'))return;try{$('aiStatus').textContent='در حال تولید محتوا…';let d=await deployApi('/api/ai/enrich',{method:'POST',body:JSON.stringify({limit:3})});$('aiStatus').innerHTML='<span class="ok">'+d.total+' محصول تکمیل شد.</span>'}catch(e){$('aiStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
let aiStatsData=null,aiCandidates=[];
async function loadAIStats(){try{aiStatsData=await deployApi('/api/ai/stats');$('aiStatsCards').innerHTML=`<div class="space-card"><b>${aiStatsData.total}</b><span>کل مدل‌ها</span></div><div class="space-card"><b>${aiStatsData.available}</b><span>سالم</span></div><div class="space-card"><b>${aiStatsData.failed}</b><span>ناموفق</span></div><div class="space-card"><b>${aiStatsData.untested}</b><span>تست‌نشده</span></div><div class="space-card"><b>${aiStatsData.avg_latency||'—'}</b><span>میانگین ms</span></div><div class="space-card"><b>${aiStatsData.tool_calling}</b><span>ابزارپذیر</span></div>`;$('aiStatsBars').innerHTML=`<div class="live-task" style="display:block"><div class="live-task-head"><b>پوشش آزمایش</b><span>${aiStatsData.coverage_pct}٪</span></div><div class="progress-track"><i style="width:${aiStatsData.coverage_pct}%"></i></div><div class="live-task-head"><b>سلامت مدل‌های آزمایش‌شده</b><span>${aiStatsData.health_pct}٪</span></div><div class="progress-track"><i style="width:${aiStatsData.health_pct}%"></i></div></div>`;renderAIModelCatalog()}catch(e){$('aiModelCatalog').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
function renderAIModelCatalog(){let q=($('aiCatalogSearch')?.value||'').toLowerCase(),f=$('aiCatalogFilter')?.value||'all',rows=aiProviders.flatMap(p=>p.models.map(m=>({...m,provider:p.id,provider_name:p.name}))).filter(m=>{let ok=!q||(`${m.provider_name} ${m.name} ${m.id}`).toLowerCase().includes(q);return ok&&(f==='all'||f==='available'&&m.available||f==='failed'&&m.tested&&!m.available||f==='untested'&&!m.tested||f==='free'&&m.free)});rows.sort((a,b)=>(b.testScore||0)-(a.testScore||0));$('aiModelCatalog').innerHTML=rows.map(m=>`<div class="model-row"><div><b>${esc(m.name||m.id)}</b><br><small>${esc(m.provider_name)} · <code>${esc(m.id)}</code></small></div><span class="badge ${m.available?'ok':m.tested?'error':''}">${m.available?'سالم':m.tested?'ناموفق':'تست‌نشده'}</span><span>${m.testScore||0} امتیاز<br><small>${m.latencyMs||0} ms</small></span></div>`).join('')||'<div class="note">مدلی مطابق فیلتر پیدا نشد.</div>'}
async function loadAICandidates(){try{let d=await deployApi('/api/ai/candidates');aiCandidates=d.candidates||[];$('aiCandProvider').innerHTML=aiProviders.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');renderCandidateModels();renderAICandidates(d.master||'')}catch(e){$('aiCandidateList').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
function renderCandidateModels(){let p=aiProviders.find(x=>x.id===$('aiCandProvider').value);$('aiCandModel').innerHTML=(p?.models||[]).filter(m=>m.available).map(m=>`<option value="${esc(m.id)}">${esc(m.name||m.id)} · ${m.testScore||0}</option>`).join('')||'<option value="">مدل سالمی نیست</option>'}
function candidateKey(x){return x.provider+'/'+x.model}
function renderAICandidates(master=''){let rows=aiCandidates.map(x=>{let p=aiProviders.find(y=>y.id===x.provider),m=p?.models.find(y=>y.id===x.model);return {...x,provider_name:p?.name||x.provider,model_name:m?.name||x.model,score:m?.testScore||0}});$('aiCandidateList').innerHTML=rows.map((x,i)=>`<div class="candidate-row ${candidateKey(x)===master?'master':''}"><div><b>${candidateKey(x)===master?'★ ':''}${esc(x.model_name)}</b><br><small>${esc(x.provider_name)} · ${x.score} امتیاز</small></div><button class="gray" onclick="aiCandidates.splice(${i},1);renderAICandidates($('aiMasterModel').value)">حذف</button></div>`).join('')||'<div class="note">هنوز کاندیدی انتخاب نشده است.</div>';$('aiMasterModel').innerHTML='<option value="">خودکار — بهترین امتیاز</option>'+rows.map(x=>`<option value="${esc(candidateKey(x))}">${esc(x.model_name)} · ${x.score}</option>`).join('');$('aiMasterModel').value=master||''}
function addAICandidate(){let x={provider:$('aiCandProvider').value,model:$('aiCandModel').value};if(x.provider&&x.model&&!aiCandidates.some(y=>candidateKey(y)===candidateKey(x)))aiCandidates.push(x);renderAICandidates($('aiMasterModel').value)}
function addAllHealthyCandidates(){aiProviders.forEach(p=>p.models.filter(m=>m.available).forEach(m=>{let x={provider:p.id,model:m.id};if(!aiCandidates.some(y=>candidateKey(y)===candidateKey(x)))aiCandidates.push(x)}));renderAICandidates($('aiMasterModel').value)}
async function saveAICandidates(){try{let d=await deployApi('/api/ai/candidates',{method:'POST',body:JSON.stringify({candidates:aiCandidates,master:$('aiMasterModel').value})});aiCandidates=d.candidates||[];renderAICandidates(d.master||'');$('aiStatus').innerHTML='<span class="ok">کاندیدها و مدل مستر ذخیره شدند.</span>'}catch(e){$('aiStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
let activeAITestJob='',aiTestJobData=null,aiAutoRunning=false,aiResultPage=1,aiCompareSet=new Set();
function testState(r){return r.status==='ok'?'ok':(r.reply_ok||r.category_ok)?'partial':r.status==='failed'?'failed':'waiting'}
function renderAITest(job){aiTestJobData=job||null;if(!job){activeAITestJob='';$('aiTestSummary').innerHTML='';$('aiTestRows').innerHTML='<div class="note">هنوز صف آزمونی ساخته نشده است.</div>';return}activeAITestJob=job.id;$('aiTestSummary').innerHTML=`<div class="space-card"><b>${job.cursor}/${job.total}</b><span>پیشرفت</span></div><div class="space-card"><b>${job.ok_count}</b><span>هر دو سالم</span></div><div class="space-card"><b>${job.reply_ok}</b><span>پاسخ مشتری</span></div><div class="space-card"><b>${job.category_ok}</b><span>دسته‌بندی</span></div><div class="space-card"><b>${job.failed_count}</b><span>ناقص/ناموفق</span></div>`+`<div class="wide live-task" style="display:block"><div class="live-task-head"><b>${esc(job.status)}</b><span>${job.total?Math.round(job.cursor/job.total*100):0}٪</span></div><div class="progress-track"><i style="width:${job.total?Math.round(job.cursor/job.total*100):0}%"></i></div><div class="live-step">${job.cursor<job.total?'مدل بعدی: '+esc(job.rows[job.cursor]?.model_name||''):'همه مدل‌ها بررسی شدند'}</div></div>`;$('aiTestRows').innerHTML=(job.rows||[]).slice().reverse().slice(0,60).map(r=>{let st=testState(r),preview=r.reply||r.category||r.error||'';return `<div class="test-row ${st}"><div class="test-row-top"><b>${esc(r.provider_name)}</b><span class="badge">${st==='ok'?'✓ سالم':st==='partial'?'◐ ناقص':r.status==='failed'?'✕ ناموفق':'در انتظار'}</span></div><strong>${esc(r.model_name)}</strong>${r.model?`<code>${esc(r.model)}</code>`:''}<small>${r.score?r.score+' امتیاز · ':''}${r.latency_ms?r.latency_ms+' ms · ':''}${esc(String(preview).slice(0,160))}</small></div>`}).join('');if($('aiTestModal').classList.contains('open'))renderAITestModal()}
async function loadAITestJobs(){try{let d=await deployApi('/api/ai/test/jobs');renderAITest((d.jobs||[])[0])}catch(e){$('aiStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
function aiTestBody(){return {per_provider:+$('ai_test_per').value,delay_ms:+$('ai_test_delay').value,only_untested:$('ai_test_only').checked,skip_nonchat:$('ai_test_skip').checked,reply_message:$('ai_reply_sample').value,category_title:$('ai_category_sample').value}}
async function startAITests(openModal=false){let d=await deployApi('/api/ai/test/jobs',{method:'POST',body:JSON.stringify(aiTestBody())});renderAITest(d.job);$('aiStatus').innerHTML='<span class="ok">صف جامع با '+d.job.total+' مدل ساخته و در تسک منیجر ثبت شد.</span>';if(openModal)openAITestModal();return d.job}
async function startAutoAITests(){try{aiAutoRunning=false;await startAITests(true);aiAutoRunning=true;$('aiStatus').innerHTML='<span class="progress-pulse">● تست خودکار همه مدل‌ها در حال اجراست؛ صفحه را باز نگه دارید.</span>';await autoAITestLoop()}catch(e){aiAutoRunning=false;$('aiStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function autoAITestLoop(){while(aiAutoRunning&&aiTestJobData&&aiTestJobData.status!=='completed'){await processAITests(true);await new Promise(r=>setTimeout(r,180))}if(aiTestJobData?.status==='completed'){$('aiStatus').innerHTML='<span class="ok">✓ آزمایش خودکار همه '+aiTestJobData.total+' مدل کامل شد.</span>';aiAutoRunning=false;await loadAI()}}
function stopAutoAITests(){aiAutoRunning=false;$('aiStatus').textContent='اجرای خودکار متوقف شد؛ نتایج ذخیره هستند و اجرای مرحله‌ای قابل ادامه است.'}
async function processAITests(automatic=false){if(!activeAITestJob){await loadAITestJobs();if(!activeAITestJob)return}try{if(!automatic)$('aiStatus').textContent='در حال اجرای دو آزمون برای هر مدل…';let d=await deployApi('/api/ai/test/jobs/'+encodeURIComponent(activeAITestJob)+'/process',{method:'POST',body:JSON.stringify({batch:automatic?1:+$('ai_test_batch').value})});renderAITest(d.job);if(!automatic)$('aiStatus').innerHTML='<span class="ok">'+d.processed+' مدل آزمایش شد؛ '+d.job.waiting+' مدل باقی مانده.</span>';return d.job}catch(e){aiAutoRunning=false;$('aiStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>';throw e}}
function openAITestModal(){if(!aiTestJobData){loadAITestJobs().then(()=>{if(aiTestJobData)openAITestModal()});return}$('aiTestModal').classList.add('open');document.body.style.overflow='hidden';renderAITestModal()}
function closeAITestModal(){$('aiTestModal').classList.remove('open');if(!$('settingsPanel').classList.contains('open'))document.body.style.overflow=''}
function aiRowKey(r){return String(r.provider||'')+'::'+String(r.model||'')}
function toggleAICompare(key,on){if(on){if(aiCompareSet.size>=4){alert('برای مقایسه دقیق حداکثر ۴ مدل انتخاب کنید.');renderAITestModal();return}aiCompareSet.add(key)}else aiCompareSet.delete(key);renderAICompare()}
function renderAICompare(){let box=$('aiCompareBar'),rows=(aiTestJobData?.rows||[]).filter(r=>aiCompareSet.has(aiRowKey(r)));box.classList.toggle('show',rows.length>0);box.innerHTML=rows.length?`<div class="ai-compare-grid">${rows.map(r=>`<div class="ai-compare-card"><b>${esc(r.model_name)}</b><small>${esc(r.provider_name)} · امتیاز ${r.score||0}</small><small>${r.latency_ms||0} ms · پاسخ ${r.reply_ok?'✓':'✕'} · دسته ${r.category_ok?'✓':'✕'}</small></div>`).join('')}</div><button class="gray" onclick="aiCompareSet.clear();renderAITestModal()">پاک‌کردن</button>`:''}
async function activateAIModel(provider,model){await selectAI(provider,model);$('aiStatus').innerHTML='<span class="ok">مدل انتخاب‌شده فعال شد.</span>'}
function renderAITestModal(){let job=aiTestJobData;if(!job)return;let all=job.rows||[],q=(($('aiResultSearch')||{}).value||'').toLowerCase();let rows=all.filter(r=>{let hay=[r.provider_name,r.model_name,r.model,r.reply,r.category,r.error,r.reply_error,r.category_error].join(' ').toLowerCase();return !q||hay.includes(q)});rows.sort((a,b)=>(b.score||0)-(a.score||0));let tested=rows.filter(r=>r.latency_ms>0).map(r=>r.latency_ms).sort((a,b)=>a-b),pct=n=>tested.length?tested[Math.min(tested.length-1,Math.floor((tested.length-1)*n))]:0,healthy=rows.filter(r=>testState(r)==='ok').length,best=rows.reduce((a,r)=>(r.score||0)>(a?.score||-1)?r:a,null);let size=window.innerWidth<720?20:40,pages=Math.max(1,Math.ceil(rows.length/size));aiResultPage=Math.max(1,Math.min(aiResultPage,pages));let offset=(aiResultPage-1)*size,shown=rows.slice(offset,offset+size);$('aiResultPageInfo').textContent=`صفحه ${aiResultPage} از ${pages} · نمایش ${shown.length} از ${rows.length}`;$('aiModalSubtitle').textContent=`${job.cursor} از ${job.total} مدل · تحلیل پاسخ مشتری و دسته‌بندی`;$('aiModalStats').innerHTML=`<div class="space-card"><b>${rows.length}</b><span>نتیجه فیلترشده</span></div><div class="space-card"><b>${healthy}</b><span>کاملاً سالم · ${rows.length?Math.round(healthy/rows.length*100):0}٪</span></div><div class="space-card"><b>${pct(.5)||'—'}</b><span>میانه latency (ms)</span></div><div class="space-card"><b>${pct(.95)||'—'}</b><span>P95 latency (ms)</span></div><div class="space-card"><b>${esc(best?.model_name||'—')}</b><span>برتر · ${best?.score||0} امتیاز</span></div>`;renderAICompare();$('aiModalRows').innerHTML=shown.map((r,i)=>{let st=testState(r),rank=offset+i+1,key=encodeURIComponent(aiRowKey(r)),reply=r.reply||r.reply_error||r.error||'در انتظار',category=r.category||r.category_error||r.error||'در انتظار',caps=(r.free?'<i class="cap-dot">رایگان</i>':'')+(r.reasoning?'<i class="cap-dot">استدلال</i>':'')+(r.vision?'<i class="cap-dot">تصویر</i>':'')+(r.tool_calling?'<i class="cap-dot">ابزار</i>':'');return `<tr class="row-${st}"><td class="ai-td-sel" data-label=""><input class="ai-select" type="checkbox" ${aiCompareSet.has(aiRowKey(r))?'checked':''} onchange="toggleAICompare(decodeURIComponent('${key}'),this.checked)"></td><td class="ai-td-rank" data-label="رتبه"><span class="rank-medal ${rank<=3?'top':''}">${rank<=3?['🥇','🥈','🥉'][rank-1]:rank}</span></td><td class="ai-td-model" data-label="مدل"><b>${esc(r.provider_name)}</b><br><strong>${esc(r.model_name)}</strong><br><code>${esc(r.model)}</code></td><td class="ai-td-score" data-label="امتیاز"><div class="score-box"><div class="score-line"><span>${r.score||0}</span><small>از ۱۰۰</small></div><div class="score-meter"><i style="width:${Math.min(100,r.score||0)}%"></i></div></div>${caps}</td><td class="answer-cell ai-td-reply" data-label="پاسخ مشتری"><span class="${r.reply_ok?'ok':'error'}">${r.reply_ok?'✓ معتبر':'✕ نامعتبر'}</span><div class="answer-preview">${esc(reply)}</div><details><summary>مشاهده پاسخ کامل</summary><div class="answer-full">${esc(reply)}</div></details></td><td class="answer-cell ai-td-cat" data-label="دسته‌بندی"><span class="${r.category_ok?'ok':'error'}">${r.category_ok?'✓ معتبر':'✕ نامعتبر'}</span><div class="answer-preview">${esc(category)}</div><details><summary>مشاهده خروجی کامل</summary><div class="answer-full">${esc(category)}</div></details></td><td class="ai-td-lat" data-label="کارایی"><span class="latency-pill">کل ${r.latency_ms||0} ms</span><br><small>پاسخ ${r.reply_ms||0} · دسته ${r.category_ms||0}</small></td><td class="ai-td-res" data-label="نتیجه"><span class="badge ${st==='ok'?'ok':st==='waiting'?'':'error'}">${st==='ok'?'سالم':st==='partial'?'ناقص':st==='failed'?'خطا':'انتظار'}</span><br>${st==='ok'?`<button style="margin-top:5px;padding:5px 8px;min-height:30px;font-size:10px" onclick="activateAIModel(decodeURIComponent('${encodeURIComponent(r.provider||'')}'),decodeURIComponent('${encodeURIComponent(r.model||'')}'))">فعال‌سازی</button>`:''}</td></tr>`}).join('')||'<tr><td colspan="8" class="empty">نتیجه‌ای مطابق فیلترهای حرفه‌ای نیست.</td></tr>'}

async function activateBestAIModel(){let r=aiTestJobData?.recommended;if(!r){$('aiStatus').innerHTML='<span class="error">هنوز مدل موفقی برای پیشنهاد وجود ندارد.</span>';return}await selectAI(r.provider,r.model);$('ai_provider').dataset.selected=r.provider;$('ai_model').dataset.selected=r.model;await loadAI();$('aiStatus').innerHTML='<span class="ok">مدل برتر «'+esc(r.model_name)+'» با امتیاز '+r.score+' فعال شد.</span>'}
function downloadAITestResults(){if(!aiTestJobData)return;let blob=new Blob([JSON.stringify(aiTestJobData,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(aiTestJobData.id||'ai-tests')+'.json';a.click();URL.revokeObjectURL(a.href)}
const changeLabels={all:'همه محصولات استخراج‌شده',added:'محصولات جدید',price_changed:'محصولات با تغییر قیمت',changed:'محصولات با تغییر محتوا',removed:'محصولات حذف‌شده',unchanged:'محصولات بدون تغییر'};
function renderComparisonCards(c={}){lastComparison=c||{lists:{}};let vals=[products.length,c.added||0,c.price_changed||0,c.content_changed??c.changed??0,c.removed||0,c.unchanged||0];$('extractCounters').querySelectorAll('button b').forEach((x,i)=>x.textContent=toFa(vals[i]||0));$('resultCountBadge').textContent=toFa(products.length)+' محصول'}
function renderComparisonHistory(history=[]){$('comparisonHistory').innerHTML=history.map((h,i)=>`<article class="history-item ${i===0?'current':''}"><b>${h.at?new Date(h.at*1000).toLocaleString('fa-IR'):'استخراج اخیر'}</b><span>کل: ${h.total||0}</span><span class="ok">جدید: ${h.added||0}</span><span>قیمت: ${h.price_changed||0}</span><span class="error">حذف: ${h.removed||0}</span><br><small>${h.pages||0} صفحه · بدون تغییر: ${h.unchanged||0}</small></article>`).join('')||'<div class="note">پس از اولین استخراج، تاریخچه اینجا نمایش داده می‌شود.</div>'}
function openChangeList(kind){let rows=kind==='all'?products:(lastComparison.lists?.[kind]||[]);$('changeModalTitle').textContent=changeLabels[kind]||'جزئیات';$('changeModalSub').textContent=rows.length+' محصول';$('changeModalList').innerHTML=rows.map((p,i)=>`<article class="change-product">${p.image?`<img src="${esc(p.image)}" loading="lazy" alt="">`:'<span></span>'}<div><b>${esc(p.title||'بدون عنوان')}</b><br><small>SKU: ${esc(p.sku||'—')} · موجودی: ${esc(p.stock??'—')}</small>${kind==='changed'&&p.changed_fields?.length?`<br><small class="ok">فیلدهای تغییرکرده: ${p.changed_fields.map(esc).join('، ')}</small>`:''}</div><div>${kind==='price_changed'?`<span class="price-before">${esc(p.previous_price||'—')}</span> ← <span class="price-after">${esc(p.price||'—')}</span>`:`<span class="price-after">${esc(p.price||'—')}</span>`}${p.link?`<br><a href="${esc(p.link)}" target="_blank" rel="noopener">مشاهده محصول ↗</a>`:''}</div></article>`).join('')||'<div class="note">محصولی در این گروه وجود ندارد.</div>';$('changeModal').classList.add('open');document.body.style.overflow='hidden'}
function closeChangeList(){$('changeModal').classList.remove('open');if(!$('settingsPanel').classList.contains('open')&&!$('aiTestModal').classList.contains('open'))document.body.style.overflow=''}
function renderExtractTask(t){$('extractLiveTask').style.display='block';$('extractTaskTitle').textContent=t.title||'استخراج';$('extractTaskPercent').textContent=toFa(Math.round(t.progress||0))+'٪';$('extractTaskBar').style.width=(t.progress||0)+'%';if($('extractTaskMetrics'))$('extractTaskMetrics').innerHTML=`<span><small>انجام</small><b>${toFa(t.done??'—')} / ${toFa(t.total??'—')}</b></span><span><small>محصول</small><b>${toFa(t.extracted??'—')}</b></span><span><small>سپری‌شده</small><b>${esc(shortDuration(t.elapsed_seconds))}</b></span>${t.eta_seconds?`<span><small>باقی‌مانده</small><b>≈ ${esc(shortDuration(t.eta_seconds))}</b></span>`:''}`;$('extractTaskStep').textContent=t.step||'';const events=compactTaskDetails(t.details);$('extractTaskDetails').innerHTML=events.map(x=>`<div class="live-detail"><b>${esc(x.at)}</b> · ${esc(clipTaskText(x.text))}${x.n>1?` ×${toFa(x.n)}`:''}</div>`).join('');$('extractTaskDetails').scrollTop=$('extractTaskDetails').scrollHeight}
async function watchDetailTask(id){for(;;){try{let d=await api('/api/tasks/'+encodeURIComponent(id)),t=d.task;renderExtractTask(t);if(['completed','failed','cancelled','interrupted'].includes(t.status)){if(t.status==='completed'&&t.result){products=t.result.products||products;renderRows();renderComparisonCards(t.result.comparison||{});$('status').innerHTML='<span class="ok">✓ فهرست سریع آماده بود و اکنون جزئیات '+(t.result.diagnostics?.details?.completed||0)+' محصول نیز تکمیل شد.</span>'}else $('status').innerHTML+='<br><span class="error">وظیفه جزئیات: '+esc(t.error||t.step)+'</span>';loadTaskTopSummary();break}await new Promise(r=>setTimeout(r,1800))}catch(e){break}}}
function updateEngineHint(){const el=$('engineMasterHint');if(!el)return;const m=(($('fetch_engine_master')||{}).value||'').trim();const pin=(($('fetch_engine')||{}).value||'auto');el.textContent=m?( (pin!=='auto'?'پین دستی: ':'مستر این سایت: ')+m+' · بقیه پشتیبان'):'هنوز مستر نیست؛ استخراج اول سریع‌ترین موتور موفق را ذخیره می‌کند'}
function onFetchEngineChange(){const v=(($('fetch_engine')||{}).value||'auto');if(v&&v!=='auto'&&$('fetch_engine_master'))$('fetch_engine_master').value=v;updateEngineHint()}
async function runScrape(){const btn=$('runBtn'),old=btn.innerHTML;if(!$('url').value.trim()){$('status').innerHTML='<span class="error">لطفاً آدرس صفحه را وارد کنید.</span>';$('url').focus();return}btn.disabled=true;lastComparison={lists:{}};renderComparisonCards({});btn.innerHTML='<span class="spinner"></span>در حال برداشت';$('status').innerHTML='<span class="progress-pulse">● وظیفه استخراج روی سرور اجرا می‌شود؛ جزئیات زنده پایین نمایش داده می‌شود.</span>';try{let started=await api('/api/scrape/start',{method:'POST',body:JSON.stringify(config())}),task;for(;;){let d=await api('/api/tasks/'+encodeURIComponent(started.task.id));task=d.task;renderExtractTask(task);if(['completed','failed','cancelled','interrupted'].includes(task.status))break;await new Promise(r=>setTimeout(r,750))}if(task.status!=='completed')throw Error(task.error||task.step||'استخراج کامل نشد');let d=task.result;products=d.products;if(d.diagnostics&&d.diagnostics.fetch_engine_master){if($('fetch_engine_master'))$('fetch_engine_master').value=d.diagnostics.fetch_engine_master;if(activeProfile&&profiles[activeProfile]){profiles[activeProfile].fetch_engine_master=d.diagnostics.fetch_engine_master;profiles[activeProfile].fetch_engine_ms=d.diagnostics.fetch_engine_ms||0}updateEngineHint()}renderRows();let c=d.comparison||{};renderComparisonCards(c);if(activeProfile&&profiles[activeProfile]){let p=profiles[activeProfile],summary={...c};delete summary.lists;p.last_comparison=c;p.comparison_history=[summary,...(p.comparison_history||[])].slice(0,10);renderComparisonHistory(p.comparison_history)}else renderComparisonHistory([c]);$('status').innerHTML=`<span class="ok">⚡ ${d.total} محصول از ${d.pages} صفحه با فاز سریع استخراج شد${d.diagnostics&&d.diagnostics.fetch_engine_master?(' · مستر '+d.diagnostics.fetch_engine_master):''}</span>\n${d.detail_task?'جزئیات به‌صورت مستقل در پس‌زمینه ادامه دارد؛ نتیجه فهرست منتظر آن نمی‌ماند.':'جدول کامل در تب «نتایج» است.'}\nروش: ${esc(d.modes.join(' · '))}`;if(d.detail_task)watchDetailTask(d.detail_task.id)}catch(e){$('status').innerHTML='<span class="error">✗ عملیات ناموفق بود\n'+esc(e.message)+'</span>'}finally{btn.disabled=false;btn.innerHTML=old}}
function renderDetailCoverage(){let n=products.length,count=f=>products.filter(f).length,cards=[['توضیحات',count(p=>p.short_desc||p.long_desc)],['گالری چندتصویری',count(p=>(p.images||[]).length>1)],['تنوع‌ها',count(p=>(p.variation_groups||[]).length||p.variations_text)],['مشخصات',count(p=>(p.attributes||[]).length)],['جزئیات کامل',count(p=>p.detail_status==='complete')]];$('detailCoverage').innerHTML=cards.map(([name,value])=>`<div class="space-card coverage-card"><b>${value}</b><span>${name} · ${n?Math.round(value/n*100):0}٪</span></div>`).join('')}
function openProductDetail(i){let p=products[i];if(!p)return;$('productDetailTitle').textContent=p.title||'جزئیات محصول';$('productDetailMeta').textContent='SKU: '+(p.sku||'—')+' · '+(p.detail_status==='complete'?'استخراج تفصیلی کامل':'اطلاعات موجود');let imgs=(p.images||[p.image]).filter(Boolean),groups=p.variation_groups||[],attrs=p.attributes||[];$('productDetailBody').innerHTML=`<div class="product-detail-grid"><div><section class="detail-section"><h3>📝 توضیح کوتاه</h3><div class="rich-description">${esc(p.short_desc||'استخراج نشده')}</div></section><section class="detail-section"><h3>📄 توضیحات کامل</h3><div class="rich-description">${esc(p.long_desc||'استخراج نشده')}</div></section><section class="detail-section"><h3>🎨 تنوع‌ها</h3>${groups.map(g=>`<div class="variation-group"><b>${esc(g.name)}</b><div class="variation-values">${(g.values||[]).map(v=>`<i>${esc(v)}</i>`).join('')}</div></div>`).join('')||esc(p.variations_text||'استخراج نشده')}</section><section class="detail-section"><h3>📋 مشخصات</h3>${attrs.map(a=>`<div class="attribute-row"><b>${esc(a.name)}</b><span>${esc(a.value)}</span></div>`).join('')||'استخراج نشده'}</section></div><aside><section class="detail-section"><h3>🖼 گالری (${imgs.length})</h3><div class="product-gallery">${imgs.map(x=>`<a href="${esc(x)}" target="_blank" rel="noopener"><img src="${esc(x)}" loading="lazy" alt=""></a>`).join('')||'تصویری نیست'}</div></section><section class="detail-section"><h3>اطلاعات پایه</h3><div class="attribute-row"><b>قیمت</b><span>${esc(p.price||'—')}</span></div><div class="attribute-row"><b>موجودی</b><span>${esc(p.stock||'—')}</span></div><div class="attribute-row"><b>برند</b><span>${esc(p.brand||'—')}</span></div><div class="attribute-row"><b>وزن</b><span>${esc(p.weight||'—')}</span></div><div class="attribute-row"><b>دسته</b><span>${esc(p.category||'—')}</span></div></section></aside></div>`;$('productDetailModal').classList.add('open');document.body.style.overflow='hidden'}
function closeProductDetail(){$('productDetailModal').classList.remove('open');document.body.style.overflow=''}
function renderRows(){if($('resultCountBadge'))$('resultCountBadge').textContent=toFa(products.length)+' محصول';renderDetailCoverage();renderResultAlternatives();if(!products.length){$('rows').innerHTML='<tr><td class="empty" colspan="7">محصولی پیدا نشد. آدرس، روش محتوا یا سلکتورها را بررسی کنید.</td></tr>';return}$('rows').innerHTML=products.map((p,i)=>`<tr><td data-label="ردیف">${toFa(i+1)}</td><td data-label="تصویر">${p.image?`<img src="${esc(p.image)}" loading="lazy" alt="">`:''}</td><td data-label="عنوان">${esc(p.title)}</td><td data-label="قیمت" dir="ltr">${esc(p.price)}</td><td data-label="SKU">${esc(p.sku)}</td><td data-label="جزئیات"><button class="gray" onclick="openProductDetail(${i})">${p.detail_status==='complete'?'✓ مشاهده':'مشاهده'}</button></td><td data-label="لینک">${p.link?`<a href="${esc(p.link)}" target="_blank" rel="noopener">مشاهده ↗</a>`:''}</td></tr>`).join('')}

async function saveProfilePrompt(){const current=activeProfile||'';const shown=prettyProfile(current,profiles[current]||{});let name=prompt('نام پروفایل:',shown||'');if(!name)return;const c=config();c.display_name=name.trim();const key=current||name.trim();let d=await api('/api/profile',{method:'POST',body:JSON.stringify({name:key,config:c})});profiles=d.profiles;activeProfile=d.active_profile||key;renderProfiles();updateActiveProfileUI()}
function prettyProfile(name,cfg){
  if(cfg&&cfg.display_name) return String(cfg.display_name).trim();
  const key=String(name||'').trim();
  if(key && !/https?:/i.test(key) && !/__/.test(key) && key.length<=60 && !/_D[89ABab]/.test(key) && (/[\u0600-\u06FF]/.test(key) || !/\.(ir|com|shop|net)\b/i.test(key))) return key;
  const url=(cfg&&cfg.url)||'';
  let host='', tail='';
  try{
    const raw=url.startsWith('http')?url:'https://'+String(url).replace(/^\/\//,'');
    const u=new URL(raw);
    host=(u.hostname||'').replace(/^www\./,'');
    const parts=decodeURIComponent(u.pathname||'').replace(/\/+$/,'').split('/').filter(Boolean);
    tail=parts.pop()||'';
    while(parts.length && (/^\d+$/.test(tail) || /^page\b/i.test(tail))){ tail=parts.pop()||''; }
    tail=tail.replace(/~Category~\d+$/i,'').replace(/[~_\-]+/g,' ').replace(/\s+/g,' ').trim();
    if(tail.length>36) tail=tail.slice(0,34)+'…';
  }catch(e){}
  if(host&&tail) return host+' · '+tail;
  if(host) return host;
  return String(name||'پروفایل').replace(/_+/g,' ').replace(/\s+/g,' ').trim()||'پروفایل';
}

function renderProfiles(){const entries=Object.entries(profiles);$('profileList').innerHTML=entries.map(([n,c])=>`<div class="card profile-card" onclick='loadProfile(${JSON.stringify(n)},true,true)'><b>${n===activeProfile?'● ':''}${esc(prettyProfile(n,c))}</b><div class="actions"><button class="gray" onclick='event.stopPropagation();delProfile(${JSON.stringify(n)})'>حذف</button></div></div>`).join('')||'<div class="note">هنوز پروفایلی نیست.</div>';$('profileSelect').innerHTML='<option value="">— پروفایل جدید —</option>'+entries.map(([n,c])=>`<option value="${esc(n)}">${esc(prettyProfile(n,c))}</option>`).join('');$('profileSelect').value=activeProfile||'';if($('dispatchProfile')){$('dispatchProfile').innerHTML=entries.map(([n,c])=>`<option value="${esc(n)}">${esc(prettyProfile(n,c))} — ${toFa(c.saved_products?.length||0)} محصول</option>`).join('')||'<option value="">پروفایلی موجود نیست</option>';$('dispatchProfile').value=activeProfile&&profiles[activeProfile]?activeProfile:(entries[0]?.[0]||'')}if($('dispatchProfileBasalam')){$('dispatchProfileBasalam').innerHTML=entries.map(([n,c])=>`<option value="${esc(n)}">${esc(prettyProfile(n,c))} — ${toFa(c.saved_products?.length||0)} محصول</option>`).join('')||'<option value="">پروفایلی موجود نیست</option>';$('dispatchProfileBasalam').value=activeProfile&&profiles[activeProfile]?activeProfile:(entries[0]?.[0]||'')}}
function updateActiveProfileUI(){let p=profiles[activeProfile];$('profileSelect').value=activeProfile||'';$('activeProfileBadge').textContent=activeProfile?prettyProfile(activeProfile,p):'جدید';$('activeProfileBadge').className='badge '+(activeProfile?'ok':'');$('activeProfileInfo').textContent=p?toFa(p.saved_products?.length||0)+' محصول':'پروفایل را انتخاب کنید.';}
async function loadSelectedProfile(){let n=$('profileSelect').value;await loadProfile(n,false,true)}
function deleteSelectedProfile(){const n=$('profileSelect').value;if(!n){alert('یک پروفایل انتخاب کنید');return}delProfile(n)}
async function renameSelectedProfile(){const n=$('profileSelect').value;if(!n){alert('یک پروفایل انتخاب کنید');return}const shown=prettyProfile(n,profiles[n]||{});const nn=(prompt('نام نمایشی پروفایل:',shown)||'').trim();if(!nn||nn===shown)return;try{let d=await api('/api/profile/rename',{method:'POST',body:JSON.stringify({old:n,name:nn})});profiles=d.profiles||{};activeProfile=d.active_profile||nn;renderProfiles();updateActiveProfileUI();if($('status'))$('status').innerHTML='<span class="ok">✓ نام پروفایل به «'+esc(prettyProfile(activeProfile,profiles[activeProfile]||{}))+'» تغییر کرد.</span>'}catch(e){alert(e.message)}}
async function loadProfile(n,switchTab=false,persist=true){if(persist){let d=await api('/api/profile/active',{method:'POST',body:JSON.stringify({name:n})});activeProfile=d.active_profile||'';if(d.config)profiles[activeProfile]=d.config}else activeProfile=n||'';let p=profiles[activeProfile];if(p){apply(p);if(Array.isArray(p.saved_products)){products=p.saved_products;renderRows();renderComparisonCards(p.last_comparison||{});renderComparisonHistory(p.comparison_history||[])}if($('status'))$('status').innerHTML='<span class="ok">✓ پروفایل «'+esc(prettyProfile(activeProfile,p))+'» · '+toFa(products.length)+' محصول.</span>'}renderProfiles();updateActiveProfileUI();syncProfileAcrossTabs();if(switchTab)openTab('scrape')}
async function delProfile(n){if(!confirm('پروفایل حذف شود؟'))return;let d=await api('/api/profile/'+encodeURIComponent(n),{method:'DELETE'});profiles=d.profiles;activeProfile=d.active_profile||'';renderProfiles();updateActiveProfileUI()}
async function loadJobs(){try{let d=await api('/api/extract/jobs');$('jobList').innerHTML=(d.jobs||[]).map(j=>`<div class="card"><b>${esc(j.id)}</b><br><small>وضعیت: ${esc(j.status)} · محصول: ${j.total||0} · صفحه بعد: ${j.next_page||'-'}</small><div class="actions">${j.status!=='completed'?`<button onclick="resumeJob('${esc(j.id)}')">ادامه</button>`:''}<button class="gray" onclick="deleteJob('${esc(j.id)}')">حذف</button></div></div>`).join('')||'<div class="note">صف خالی است.</div>'}catch(e){$('jobList').textContent=e.message}}
async function resumeJob(id){try{$('jobList').textContent='در حال ادامه استخراج…';let d=await api('/api/extract/resume/'+encodeURIComponent(id),{method:'POST',body:'{}'});products=d.products||[];renderRows();$('status').innerHTML=`<span class="ok">✓ عملیات ادامه یافت؛ ${d.total||0} محصول</span>`;openTab('results')}catch(e){$('jobList').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function deleteJob(id){if(!confirm('این نقطه ادامه حذف شود؟'))return;await api('/api/extract/jobs/'+encodeURIComponent(id),{method:'DELETE'});loadJobs()}
function downloadCSV(){location.href='/api/export.csv'}function downloadJSON(){location.href='/api/export.json'}function downloadXLSX(){location.href='/api/export.xlsx'}let importFile=null,importHeaders=[];
async function previewImport(input){if(!input.files[0])return;importFile=input.files[0];let f=new FormData();f.append('file',asciiFile(importFile,'import.csv'));try{let r=await fetch('/api/import/preview',{method:'POST',body:f}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error);importHeaders=d.headers||[];const fields={title:'عنوان',price:'قیمت',link:'لینک',image:'تصویر اصلی',images:'گالری',sku:'SKU',stock:'موجودی',brand:'برند',category:'دسته‌بندی',weight:'وزن',short_desc:'توضیح کوتاه',long_desc:'توضیح کامل'};$('importMap').innerHTML=Object.entries(fields).map(([k,n])=>`<div><label>${n}</label><select data-map="${k}"><option value="">— استفاده نشود —</option>${importHeaders.map(h=>`<option value="${esc(h)}" ${h.toLowerCase()===k?'selected':''}>${esc(h)}</option>`).join('')}</select></div>`).join('');$('importOptions').style.display='grid';$('applyImportBtn').style.display='inline-block';$('importPreview').style.display='block';$('importPreview').textContent=`${d.total} ردیف؛ ستون‌ها: ${importHeaders.join('، ')}`;}catch(e){$('importPreview').style.display='block';$('importPreview').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function applyImport(){if(!importFile)return;let mapping={};document.querySelectorAll('[data-map]').forEach(x=>mapping[x.dataset.map]=x.value);let options={price_multiplier:+$('impMul').value,price_addition:+$('impAdd').value,title_prefix:$('impPrefix').value,title_suffix:$('impSuffix').value,mode:$('impMode').value};let f=new FormData();f.append('file',asciiFile(importFile,'import.csv'));f.append('mapping',JSON.stringify(mapping));f.append('options',JSON.stringify(options));try{$('importPreview').textContent='در حال درون‌ریزی…';let r=await fetch('/api/import/apply',{method:'POST',body:f}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error);products=d.products||[];renderRows();$('status').innerHTML=`<span class="ok">✓ ${d.total} محصول پس از نگاشت وارد شد</span>`;openTab('results')}catch(e){$('importPreview').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function backupSettings(){try{let secret=await needDeploySecret(),r=await fetch((typeof BASE==='string'?BASE:'')+'/api/settings/backup',{method:'POST',headers:deployHeaders()});if(!r.ok){let d=await r.json();throw Error(d.error)}let blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='scraper4-settings.json';a.click();URL.revokeObjectURL(a.href);$('backupStatus').innerHTML='<span class="ok">پشتیبان دانلود شد.</span>'}catch(e){$('backupStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function restoreSettings(input){if(!input.files[0]||!confirm('همه تنظیمات و صف‌های فعلی جایگزین شوند؟'))return;try{needDeploySecret();const f=new FormData();f.append('file',asciiFile(input.files[0],'scraper4-settings.json'));f.append('deploy_password',deploySecret||'');let r=await fetch((typeof BASE==='string'?BASE:'')+'/api/settings/restore',{method:'POST',headers:deployHeaders(),body:f}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'بازیابی ناموفق');$('backupStatus').innerHTML='<span class="ok">'+esc(d.message)+'؛ صفحه در حال بارگذاری مجدد است.</span>';setTimeout(()=>location.reload(),900)}catch(e){$('backupStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}finally{input.value=''}}
async function importCSV(input){if(!input.files[0])return;let form=new FormData();form.append('file',asciiFile(input.files[0],'import.csv'));try{let r=await fetch('/api/import.csv',{method:'POST',body:form}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'ورود ناموفق');products=d.products||[];renderRows();$('status').innerHTML=`<span class="ok">✓ ${d.total} محصول از CSV وارد شد</span>`;openTab('results')}catch(e){$('status').innerHTML='<span class="error">'+esc(e.message)+'</span>'}finally{input.value=''}}
function updateGatewayUI(){let mode=$('proxy_mode')?.value||'direct',names={relay:'Cloudflare Worker',direct:'اتصال مستقیم',http:'HTTP Proxy',auto:'تشخیص خودکار'},label=names[mode]||mode;if($('gatewayModeBadge')){$('gatewayModeBadge').textContent=label;$('gatewayModeBadge').className='badge '+(mode==='direct'?'ok':'')}if($('gatewayFlowMode'))$('gatewayFlowMode').textContent=label}
async function diagnoseGateway(){try{$('networkStatus').innerHTML='<span class="spinner"></span> آزمایش دسترسی، Authorization، POST و JSON…';let d=await deployApi('/api/network/diagnose',{method:'POST',body:'{}'}),mark=x=>x?'✓':'✕';$('networkStatus').innerHTML=(d.ready_for_authenticated_api?'<span class="ok">دروازه برای APIهای احراز هویت‌شده آماده است.</span>':'<span class="error">دروازه برای باسلام/AI خصوصی کامل نیست.</span>')+`\nدسترسی ${mark(d.reachable)} · Authorization ${mark(d.authorization)} · POST ${mark(d.method)} · JSON ${mark(d.json)} · مسیر ${esc(d.transport)}`}catch(e){$('networkStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function useMyWorker(){$('proxy').value='https://proxy.fazilat-ma.workers.dev';$('proxy_mode').value='relay';updateGatewayUI();await saveSettings();}
async function saveSettings(woo=false){let body={network:{timeout:+$('timeout').value,gap_ms:+$('gap_ms').value,proxy:$('proxy').value.trim(),proxy_mode:$('proxy_mode').value,worker_key:$('worker_key').value.trim(),verify_tls:$('verify_tls').checked}};if(woo)body.woocommerce={url:$('woo_url').value.trim(),consumer_key:$('woo_ck').value.trim(),consumer_secret:$('woo_cs').value.trim()};await deployApi('/api/settings',{method:'POST',body:JSON.stringify(body)});updateGatewayUI();if($('networkStatus'))$('networkStatus').innerHTML='<span class="ok">دروازه مرکزی ذخیره شد و همه اتصال‌های خروجی از این مسیر استفاده می‌کنند.</span>'}
async function wooTest(){const target=$('wooConnectionStatus')||$('wooStatus');try{target.textContent='در حال تست ووکامرس از دروازه مرکزی '+$('proxy_mode').value+'…';let d=await deployApi('/api/woo/test',{method:'POST',body:'{}'});target.innerHTML='<span class="ok">اتصال ووکامرس از دروازه مرکزی موفق است.</span>'}catch(e){target.innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function wooQueue(){try{let d=await deployApi('/api/woo/queue',{method:'POST',body:JSON.stringify({products,status:$('woo_product_status').value,update_existing:$('woo_update').checked})});$('wooStatus').innerHTML='<span class="ok">صف ساخته شد؛ اکنون «ادامه / تخلیه کامل» را بزنید.</span>';loadWooJobs()}catch(e){$('wooStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function loadWooJobs(){try{let d=await deployApi('/api/woo/jobs');$('wooJobList').innerHTML=(d.jobs||[]).map(j=>`<div class="card"><b>${esc(j.id)}</b><br><small>${esc(j.status)} · پیشرفت ${j.cursor||0}/${j.total||0} · موفق ${j.sent||0} · خطا ${j.failed||0}</small><div class="progress-track"><i style="width:${j.total?Math.round((j.cursor||0)/j.total*100):0}%"></i></div><div class="actions">${j.status!=='completed'?`<button onclick="processWoo('${esc(j.id)}')">ادامه / تخلیه کامل</button>`:''}<button class="gray" onclick="deleteWoo('${esc(j.id)}')">حذف</button></div></div>`).join('')||'<div class="note">صفی وجود ندارد.</div>'}catch(e){$('wooStatus').textContent=e.message}}
async function processWoo(id){try{$('wooStatus').textContent='در حال تخلیه کامل صف ووکامرس روی سرور…';let d=await deployApi('/api/woo/process/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify({batch:+$('woo_batch').value||50,drain:true})});$('wooStatus').innerHTML=`<span class="ok">صف روی سرور در حال ارسال است · ${d.job.cursor||0}/${d.job.total||0}</span>`;loadWooJobs()}catch(e){$('wooStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function deleteWoo(id){if(!confirm('صف حذف شود؟'))return;await deployApi('/api/woo/jobs/'+encodeURIComponent(id),{method:'DELETE'});loadWooJobs()}
function toFa(x){return String(x??'').replace(/[0-9]/g,d=>'۰۱۲۳۴۵۶۷۸۹'[+d])}
function showToast(msg,isErr){let t=$('toast');if(!t){try{alert(msg)}catch(e){}return}clearTimeout(window._toastT);t.textContent=msg;t.className=isErr?'err show':'show';window._toastT=setTimeout(()=>{t.className=isErr?'err':''},3200)}
function deployGoTo(){try{if(typeof showAdmin==='function'){if(typeof toggleSettingsPanel==='function')toggleSettingsPanel(true);showAdmin('deploy')}else if(typeof openTab==='function')openTab('deploy')}catch(e){}try{let b=$('deployMainBtn');if(b)b.scrollIntoView({behavior:'smooth',block:'center'})}catch(_e){}}
function dismissDeployBanner(){let b=$('deployBanner');if(b)b.style.display='none'}
function showDeployBanner(text){let b=$('deployBanner');if(!b)return;b.style.display='flex';$('deployBannerText').textContent=text}
let DEPLOY_BRANCHES=[],DEPLOY_FILES=[];
function deployBranchesFromUI(){let raw=($('dep_branches').value||'').split(/[\s,;\n]+/).map(x=>x.trim()).filter(Boolean);let seen=[],out=[];raw.forEach(b=>{if(!seen.includes(b)){seen.push(b);out.push(b)}});return out.slice(0,8)}
function renderBranchChips(newest){let list=deployBranchesFromUI();let box=$('depBranchChips');if(!box)return;box.innerHTML=list.map(b=>`<span class="branch-chip${newest&&b===newest?' newest':''}">${esc(b)}${newest&&b===newest?' ★ جدیدترین':''}<button onclick="removeDeployBranch('${esc(b)}')">✕</button></span>`).join('')||'<span style="color:var(--muted);font-size:11px">برنچی ثبت نشده است.</span>'}
function removeDeployBranch(b){let list=deployBranchesFromUI().filter(x=>x!==b);$('dep_branches').value=list.join('\n');renderBranchChips();saveDeploy()}
function addDeployBranch(){let v=($('dep_branch_pick').value||'').trim();if(!v){showToast('ابتدا یک برنچ انتخاب یا تایپ کنید',1);return}if(!/^[A-Za-z0-9._\-/]{1,150}$/.test(v)||v.includes('..')){showToast('نام برنچ معتبر نیست',1);return}let list=deployBranchesFromUI();if(list.includes(v)){showToast('این برنچ قبلا اضافه شده');return}if(list.length>=8){showToast('حداکثر ۸ برنچ',1);return}list.push(v);$('dep_branches').value=list.join('\n');$('dep_branch_pick').value='';closeDeployDrops();renderBranchChips();saveDeploy()}
function closeDeployDrops(){['depBranchDrop','depFileDrop'].forEach(id=>{let e=$(id);if(e)e.classList.remove('open')})}
async function loadDeployBranches(manual){let repo=($('dep_repo').value||'').trim();if(!repo){if(manual)showToast('ابتدا نام ریپو را وارد کنید',1);return}let btn=$('depRepoBtn');if(btn){btn.disabled=true;btn.textContent='⏳'}try{let d=await deployApi('/api/deploy/branches?repo='+encodeURIComponent(repo));DEPLOY_BRANCHES=d.branches||[];if(manual)showToast('✓ '+toFa(DEPLOY_BRANCHES.length)+' برنچ')}catch(e){DEPLOY_BRANCHES=[];if(manual)showToast(e.message,1)}finally{if(btn){btn.disabled=false;btn.textContent='🔄'}}filterDeployBranches()}
function filterDeployBranches(){let box=$('depBranchDrop');if(!box)return;let q=($('dep_branch_pick').value||'').trim().toLowerCase();let items=(DEPLOY_BRANCHES||[]).filter(b=>!q||b.name.toLowerCase().includes(q)).slice(0,30);if(!items.length){box.innerHTML='<div class="vc-opt"><span>موردی یافت نشد — نام کامل را تایپ و «افزودن برنچ» را بزنید</span></div>';box.classList.add('open');return}box.innerHTML=items.map((b,i)=>`<div class="vc-opt" data-i="${i}"><span>${esc(b.name)}</span><span class="vc-meta">${b.protected?'protected':''}</span></div>`).join('');box.querySelectorAll('.vc-opt').forEach(el=>{el.onmousedown=e=>{e.preventDefault();let b=items[+el.dataset.i];if(b){$('dep_branch_pick').value=b.name;closeDeployDrops()}}});box.classList.add('open')}
async function loadDeployFiles(){let repo=($('dep_repo').value||'').trim(),branches=deployBranchesFromUI();if(!repo||!branches.length)return;try{let d=await deployApi('/api/deploy/files?repo='+encodeURIComponent(repo)+'&branch='+encodeURIComponent(branches[0]));DEPLOY_FILES=d.files||[];$('depFileCount').textContent=DEPLOY_FILES.length?toFa(DEPLOY_FILES.length)+' فایل Python در برنچ '+branches[0]:''}catch(e){DEPLOY_FILES=[];$('depFileCount').textContent=''}filterDeployFiles()}
function filterDeployFiles(){let box=$('depFileDrop');if(!box)return;let q=($('dep_path').value||'').trim().toLowerCase();let items=(DEPLOY_FILES||[]).filter(f=>!q||f.toLowerCase().includes(q)).slice(0,30);if(!items.length){box.classList.remove('open');return}box.innerHTML=items.map((f,i)=>`<div class="vc-opt" data-i="${i}"><span>${esc(f)}</span></div>`).join('');box.querySelectorAll('.vc-opt').forEach(el=>{el.onmousedown=e=>{e.preventDefault();let f=items[+el.dataset.i];if(f){$('dep_path').value=f;closeDeployDrops()}}});box.classList.add('open')}
document.addEventListener('click',e=>{if(!e.target.closest||(!e.target.closest('#dep_branch_pick')&&!e.target.closest('#depBranchDrop')&&!e.target.closest('#dep_path')&&!e.target.closest('#depFileDrop')))closeDeployDrops()});
async function saveDeploy(silent){try{let branches=deployBranchesFromUI();let tok=$('dep_token').value.trim();let deploy={repo:$('dep_repo').value.trim(),branches,branch:branches[0]||'',path:$('dep_path').value.trim(),reload_file:$('dep_reload').value.trim(),check_on_load:$('dep_autocheck')?$('dep_autocheck').checked:false};if(tok==='__CLEAR__'){deploy.clear_token=true}else if(tok){deploy.github_token=tok}await deployApi('/api/settings',{method:'POST',body:JSON.stringify({deploy})});$('dep_token').value='';renderBranchChips();if(!silent){$('deployStatus').innerHTML='<span class="ok">تنظیمات نصب ذخیره شد.</span>';showToast('✓ تنظیمات نصب ذخیره شد')}}catch(e){if(!silent)$('deployStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>';if(!silent)showToast(e.message,1);throw e}}
let fileCurrent='',fileParent='';const formatBytes=n=>{n=Number(n||0);if(n<1024)return n+' B';const u=['KB','MB','GB','TB'];let i=-1;do{n/=1024;i++}while(n>=1024&&i<u.length-1);return n.toFixed(n>=100?0:n>=10?1:2)+' '+u[i]};
async function browseFiles(path=''){try{let secret=await needDeploySecret();$('fileRows').innerHTML='<div class="status">در حال محاسبه اندازه پوشه‌ها…</div>';let r=await fetch('/api/files?path='+encodeURIComponent(path||''),{headers:deployHeaders(),cache:'no-store'}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error);fileCurrent=d.current||'';fileParent=d.parent||'';$('filePath').textContent=d.home+(fileCurrent?'/'+fileCurrent:'');$('spaceSummary').innerHTML=`<div class="space-card"><b>${formatBytes(d.account_quota_used??d.account_used)}</b><span>فضای مصرف‌شده حساب${d.account_quota_used==null&&!d.account_complete?' (تقریبی)':''}</span></div><div class="space-card"><b>${formatBytes(d.account_quota_remaining??d.filesystem.free)}</b><span>${d.account_quota_remaining!=null?'فضای باقی‌مانده سهمیه':'فضای آزاد فایل‌سیستم'}</span></div><div class="space-card"><b>${d.account_quota_limit!=null?formatBytes(d.account_quota_limit):d.scanned_files}</b><span>${d.account_quota_limit!=null?'سقف سهمیه حساب':'فایل بررسی‌شده'}</span></div>`;$('quotaInfo').textContent=d.quota||'سامانه سهمیه عدد جداگانه‌ای گزارش نکرد؛ مصرف پوشه حساب و فضای فایل‌سیستم نمایش داده شده است.';$('fileRows').innerHTML=(d.entries||[]).map(e=>`<div class="file-row"><div>${e.directory&&!e.symlink?`<button onclick="browseFiles(decodeURIComponent('${encodeURIComponent(e.path)}'))">📁 ${esc(e.name)}</button>`:`<span>📄 ${esc(e.name)}</span>`}${e.protected?' <span class="badge">محافظت‌شده</span>':''}</div><span class="fsize">${e.complete?'':'≈ '}${formatBytes(e.size)}</span><small>${new Date(e.modified*1000).toLocaleDateString('fa-IR')}</small></div>`).join('')||'<div class="note">این پوشه خالی است.</div>'}catch(e){$('fileRows').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function cleanupAccount(){if(!confirm('فقط cacheها، نصب‌های نیمه‌کاره، مرورگرهای تکراری و بسته‌های بلااستفاده پاک شوند؟ فایل‌های سیستمی، برنامه، تنظیمات و فایل‌های شخصی حفظ می‌شوند.'))return;try{$('deployStatus').textContent='در حال پاکسازی امن فضای حساب…';let d=await deployApi('/api/deploy/cleanup',{method:'POST',body:'{}'});$('deployStatus').innerHTML='<span class="ok">'+esc(d.message)+'</span>\n'+esc((d.removed||[]).join('\n'))}catch(e){$('deployStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function installDeps(){if(!confirm('کتابخانه‌های استخراج و مرورگر Chromium نصب/به‌روزرسانی شوند؟ ممکن است چند دقیقه طول بکشد.'))return;try{$('deployStatus').textContent='در حال نصب Playwright، Chromium و کتابخانه‌های استخراج…';let d=await deployApi('/api/deploy/dependencies',{method:'POST',body:'{}'});$('deployStatus').innerHTML='<span class="ok">'+esc(d.message)+'</span>'+(!d.browser_installed&&d.warning?'\n'+esc(d.warning):'')+(d.browser_installed?'\nمرورگر اکنون آماده استخراج است.':'')}catch(e){$('deployStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function deployCheck(manual){try{$('deployStatus').textContent='در حال بررسی همه برنچ‌ها در GitHub…';let d=await deployApi('/api/deploy/check',{method:'POST',body:'{}'});
let cands=d.candidates||[];renderBranchChips(d.newest_branch);
$('deployLocal').innerHTML='فایل جاری: <b>scraper4.py</b> · نسخه محلی <b>v'+esc(d.version)+'</b><br><span>SHA محلی:</span> '+esc(d.local_sha)+'<br><span>جدیدترین:</span> v'+esc(d.newest_version||'?')+' در برنچ '+esc(d.newest_branch||d.branch||'—');
if(!d.update_available){$('deployStatus').innerHTML='<span class="ok">✓ نسخه شما به‌روز است — v'+esc(d.version)+'</span>';$('deployUpdateBtn').style.display='none';dismissDeployBanner();paintVersionBadge(false)}
else{$('deployStatus').innerHTML='⬆ نسخه جدید: <b>v'+esc(d.newest_version||'?')+'</b> در برنچ <code>'+esc(d.newest_branch||'')+'</code> · نسخه جاری v'+esc(d.version);$('deployUpdateBtn').style.display='';showDeployBanner('⬆ نسخه جدید v'+(d.newest_version||'')+' در برنچ '+(d.newest_branch||'')+' موجود است');paintVersionBadge(true)}
let box=$('deployCandidates');if(box){box.innerHTML=cands.map(c=>{let isNew=c.branch===(d.newest_branch||'');if(c.error)return `<div class="cand-row"><div><b dir="ltr">${esc(c.branch)}</b><small class="error">${esc(c.error)}</small></div></div>`;return `<div class="cand-row${isNew?' newest':''}"><div><b dir="ltr">${esc(c.branch)}</b>${isNew?' <span class="badge ok">★ جدیدترین</span>':''}<small>نسخه: <b>v${esc(c.version||'?')}</b> · SHA: <code>${esc((c.sha||'').slice(0,10))}</code> · ${c.update_available?'متفاوت از محلی':'یکسان با محلی'}</small></div><div class="row-actions"><button class="gray" onclick="deployRun('${esc(c.branch)}')">نصب این برنچ</button></div></div>`}).join('')||'<div class="note">کاندیدی یافت نشد.</div>'}
if(manual&&d.update_available)showToast('⬆ نسخه جدید v'+(d.newest_version||'')+' آماده نصب است');return d}catch(e){$('deployStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>';if(manual)showToast(e.message,1);throw e}}
async function deployCheckInstall(manual){let btn=$('deployMainBtn');if(btn){btn.disabled=true;btn.textContent='⏳ در حال بررسی…'}try{let d=await deployCheck(false);if(!d.update_available){if(manual)showToast('✓ نسخه شما به‌روز است');return d}await deployRun()}catch(e){}finally{if(btn){btn.disabled=false;btn.textContent='🔍 بررسی و نصب نسخهٔ جدید'}}}
function paintVersionBadge(hasUpdate){let v=$('appVersion');if(v){v.classList.toggle('upd',!!hasUpdate);v.title=hasUpdate?'نسخه جدید موجود است — کلیک کنید':'نسخه کد — برای بررسی به‌روزرسانی کلیک کنید';v.textContent='v'+ (window.APP_VERSION||v.textContent.replace(/^v/,''))}let c=$('chromeVer');if(c)c.textContent=v?v.textContent:'v10.133'}
async function deployRun(branch){let target=branch||'';if(!target){try{let d0=await deployApi('/api/deploy/check',{method:'POST',body:'{}'});if(d0&&d0.newest_branch)target=d0.newest_branch}catch(e){}}let label=target?(' برنچ '+target+' (جدیدترین نسخه)'):' جدیدترین نسخه';if(!confirm('فایل جاری جایگزین و نسخه قبلی در .bak ذخیره شود؟\n\nمقصد:'+label))return;try{$('deployStatus').textContent='در حال دانلود، اعتبارسنجی و نصب'+label+'…';let d=await deployApi('/api/deploy/run',{method:'POST',body:JSON.stringify(target?{branch:target}:{})});$('deployStatus').innerHTML='<span class="ok">'+esc(d.message)+' — نسخه '+esc(d.version)+'</span>\n'+(d.reload_requested?'درخواست reload فرستاده شد.':'در صورت تنظیم‌نبودن WSGI، از تب Web دکمه Reload را بزنید.');dismissDeployBanner();paintVersionBadge(false);showToast('✓ نصب شد: v'+d.version);setTimeout(()=>location.reload(),1600)}catch(e){$('deployStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>';showToast(e.message,1)}}
async function deployRollback(){if(!confirm('نسخه scraper4.py.bak بازیابی شود؟'))return;try{let d=await deployApi('/api/deploy/rollback',{method:'POST',body:'{}'});$('deployStatus').innerHTML='<span class="ok">'+esc(d.message)+' — نسخه '+esc(d.version)+'</span>';}catch(e){$('deployStatus').innerHTML='<span class="error">'+esc(e.message)+'</span>'}}
async function watchBuild(){try{let r=await fetch('/health',{cache:'no-store'}),d=await r.json();if(currentBuild&&d.build&&d.build!==currentBuild){document.body.style.opacity='.65';location.reload()}}catch(e){}}
init().then(async()=>{setInterval(watchBuild,30000);setInterval(loadTaskTopSummary,10000);try{if($('dep_autocheck')&&$('dep_autocheck').checked){await deployCheck(false)}}catch(e){}}).catch(e=>$('status').textContent=e.message);
</script></body></html>'''

# >>> scraper4 node-parity dashboard bridge >>>
# ---------------------------------------------------------------------------
# Node dashboard parity layer
#
# ui_bridge serves the Node.js project's dashboard (extracted verbatim from
# cloudflare-scraper4/worker-src/dashboard.ts) at "/ui" and registers the
# REST surface that dashboard expects, mapped onto this backend's data model.
# It is imported last so every function and constant it reaches for already
# exists on this module. A failure here must never take the classic UI down.
#
# Do not delete the marker comment above: ensure_ui_bridge_block() uses it to
# re-attach this block to updates downloaded from the upstream repository,
# which does not carry the bridge.
# ---------------------------------------------------------------------------
try:
    import sys as _sys

    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import ui_bridge as _ui_bridge

    _ui_bridge.register(_sys.modules[__name__])
    UI_BRIDGE_READY = True
    UI_BRIDGE_ERROR = ""
except Exception as _ui_exc:  # noqa: BLE001 - optional layer, never fatal
    import traceback as _ui_traceback

    UI_BRIDGE_READY = False
    UI_BRIDGE_ERROR = f"{type(_ui_exc).__name__}: {_ui_exc}"
    # Loud on purpose: a silent failure here looks like a healthy install while
    # /ui returns 404. The full traceback goes to the journal.
    app.logger.error(
        "Node dashboard bridge FAILED to load (/ui will return 404): %s\n%s",
        UI_BRIDGE_ERROR, _ui_traceback.format_exc(),
    )


if __name__ == "__main__":
    start_vps_supervisors()
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
