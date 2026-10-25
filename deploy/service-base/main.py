"""Service Base adapter: supervise a packaged application and optional FRP client."""
import json
import os
from pathlib import Path
import signal
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request


OUTPUT_LOCK=threading.Lock()

def emit(event):
    with OUTPUT_LOCK:print(json.dumps({'event':event}),flush=True)

def start_child(command,**kwargs):
    child=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1,**kwargs)
    def relay():
        for line in child.stdout:
            with OUTPUT_LOCK:print('process: '+line.rstrip('\r\n'),flush=True)
    threading.Thread(target=relay,daemon=True).start()
    return child


def run():
    config=json.loads(Path(os.environ['SERVICE_BASE_CONFIG']).read_text())
    data=Path(os.environ['SERVICE_BASE_DATA_DIR']);data.mkdir(parents=True,exist_ok=True)
    app=Path(__file__).resolve().parent/'app'
    if not shutil.which('node'):raise RuntimeError('Node.js is required for source checks')
    interval=max(1,min(15,float(config.get('heartbeat_seconds',10))))
    port=int(config.get('port',8770))
    if not 1024<=port<=65535:raise ValueError('Invalid application port')
    env={**os.environ,'FORMA_HOST':'127.0.0.1','FORMA_PORT':str(port),
         'FORMA_DB':str(config.get('database') or data/'forma.sqlite3'),
         'FORMA_PUBLIC_URL':config.get('public_url',''),'FORMA_ALLOW_LOCAL_ACCESS':'1'}
    if config.get('env_file'):env['FORMA_ENV_FILE']=str(Path(config['env_file']).expanduser())
    # The edge overwrites X-Real-IP; the FRP endpoint is local to this machine.
    if config.get('public_url'):env['FORMA_TRUSTED_PROXIES']='127.0.0.1/32'
    stopped=threading.Event()
    for name in (signal.SIGTERM,signal.SIGINT):signal.signal(name,lambda *_:stopped.set())
    children=[];tunnel_pid=None
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def healthy():
        try:
            with opener.open(f'http://127.0.0.1:{port}/api/health',timeout=2) as response:
                if json.load(response).get('ok') is not True:return False
            request=urllib.request.Request(f'http://127.0.0.1:{port}/api/bootstrap',data=b'{}',headers={'Content-Type':'application/json','X-Forma-Request':'1'})
            with opener.open(request,timeout=2) as response:return json.load(response).get('apiVersion')==1
        except (OSError,ValueError):return False
    def status(phase):
        temporary=data/'status.tmp'
        temporary.write_text(json.dumps({'phase':phase,'checked_at':time.time(),'port':port,
            'public_url':config.get('public_url',''),'app_pid':children[0].pid if children else None,
            'tunnel_pid':tunnel_pid}))
        temporary.replace(data/'status.json')
    try:
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            probe.bind(('127.0.0.1',port))
        # No shell or detached process group: Service Base owns the whole tree.
        children.append(start_child([sys.executable,'-m','backend'],cwd=app,env=env))
        deadline=time.monotonic()+20
        while not stopped.is_set() and not healthy():
            if children[0].poll() is not None or time.monotonic()>deadline:raise RuntimeError('Application did not become healthy')
            stopped.wait(.25)
        if stopped.is_set():return
        if config.get('frpc_config'):
            binary=Path(config['frpc_binary']).expanduser();tunnel=Path(config['frpc_config']).expanduser()
            if not binary.is_file() or not tunnel.is_file():raise ValueError('FRP runtime/config is unavailable')
            children.append(start_child([str(binary),'-c',str(tunnel)]))
            tunnel_pid=children[-1].pid
            if stopped.wait(1):return
            if children[-1].poll() is not None:raise RuntimeError('FRP client failed to start')
        if sys.platform=='darwin' and config.get('keep_awake',True) and shutil.which('caffeinate'):
            children.append(start_child(['caffeinate','-i','-s','-w',str(children[0].pid)]))
        status('ready');emit('ready')
        failures=0
        while not stopped.wait(interval):
            if any(child.poll() is not None for child in children):raise RuntimeError('A managed process exited')
            if healthy():failures=0;status('running');emit('heartbeat')
            else:
                failures+=1
                if failures>=2:raise RuntimeError('Application health check failed')
    finally:
        status('stopping')
        for child in reversed(children):
            if child.poll() is None:child.terminate()
        deadline=time.monotonic()+8
        for child in reversed(children):
            try:child.wait(timeout=max(.1,deadline-time.monotonic()))
            except subprocess.TimeoutExpired:child.kill();child.wait()
        status('stopped')


if __name__=='__main__':run()
