"""Downloadable credential-free runtime/deployment summary; no console copying."""
import json
import re
from ..config import VERSION
from ..db import utc_now
from .updates import read_release
from .operation_coverage import report as coverage
from .extraction_diagnostics import report as extraction


def sha(value):
    return value if isinstance(value,str) and re.fullmatch(r'[0-9a-f]{40}',value) else None


def report(db,settings,loaded_commit):
    deployments=[]
    with db.connect() as conn:
        rows=conn.execute("SELECT state FROM task_checkpoints WHERE task LIKE 'agent-deploy:%' ORDER BY updated_at DESC LIMIT 5").fetchall()
    for row in rows:
        try:value=json.loads(row['state'])
        except (ValueError,TypeError):continue
        if not isinstance(value,dict):continue
        deployments.append({'state':value.get('state') if value.get('state') in ('preparing','interrupted','failed','reload_pending','reload_requested') else 'unknown',
                            'commit':sha(value.get('commit')),'error_recorded':bool(value.get('error')),
                            'live_verified':False})
    op=db.checkpoint_read('maintenance:request');state=db.checkpoint_read('updates:state')
    return {'ok':True,'format':'scraper4-safe-support-v1','generated_at':utc_now(),
            'runtime':{'version':VERSION,'loaded_commit':sha(loaded_commit),'installed_commit':sha(read_release(settings.base_dir).get('commit'))},
            'maintenance_active':(settings.base_dir/'.maintenance.json').exists(),
            'update':{'action':op.get('action') if op.get('action') in ('check','update','reload','configure','rollback') else None,
                      'status':op.get('status') if op.get('status') in ('pending','running','done','failed') else None,
                      'error_recorded':bool(op.get('error') or state.get('error'))},
            'deployments':deployments,'extraction':extraction(db,settings),'coverage':coverage(),
            'contains_credentials':False,'console_output_included':False,'source_probes_executed':False,'queues_executed':False,
            'note':'گزارش از وضعیت ذخیره‌شده ساخته شده؛ متن خام کنسول/لاگ سرور یا علت قطعی خطای۵۰۰ نیست. دانلود/خواندن هیچ نصب، probe یا صفی را اجرا نمی‌کند. شناسه/وضعیت کارها داخل فایل است؛ پیش از اشتراک بازبینی کنید.'}
