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
    mode=os.environ.get('S4_BROWSER_EXTRACTION_FIXTURE','');source_calls=[]
    if mode!='browser-cron':db.checkpoint_write('browser-cron:config',{'enabled':False})
    if mode:
        if mode=='detail':
            db.upsert_profile('one',p['url'],p['name'],selectors=p['selectors'],settings={'detailSelectors':{'longDesc':'.description','sku':'.sku'}})
            db.upsert_product(p['id'],'a',{'title':'keep title','price_num':1000,'link':'https://example.com/detail/a'})
            db.upsert_product(p['id'],'b',{'title':'keep second','price_num':2000,'link':'https://example.com/detail/b'})
            for row in db.list_products(p['id']):db.mark_product_target(row['id'],'woo',77)
        if mode in ('resume','resume-denied'):
            db.enqueue('extract',p['id'],{'pages':3,'_page':2,'with_detail':False},status='failed')
        if mode in ('waiting','browser-cron'):
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
            source_calls.append(url)
            if mode in ('denied','resume-denied'):return {'ok':False,'code':403,'error':'PRIVATE-FIXTURE-TOKEN'}
            if mode=='detail':
                if '/detail/' not in url:raise AssertionError('Detail-only must never fetch listing')
                return {'ok':True,'code':200,'url':url,'html':'<div class="description"><b>Enriched detail</b><script>bad()</script></div><span class="sku">SKU-DETAIL</span>'}
            return {'ok':True,'code':200,'url':url,'html':'<article class="product"><h2>Fixture '+('page two' if 'page=2' in url else 'page one')+'</h2></article>'}
        if mode=='source-apis':
            db.upsert_profile('one','https://snappshop.ir/category/mobile','Snapp fixture',settings={'extractionEngine':'selenium'})
            db.upsert_profile('other','https://digikala.com/search/','Digikala fixture',settings={'extractionEngine':'playwright'})
            db.upsert_profile('bsl-api','https://basalam.com/vendors/7','Basalam fixture',settings={'extractionEngine':'selenium'})
            from scraper4.services.scraping import snappshop_api
            from scraper4.services.scraping.render import RenderedFetcher
            RenderedFetcher.get=staticmethod(forbidden)
            def snapp_fixture(ep,*a,**kw):
                source_calls.append('https://apix.snappshop.ir/'+ep)
                return {'data':{'token':'FIXTURE-GUEST'}} if ep=='guest/v2/token' else {'data':{'items':[{'href':'/product/snp-1','title':'Snapp API fixture','price':1000}],'pagination':{'total_pages':1}}}
            snappshop_api.request_json=snapp_fixture
            def fixture(url,**kw):
                source_calls.append(url)
                if url.startswith('https://api.digikala.com/'):
                    body={'data':{'products':[{'id':12,'title_fa':'DK fixture','status':'marketable','default_variant':{'price':{'selling_price':20000}}}],'pager':{'total_pages':1}}}
                elif url.startswith('https://core.basalam.com/'):
                    body={'data':[{'id':13,'title':'BSL fixture','status':2976,'primary_price':30000}],'next_cursor':0}
                else:raise AssertionError('API sources must not fetch HTML')
                return {'ok':True,'code':200,'url':url,'html':json.dumps(body)}
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
        @app.get('/__test__/source-calls')
        def source_call_state():return {'urls':source_calls}
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
