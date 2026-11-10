"""Explicit extraction row resume, never a browser retry loop or sender retry."""
import fcntl
import time
from dataclasses import replace
import pytest
from scraper4 import create_app
from scraper4.services import php_ui_start


def call(c,action,profile='one',id=1,write=False):
    return c.post('/api/php-ui/'+('write' if write else 'read'),json={'action':action,'query':{},'fields':{'profile':profile,'id':str(id)}})


@pytest.fixture
def rows(settings,monkeypatch):
    app=create_app(replace(settings,access_mode='open',password=''));db=app.extensions['s4_db'];p=db.upsert_profile('one','https://example.com/shop',selectors={'container':'.product','title':'h2'})
    other=db.upsert_profile('other','https://example.org/shop');send=db.enqueue('woo_send',p['id']);unrelated=db.enqueue('extract',other['id'])
    seen=[]
    def fetch(url,**kwargs):
        seen.append(url);return {'ok':True,'code':200,'url':url,'html':'<article class="product"><h2>row resumed</h2></article>'}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fetch)
    return app,app.test_client(),db,p,seen,send,unrelated


@pytest.mark.parametrize('status',['failed','paused','waiting'])
def test_resume_exact_row_preserves_checkpoint_without_new_job_or_sender(rows,status):
    app,c,db,p,seen,send,other=rows
    job=db.enqueue('extract',p['id'],{'pages':3,'_page':2,'with_detail':False,'opaque':'DO-NOT-EXPOSE'},status=status)
    db.checkpoint_write('sentinel:checkpoint',{'keep':True},queue_entry_id=job)
    before=db.list_entries();r=call(c,'python_extract_resume',id=job,write=True)
    assert r.status_code==200 and r.json['ran']==1 and r.json['id']==job and r.json['remote_send_executed'] is False
    assert len(seen)==1 and 'page=2' in seen[0]
    assert db.get_entry(job)['payload']['_page']==3 and db.get_entry(job)['status']=='waiting'
    assert db.checkpoint_read('sentinel:checkpoint')=={'keep':True}
    assert len(db.list_entries())==len(before) and db.get_entry(send)==next(j for j in before if j['id']==send) and db.get_entry(other)==next(j for j in before if j['id']==other)
    assert 'DO-NOT-EXPOSE' not in r.text
    repeated=call(c,'python_extract_resume',id=job,write=True);assert repeated.json['throttled'] and len(seen)==1


def test_read_row_is_safe_even_outside_100_row_status_window(rows,settings):
    app,c,db,p,seen,send,other=rows;job=db.enqueue('extract',p['id'],status='failed')
    db.update_entry(job,error='PRIVATE SOURCE TOKEN',counters={'error_code':'source_access_denied','last_http_status':403,'private':'TOKEN'})
    for _ in range(105):db.enqueue('extract',p['id'],status='failed')
    with db.connect() as conn:before=list(conn.iterdump())
    r=call(c,'python_extract_row',id=job);assert r.status_code==200 and r.json['job']['id']==job and r.json['read_only']
    assert 'PRIVATE' not in r.text and 'TOKEN' not in r.text and '403' in r.text and not seen
    with db.connect() as conn:assert list(conn.iterdump())==before
    db.checkpoint_write('extract:manual:last',{'started_epoch':0})
    assert call(c,'python_extract_resume',id=job,write=True).json['job']['id']==job


@pytest.mark.parametrize('state',['done','cancelled'])
def test_terminal_rows_cannot_restart(rows,state):
    app,c,db,p,seen,*_=rows;j=db.enqueue('extract',p['id'],status=state)
    assert call(c,'python_extract_resume',id=j,write=True).status_code==409
    assert db.get_entry(j)['status']==state and not seen


def test_kind_profile_running_heartbeat_and_lock_checks(rows,settings):
    app,c,db,p,seen,send,other=rows
    assert call(c,'python_extract_resume',id=send,write=True).status_code==400
    assert call(c,'python_extract_resume',id=other,write=True).status_code==400
    j=db.enqueue('extract',p['id'],{'pages':2},status='running')
    assert call(c,'python_extract_resume',id=j,write=True).status_code==409
    db.update_entry(j,heartbeat='2000-01-01 00:00:00')
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        assert call(c,'python_extract_resume',id=j,write=True).json['busy']
    assert not seen and db.get_entry(j)['status']=='running'
    assert call(c,'python_extract_resume',id=j,write=True).json['ran']==1 and len(seen)==1


def test_resume_failure_remains_failed_safe_and_never_auto_retries(rows,monkeypatch):
    app,c,db,p,seen,*_=rows;j=db.enqueue('extract',p['id'],{'_page':3,'pages':4},status='failed')
    def denied(*a,**k):seen.append('denied');return {'ok':False,'code':403,'error':'PRIVATE-TOKEN'}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',denied)
    r=call(c,'python_extract_resume',id=j,write=True)
    assert r.status_code==422 and not r.json['ok'] and r.json['job']['status']=='failed' and 'PRIVATE-TOKEN' not in r.text
    assert db.get_entry(j)['payload']['_page']==3 and len(seen)==1
    for _ in range(3):assert call(c,'python_extract_row',id=j).json['read_only']
    assert len(seen)==1


def test_extract_queue_filters_before_limit_and_reports_safe_resumability(rows):
    app,c,db,p,seen,*_=rows;j=db.enqueue('extract',p['id'],status='failed')
    for _ in range(110):db.enqueue('bsl_send',p['id'])
    r=c.post('/api/php-ui/read',json={'action':'extract_queue_status','fields':{},'query':{}})
    assert any(e['id']==str(j) and e['resumable'] for e in r.json['entries']) and not seen
