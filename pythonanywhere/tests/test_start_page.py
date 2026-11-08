import base64
import io
import json
import time
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from scraper4.services import start_page as start
from scraper4.services import github_products as gh
from scraper4.services.product_browser import list_products
from scraper4.services.engine import run_entry
from scraper4.start import finish_extraction


def profile(db,**kw):
    return db.upsert_profile('start','https://example.com/shop','فروشگاه',selectors={'container':'.product','title':'h2'},**kw)


def data(p=None,**kw):
    return {'id':p['id'] if p else None,'name':'فروشگاه تازه','url':'https://example.com/new','engine':'auto','pagination':{'type':'query_page','val':''},'pages':0,'with_detail':True,'detail_mode':'two_stage',**kw}


def step(db,settings):
    entry=db.claim_next(('extract',));assert entry
    run_entry(db,settings,entry,time.monotonic()+10,max_steps=1,network_timeout=8)
    return db.get_entry(entry['id'])


def network(monkeypatch,pages):
    calls=[]
    def extract(url,*args,**kwargs):
        calls.append(url)
        if '/p/' in url:html='<div class="desc">detail</div>';products={}
        else:
            page=2 if 'page=2' in url else 3 if 'page=3' in url else 1
            html='';products=pages.get(page,{})
        return {'products':products,'html':html,'url':url,'code':200,'engine':'selectors','used_engine':'selectors','elapsed_ms':1}
    monkeypatch.setattr('scraper4.services.scraping.engines.extract',extract)
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',lambda url,**kw:(calls.append(url) or {'ok':True,'code':200,'url':url,'html':'<div class="desc">detail</div>'}))
    return calls


def test_php_sixteen_metrics_drilldowns_match_and_preserve_remote_identity(db):
    p=profile(db,settings={'detailSelectors':{'longDesc':'.desc'}})
    db.put_config('basalam',{'vendor_id':'7','token':'DO-NOT-ECHO','vendors':[{'vendor_id':'8','token':'NESTED-SECRET'}]})
    db.checkpoint_write('basalam:legacy_owner',{'vendor_id':'7'})
    db.upsert_product(p['id'],'a',{'title':'A','link':'https://example.com/p/a','price_num':100,'sku':'s','extra':{'images':['https://example.com/a.jpg','https://example.com/b.jpg'],'stock':4,'category':['books'],'brand':'Brand','longDesc':'<p>شرح</p>','variations':[{'color':'red'}],'_detail_checked_at':'now','basalam_targets':{'8':80}}})
    a=db.list_products()[0];db.mark_product_target(a['id'],'woo',10);db.mark_product_target(a['id'],'basalam',70)
    db.upsert_product(p['id'],'b',{'title':'B','extra':{'stock_status':'outofstock'}})
    empty=db.upsert_profile('empty','https://example.org','خالی',enabled=False)
    with db.connect() as conn:before=list(conn.iterdump())
    result=start.overview(db)
    assert len(result['metrics'])==16 and result['totals']['all']==2
    assert result['totals']['has_image']==1 and result['totals']['gallery']==1 and result['totals']['ready']==1
    assert result['totals']['in_stock']==1 and result['totals']['out_stock']==1 and result['totals']['stock_unknown']==0
    assert result['shop_total']==2 and result['destination_totals']=={'woo':1,'bsl:7':1,'bsl:8':1}
    assert result['by_profile'][0]['detail']=={'selectors':1,'present':1,'checked':1}
    assert result['by_profile'][1]['id']==empty['id'] and not result['by_profile'][1]['enabled']
    assert not result['remote_inventory'] and 'DO-NOT-ECHO' not in json.dumps(result) and 'NESTED-SECRET' not in json.dumps(result)
    for metric in start.METRICS:
        value=list_products(db,{'filter':metric,'profile_id':str(p['id'])})
        assert value['total']==result['totals'][metric],metric
    assert list_products(db,{'filter':'detail_present'})['total']==1
    with db.connect() as conn:assert list(conn.iterdump())==before


@pytest.mark.parametrize('extra,key',[
    ({},'stock_unknown'),({'stock':0},'out_stock'),({'inventory':'5'},'in_stock'),({'stock_quantity':'n/a'},'stock_unknown'),
    ({'stock':float('inf')},'stock_unknown'),({'in_stock':False},'out_stock'),({'in_stock':True},'in_stock'),
    ({'stock_status':' instock '},'in_stock'),({'stock_status':'out_of_stock'},'out_stock')])
def test_explicit_stock_not_inferred_from_price(extra,key):
    assert start.flags({'price_num':500,'extra':extra})[key]


def test_image_dedup_content_whitespace_and_malformed_metadata():
    flags=start.flags({'image':'https://example.com/a.jpg','extra':{'images':['https://example.com/a.jpg',' https://example.com/a.jpg ','javascript:alert(1)',{}],'category':'  ','brand':' ','variations':' '}})
    assert flags['has_image'] and not flags['gallery'] and not flags['brand'] and not flags['category'] and not flags['variations']
    assert start.flags({'extra':'not json'})['stock_unknown']


def test_native_and_already_imported_php_start_preferences(db):
    p=profile(db,settings={'legacy_profile_settings':{'pages':0,'detailExtractMode':'inline','backendExtractWithDetail':False,'productSource':{'mode':'github','repo':'a/b','branch':'main','path':'p.csv'}}})
    opts=start.options(p)
    assert opts['pages']==0 and not opts['with_detail'] and opts['detail_mode']=='inline' and opts['source']=='github' and opts['github']['repo']=='a/b'


def test_profile_save_preserves_settings_selectors_ids_and_same_id_after_url_edit(db):
    p=profile(db,settings={'opaque':{'token':'KEEP'},'detailSelectors':{'sku':'.sku'}})
    db.upsert_product(p['id'],'p',{'title':'P','price_num':3});product=db.list_products()[0];db.mark_product_target(product['id'],'woo',60)
    saved=start.save_profile(db,data(p))
    assert saved['id']==p['id'] and saved['key']==p['key'] and saved['url'].endswith('/new')
    assert saved['settings']['opaque']=={'token':'KEEP'} and saved['settings']['detailSelectors']=={'sku':'.sku'}
    assert db.list_products()[0]['woo_id']==60 and saved['selectors']==p['selectors']
    new=start.save_profile(db,data());assert new['id']!=p['id'] and len(db.list_profiles())==2


@pytest.mark.parametrize('patch',[{'pages':-1},{'pages':1001},{'pages':True},{'engine':'fake'},{'with_detail':1},{'detail_mode':'invalid'}, {'url':'http://127.0.0.1/'},{'name':' '},{'id':999},{'unexpected':'x'}, {'source':'unknown'},{'source':'github','github':{'repo':'x','path':'p.csv'}}])
def test_bad_start_profile_is_rejected_without_writes(db,patch):
    with pytest.raises(ValueError):start.save_profile(db,data(**patch))
    assert not db.list_profiles()


def test_source_change_rejected_while_job_alive(db):
    p=profile(db);jid=db.enqueue('extract',p['id'],status='paused')
    with pytest.raises(ValueError,match='لغو'):start.save_profile(db,data(p))
    assert db.get_profile(p['id'])['url']==p['url']
    db.update_entry(jid,status='cancelled');assert start.save_profile(db,data(p))['url'].endswith('/new')


def test_two_stage_lists_all_pages_before_details_and_deduplicates_overlap(db,settings,monkeypatch):
    p=profile(db,settings={'detailSelectors':{'longDesc':'.desc'}})
    calls=network(monkeypatch,{1:{'a':{'title':'A','link':'https://example.com/p/a'}},2:{'a':{'title':'A','link':'https://example.com/p/a'},'b':{'title':'B','link':'https://example.com/p/b'}}})
    jid=db.enqueue('extract',p['id'],{'pages':2,'detail_mode':'two_stage'})
    assert step(db,settings)['counters']['phase']=='listing'
    assert step(db,settings)['counters']['phase']=='detail'
    assert len(calls)==2 and db.count_products()==2
    for _ in range(6):
        if db.get_entry(jid)['status']=='done':break
        step(db,settings)
    assert db.get_entry(jid)['status']=='done'
    assert sum('/p/a' in url for url in calls)==1 and sum('/p/b' in url for url in calls)==1
    assert all('detail' in row['extra']['longDesc'] for row in db.list_products())
    with db.connect() as conn:assert not conn.execute("SELECT id FROM task_checkpoints WHERE task LIKE 'start:seen:%'").fetchall()


def test_inline_details_precede_next_listing_and_checkbox_really_disables_details(db,settings,monkeypatch):
    p=profile(db,settings={'detailSelectors':{'longDesc':'.desc'}});calls=network(monkeypatch,{1:{'a':{'title':'A','link':'https://example.com/p/a'}},2:{'b':{'title':'B','link':'https://example.com/p/b'}}})
    jid=db.enqueue('extract',p['id'],{'pages':2,'detail_mode':'inline'})
    step(db,settings);step(db,settings);step(db,settings)
    assert '/p/a' in calls[1] and 'page=2' in calls[2]
    db.update_entry(jid,status='cancelled');calls.clear()
    db.enqueue('extract',p['id'],{'pages':1,'detail_mode':'two_stage','with_detail':False})
    assert step(db,settings)['status']=='done' and len(calls)==1


def test_unlimited_mode_stops_on_repeated_listing_not_1000_duplicate_pages(db,settings,monkeypatch):
    p=profile(db);row={'a':{'title':'A','link':'https://example.com/p/a'}};calls=network(monkeypatch,{1:row,2:row})
    db.enqueue('extract',p['id'],{'pages':0})
    assert step(db,settings)['status']=='waiting'
    result=step(db,settings);assert result['status']=='done' and 'تکراری' in result['counters']['warning'] and len(calls)==2


def test_finish_source_and_send_children_atomic_idempotent_and_pinned(db,settings,monkeypatch):
    p=profile(db);network(monkeypatch,{1:{'a':{'title':'A','link':'https://example.com/p/a'}}})
    jid=db.enqueue('extract',p['id'],{'pages':1,'_send_after':[{'kind':'woo_send','payload':{'status':'draft'}},{'kind':'bsl_send','payload':{'vendor_id':'7'}}]})
    result=step(db,settings);assert result['status']=='done'
    children=[j for j in db.list_entries() if j['id']!=jid];assert len(children)==2 and all(j['status']=='waiting' for j in children)
    assert next(j for j in children if j['kind']=='bsl_send')['payload']['vendor_id']=='7'
    finish_extraction(db,result);assert len(db.list_entries())==3
    assert db.list_products()[0]['woo_id'] is None


def test_pause_during_final_page_wins_and_resumes_without_refetch_or_duplicate_send(db,settings,monkeypatch):
    p=profile(db);network(monkeypatch,{1:{'a':{'title':'A'}}})
    jid=db.enqueue('extract',p['id'],{'pages':1,'_send_after':[{'kind':'woo_send','payload':{}}]})
    original=db.update_entry
    def pause(entry_id,**kwargs):
        original(entry_id,**kwargs)
        if kwargs.get('payload',{}).get('_extraction_complete'):original(entry_id,status='paused')
    monkeypatch.setattr(db,'update_entry',pause);assert step(db,settings)['status']=='paused' and len(db.list_entries())==1
    monkeypatch.setattr(db,'update_entry',original);db.update_entry(jid,status='waiting')
    monkeypatch.setattr('scraper4.services.scraping.engines.extract',lambda *a,**kw:pytest.fail('final page must not refetch'))
    assert step(db,settings)['status']=='done' and len(db.list_entries())==2


def test_no_send_child_on_empty_or_failed_extraction(db,settings,monkeypatch):
    p=profile(db);network(monkeypatch,{})
    db.enqueue('extract',p['id'],{'pages':1,'_send_after':[{'kind':'woo_send','payload':{}}]});assert step(db,settings)['status']=='done' and len(db.list_entries())==1
    monkeypatch.setattr('scraper4.services.scraping.engines.extract',lambda *a,**kw:(_ for _ in ()).throw(ValueError('no network')))
    db.enqueue('extract',p['id'],{'pages':1,'_send_after':[{'kind':'woo_send','payload':{}}]});assert step(db,settings)['status']=='failed' and len(db.list_entries())==2


def test_history_durable_utc_throttled_bounded_no_invented_days(db,monkeypatch):
    profile(db);clock=[datetime(2026,1,1,tzinfo=timezone.utc)]
    class Clock(datetime):
        @classmethod
        def now(cls,tz=None):return clock[0]
    monkeypatch.setattr(start,'datetime',Clock)
    assert not start.overview(db)['history']['daily']
    assert start.snapshot(db)['snapshot_recorded'];assert not start.snapshot(db)['snapshot_recorded']
    for _ in range(185):clock[0]+=timedelta(days=1);start.snapshot(db)
    value=db.checkpoint_read('start:history');assert len(value['daily'])==180 and len(start.overview(db)['history']['daily'])==30
    assert len(start.overview(db)['history']['updates'])==60
    for _ in range(730):clock[0]+=timedelta(minutes=1);start.snapshot(db)
    assert len(db.checkpoint_read('start:history')['updates'])==720


def test_start_routes_csrf_scope_empty_shape_and_duplicate_extraction_guard(app,client,auth_headers):
    db=app.extensions['s4_db'];p=profile(db)
    assert client.post('/api/start/enqueue',json={'profile_id':p['id'],'pages':0},headers=auth_headers).status_code==202
    assert client.post('/api/start/enqueue',json={'profile_id':p['id']},headers=auth_headers).status_code==409
    assert client.post('/api/start/snapshot',json={}).status_code==400
    assert client.post('/api/start/snapshot',json={'url':'https://example.com'},headers=auth_headers).status_code==400
    assert app.test_client().get('/api/start/overview').status_code==401
    cron=client.post('/api/cron/token',json={},headers=auth_headers).json['token']
    assert app.test_client().get('/api/start/overview',headers={'Authorization':'Bearer '+cron}).status_code==403
    with db.connect() as conn:before=list(conn.iterdump())
    assert client.get('/api/start/overview').status_code==200
    with db.connect() as conn:assert list(conn.iterdump())==before


def test_chain_preflight_and_pause_scope_and_clear_keep_failed_and_active(app,client,auth_headers):
    db=app.extensions['s4_db'];p=profile(db)
    assert client.post('/api/start/enqueue',json={'profile_id':p['id'],'send_after':[{'kind':'woo_send'}]},headers=auth_headers).status_code==400
    db.put_config('woocommerce',{'store_url':'https://example.org','consumer_key':'key','consumer_secret':'secret'})
    result=client.post('/api/start/enqueue',json={'profile_id':p['id'],'send_after':[{'kind':'woo_send'}]},headers=auth_headers)
    assert result.status_code==202
    parent=result.json['id'];child=db.enqueue('woo_send',p['id'],batch_id=f'extract:{parent}');standalone=db.enqueue('woo_send',p['id']);failed=db.enqueue('extract',p['id'],status='failed');done=db.enqueue('extract',p['id'],status='done')
    paused=client.post(f'/api/start/profiles/{p["id"]}/pause',json={'chain':True},headers=auth_headers)
    assert paused.json['paused']==2 and db.get_entry(child)['status']=='paused' and db.get_entry(standalone)['status']=='waiting'
    assert client.post('/api/start/queues/clear-finished',json={},headers=auth_headers).json['removed']==1
    assert not db.get_entry(done) and db.get_entry(failed)['status']=='failed' and db.get_entry(parent)['status']=='paused'


def test_profile_copy_settings_only_and_delete_protects_active_jobs(app,client,auth_headers):
    db=app.extensions['s4_db'];p=profile(db,settings={'detailSelectors':{'brand':'.brand'},'startPages':0})
    db.upsert_product(p['id'],'a',{'title':'A','extra':{'basalam_targets':{'7':1}}})
    response=client.post(f'/api/start/profiles/{p["id"]}/duplicate',json={'name':'کپی'},headers=auth_headers)
    assert response.status_code==201 and response.json['products_copied'] is False
    copy=response.json['profile'];assert copy['settings']==p['settings'] and not db.count_products(copy['id'])
    db.enqueue('extract',p['id']);assert client.delete(f'/api/profiles/{p["id"]}',headers=auth_headers).status_code==400


def xlsx(rows):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('xl/workbook.xml','<workbook xmlns="'+gh.NS['s']+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        from xml.sax.saxutils import escape
        body=''.join('<row>'+''.join(f'<c r="{chr(65+i)}{j}" t="inlineStr"><is><t>{escape(v)}</t></is></c>' for i,v in enumerate(r))+'</row>' for j,r in enumerate(rows,1))
        z.writestr('xl/worksheets/sheet1.xml',f'<worksheet xmlns="{gh.NS["s"]}"><sheetData>{body}</sheetData></worksheet>')
    return out.getvalue()


@pytest.mark.parametrize('fmt',['csv','xlsx'])
def test_github_csv_xlsx_import_is_atomic_deduplicated_preserves_ids_and_rich_extras(db,fmt):
    p=profile(db);rows=[['title','price','link','sku','woo_id','basalam_targets','longDesc'],['کالا','۱۲۰۰','https://example.com/p/a','','999','malicious','شرح']]
    raw=xlsx(rows) if fmt=='xlsx' else ('\ufeff'+ '\n'.join(','.join(r) for r in rows)).encode()
    parsed=gh.parse(raw,'products.'+fmt);assert len(parsed)==1
    key=next(iter(parsed));db.upsert_product(p['id'],key,{'title':'Old','sku':'KEEP-SKU','extra':{'basalam_targets':{'7':70},'images':['https://example.com/a.jpg']}});product=db.list_products()[0];db.mark_product_target(product['id'],'woo',10)
    assert gh.import_products(db,p,parsed)==1
    saved=db.list_products()[0];assert saved['woo_id']==10 and saved['sku']=='KEEP-SKU' and saved['extra']['basalam_targets']=={'7':70} and saved['extra']['images']
    assert saved['extra']['longDesc']=='شرح' and saved['price_num']==1200


@pytest.mark.parametrize('payload',[b'',b'title\n',b'title,title\na,b',b'price\n10',b'title,link\na,http://127.0.0.1/',b'title\n'+b'a\n'*1001,b'\xff\xff'])
def test_invalid_csv_before_any_import(payload):
    with pytest.raises(ValueError):gh.parse(payload,'products.csv')


def test_xlsx_rejects_formulas_archives_and_size_limits():
    with pytest.raises(ValueError):gh.parse(b'notzip','p.xlsx')
    with pytest.raises(ValueError):gh.parse(b'a'*(gh.MAX_FILE+1),'p.csv')
    raw=xlsx([['title'],['Product']]);source=zipfile.ZipFile(io.BytesIO(raw));out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as dest:
        for info in source.infolist():
            body=source.read(info.filename)
            if info.filename.endswith('sheet1.xml'):body=body.replace(b'<is><t>Product',b'<f>1+1</f><is><t>Product')
            dest.writestr(info.filename,body)
    with pytest.raises(ValueError,match='فرمول'):gh.parse(out.getvalue(),'p.xlsx')


def test_public_github_source_uses_fixed_api_one_call_and_real_worker_import(db,settings,monkeypatch):
    csv=b'title,price,link\nProduct,100,https://example.com/p/a';calls=[]
    def read(path,params):calls.append((path,params));return {'type':'file','encoding':'base64','size':len(csv),'content':base64.b64encode(csv).decode()}
    monkeypatch.setattr(gh,'api_read',read)
    p=profile(db,settings={'productSource':'github','sourceGithub':{'repo':'a/b','branch':'branch/one','path':'p.csv'}})
    db.enqueue('extract',p['id'],{'pages':0});assert step(db,settings)['status']=='done'
    assert len(calls)==1 and calls[0]==('repos/a/b/contents/p.csv',{'ref':'branch/one'}) and db.list_products()[0]['price_num']==100


def test_comprehensive_probe_signed_pagination_no_products_or_jobs_and_stale_rejection(app,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db'];p=profile(db);network(monkeypatch,{i:{str(i):{'title':str(i),'link':f'https://example.com/p/{i}'}} for i in range(1,6)})
    # Unique rows per requested page, including pages four/five.
    def extract(url,*args,**kw):
        from urllib.parse import parse_qs,urlsplit
        number=int(parse_qs(urlsplit(url).query).get('page',['1'])[0]);return {'products':{str(number):{'title':str(number)}},'used_engine':'selectors','elapsed_ms':1,'html':'','url':url}
    monkeypatch.setattr('scraper4.services.scraping.engines.extract',extract)
    continuation=None
    for i in range(1,6):
        body={'profile_id':p['id'],'engine':'selectors',**({'continuation':continuation} if continuation else {})}
        response=client.post('/api/extraction/probe',json=body,headers=auth_headers);assert response.status_code==200
        report=response.json['report'];assert report['page']==i and report['status']=='passed';continuation=report['next']
        if i<5:assert continuation
    assert continuation is None and not db.count_products() and not db.list_entries()
    reports=client.get('/api/extraction/reports').json['reports'];assert len(reports)==5 and all('next' not in r for r in reports)
    assert client.post('/api/extraction/probe',json={'profile_id':p['id'],'engine':'selectors','continuation':'forged'},headers=auth_headers).status_code==400
    token=client.post('/api/extraction/probe',json={'profile_id':p['id'],'engine':'selectors'},headers=auth_headers).json['report']['next']
    db.upsert_profile(p['key'],p['url']+'/changed',selectors=p['selectors'])
    assert client.post('/api/extraction/probe',json={'profile_id':p['id'],'engine':'selectors','continuation':token},headers=auth_headers).status_code==400


def test_github_explicit_stock_variations_and_boolean_validation():
    rows=gh.parse(b'title,stock,in_stock,variations\nA,0,false,"[""red""]"','p.csv')
    value=next(iter(rows.values()));assert value['extra']=={'stock':'0','in_stock':False,'variations':['red']}
    assert start.flags(value)['out_stock'] and start.flags(value)['variations']
    with pytest.raises(ValueError):gh.parse(b'title,in_stock\nA,maybe','p.csv')


def test_legacy_zero_padded_owner_local_counts_without_pinning_or_mutating(db):
    p=profile(db);db.put_config('basalam',{'vendor_id':'007','token':'secret'})
    db.upsert_product(p['id'],'a',{'title':'A'});db.mark_product_target(db.list_products()[0]['id'],'basalam',70)
    assert start.overview(db)['destination_totals']['bsl:7']==1
    assert db.checkpoint_read('basalam:legacy_owner')=={}


def test_resumed_failed_source_clears_old_error_after_success(db,settings,monkeypatch):
    p=profile(db);network(monkeypatch,{1:{'a':{'title':'A'}}})
    jid=db.enqueue('extract',p['id'],{'pages':1});db.update_entry(jid,status='failed',error='old failure');db.update_entry(jid,status='waiting')
    result=step(db,settings);assert result['status']=='done' and result['error']=='' and result['counters']['phase']=='complete'
