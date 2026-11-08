"""python -m scraper4 {init,tick,selftest,import-legacy,backup,serve}"""
import argparse
import fcntl
import subprocess
import sys
import json
import sqlite3
from pathlib import Path

from .config import Settings
from .db import DB
from .services.engine import tick, selftest
from .services.support.persian import price_num
from .services.support.url import profile_key
from .services.scraping.product_key import product_key


def import_legacy(db, directory):
    directory = Path(directory)
    counts = dict(profiles=0, products=0, connections=0)
    profiles_file = directory / 'profiles.json'
    if profiles_file.exists():
        profiles = json.loads(profiles_file.read_text(encoding='utf-8'))
        if not isinstance(profiles, dict):
            raise ValueError('profiles.json must be an object keyed by profile key')
        for key, row in profiles.items():
            if not isinstance(row, dict) or not row.get('url'):
                continue
            profile = db.upsert_profile(key or profile_key(row['url']), row['url'], row.get('name', ''),
                       row.get('selectors') or {}, {'type': row.get('pagType', 'query_page'), 'val': row.get('pagVal', '')},
                       row.get('settings') or row.get('detail') or {})
            counts['profiles'] += 1
            products = row.get('products') or {}
            entries = products.items() if isinstance(products, dict) else enumerate(products)
            for pkey, product in entries:
                if not isinstance(product, dict):
                    continue
                pkey = pkey if isinstance(pkey, str) and len(pkey) == 32 else product_key(product)
                product = dict(product)
                product['price_num'] = price_num(product.get('price', ''))
                product['extra'] = {k: v for k, v in product.items() if k not in ('title','price','link','image','sku','key','price_num')}
                db.upsert_product(profile['id'], pkey, product)
                for target, col in [('woo', 'woo_id'), ('basalam', 'basalam_id')]:
                    if product.get(col):
                        with db.connect() as conn:
                            conn.execute(f'UPDATE products SET {col}=? WHERE profile_id=? AND key=?',
                                         (int(product[col]), profile['id'], pkey))
                counts['products'] += 1
            db.sync_profile_count(profile['id'])
    connections_file = directory / 'connections.json'
    if connections_file.exists():
        configs = json.loads(connections_file.read_text(encoding='utf-8'))
        if not isinstance(configs, dict):
            raise ValueError('connections.json must be an object')
        for name, cfg in configs.items():
            if isinstance(cfg, dict):
                db.put_config({'woo': 'woocommerce', 'bsl': 'basalam'}.get(name, name), cfg)
                counts['connections'] += 1
    return {'ok': True, **counts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('init')
    commands.add_parser('selftest')
    configure = commands.add_parser('configure')
    configure.add_argument('--replace-existing', action='store_true')
    configure.add_argument('--reset-api', action='store_true', help='Read a replacement API token from the local terminal')
    configure.add_argument('--api-site', choices=['www.pythonanywhere.com', 'eu.pythonanywhere.com'])
    configure.add_argument('--api-username')
    configure.add_argument('--api-domain')
    commands.add_parser('diagnose-platform')
    maintenance = commands.add_parser('maintain')
    maintenance.add_argument('--budget', type=int, default=240)
    update = commands.add_parser('update')
    update.add_argument('--check-only', action='store_true')
    worker = commands.add_parser('tick')
    worker.add_argument('--budget', type=int, default=None)
    imp = commands.add_parser('import-legacy')
    imp.add_argument('--dir', required=True)
    backup = commands.add_parser('backup')
    backup.add_argument('--output', required=True)
    server = commands.add_parser('serve')
    server.add_argument('--port', type=int, default=5000)
    args = parser.parse_args()
    settings = Settings.load()
    settings.ensure_dirs()
    settings.ensure_secret()
    db = DB(settings.db_path, settings.secret_key)
    if args.command == 'init':
        result = {'ok': True, 'database': str(settings.db_path)}
    elif args.command == 'configure':
        from .services.platform import PythonAnywhere, prompt_configuration
        from .services.updates import update_config
        cfg = prompt_configuration(db, reset_api=args.reset_api, site=args.api_site,
                                   username=args.api_username, domain=args.api_domain)
        result = PythonAnywhere(cfg).provision(db, settings, replace_existing=args.replace_existing)
        db.checkpoint_write('updates:config', update_config(db))
    elif args.command == 'diagnose-platform':
        from .services.platform import diagnose
        result = diagnose(db)
    elif args.command in ('maintain', 'update'):
        from .services import updates
        lock_path = settings.db_path.with_suffix('.worker.lock')
        with lock_path.open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print(json.dumps({'ok': True, 'busy': True}))
                return
            if args.command == 'update':
                updates.request_operation(db, 'check' if args.check_only else 'update')
            result = updates.maintain(db, settings)
        if args.command == 'maintain':
            # A fresh interpreter imports the newly installed worker modules.
            worker = subprocess.run([sys.executable, '-m', 'scraper4', 'tick', '--budget', str(args.budget)],
                                    cwd=settings.base_dir, check=False)
            if worker.returncode:
                result = {'ok': False, 'error': 'Worker process failed', 'maintenance': result}
    elif args.command == 'tick':
        result = tick(db, settings, budget_seconds=args.budget)
    elif args.command == 'selftest':
        result = selftest(db, settings)
    elif args.command == 'import-legacy':
        result = import_legacy(db, args.dir)
    elif args.command == 'backup':
        destination = Path(args.output).resolve()
        if destination == settings.db_path.resolve() or destination.exists():
            parser.error('Backup destination must be a new file, different from the database')
        destination.parent.mkdir(parents=True, exist_ok=True)
        # SQLite backup API includes committed WAL content consistently.
        with sqlite3.connect(str(destination)) as target, db.connect() as source:
            source.backup(target)
        destination.chmod(0o600)
        result = {'ok': True, 'backup': str(destination)}
    else:
        from . import create_app
        create_app(settings).run(host='0.0.0.0', port=args.port, debug=False)
        return
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result.get('ok'):
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except ValueError as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
