"""Publish an immutable MusicXML/PDF snapshot in one GitHub commit.

Credentials and destination configuration stay on the server. GitHub CLI handles
authentication; Git data APIs avoid touching a user's checkout or staging area.
"""
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import unicodedata
from urllib.parse import quote
import uuid
import xml.etree.ElementTree as ET


class PublishError(ValueError):
    pass


class GitHubError(PublishError):
    pass


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temp, path)


def md(value):
    return re.sub(r'([\\`*_{}\[\]<>#|])', r'\\\1', str(value).replace('\n', ' ').replace('\r', ' '))


def score_slug(title):
    """A readable single directory name that also works on Windows and macOS."""
    name = unicodedata.normalize('NFC', str(title))
    name = re.sub(r'[<>:"/\\|?*]', ' - ', name)
    name = ''.join(c for c in name if not unicodedata.category(c).startswith('C'))
    name = re.sub(r'\s+', ' ', name).strip().rstrip(' .') or 'Untitled'
    if name.casefold() == '.git':
        name = 'Score - ' + name
    if re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?', name, re.I):
        name = 'Score - ' + name
    while len(name) > 100 or len(name.encode('utf-8')) > 200:
        name = name[:-1]
    return name.rstrip(' .') or 'Untitled'


def valid_score_slug(name):
    return isinstance(name, str) and name == score_slug(name)


def unique_score_slug(title, used):
    occupied = {unicodedata.normalize('NFC', name).casefold() for name in used}
    base = score_slug(title)
    candidate = base
    number = 2
    while candidate.casefold() in occupied:
        suffix = f' ({number})'
        stem = base
        while len(stem + suffix) > 100 or len((stem + suffix).encode('utf-8')) > 200:
            stem = stem[:-1]
        candidate = stem.rstrip(' .') + suffix
        number += 1
    return candidate


def score_info(xml):
    root = ET.fromstring(xml)
    part = root.find('part')
    if part is None:
        raise PublishError('乐谱没有可发布的声部。')
    tuning = []
    for item in sorted(part.findall('.//staff-tuning'), key=lambda n: int(n.get('line', '0'))):
        accidental = {'1': '#', '-1': 'b'}.get(item.findtext('tuning-alter', '0'), '')
        tuning.append(item.findtext('tuning-step', '') + accidental + item.findtext('tuning-octave', ''))
    # The initial staff-details describes the instrument; subsequent tuning changes
    # remain in the MusicXML rather than being concatenated into the catalog.
    details = part.find('.//staff-details')
    strings = int(details.findtext('staff-lines', '0')) if details is not None else 0
    tuning = tuning[:strings] if strings else []
    tempo = part.find('.//sound[@tempo]')
    return {
        'title': root.findtext('./work/work-title') or root.findtext('movement-title') or 'Untitled',
        'instrument': root.findtext('./part-list/score-part/part-name', 'TAB'),
        'tuning': tuning, 'measures': len(part.findall('measure')),
        'meter': part.findtext('.//time/beats', '4') + '/' + part.findtext('.//time/beat-type', '4'),
        'tempo': tempo.get('tempo') if tempo is not None else '120',
    }


def replace_section(text, name, content, heading=None):
    start, end = f'<!-- localtab:{name}:start -->', f'<!-- localtab:{name}:end -->'
    block = start + '\n' + content.rstrip() + '\n' + end
    if start in text and end in text:
        return text[:text.index(start)] + block + text[text.index(end) + len(end):]
    if heading:
        pattern = rf'(?ms)^## {re.escape(heading)}\s*\n.*?(?=^## |\Z)'
        match = re.search(pattern, text)
        if match:
            return text[:match.start()] + block + '\n\n' + text[match.end():]
    return text.rstrip() + '\n\n' + block + '\n'


class Publisher:
    def __init__(self, root):
        self.root = Path(root)
        self.local = self.root / '.local'
        self.work = self.local / 'publish'
        self.lock = threading.RLock()

    def config(self):
        path = self.local / 'publish.json'
        if not path.exists():
            raise PublishError('尚未设置公开仓库。请按 README 的发布设置，在服务端配置 .local/publish.json。')
        config = json.loads(path.read_text(encoding='utf-8-sig'))
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', config.get('repository', '')):
            raise PublishError('发布仓库应使用 owner/repository 格式。')
        if config.get('repository', '').endswith('/.') or '..' in config['repository']:
            raise PublishError('发布仓库名称无效。')
        config.setdefault('branch', 'main')
        if not isinstance(config['branch'], str) or not config['branch'] or len(config['branch']) > 200:
            raise PublishError('发布分支无效。')
        return config

    def cli(self):
        candidate = self.local / 'tools/gh/bin/gh.exe'
        executable = str(candidate) if candidate.exists() else shutil.which('gh')
        if not executable:
            raise PublishError('发布需要 GitHub CLI。请在服务端安装 gh 并运行 gh auth login。')
        env = dict(os.environ)
        saved = self.local / 'github-cli'
        if not env.get('GH_CONFIG_DIR') and (saved / 'hosts.yml').exists():
            env['GH_CONFIG_DIR'] = str(saved)
        env['GH_PROMPT_DISABLED'] = '1'
        return executable, env

    def api(self, endpoint, method='GET', data=None):
        executable, env = self.cli()
        command = [executable, 'api', '--hostname', 'github.com', '--method', method, endpoint]
        if data is not None:
            command.extend(['--input', '-'])
        try:
            result = subprocess.run(command, input=json.dumps(data) if data is not None else None,
                capture_output=True, text=True, encoding='utf-8', timeout=60, env=env,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise GitHubError('GitHub 请求失败或超时，请检查网络后重试。') from error
        if result.returncode:
            # Never return stdout: it could be a credential or unexpected CLI output.
            status = re.search(r'HTTP (\d+)', result.stderr)
            code = status.group(1) if status else '连接/授权'
            raise GitHubError(f'GitHub 请求失败（{code}）。请检查服务端 gh 登录、仓库权限或网络后重试。')
        return json.loads(result.stdout)

    def state(self):
        path = self.work / 'state.json'
        return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}

    def status(self, project_id):
        try:
            config = self.config()
            self.cli()
            self.load_playwright()
            previous = self.state().get(project_id)
            if previous and previous['repository'] != config['repository']:
                previous = None
            return {'ready': True, 'repository': config['repository'], 'lastPublished': previous}
        except (PublishError, ValueError) as error:
            return {'ready': False, 'error': str(error)}

    def load_playwright(self):
        packages = str(self.local / 'python')
        if Path(packages).is_dir() and packages not in sys.path:
            sys.path.insert(0, packages)
        if importlib.util.find_spec('playwright') is None:
            raise PublishError('自动 PDF 需要服务端安装依赖：python -m pip install -r requirements-publish.txt')

    def draft_path(self, ident):
        if not re.fullmatch('[a-f0-9]{32}', ident):
            raise PublishError('发布预览编号无效。')
        return self.work / 'drafts' / ident

    def draft(self, ident):
        path = self.draft_path(ident) / 'snapshot.json'
        if not path.exists():
            raise PublishError('发布预览不存在，请重新生成。')
        return json.loads(path.read_text(encoding='utf-8'))

    def render_pdf(self, ident, base_url):
        self.load_playwright()
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = None
            for channel in ['chrome', 'msedge', None]:
                try:
                    browser = pw.chromium.launch(headless=True, channel=channel)
                    break
                except Exception:
                    continue
            if browser is None:
                raise PublishError('生成 PDF 需要服务端安装 Chrome / Edge，或运行 python -m playwright install chromium。')
            try:
                page = browser.new_page(viewport={'width': 1000, 'height': 800}, device_scale_factor=1)
                # Export only local app assets; an imported score cannot cause network fetches.
                page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base_url + '/') else route.abort())
                page.goto(base_url + '/print.html?draft=' + ident, wait_until='load', timeout=45000)
                page.wait_for_function('window.localTabPrintState?.ready || window.localTabPrintState?.error', timeout=60000)
                state = page.evaluate('window.localTabPrintState')
                if state.get('error'):
                    raise PublishError('PDF 排版失败：' + state['error'])
                page.pdf(path=str(self.draft_path(ident) / 'score.pdf'), format='A4',
                    prefer_css_page_size=True, print_background=True, display_header_footer=True,
                    header_template='<span></span>',
                    footer_template='<div style="width:100%;text-align:center;font-size:9px;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>')
            except PublishError:
                raise
            except Exception as error:
                raise PublishError('PDF 生成失败，请重新生成预览。' + str(error).splitlines()[0][:150]) from error
            finally:
                browser.close()

    def prepare(self, project_id, data, base_url):
        config = self.config()
        if len(ET.fromstring(data['xml']).findall('part')) != 1:
            raise PublishError('当前 PDF 发布支持单乐器乐谱；请先导出所需分谱。')
        if not re.fullmatch('[a-zA-Z0-9_-]{1,100}', project_id):
            raise PublishError('项目编号无效。')
        state = self.state()
        previous = state.get(project_id, {})
        # Keep published links stable even after the score title changes.
        if previous.get('repository') == config['repository'] and previous.get('slug'):
            slug = previous['slug']
        else:
            slug = unique_score_slug(data['project']['title'],
                [entry['slug'] for entry in state.values()
                 if entry.get('repository') == config['repository'] and entry.get('slug')])
        if not valid_score_slug(slug):
            raise PublishError('公开目录名称无效，请检查本地发布记录。')
        ident = uuid.uuid4().hex
        folder = self.draft_path(ident)
        folder.mkdir(parents=True)
        info = score_info(data['xml'])
        info['title'] = data['project']['title']
        snapshot = {'id': ident, 'projectId': project_id, 'revision': data['revision'],
                    'repository': config['repository'], 'branch': config['branch'],
                    'slug': slug, 'xml': data['xml'], 'info': info,
                    'created': datetime.now(timezone.utc).isoformat(timespec='seconds')}
        write_json(folder / 'snapshot.json', snapshot)
        self.render_pdf(ident, base_url)
        pdf = (folder / 'score.pdf').read_bytes()
        if not pdf.startswith(b'%PDF-') or len(pdf) < 500:
            raise PublishError('生成的 PDF 无效，请重新生成。')
        snapshot['ready'] = True
        write_json(folder / 'snapshot.json', snapshot)
        return {'draftId': ident, 'title': info['title'], 'repository': config['repository'],
                'previewUrl': f'/api/publish/preview/{ident}.pdf', 'slug': slug}

    @staticmethod
    def blob_sha(content):
        return hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()

    def links(self, draft):
        base = 'https://github.com/' + draft['repository']
        ref = quote(draft['branch'], safe='')
        folder = '/scores/' + quote(draft['slug'], safe='')
        return {'url': base + '/tree/' + ref + folder,
                'pdfUrl': base + '/blob/' + ref + folder + '/score.pdf',
                'xmlUrl': base + '/blob/' + ref + folder + '/score.musicxml'}

    def build_files(self, draft, tree, read):
        if not valid_score_slug(draft['slug']):
            raise PublishError('公开目录名称无效。')
        catalog_path = 'catalog.json'
        catalog = json.loads(read(catalog_path)) if catalog_path in tree else {'schemaVersion': 1, 'scores': {}}
        if catalog.get('schemaVersion') != 1 or not isinstance(catalog.get('scores'), dict):
            raise PublishError('公开库 catalog.json 格式不支持，未修改远端内容。')
        scores = catalog['scores']
        for path in tree:
            match = re.fullmatch(r'scores/([^/]+)/score.musicxml', path)
            if match and valid_score_slug(match[1]) and match[1] not in scores:
                scores[match[1]] = score_info(read(path))
        # Exclude stale catalog rows whose MusicXML no longer exists.
        scores = {slug: info for slug, info in scores.items()
                  if valid_score_slug(slug) and f'scores/{slug}/score.musicxml' in tree}
        scores[draft['slug']] = {**scores.get(draft['slug'], {}), **draft['info'], 'publishedAt': draft['created']}
        catalog['scores'] = scores
        folder = 'scores/' + draft['slug']
        base = 'https://github.com/' + draft['repository']
        ref = quote(draft['branch'], safe='')
        rows = []
        for slug, info in sorted(scores.items(), key=lambda item: item[1]['title'].casefold()):
            path = 'scores/' + quote(slug, safe='')
            pdf = f' · [PDF]({path}/score.pdf)' if f'scores/{slug}/score.pdf' in tree or slug == draft['slug'] else ''
            rows.append(f"| {md(info['title'])} | {md(info.get('instrument', 'TAB'))} | {md(' '.join(info.get('tuning', [])))} | [Page / 页面]({path}/README.md) · [MusicXML]({path}/score.musicxml){pdf} |")
        table = '| Score / 曲谱 | Instrument / 乐器 | Tuning / 调弦 | Downloads / 下载 |\n| --- | --- | --- | --- |\n' + '\n'.join(rows)
        files = {
            folder + '/score.musicxml': draft['xml'].encode('utf-8'),
            folder + '/score.pdf': (self.draft_path(draft['id']) / 'score.pdf').read_bytes(),
            catalog_path: (json.dumps(catalog, ensure_ascii=False, indent=2) + '\n').encode('utf-8'),
        }
        for filename, heading in [('README.md', 'Score index'), ('README.zh-CN.md', '曲谱目录')]:
            original = read(filename).decode('utf-8-sig') if filename in tree else '# LocalTab-Scores\n'
            files[filename] = replace_section(original, 'catalog', f'## {heading}\n\n' + table, heading).encode('utf-8')
        filename = folder + '/README.md'
        original = read(filename).decode('utf-8-sig') if filename in tree else '# ' + md(draft['info']['title']) + '\n\n[曲谱目录 / Score index](../../README.md)\n'
        info = draft['info']
        downloads = ('## 下载 / Downloads\n\n**[PDF 预览与下载 / View PDF](score.pdf)** · **[MusicXML](score.musicxml)**\n\n'
                     + md(info['title']) + '\n\n'
                     + f"{md(info['instrument'])} · {info['measures']} 小节 / measures · {md(info['meter'])} · ♩ = {md(info['tempo'])}\n\n"
                     + '调弦 / Tuning: ' + md(' '.join(info['tuning'])) + '\n\n'
                     + '更新 / Updated: ' + draft['created'] + '\n\n'
                     + '由 LocalTab 发布 MusicXML 与 PDF。原作品权利归相应权利人；软件 MIT 许可证不适用于乐谱。\n'
                     + 'Published with LocalTab. Composition rights remain with their owners; the software MIT license does not apply to scores.')
        # Keep hand-written notes. The publisher owns only its marked section.
        files[filename] = replace_section(original, 'downloads', downloads).encode('utf-8')
        return files

    def publish(self, ident, current_revision):
        with self.lock:
            draft = self.draft(ident)
            if not draft.get('ready'):
                raise PublishError('PDF 预览尚未完成，请重新生成。')
            if draft['revision'] != current_revision:
                raise PublishError('乐谱在预览生成后已变化，请关闭窗口并重新生成预览。')
            config = self.config()
            if (config['repository'], config['branch']) != (draft['repository'], draft['branch']):
                raise PublishError('发布目标已改变，请重新生成预览。')
            if not valid_score_slug(draft['slug']):
                raise PublishError('公开目录名称无效。')
            previous = self.state().get(draft['projectId'], {})
            if previous.get('repository') == config['repository'] and previous.get('slug') != draft['slug']:
                raise PublishError('公开目录已改名，请重新生成预览。')
            endpoint = '/repos/' + config['repository']
            repo = self.api(endpoint)
            if repo.get('private'):
                raise PublishError('目标不是公开仓库，请在服务端设置公开曲谱库。')
            branch = quote(config['branch'], safe='')
            # Retry a non-fast-forward race by rebuilding against the latest tree.
            for attempt in range(3):
                head = self.api(endpoint + '/git/ref/heads/' + branch)['object']['sha']
                commit = self.api(endpoint + '/git/commits/' + head)
                remote = self.api(endpoint + '/git/trees/' + commit['tree']['sha'] + '?recursive=1')
                if remote.get('truncated'):
                    raise PublishError('公开库目录过大，无法完整读取；未修改远端内容。')
                tree = {item['path']: item for item in remote['tree'] if item['type'] == 'blob'}
                cache = {}
                def read(path):
                    if path not in cache:
                        blob = self.api(endpoint + '/git/blobs/' + tree[path]['sha'])
                        cache[path] = base64.b64decode(blob['content'])
                    return cache[path]
                target = 'scores/' + draft['slug'] + '/score.musicxml'
                previous = self.state().get(draft['projectId'], {})
                if target in tree and previous.get('repository') != config['repository']:
                    # Adopt an existing entry only when it is this exact score.
                    if read(target).decode('utf-8-sig').replace('\r\n', '\n') != draft['xml'].replace('\r\n', '\n'):
                        raise PublishError('该公开地址已有不同的乐谱，未覆盖。请检查本地发布记录或目标仓库。')
                files = self.build_files(draft, tree, read)
                changes = []
                for path, content in files.items():
                    if tree.get(path, {}).get('sha') == self.blob_sha(content):
                        continue
                    blob = self.api(endpoint + '/git/blobs', 'POST', {'encoding': 'base64', 'content': base64.b64encode(content).decode()})
                    changes.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
                if changes:
                    new_tree = self.api(endpoint + '/git/trees', 'POST', {'base_tree': commit['tree']['sha'], 'tree': changes})
                    new_commit = self.api(endpoint + '/git/commits', 'POST', {
                        'message': 'Publish score: ' + draft['info']['title'], 'tree': new_tree['sha'], 'parents': [head]})
                    try:
                        self.api(endpoint + '/git/refs/heads/' + branch, 'PATCH', {'sha': new_commit['sha'], 'force': False})
                    except GitHubError:
                        # The server may have accepted an update before a timeout.
                        # Re-reading and comparing blobs makes retries idempotent.
                        if attempt < 2:
                            continue
                        raise
                    head = new_commit['sha']
                result = {**self.links(draft), 'repository': config['repository'], 'slug': draft['slug'],
                          'commit': head, 'publishedAt': draft['created'], 'revision': draft['revision']}
                state = self.state()
                state[draft['projectId']] = result
                write_json(self.work / 'state.json', state)
                return result
            raise PublishError('公开库更新冲突，请稍后重试。')
