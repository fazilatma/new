#!/usr/bin/env python3
import json,platform,shutil,subprocess,sys
def v(c):
 try:return subprocess.run(c,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=5).stdout.strip().splitlines()[0]
 except:return None
print(json.dumps({'python':sys.version.split()[0],'platform':platform.platform(),'node':shutil.which('node'),'php':shutil.which('php'),'llama_server':shutil.which('llama-server')},ensure_ascii=False))