"""Disposable real-browser fixture, NEVER a production entrypoint."""
import hashlib
import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from werkzeug.serving import make_server
from scraper4 import create_app
from scraper4.config import Settings

with TemporaryDirectory(prefix='s4-real-browser-') as folder:
    base=Path(folder)
    app=create_app(Settings(base_dir=base,db_path=base/'ui.db',secret_key='temporary-browser-fixture',password='' if os.environ.get('S4_BROWSER_OPEN')=='1' else 'test',access_mode='open' if os.environ.get('S4_BROWSER_OPEN')=='1' else 'password'))
    db=app.extensions['s4_db']
    p=db.upsert_profile('one','https://example.com/shop','مرجع آزمایشی',selectors={'container':'.product','title':'h2'})
    db.upsert_product(p['id'],'a',{'title':'محصول آزمایشی','price_num':1000})
    # No actual network access is allowed from any extraction/sending path.
    from scraper4.services.scraping.fetch import HtmlFetcher
    def forbidden(*args,**kwargs):
        raise AssertionError('Browser boot must never fetch a source/destination')
    mode=os.environ.get('S4_BROWSER_EXTRACTION_FIXTURE','')
    if mode:
        if mode=='waiting':
            db.upsert_profile('one',p['url'],'مانتو پاتریس',selectors=p['selectors'])
            db.enqueue('extract',p['id'],{'pages':1,'with_detail':False})
        other=db.upsert_profile('other','https://example.com/other','Unrelated fixture')
        db.enqueue('extract',other['id']);db.enqueue('woo_send',other['id'])
        if mode=='pipeline':
            target=[{'kind':'woo_send','payload':{'secret':'PIPELINE-PRIVATE'}}]
            root=db.enqueue('extract',p['id'],{'_send_after':target},status='done')
            db.update_entry(root,counters={'found':2,'current':1})
            send=db.enqueue('woo_send',p['id'],{'source_extract_job':root,'secret':'PIPELINE-PRIVATE'},batch_id=f'extract:{root}',status='done')
            db.update_entry(send,counters={'sent':1,'failed':1,'total':2,'current':2})
            missing=db.enqueue('extract',p['id'],{'_send_after':target},status='done')
            db.update_entry(missing,counters={'found':2,'current':1})
            db.enqueue('woo_send',p['id'],status='waiting') # unrelated, never linked
        def fixture(url,**kwargs):
            if not url.startswith('https://example.com/'):raise AssertionError('Unexpected source')
            if mode=='denied':return {'ok':False,'code':403,'error':'PRIVATE-FIXTURE-TOKEN'}
            return {'ok':True,'code':200,'url':url,'html':'<article class="product"><h2>Fixture '+('page two' if 'page=2' in url else 'page one')+'</h2></article>'}
        HtmlFetcher.get=staticmethod(fixture)
        from scraper4.services import github_products
        import base64
        def github_fixture(path,params=None):
            if path.endswith('/branches'):return [{'name':'main'}]
            if '/git/trees/' in path:return {'tree':[{'path':'products.csv','type':'blob','size':100}], 'truncated':False}
            if '/contents/' in path:
                raw=b'title,price,link\nCSV fixture,2500,https://example.com/csv-product\n'
                return {'type':'file','encoding':'base64','size':len(raw),'content':base64.b64encode(raw).decode()}
            raise AssertionError('Unexpected GitHub fixture endpoint')
        github_products.api_read=github_fixture
        @app.get('/__test__/extract-state')
        def extract_state():return {'jobs':db.list_entries(),'products':db.list_products(p['id'])}
        @app.post('/__test__/age-step')
        def age_step():
            value=db.checkpoint_read('extract:manual:last');value['started_epoch']=0;db.checkpoint_write('extract:manual:last',value);return {'ok':True}
    else:HtmlFetcher.get=staticmethod(forbidden)
    @app.get('/__test__/snapshot')
    def snapshot():
        with db.connect() as conn:
            dump='\n'.join(conn.iterdump())
        return {'digest':hashlib.sha256(dump.encode()).hexdigest(),'jobs':len(db.list_entries())}
    server=make_server('0.0.0.0',0,app,threaded=True)
    print(json.dumps({'port':server.server_port}),flush=True)
    try:server.serve_forever()
    finally:server.server_close()
