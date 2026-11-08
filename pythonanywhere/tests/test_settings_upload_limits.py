import base64
import json

import pytest

from scraper4.services import settings_transfer as transfer


def large_php():
    connection=base64.b64encode(json.dumps({'basalam':{'token':'test-only','vendor_id':'123'}}).encode()).decode()
    # Ignored products are deliberately not restored; realistic >2MB envelope.
    return json.dumps({'app':'scraper','files':{'connections.json':{'b64':connection},'products.json':{'b64':'x'*2300000}}})


def test_large_php_file_crosses_old_flask_limit_inspects_previews_and_applies(client,auth_headers,app):
    raw=large_php();assert len(raw)>2*1024*1024
    request={'file':raw,'password':'','source':'file','sections':['basalam'],'mode':'merge','credentials':True}
    assert client.get('/api/settings/sections').json['max_file_bytes']==10*1024*1024
    response=client.post('/api/settings/inspect',json=request,headers=auth_headers)
    assert response.status_code==200 and response.json['available']==['basalam']
    preview=client.post('/api/settings/preview',json=request,headers=auth_headers)
    assert preview.status_code==200
    applied=client.post('/api/settings/import',json={**request,'token':preview.json['token']},headers=auth_headers)
    assert applied.status_code==200 and applied.json['changed']
    db=app.extensions['s4_db']
    assert db.get_config('basalam')['vendor_id']=='123' and not db.list_products() and not db.list_entries()


def test_larger_encrypted_settings_roundtrip_exceeds_old_plain_limit():
    bundle={'format':transfer.FORMAT,'schema':1,'sections':{'profiles':[{'key':'test','name':'Test','url':'https://example.com',
        'enabled':True,'selectors':{},'pagination':{'type':'query_page','val':''},'settings':{'custom':'x'*1200000}}]}}
    envelope=transfer.encrypt(bundle,'test-password-1234')
    assert len(envelope['ciphertext'])>1500000
    assert transfer.decode(envelope,'test-password-1234')==bundle


def test_limits_are_enforced_and_not_raised_for_other_routes(client,auth_headers,app):
    assert app.config['MAX_CONTENT_LENGTH']==2*1024*1024
    result=client.post('/api/profiles',data=json.dumps({'padding':'x'*(2*1024*1024)}),content_type='application/json',headers=auth_headers)
    assert result.status_code==413
    assert client.post('/api/settings/inspect',json={'file':'x'*(transfer.MAX_FILE+1)},headers=auth_headers).status_code==400
    with pytest.raises(ValueError): transfer.encrypt({'padding':'x'*transfer.MAX_PLAIN},'test-password-1234')


def test_scoped_request_ceiling_rejects_oversized_envelope(client,auth_headers,monkeypatch):
    monkeypatch.setattr(transfer,'MAX_REQUEST',128)
    assert client.post('/api/settings/inspect',json={'file':'x'*200},headers=auth_headers).status_code==413


def test_large_request_cannot_bypass_browser_auth_csrf_or_bearer_policy(app,client,auth_headers):
    raw={'file':large_php()}
    assert client.post('/api/settings/inspect',json=raw).status_code in (400,413)
    remote=app.test_client()
    assert remote.post('/api/settings/inspect',json=raw).status_code in (400,401,413)
    token=client.post('/api/auth/token',json={},headers=auth_headers).json['token']
    assert remote.post('/api/settings/inspect',json=raw,headers={'Authorization':'Bearer '+token}).status_code==403
