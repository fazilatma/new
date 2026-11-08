import fcntl
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

from scraper4.services import worker_runtime as runtime
from scraper4.services.platform import PythonAnywhere, PlatformError


class Stop:
    def __init__(self): self.now=0;self.flag=False
    def is_set(self): return self.flag
    def wait(self, seconds): self.now+=seconds


def test_disabled_worker_has_no_child_and_honors_runtime(db,settings):
    stop=Stop();child=Mock(side_effect=AssertionError('disabled'))
    result=runtime.supervise(db,settings,max_runtime=11,stop=stop,clock=lambda:stop.now,child=child)
    assert result=={'ok':True,'cycles':0,'reason':'runtime_limit'} and stop.now==11
    assert db.checkpoint_read('worker:state')['phase']=='stopped'
    assert runtime.status(db,settings)['observed_running'] is False


def test_daemon_lock_and_observed_heartbeat(db,settings):
    with settings.db_path.with_suffix('.daemon.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        assert runtime.supervise(db,settings,max_runtime=1)['busy']
        assert runtime.status(db,settings)['observed_running'] is False
        import time
        db.checkpoint_write('worker:state',{'heartbeat_epoch':time.time(),'phase':'processing'})
        assert runtime.status(db,settings)['observed_running'] is True
    assert runtime.status(db,settings)['observed_running'] is False


def test_real_resumable_engine_runs_across_cycles_with_worker_lock(db,settings,monkeypatch):
    from scraper4.services.engine import _tick_locked
    p=db.upsert_profile('shop','https://example.com/shop',selectors={'container':'.product','title':'h2'})
    job=db.enqueue('extract',p['id'],{'pages':3})
    db.checkpoint_write('worker:config',{'enabled':True,'poll_seconds':5})
    calls=[]
    fetched=[]
    def fetch(url,**kw):
        fetched.append(url)
        return {'ok':True,'url':url,'html':f'<article class="product"><h2>Product {len(fetched)}</h2><a href="/p/{len(fetched)}">link</a></article>'}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fetch)
    def child(db,settings,command,pulse):
        calls.append(command)
        with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            _tick_locked(db,settings,20,1,max_steps=1)
        pulse();return 0
    stop=Stop();result=runtime.supervise(db,settings,max_runtime=16,stop=stop,clock=lambda:stop.now,child=child)
    assert db.get_entry(job)['status']=='done' and db.count_products(p['id'])==3
    assert calls==['maintain','tick','tick'] and result['cycles']==3
    assert db.get_config('pythonanywhere')=={}


def test_config_disable_and_graceful_stop_are_respected_at_cycle_boundary(db,settings):
    db.checkpoint_write('worker:config',{'enabled':True,'poll_seconds':5})
    stop=Stop();calls=[]
    def child(db,settings,command,pulse):
        calls.append(command);db.checkpoint_write('worker:config',{'enabled':False,'poll_seconds':5});return 0
    runtime.supervise(db,settings,max_runtime=11,stop=stop,clock=lambda:stop.now,child=child)
    assert calls==['maintain']
    db.checkpoint_write('worker:config',{'enabled':True,'poll_seconds':5})
    def shutdown(*a):stop.flag=True;return 0
    assert runtime.supervise(db,settings,stop=stop,clock=lambda:stop.now,child=shutdown)['cycles']==1


def test_code_change_exits_before_next_child(db,settings):
    db.checkpoint_write('worker:config',{'enabled':True,'poll_seconds':5})
    release=settings.base_dir/'.release.json';release.write_text(json.dumps({'commit':'a'*40}))
    stop=Stop()
    def child(*a):release.write_text(json.dumps({'commit':'b'*40}));return 0
    result=runtime.supervise(db,settings,max_runtime=20,stop=stop,clock=lambda:stop.now,child=child)
    assert result['reason']=='code_changed' and result['cycles']==1


def test_child_failure_status_without_raw_log_or_automatic_failed_job_retry(db,settings):
    db.checkpoint_write('worker:config',{'enabled':True,'poll_seconds':5})
    p=db.upsert_profile('p','https://example.com');job=db.enqueue('woo_send',p['id'],status='failed')
    stop=Stop();child=Mock(return_value=1)
    result=runtime.supervise(db,settings,max_runtime=6,stop=stop,clock=lambda:stop.now,child=child)
    assert result['cycles']==1 and db.get_entry(job)['status']=='failed'
    assert db.checkpoint_read('worker:state')['last_exit_code']==1


def test_actual_cli_worker_disabled_exits_without_web_or_background_process(settings):
    env={**os.environ,'PYTHONPATH':str(Path(__file__).parents[1]),'S4_BASE_DIR':str(settings.base_dir),
         'S4_DB':str(settings.db_path),'S4_SECRET_KEY':settings.secret_key,'S4_PASSWORD':'test-password'}
    result=subprocess.run([sys.executable,'-m','scraper4','worker','--max-runtime','1'],env=env,capture_output=True,text=True,timeout=10)
    assert result.returncode==0 and json.loads(result.stdout)['reason']=='runtime_limit'


def test_child_argv_is_fixed_and_parent_heartbeat_updates_during_long_wait(db,settings,monkeypatch):
    child=Mock();child.wait.side_effect=[subprocess.TimeoutExpired('test',2),0]
    context=Mock();context.__enter__=Mock(return_value=child);context.__exit__=Mock(return_value=False)
    popen=Mock(return_value=context);monkeypatch.setattr(runtime.subprocess,'Popen',popen)
    pulse=Mock();assert runtime.run_child(db,settings,'tick',pulse)==0
    pulse.assert_called_once();assert popen.call_args.args[0]==[sys.executable,'-m','scraper4','tick','--budget','20']
    assert 'shell' not in popen.call_args.kwargs


@pytest.mark.parametrize('body',[{}, {'enabled':1,'poll_seconds':5},{'enabled':True,'poll_seconds':1}, {'enabled':True,'poll_seconds':False}, {'enabled':True,'poll_seconds':5,'command':'bad'}])
def test_bad_config_rejected(client,auth_headers,body):
    assert client.post('/api/worker/config',json=body,headers=auth_headers).status_code==400


def test_worker_endpoints_guard_auth_csrf_cron_and_browser_only(app,client,auth_headers):
    remote=app.test_client();assert remote.get('/api/worker/status').status_code==401
    assert client.post('/api/worker/config',json={'enabled':True,'poll_seconds':5}).status_code==400
    cron=client.post('/api/cron/token',json={},headers=auth_headers).json['token']
    assert remote.get('/api/worker/status',headers={'Authorization':'Bearer '+cron}).status_code==403
    full=client.post('/api/auth/token',json={},headers=auth_headers).json['token']
    assert remote.post('/api/worker/config',json={'enabled':True,'poll_seconds':5},headers={'Authorization':'Bearer '+full}).status_code==403
    response=client.post('/api/worker/config',json={'enabled':True,'poll_seconds':5},headers=auth_headers)
    assert response.json['process_started'] is False


def test_native_task_creation_only_enables_config_after_success(app,client,auth_headers,monkeypatch):
    monkeypatch.setattr('scraper4.worker.installed_python',lambda _:Path('/venv/bin/python'))
    monkeypatch.setattr(PythonAnywhere,'__init__',lambda *a,**kw:None)
    method=Mock(side_effect=PlatformError('Plan denied'));monkeypatch.setattr(PythonAnywhere,'ensure_task',method)
    assert client.post('/api/worker/schedule',json={},headers=auth_headers).status_code==400
    db=app.extensions['s4_db'];assert runtime.config(db)['enabled'] is False
    method.side_effect=None;method.return_value={'task_id':3,'interval':'hourly'}
    response=client.post('/api/worker/schedule',json={},headers=auth_headers)
    assert response.json['process_started'] is False and runtime.config(db)['enabled']
    assert response.json['native_schedule']['interval']=='hourly'
    assert method.call_args.kwargs['long_running'] is True
    assert client.post('/api/worker/schedule',json={'command':'rm -rf /'},headers=auth_headers).status_code==400


def test_native_schedule_hourly_daily_fallback_idempotence_and_unrelated_tasks(settings,monkeypatch):
    api=PythonAnywhere({'site':'www.pythonanywhere.com','username':'test','domain':'test.pythonanywhere.com','token':'private'})
    calls=[]
    def call(method,path,**kw):
        import copy
        calls.append((method,path,copy.deepcopy(kw)))
        if method=='GET':return [{'id':99,'command':'unrelated task'}]
        if kw['json']['interval']=='hourly':raise PlatformError('plan restricted',status=403,category='forbidden')
        return {'id':8,'enabled':True,'interval':'daily'}
    monkeypatch.setattr(api,'call',call)
    result=api.ensure_task(settings,python='/venv/bin/python',long_running=True)
    assert result['interval']=='daily'
    assert 'worker --max-runtime 6600' in calls[-1][2]['json']['command']
    assert calls[-1][1]=='schedule/' and 'private' not in calls[-1][2]['json']['command']
    assert '3300' in calls[1][2]['json']['command']
    command=calls[-1][2]['json']['command']
    def existing(method,path,**kw):
        if method=='GET':return [{'id':8,'command':command,'interval':'daily','enabled':True}]
        assert path=='schedule/8/' and method=='PATCH'
        return {'id':8,'enabled':True,'interval':'hourly'}
    monkeypatch.setattr(api,'call',existing)
    assert api.ensure_task(settings,python='/venv/bin/python',long_running=True)['task_id']==8
    assert api.ensure_task(settings,python='/venv/bin/python')['task']=='preserved_worker'


def test_legacy_activation_preserves_even_disabled_unbounded_worker_schedule(settings,monkeypatch):
    import shlex
    api=PythonAnywhere({'site':'www.pythonanywhere.com','username':'test','domain':'test.pythonanywhere.com','token':'private'})
    cmd='cd '+shlex.quote(str(settings.base_dir.resolve()))+' && /venv/python -m scraper4 '
    method=Mock(return_value=[{'id':1,'command':cmd+'maintain --budget 240','enabled':True},
                             {'id':2,'command':cmd+'worker','enabled':False}])
    monkeypatch.setattr(api,'call',method)
    result=api.ensure_task(settings,python='/venv/python')
    assert result['task']=='preserved_worker' and result['task_id']==2 and result['enabled'] is False
    assert result['note'] and method.call_count==1
