"""Pipeline reads are bounded, provenance-checked, private and never repair work."""
import json
import pytest
from scraper4.services.php_ui_pipeline import status


@pytest.fixture
def pipeline(app):
    db=app.extensions['s4_db'];p=db.upsert_profile('one','https://private.example/?token=SECRET','One')
    return db,p


def root(db,p,state='done',found=2,targets=None):
    targets=targets if targets is not None else [{'kind':'woo_send','payload':{'secret':'SECRET'}}]
    eid=db.enqueue('extract',p['id'],{'_send_after':targets},status=state)
    db.update_entry(eid,counters={'found':found,'current':1,'error_code':['malformed'],'error_hint':'SECRET'},error='SECRET')
    return eid


def child(db,p,eid,state='waiting',kind='woo_send',vendor=None,**kwargs):
    return db.enqueue(kind,p['id'],{'source_extract_job':eid,'secret':'SECRET','vendor_id':vendor,**kwargs},batch_id=f'extract:{eid}',status=state)


def read(db):return status(db,{'profile':'one'})


def test_pipeline_is_read_only_and_links_exact_children_not_newer_profile_sends(pipeline):
    db,p=pipeline;eid=root(db,p);cid=child(db,p,eid);db.enqueue('woo_send',p['id'],status='done')
    other=db.upsert_profile('other','https://example.org');child(db,other,eid,'done')
    child(db,p,eid,'done',source_extract_job=999)
    with db.connect() as c:before=list(c.iterdump())
    result=read(db);row=result['rows'][0]
    assert row['id']==eid and row['stage']=='send' and row['status']=='waiting'
    assert [e['id'] for e in row['entries']]==[eid,cid]
    assert result['read_only'] and not result['processed'] and not result['reconciliation_performed']
    assert not any(s in json.dumps(result) for s in ('SECRET','private.example','vendor_id','_send_after'))
    with db.connect() as c:assert list(c.iterdump())==before


@pytest.mark.parametrize('state',['waiting','running','paused','failed','cancelled'])
def test_inactive_and_failed_roots_are_never_resumed_or_reconciled(pipeline,state):
    db,p=pipeline;eid=root(db,p,state)
    r=read(db)['rows'][0];assert r['status']==state and len(db.list_entries())==1
    assert db.get_entry(eid)['status']==state


@pytest.mark.parametrize('found,expected',[(0,'done'),(2,'incomplete')])
def test_empty_or_missing_child_does_not_fake_send_success(pipeline,found,expected):
    db,p=pipeline;root(db,p,found=found)
    r=read(db)['rows'][0];assert r['status']==expected and r['linked_send_jobs']==0
    assert len(db.list_entries())==1


def test_completed_job_with_product_failures_is_not_all_success(pipeline):
    db,p=pipeline;eid=root(db,p);cid=child(db,p,eid,'done');db.update_entry(cid,counters={'failed':1,'sent':2,'current':3,'total':3,'token':'SECRET'})
    r=read(db)['rows'][0];assert r['status']=='completed_with_errors' and r['entries'][1]['counts']['failed']==1


def test_wrong_destination_or_duplicate_child_is_incomplete(pipeline):
    db,p=pipeline;eid=root(db,p,targets=[{'kind':'bsl_send','payload':{'vendor_id':'42'}}]);child(db,p,eid,'done',kind='bsl_send',vendor='43')
    assert read(db)['rows'][0]['status']=='incomplete'
    correct=child(db,p,eid,'done',kind='bsl_send',vendor='42');assert correct and read(db)['rows'][0]['status']=='incomplete'


def test_two_actual_targets_with_one_failed_child_stays_failed(pipeline):
    db,p=pipeline;eid=root(db,p,targets=[{'kind':'bsl_send','payload':{'vendor_id':'42'}},{'kind':'woo_send','payload':{}}])
    child(db,p,eid,'done',kind='bsl_send',vendor='42');child(db,p,eid,'failed')
    assert read(db)['rows'][0]['status']=='failed'


def test_limits_prioritize_old_active_roots_and_do_not_claim_complete_truncated_children(pipeline):
    db,p=pipeline;active=root(db,p,'failed')
    for _ in range(22):root(db,p,targets=[])
    r=read(db);assert r['truncated'] and len(r['rows'])==20 and r['rows'][0]['id']==active
    eid=root(db,p)
    for _ in range(101):child(db,p,eid,'done')
    row=next(r for r in read(db)['rows'] if r['id']==eid)
    assert row['children_truncated'] and row['status']=='incomplete' and len(row['entries'])==101


def test_pipeline_filters_profile_before_limit_and_handles_deleted_profile(pipeline):
    db,p=pipeline;eid=root(db,p,targets=[]);other=db.upsert_profile('other','https://example.org')
    for _ in range(25):root(db,other)
    assert [r['id'] for r in read(db)['rows']]==[eid]
    with pytest.raises(ValueError):status(db,{'profile':'missing'})
    with pytest.raises(ValueError):status(db,{'url':'https://evil.example'})


def test_broker_advertises_read_and_preserves_auth_and_csrf(pipeline,app,client,auth_headers):
    db,p=pipeline;root(db,p)
    path='/api/php-ui/read';body={'action':'sync_pipeline_status','fields':{'profile':'one'},'query':{}}
    assert client.post(path,json=body,headers=auth_headers).json['read_only']
    assert client.post(path,json=body).status_code==400
    assert app.test_client().post(path,json=body).status_code in (400,401)
    assert 'sync_pipeline_status' in client.get('/api/php-ui/capabilities').json['read_actions']
    assert client.post('/api/php-ui/write',json=body,headers=auth_headers).status_code==501


def test_old_finished_root_with_active_send_is_not_hidden_by_newer_terminal_roots(pipeline):
    db,p=pipeline;eid=root(db,p);child(db,p,eid,'failed')
    for _ in range(25):root(db,p,targets=[])
    result=read(db);assert result['rows'][0]['id']==eid and result['rows'][0]['status']=='failed'
    assert result['truncated']


@pytest.mark.parametrize('payload',['invalid-json','null','[]','{"source_extract_job":true}','{"source_extract_job":"1"}','{"source_extract_job":9999999999999999999999999}'])
def test_malformed_or_untyped_provenance_never_links_or_breaks_status(pipeline,payload):
    db,p=pipeline;eid=root(db,p);cid=child(db,p,eid,'failed')
    with db.connect() as c:c.execute('UPDATE queue_entries SET payload=? WHERE id=?',(payload,cid))
    result=read(db);assert result['rows'][0]['status']=='incomplete'
    assert result['rows'][0]['linked_send_jobs']==0
