#!/usr/bin/env python3
import os,sys,subprocess,json,platform,shutil

def run(cmd):
    try:return subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=5).stdout.strip()
    except Exception:return None
print(json.dumps({'python':sys.version.split()[0],'platform':platform.platform(),'node':shutil.which('node'),'php':shutil.which('php'),'llama_server':shutil.which('llama-server')},ensure_ascii=False))
