from pathlib import Path
import socket,threading,subprocess,base64,hashlib,json,os
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out=Path('/tmp/xlog-review-verification-20261028-12824393/native')
fixture=out/('tci-loopback-'+str(os.getpid()))
fixture.mkdir(mode=0o700)
listener=socket.socket()
listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(15)
port=listener.getsockname()[1]
events=[]
def server():
    try:
        connection,_=listener.accept();connection.settimeout(15)
        with connection:
            request=b''
            while b'\r\n\r\n' not in request:
                chunk=connection.recv(4096)
                if not chunk:raise RuntimeError('HTTP handshake ended')
                request+=chunk
                if len(request)>16384:raise RuntimeError('HTTP handshake too large')
            headers=dict(line.split(':',1) for line in request.decode().split('\r\n')[1:] if ':' in line)
            key=next(v.strip() for k,v in headers.items() if k.lower()=='sec-websocket-key')
            accept=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            connection.sendall(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n').encode())
            (fixture/'handshake.ok').write_text('loopback-only WebSocket accepted\n');events.append('handshake')
            while True:
                data=connection.recv(4096)
                if not data or data[0]&15==8:
                    (fixture/'closed.ok').write_text('peer closed WebSocket\n');events.append('closed')
                    if data:connection.sendall(b'\x88\x00')
                    return
                events.append({'clientFrameOpcode':data[0]&15,'bytes':len(data)})
    except Exception as e:events.append({'error':str(e)})
thread=threading.Thread(target=server,daemon=True);thread.start()
cmd=['swift','-I',str(root/'.build/prototype-tests/debug'),'-I',str(root/'Sources/CSQLitePrototype'),'-I',str(out),'-L',str(out),'-lReviewNative','-Xlinker','-rpath','-Xlinker',str(out),str(out/'verify_tci_shutdown.swift'),str(fixture),str(port)]
(out/'tci-loopback-command.json').write_text(json.dumps(cmd,indent=2)+'\n')
with (out/'tci-loopback-result.log').open('w') as log:
    try:result=subprocess.run(cmd,cwd=root,stdout=log,stderr=subprocess.STDOUT,timeout=20)
    except subprocess.TimeoutExpired:
        listener.close();raise
thread.join(timeout=1);listener.close()
(out/'tci-loopback-server.json').write_text(json.dumps({'port':port,'fixture':str(fixture),'events':events},indent=2)+'\n')
print('TCI loopback lifecycle exit',result.returncode)
raise SystemExit(result.returncode)
