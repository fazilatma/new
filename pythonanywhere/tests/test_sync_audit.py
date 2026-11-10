"""All-profile diagnostics: page every saved profile, do not advance any work."""
import json
import pytest
from scraper4.services import sync_audit


def call(client,headers,fields=None):
    return client.post('/api/php-ui/read',json={'action':'python_sync_audit','fields':fields or {},'query':{}},headers=headers)


def test_all_profiles_paged_including_disabled_no_mutation_or_secret_export(app,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db']
    for i in range(61):
        p=db.upsert_profile(str(i),'https://private.example/?secret=PRIVATE','Profile '+str(i),enabled=i%2==0)
        db.enqueue('extract',p['id'],{'PRIVATE':'PRIVATE'},status='failed' if i==0 else 'waiting')
    db.put_config('woocommerce',{'store_url':'https://PRIVATE','consumer_key':'PRIVATE','consumer_secret':'PRIVATE'})
    db.checkpoint_write('cron:last',{'status':'failed','error':'PRIVATE','result':'PRIVATE'})
    monkeypatch.setattr('scraper4.services.scraping.fetch.HtmlFetcher.get',lambda *a,**k:pytest.fail('local diagnostic must not use network'))
    with db.connect() as c:before=list(c.iterdump())
    first=call(client,auth_headers).json;rows=first['profiles'];through=first['through_id'];nxt=first['next_after_id']
    assert first['limit']==25 and first['total_profiles']==61 and first['read_only'] and not first['processed']
    while nxt is not None:
        d=call(client,auth_headers,{'after_id':str(nxt),'through_id':str(through)}).json;rows+=d['profiles'];nxt=d['next_after_id']
    assert len(rows)==61 and len({r['id'] for r in rows})==61 and any(not r['enabled'] for r in rows)
    assert any(c['stage']=='queues' and c['status']=='blocked' for c in rows[0]['checks'])
    assert all('source' in r and not r['destination_reachability_tested'] for r in rows)
    assert 'PRIVATE' not in json.dumps([first,rows]) and 'private.example' not in json.dumps(rows)
    with db.connect() as c:assert list(c.iterdump())==before


def test_pagination_high_water_excludes_new_profiles_and_handles_empty_db(app,client,auth_headers):
    assert call(client,auth_headers).json['profiles']==[]
    db=app.extensions['s4_db']
    for i in range(26):db.upsert_profile(str(i),'https://example.org')
    first=call(client,auth_headers).json;db.upsert_profile('new','https://example.org')
    last=call(client,auth_headers,{'after_id':str(first['next_after_id']),'through_id':str(first['through_id'])}).json
    assert len(last['profiles'])==1 and last['next_after_id'] is None and last['total_profiles']==26


def test_pricing_detail_targets_and_pipeline_are_actually_checked(app,client,auth_headers):
    db=app.extensions['s4_db'];p=db.upsert_profile('bad','https://example.org','Bad',settings={'detailSelectors':{'BAD':'x'},'profileOptions':{'priceMode':'INVALID'}})
    db.enqueue('bsl_send',p['id'],{'vendor_id':'99'},status='failed');root=db.enqueue('extract',p['id'],{'_send_after':[{'kind':'woo_send','payload':{}}]},status='done');db.update_entry(root,counters={'found':2})
    result=call(client,auth_headers).json['profiles'][0];codes={c['code']:c for c in result['checks']}
    assert codes['invalid_detail_config']['status']=='blocked' and codes['invalid_pricing']['status']=='blocked'
    assert codes['queued_destinations']['counts']['invalid']==1 and codes['pipeline_provenance']['counts']['issues']==1


def test_source_and_products_and_runtime_are_not_remote_validation(app,client,auth_headers):
    db=app.extensions['s4_db'];p=db.upsert_profile('browser','https://example.org',settings={'extractionEngine':'playwright','startWithDetail':False})
    db.upsert_product(p['id'],'one',{'title':'PRIVATE','price_num':100,'image':'','link':''})
    result=call(client,auth_headers).json;r=result['profiles'][0];checks={c['stage']:c for c in r['checks']}
    assert checks['source']['code']=='renderer_missing' and checks['products']['counts']['no_image']==1
    assert checks['detail']['status']=='skipped' and checks['pricing']['counts']['sampled']==1
    assert not result['runtime']['worker_observed_running'] and not result['runtime']['cron_seen']
    assert not result['destination_reachability_tested'] and not result['source_reachability_tested']
    assert 'PRIVATE' not in json.dumps(result)


@pytest.mark.parametrize('fields',[{'url':'https://evil.example'},{'after_id':'-1'},{'after_id':'2','through_id':'1'},{'through_id':'no'}])
def test_invalid_pagination_and_urls_are_rejected(client,auth_headers,fields):
    assert call(client,auth_headers,fields).status_code==400


def test_invalid_profile_does_not_stop_other_profiles_and_bearer_forbidden(app,client,auth_headers):
    db=app.extensions['s4_db'];bad=db.upsert_profile('bad','https://example.org');db.upsert_profile('good','https://example.org')
    with db.connect() as c:c.execute('UPDATE profiles SET settings=? WHERE id=?',('[]',bad['id']))
    rows=call(client,auth_headers).json['profiles'];assert len(rows)==2 and rows[0]['checks'][0]['code']=='invalid_saved_configuration'
    assert len(rows[1]['checks'])>1
    assert call(app.test_client(),{}).status_code in (400,401)
    assert client.post('/api/php-ui/write',json={'action':'python_sync_audit','fields':{},'query':{}},headers=auth_headers).status_code==501


def test_detail_coverage_runtime_age_and_unknown_queue_fields_are_safe(app,client,auth_headers):
    import time
    db=app.extensions['s4_db'];p=db.upsert_profile('p','https://example.org')
    db.upsert_product(p['id'],'x',{'title':'title','extra':{'_detail_checked_at':'2026-11-08'}})
    db.enqueue('PRIVATE',p['id'],status='PRIVATE')
    db.checkpoint_write('cron:last',{'status':'PRIVATE','started_epoch':time.time()-900,'result':'PRIVATE'})
    d=call(client,auth_headers).json
    assert 899<=d['runtime']['cron_last_age_seconds']<=905 and d['runtime']['continuation_unconfirmed']
    assert d['runtime']['cron_last_status']=='unknown' and 'PRIVATE' not in json.dumps(d)
    products=next(c for c in d['profiles'][0]['checks'] if c['stage']=='products')
    assert products['counts']['detail_checked']==1
