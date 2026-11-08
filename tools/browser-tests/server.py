"""Disposable real-browser fixture, NEVER a production entrypoint."""
import hashlib
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from werkzeug.serving import make_server
from scraper4 import create_app
from scraper4.config import Settings

with TemporaryDirectory(prefix='s4-real-browser-') as folder:
    base=Path(folder)
    app=create_app(Settings(base_dir=base,db_path=base/'ui.db',secret_key='temporary-browser-fixture',password='test'))
    db=app.extensions['s4_db']
    p=db.upsert_profile('one','https://example.com/shop','مرجع آزمایشی',selectors={'container':'.product','title':'h2'})
    db.upsert_product(p['id'],'a',{'title':'محصول آزمایشی','price_num':1000})
    # No actual network access is allowed from any extraction/sending path.
    from scraper4.services.scraping.fetch import HtmlFetcher
    def forbidden(*args,**kwargs):
        raise AssertionError('Browser boot must never fetch a source/destination')
    HtmlFetcher.get=staticmethod(forbidden)
    @app.get('/__test__/snapshot')
    def snapshot():
        with db.connect() as conn:
            dump='\n'.join(conn.iterdump())
        return {'digest':hashlib.sha256(dump.encode()).hexdigest(),'jobs':len(db.list_entries())}
    server=make_server('0.0.0.0',0,app,threaded=True)
    print(json.dumps({'port':server.server_port}),flush=True)
    try:server.serve_forever()
    finally:server.server_close()
