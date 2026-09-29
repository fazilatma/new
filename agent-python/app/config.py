import json, os
from pathlib import Path
BASE=Path(__file__).parents[1]/'data'; FILE=BASE/'environment.json'
NAMES=['OPENROUTER_API_KEY','GROQ_API_KEY','TOGETHER_API_KEY','MISTRAL_API_KEY','GEMINI_API_KEY','DEEPSEEK_API_KEY','ANTHROPIC_API_KEY','CLOUDFLARE_API_TOKEN','GITHUB_TOKEN','OLLAMA_BASE_URL','AGENT_WORKSPACE','PROVIDERS_FILE']
def read():
    data=json.loads(FILE.read_text()) if FILE.exists() else {}
    return {k:('' if 'KEY' in k or 'TOKEN' in k else str(data.get(k,os.getenv(k,'')))) for k in NAMES}
def write(data):
    BASE.mkdir(exist_ok=True); clean={k:str(data.get(k,'')) for k in NAMES}; FILE.write_text(json.dumps(clean,ensure_ascii=False,indent=2)); return clean
