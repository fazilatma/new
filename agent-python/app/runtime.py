"""Runtime job submission and query interface."""
from typing import Dict, Any, List, Optional
from .worker import (
    create_job, get_job_details, list_all_jobs,
    cancel_job, pause_job, resume_job, retry_job, delete_old_jobs
)

def submit(payload: Dict[str, Any], title: str = "Agent Chat Task", provider: str = "openrouter", model: str = "", workspace_id: str = "default", user_id: str = "user") -> Dict[str, Any]:
    return create_job(
        title=title,
        provider_id=provider,
        model_id=model,
        payload=payload,
        workspace_id=workspace_id,
        user_id=user_id
    )

def get(jid: str) -> Optional[Dict[str, Any]]:
    return get_job_details(jid)

def list_jobs(status: Optional[str] = None, provider: Optional[str] = None, model: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    return list_all_jobs(status=status, provider=provider, model=model, limit=limit)
