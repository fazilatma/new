"""First detail-page parity slice: PHP 10.641 detail selectors/clean HTML/specs.

Not a variant/stock/weight engine. No page is opened without an enabled selector.
HTML is deliberately stricter than legacy PHP: allowlisted tags/attributes only.
"""
import copy
import html
import re
from urllib.parse import urljoin

import lxml.html

from .parser import load_dom, query_inside, _image_from_node
from .fetch import validate_url
from ..support.persian import normalize_text
from ..support.url import is_image

FIELDS = ('shortDesc', 'longDesc', 'specs', 'images', 'sku', 'brand')
TAGS = set('p div span h1 h2 h3 h4 h5 h6 ul ol li strong b em i u s del ins br hr a img table caption thead tbody tfoot tr th td dl dt dd blockquote pre code'.split())
DROP = set('script style iframe object embed form input button select textarea option noscript svg math link meta base template applet frame frameset'.split())


def normalize_selectors(raw):
    if not isinstance(raw, dict):
        raise ValueError('Detail selectors must be an object')
    out = {}
    for field, value in raw.items():
        if field not in FIELDS:
            raise ValueError('Unsupported detail field: ' + str(field))
        if isinstance(value, dict):
            if set(value) - {'enabled', 'selector'} or type(value.get('enabled', True)) is not bool:
                raise ValueError('Invalid detail selector configuration')
            if not value.get('enabled', True):
                continue
            value = value.get('selector', '')
        if not isinstance(value, str) or len(value) > 1000:
            raise ValueError('Detail CSS selectors must be strings of at most 1000 characters')
        if value.strip():
            out[field] = value.strip()
    return out


def web_url(value, base):
    value = re.sub(r'[\x00-\x20\x7f]+', '', value or '')
    if not value:
        return ''
    try:
        return validate_url(urljoin(base, value))
    except ValueError:
        return ''


def clean_html(node, base):
    root = copy.deepcopy(node)
    if not isinstance(root.tag, str) or root.tag.lower() in DROP:
        return ''
    for child in list(root.iterdescendants()):
        if child.getparent() is None:
            continue
        if not isinstance(child.tag, str) or child.tag.lower() in DROP:
            if isinstance(child.tag, str):
                child.drop_tree()
            else:
                child.getparent().remove(child)
    for el in list(root.iter()):
        if not isinstance(el.tag, str):
            continue
        tag = el.tag.lower()
        attrs = dict(el.attrib)
        el.attrib.clear()
        for name in ('title', 'alt'):
            if name in attrs and (tag == 'img' or name == 'title'):
                el.set(name, attrs[name][:500])
        attr = 'href' if tag == 'a' else 'src' if tag == 'img' else None
        if attr:
            value = web_url(attrs.get(attr, ''), base)
            if value:
                el.set(attr, value)
        for name in ('colspan', 'rowspan'):
            if tag in ('td', 'th') and re.fullmatch(r'[1-9][0-9]?', attrs.get(name, '')):
                el.set(name, attrs[name])
        if tag not in TAGS and el is not root:
            el.drop_tag()
    inner = html.escape(root.text or '', quote=False) + ''.join(
        lxml.html.tostring(child, encoding='unicode', method='html', with_tail=True) for child in root)
    inner = re.sub(r'(?:&amp;)*&#(?:0*13|x0*d);?', '', inner, flags=re.I).replace('\r', '')
    cleaned = re.sub(r'\s+', ' ', inner).strip()
    if len(cleaned) > 30000:
        # Never cut serialized markup in the middle of an attribute/tag.
        return '<p>' + html.escape(normalize_text(' '.join(root.itertext()))[:25000]) + '</p>'
    return cleaned


def sanitize_fragment(value, base):
    if not isinstance(value, str) or not value.strip():
        return ''
    try:
        root = lxml.html.fragment_fromstring(value[:100000], create_parent='div')
        return clean_html(root, base)
    except (ValueError, lxml.etree.ParserError):
        return ''


def text_html(value):
    return normalize_text(' '.join(load_dom(value).itertext())) if value else ''


def specs_rows(nodes):
    rows, seen = [], set()
    def add(key, value):
        key = normalize_text(key).strip(' :：')
        value = normalize_text(value)
        signature = (key.casefold(), value.casefold())
        if key and value and len(key) <= 120 and signature not in seen and len(rows) < 100:
            seen.add(signature)
            rows.append({'k': key, 'v': value[:2000]})
    for node in nodes:
        trs = [node] if node.tag == 'tr' else node.xpath('.//tr')
        for tr in trs:
            cells = tr.xpath('./th|./td')
            if len(cells) >= 2:
                add(cells[0].text_content(), ' ، '.join(normalize_text(c.text_content()) for c in cells[1:]))
        for dt in node.xpath('./dt' if node.tag == 'dl' else './/dl/dt'):
            sibling = dt.getnext()
            if sibling is not None and sibling.tag == 'dd':
                add(dt.text_content(), sibling.text_content())
        for li in ([node] if node.tag == 'li' else node.xpath('.//li')):
            value = normalize_text(li.text_content())
            pair = re.split('[:：]', value, maxsplit=1)
            if len(pair) == 2:
                add(*pair)
    return rows


def specs_html(rows):
    return ('<table class="s4-specs-table woocommerce-product-attributes shop_attributes" dir="rtl"><tbody>' +
            ''.join('<tr><th>' + html.escape(r['k']) + '</th><td>' + html.escape(r['v']) + '</td></tr>' for r in rows) +
            '</tbody></table>') if rows else ''


def parse_detail(source, base, selectors):
    root, out = load_dom(source), {}
    for field, selector in normalize_selectors(selectors).items():
        nodes = query_inside(root, selector) or []
        if not nodes:
            continue
        if field == 'images':
            images = []
            for node in nodes:
                candidates = [node] if node.tag in ('a', 'img') else list(node.iter('img'))
                for image in candidates:
                    raw = image.get('href', '') if image.tag == 'a' else image.get('data-large_image') or image.get('data-large-image') or _image_from_node(image, base)
                    url = web_url(raw, base)
                    if url and is_image(url) and url not in images and len(images) < 30:
                        images.append(url)
            if images:
                out['images'] = images
        elif field in ('shortDesc', 'longDesc', 'specs'):
            rows = specs_rows(nodes)
            value = specs_html(rows) if rows and (field == 'specs' or (len(rows) >= 2 and nodes[0].tag in ('table','tbody','dl','ul'))) else clean_html(nodes[0], base)
            if value:
                out[field] = value
            if field == 'specs' and rows:
                out['specs_rows'] = rows
        else:
            value = normalize_text(nodes[0].text_content())[:1000]
            if value:
                out[field] = value
    return out


def merge_detail(previous, fresh):
    result = dict(previous) if isinstance(previous, dict) else {}
    if 'images' in result and not isinstance(result['images'], list):
        result.pop('images')
        result.pop('images_count', None)
    for field in ('shortDesc', 'longDesc', 'specs', 'sku', 'brand', 'specs_rows'):
        if fresh.get(field):
            result[field] = fresh[field]
    # PHP extractMergeDetail: a smaller gallery must not erase a richer one.
    old = result.get('images') if isinstance(result.get('images'), list) else []
    new = fresh.get('images') if isinstance(fresh.get('images'), list) else []
    if new and len(new) >= len(old):
        result['images'] = new
    if result.get('images'):
        result['images_count'] = len(result['images'])
    result['_detail_preview'] = text_html(result.get('longDesc') or result.get('shortDesc') or result.get('specs') or '')[:1500]
    return result
