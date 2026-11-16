"""Local/LAN score workspace. Python 3.10+, standard library only."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse, unquote, parse_qs
import argparse, base64, hashlib, io, json, mimetypes, os, re, secrets, socket, threading, time, uuid, webbrowser, zipfile
import xml.etree.ElementTree as ET
from publishing import Publisher

ROOT=Path(__file__).resolve().parent
LIBRARY=ROOT/'library'
TOKEN=secrets.token_urlsafe(32)
LOCK=threading.RLock()

class LocalTabHTTPServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR permits two listeners on one port, mixing save tokens.
    # Keep a single owner so Start.cmd can reliably detect an existing instance.
    allow_reuse_address = os.name != 'nt'
    def __init__(self, *args, **kwargs):
        self.allowed_hostnames = {'localhost', socket.gethostname().lower(), socket.getfqdn().lower()}
        self.publisher = Publisher(ROOT)
        super().__init__(*args, **kwargs)
    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

def read_project(folder):
    xml=(folder/'score.musicxml').read_text(encoding='utf-8')
    project=json.loads((folder/'project.json').read_text(encoding='utf-8'))
    rev=hashlib.sha256((xml+json.dumps(project,sort_keys=True)).encode()).hexdigest()
    return {'id':folder.name,'xml':xml,'project':project,'revision':rev}

def timestamp(value):
    """Normalize persisted ISO timestamps without trusting client-side clocks."""
    if not isinstance(value, str): return None
    try:
        parsed=datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None: parsed=parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except (ValueError, OverflowError): return None

def timestamp_now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def project_summary(folder, project=None):
    """List metadata without loading notation or rewriting legacy projects."""
    if project is None:
        project=json.loads((folder/'project.json').read_text(encoding='utf-8'))
    source=project.get('sourceMetadata')
    source=source if isinstance(source, dict) else {}
    created=timestamp(project.get('createdAt')) or timestamp(source.get('importedAt'))
    updated=timestamp(project.get('updatedAt'))
    if not created or not updated:
        stats=[(folder/name).stat() for name in ('project.json', 'score.musicxml')]
        if not created:
            stat=folder.stat()
            # Windows ctime is creation time on older supported Python versions.
            born=getattr(stat, 'st_birthtime', None)
            if born is None: born=stat.st_ctime if os.name == 'nt' else min(s.st_mtime for s in stats)
            created=datetime.fromtimestamp(born, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        if not updated:
            modified=max(s.st_mtime for s in stats)
            updated=datetime.fromtimestamp(modified, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    return {'id':folder.name, 'title':project['title'], 'createdAt':created, 'updatedAt':updated}

def valid_xml(text):
    if len(text)>20_000_000 or '<!ENTITY' in text.upper(): raise ValueError('乐谱过大或含不支持的实体定义')
    root=ET.fromstring(text)
    if root.tag.split('}')[-1]!='score-partwise': raise ValueError('请选择 partwise MusicXML 乐谱')
    return root

def atomic(path,data):
    tmp=path.with_name(path.name+'.tmp')
    tmp.write_text(data,encoding='utf-8',newline='\n')
    os.replace(tmp,path)

def new_xml(title,tuning,bars,tempo=120,beats=4,unit=4):
    from xml.sax.saxutils import escape
    if type(bars) is not int or not 1 <= bars <= 200:
        raise ValueError('初始小节数应为 1–200 的整数')
    if type(beats) is not int or not 1 <= beats <= 32 or type(unit) is not int or unit not in (1,2,4,8,16):
        raise ValueError('拍号分子 1–32，分母 1/2/4/8/16')
    if type(tempo) not in (int,float) or not 20 <= tempo <= 300:
        raise ValueError('速度范围为 20–300 BPM（四分音符 / 分钟）')
    tempo=f'{tempo:g}'
    note_type={1:'whole',2:'half',4:'quarter',8:'eighth',16:'16th'}[unit]
    details=[]
    for i,n in enumerate(tuning):
        match=re.fullmatch(r'([A-Ga-g])([#b]?)([0-8])',n)
        if not match: raise ValueError('调弦格式应为 E1、F#1 或 Bb0')
        step,acc,octave=match.groups()
        details.append(f'<staff-tuning line="{i+1}"><tuning-step>{step.upper()}</tuning-step><tuning-alter>{1 if acc=="#" else -1 if acc=="b" else 0}</tuning-alter><tuning-octave>{octave}</tuning-octave></staff-tuning>')
    clef='G' if len(tuning)==6 else 'F'
    measure=''
    for i in range(bars):
        attrs=f'<attributes><divisions>480</divisions><key><fifths>0</fifths></key><time><beats>{beats}</beats><beat-type>{unit}</beat-type></time><clef><sign>{clef}</sign><line>{2 if clef=="G" else 4}</line><clef-octave-change>-1</clef-octave-change></clef><staff-details><staff-lines>{len(tuning)}</staff-lines>{"".join(details)}</staff-details></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>{tempo}</per-minute></metronome></direction-type><sound tempo="{tempo}"/></direction>' if i==0 else ''
        notes=f'<note><rest/><duration>{1920//unit}</duration><voice>1</voice><type>{note_type}</type></note>'*beats
        measure+=f'<measure number="{i+1}">{attrs}{notes}</measure>'
    root=ET.fromstring(f'<score-partwise version="4.0"><work><work-title>{escape(title)}</work-title></work><part-list><score-part id="P1"><part-name>{"Guitar" if clef=="G" else "Bass"}</part-name></score-part></part-list><part id="P1">{measure}</part></score-partwise>')
    ET.indent(root,space='  ')
    return '<?xml version="1.0" encoding="UTF-8"?>\n'+ET.tostring(root,encoding='unicode')+'\n'

class Handler(BaseHTTPRequestHandler):
    def log_message(self,fmt,*args): print(time.strftime('%H:%M:%S'),self.client_address[0],fmt%args,flush=True)
    def json(self,status,data):
        body=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(body))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
    def allowed(self,write=False):
        # No login or password. Hosts include the actual receiving interface,
        # so LAN IPs and DHCP changes work without accepting arbitrary domains.
        names = self.server.allowed_hostnames | {'127.0.0.1', self.connection.getsockname()[0]}
        authorities = {f'{name}:{self.server.server_port}' for name in names}
        host=self.headers.get('Host','').lower()
        if host not in authorities:
            self.json(403,{'error':'请使用这台电脑的 IP 地址或主机名访问'}); return False
        # This automatically issued token is CSRF protection, not authentication.
        if write and self.headers.get('X-Local-Token')!=TOKEN:
            self.json(403,{'error':'请刷新本地页面后重试'}); return False
        origin=self.headers.get('Origin')
        if origin and origin.lower() != f'http://{host}':
            self.json(403,{'error':'不接受其他网站的请求'}); return False
        return True
    def folder(self,ident):
        if not re.fullmatch('[a-zA-Z0-9_-]{1,100}',ident): raise ValueError('无效项目名')
        folder=LIBRARY/ident
        if not (folder/'project.json').exists(): raise ValueError('项目不存在')
        return folder
    def body(self,limit=80_000_000):
        length=int(self.headers.get('Content-Length','0'))
        if length<0 or length>limit: raise ValueError('文件过大')
        return self.rfile.read(length)
    def do_GET(self):
        if not self.allowed(): return
        path=unquote(urlparse(self.path).path)
        try:
            if path=='/api/session': return self.json(200,{'app':'local-tab-studio','version':'0.9.0','token':TOKEN})
            if path.startswith('/api/publish/status/'):
                folder=self.folder(path.split('/')[-1])
                return self.json(200,self.server.publisher.status(folder.name))
            if path.startswith('/api/publish/snapshot/'):
                draft=self.server.publisher.draft(path.split('/')[-1])
                return self.json(200,{'xml':draft['xml'],'project':{'title':draft['info']['title']}})
            if path=='/api/projects':
                items=[]
                with LOCK:
                    for folder in sorted(LIBRARY.iterdir()):
                        if (folder/'project.json').exists():
                            items.append(project_summary(folder))
                return self.json(200,items)
            if path.startswith('/api/project/'):
                with LOCK:
                    folder=self.folder(path.split('/')[-1]); data=read_project(folder)
                    data['summary']=project_summary(folder, data['project'])
                return self.json(200,data)
            roots={'public':ROOT/'public','vendor':ROOT/'vendor','library':LIBRARY}
            if path.startswith('/api/publish/preview/'):
                ident=path.split('/')[-1].removesuffix('.pdf')
                base=self.server.publisher.draft_path(ident); rel='score.pdf'
            elif path.startswith('/vendor/'): base=roots['vendor']; rel=path[8:]
            elif path.startswith('/library/'):
                base=roots['library']; rel=path[9:]
                if any(p.startswith('.') for p in Path(rel).parts): raise ValueError('无效路径')
            else: base=roots['public']; rel=path.lstrip('/') or 'index.html'
            file=(base/rel).resolve()
            if not file.is_relative_to(base.resolve()) or not file.is_file(): return self.json(404,{'error':'未找到文件'})
            size=file.stat().st_size; start=0; end=size-1; status=200
            ran=self.headers.get('Range')
            if ran:
                match=re.fullmatch(r'bytes=(\d+)-(\d*)',ran)
                if not match: self.send_error(416); return
                start=int(match[1]); end=min(int(match[2]) if match[2] else end,end)
                if start>end: self.send_error(416); return
                status=206
            self.send_response(status)
            self.send_header('Content-Type',mimetypes.guess_type(file)[0] or 'application/octet-stream')
            self.send_header('Content-Length',str(end-start+1)); self.send_header('Accept-Ranges','bytes')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Cache-Control','no-cache')
            if status==206:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
            self.end_headers()
            with file.open('rb') as f:
                f.seek(start); remain=end-start+1
                while remain:
                    data=f.read(min(remain,65536))
                    if not data:break
                    self.wfile.write(data); remain-=len(data)
        except (ValueError,ET.ParseError) as e:self.json(400,{'error':str(e)})
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):pass
        except Exception as e:self.json(500,{'error':str(e)})
    def do_PUT(self):
        if not self.allowed(True):return
        try:
            path=urlparse(self.path).path
            if not path.startswith('/api/project/'):return self.json(404,{'error':'无效路径'})
            data=json.loads(self.body(25_000_000)); valid_xml(data['xml'])
            project=data['project']
            if not isinstance(project.get('title'),str) or not isinstance(project.get('recordings'),list):raise ValueError('项目结构无效')
            with LOCK:
                folder=self.folder(path.split('/')[-1]); old=read_project(folder)
                if data.get('revision')!=old['revision']:return self.json(409,{'error':'文件已在其他窗口或程序中更改。请先导出当前 MusicXML 备份，然后重新加载项目。'})
                project['createdAt']=project_summary(folder, old['project'])['createdAt']
                project['updatedAt']=timestamp_now()
                backup=ROOT/'.local'/'backups'/folder.name; backup.mkdir(parents=True,exist_ok=True)
                atomic(backup/f'{time.time_ns()}.json',json.dumps(old,ensure_ascii=False,indent=2))
                atomic(folder/'score.musicxml',data['xml'])
                atomic(folder/'project.json',json.dumps(project,ensure_ascii=False,indent=2)+'\n')
                updated=read_project(folder)
            self.json(200,{'revision':updated['revision'], 'summary':project_summary(folder, updated['project'])})
        except (ValueError,KeyError,ET.ParseError) as e:self.json(400,{'error':str(e)})
        except Exception as e:self.json(500,{'error':str(e)})
    def do_POST(self):
        if not self.allowed(True):return
        try:
            url=urlparse(self.path); path=url.path
            if path.startswith('/api/audio/'):
                folder=self.folder(path.split('/')[-1]); name=parse_qs(url.query).get('name',['录音.mp3'])[0]
                content=self.body(); filename=uuid.uuid4().hex[:12]+'.mp3'
                (folder/'audio').mkdir(exist_ok=True); (folder/'audio'/filename).write_bytes(content)
                return self.json(201,{'id':uuid.uuid4().hex,'file':'audio/'+filename,'name':Path(name).stem})
            data=json.loads(self.body())
            if path.startswith('/api/publish/prepare/'):
                folder=self.folder(path.split('/')[-1])
                with LOCK:
                    saved=read_project(folder)
                    if data.get('revision')!=saved['revision']:
                        return self.json(409,{'error':'乐谱已在其他窗口更改，请重新加载后再发布。'})
                host=self.server.server_address[0]
                base_url=f'http://{("127.0.0.1" if host=="0.0.0.0" else host)}:{self.server.server_port}'
                return self.json(201,self.server.publisher.prepare(folder.name,saved,base_url))
            if path.startswith('/api/publish/commit/'):
                folder=self.folder(path.split('/')[-1])
                ident=data.get('draftId','')
                with LOCK:
                    draft=self.server.publisher.draft(ident)
                    if draft['projectId']!=folder.name: raise ValueError('预览与当前乐谱不匹配。')
                    saved=read_project(folder)
                    return self.json(200,self.server.publisher.publish(ident,saved['revision']))
            if path=='/api/import':
                raw=base64.b64decode(data['data'])
                if raw[:2]==b'PK':
                    with zipfile.ZipFile(io.BytesIO(raw)) as z:
                        container=ET.fromstring(z.read('META-INF/container.xml'))
                        rootfile=next(e.get('full-path') for e in container.iter() if e.tag.split('}')[-1]=='rootfile')
                        if z.getinfo(rootfile).file_size>20_000_000:raise ValueError('解压后的乐谱过大')
                        raw=z.read(rootfile)
                xml=raw.decode('utf-8-sig'); root=valid_xml(xml)
                title=next((e.text for e in root.iter() if e.tag.split('}')[-1]=='work-title'),None) or Path(data['name']).stem
            elif path=='/api/new':
                title=str(data.get('title','新乐谱')).strip() or '新乐谱'
                tuning=data.get('tuning',['B0','E1','A1','D2','G2'])
                if len(tuning) not in (4,5,6):raise ValueError('原型支持4、5、6弦')
                xml=new_xml(title,tuning,data.get('bars',8),data.get('tempo',120),data.get('beats',4),data.get('unit',4))
            else:return self.json(404,{'error':'无效路径'})
            ident='score-'+uuid.uuid4().hex[:10]; folder=LIBRARY/ident
            folder.mkdir(parents=True); (folder/'audio').mkdir()
            atomic(folder/'score.musicxml',xml)
            created=timestamp_now()
            project={'schemaVersion':1,'title':title,'recordings':[], 'createdAt':created,'updatedAt':created}
            atomic(folder/'project.json',json.dumps(project,ensure_ascii=False,indent=2)+'\n')
            self.json(201,{'id':ident, 'summary':project_summary(folder, project)})
        except (ValueError,KeyError,ET.ParseError,zipfile.BadZipFile) as e:self.json(400,{'error':str(e)})
        except Exception as e:self.json(500,{'error':str(e)})

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--host',default='0.0.0.0',help='Bind address; use 127.0.0.1 for this computer only'); parser.add_argument('--port',type=int,default=8767); parser.add_argument('--open',action='store_true'); args=parser.parse_args()
    LIBRARY.mkdir(exist_ok=True)
    url=f'http://{("127.0.0.1" if args.host == "0.0.0.0" else args.host)}:{args.port}'
    try:
        server=LocalTabHTTPServer((args.host,args.port),Handler)
    except OSError:
        if args.open:
            from urllib.request import urlopen
            try:
                with urlopen(url+'/api/session',timeout=2) as response:
                    already_running=json.load(response).get('app')=='local-tab-studio'
                if already_running:
                    webbrowser.open(url)
                    print('Local Tab Studio is already running:',url)
                    raise SystemExit(0)
            except (OSError,ValueError):
                pass
        raise
    print('Local Tab Studio:',url,flush=True)
    if args.host == '0.0.0.0':
        try:
            addresses = sorted({entry[4][0] for entry in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_STREAM) if not entry[4][0].startswith('127.')})
            for address in addresses: print(f'LAN (no login): http://{address}:{args.port}',flush=True)
        except OSError: pass
    if args.open:threading.Timer(.5,lambda:webbrowser.open(url)).start()
    try:server.serve_forever()
    except KeyboardInterrupt:pass
