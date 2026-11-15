"""Real HTTP tests against an isolated temporary library (never user scores)."""
import base64
import contextlib
import http.client
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.old_root, cls.old_library = server.ROOT, server.LIBRARY
        server.ROOT = Path(cls.tmp.name)
        server.LIBRARY = server.ROOT / 'library'
        server.LIBRARY.mkdir()
        (server.ROOT / 'public').mkdir()
        (server.ROOT / 'public' / 'index.html').write_text('local prototype')
        cls.http = server.LocalTabHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.worker = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.worker.join()
        server.ROOT, server.LIBRARY = cls.old_root, cls.old_library
        cls.tmp.cleanup()

    def request(self, method, path, data=None, headers=None, token=True):
        conn = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
        fields = {'X-Local-Token': server.TOKEN} if token else {}
        fields.update(headers or {})
        if isinstance(data, dict):
            data = json.dumps(data).encode()
            fields['Content-Type'] = 'application/json'
        conn.request(method, path, body=data, headers=fields)
        response = conn.getresponse()
        body = response.read()
        result = (response.status, dict(response.getheaders()), body)
        conn.close()
        return result

    def create(self, strings=5):
        tuning = {4: ['E1','A1','D2','G2'], 5: ['B0','E1','A1','D2','G2'], 6: ['E2','A2','D3','G3','B3','E4']}[strings]
        status, _, body = self.request('POST', '/api/new', {'title': '测试 & étude', 'bars': 2, 'tuning': tuning})
        self.assertEqual(status, 201)
        return json.loads(body)['id']

    def test_server_port_has_a_single_owner(self):
        with self.assertRaises(OSError):
            duplicate = server.LocalTabHTTPServer(('127.0.0.1', self.http.server_port), server.Handler)
            duplicate.server_close()

    def test_publish_preview_endpoints_are_revision_checked_and_exclude_private_metadata(self):
        ident = self.create()
        saved = json.loads(self.request('GET', '/api/project/' + ident)[2])
        path = '/api/publish/prepare/' + ident
        self.assertEqual(self.request('POST', path, {'revision': saved['revision']}, token=False)[0], 403)
        self.assertEqual(self.request('POST', path, {'revision': 'old'})[0], 409)
        from publishing import write_json
        publisher = self.http.publisher
        write_json(server.ROOT / '.local/publish.json', {'repository': 'test/scores'})
        def render(draft_id, base):
            self.assertEqual(base, f'http://127.0.0.1:{self.http.server_port}')
            (publisher.draft_path(draft_id) / 'score.pdf').write_bytes(b'%PDF-1.7\n' + b'example' * 100)
        with patch.object(publisher, 'render_pdf', side_effect=render):
            status, _, body = self.request('POST', path, {'revision': saved['revision']})
        self.assertEqual(status, 201)
        draft = json.loads(body)
        status, headers, pdf = self.request('GET', draft['previewUrl'])
        self.assertEqual((status, headers['Content-Type']), (200, 'application/pdf'))
        self.assertTrue(pdf.startswith(b'%PDF-'))
        snapshot = json.loads(self.request('GET', '/api/publish/snapshot/' + draft['draftId'])[2])
        self.assertEqual(set(snapshot), {'xml', 'project'})
        self.assertEqual(set(snapshot['project']), {'title'})
        self.assertNotIn('token', json.dumps(snapshot))
        self.assertEqual(self.request('GET', '/api/publish/preview/..%2Fstate.json.pdf')[0], 400)
        saved['project']['title'] = 'A newer edit'
        self.assertEqual(self.request('PUT', '/api/project/' + ident, saved)[0], 200)
        with patch.object(publisher, 'api') as api:
            status, _, body = self.request('POST', '/api/publish/commit/' + ident, {'draftId': draft['draftId']})
        self.assertEqual(status, 400)
        api.assert_not_called()

    def test_create_all_instruments_and_save_with_conflict_backup(self):
        for strings in (4,5,6):
            ident = self.create(strings)
            status, _, body = self.request('GET', '/api/project/' + ident)
            self.assertEqual(status, 200)
            old = json.loads(body)
            root = server.valid_xml(old['xml'])
            self.assertEqual(len(root.findall('.//staff-tuning')), strings)
            self.assertEqual(len(root.findall('.//measure')), 2)
            old['project']['title'] = '编辑后的标题'
            self.assertEqual(self.request('PUT', '/api/project/' + ident, old)[0], 200)
            self.assertEqual(self.request('PUT', '/api/project/' + ident, old)[0], 409)
            backups = list((server.ROOT / '.local' / 'backups' / ident).glob('*.json'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(json.loads(backups[0].read_text(encoding='utf-8'))['project']['title'], '测试 & étude')

    def test_reject_foreign_origin_host_and_missing_token(self):
        data = {'title': 'blocked'}
        self.assertEqual(self.request('POST','/api/new',data,token=False)[0],403)
        self.assertEqual(self.request('POST','/api/new',data,{'Origin':'https://example.com'})[0],403)
        self.assertEqual(self.request('GET','/api/session',headers={'Host':'example.com'})[0],403)
        self.assertEqual(self.request('GET','/../server.py')[0],404)
        self.assertEqual(self.request('GET','/library/../../server.py')[0],400)

    def test_lan_and_hostname_clients_bootstrap_without_login_and_can_save(self):
        # Simulate an interface/hostname in the server's accepted names. Actual
        # receiving interface IPs are also accepted via connection.getsockname().
        for name in ('192.168.50.20', 'localtab-pc'):
            self.http.allowed_hostnames.add(name)
            try:
                host = f'{name}:{self.http.server_port}'
                status, _, body = self.request('GET', '/api/session', headers={'Host': host}, token=False)
                self.assertEqual(status, 200)
                session = json.loads(body)
                self.assertEqual(session['version'], '0.8.0')
                headers = {'Host': host, 'Origin': f'http://{host}', 'X-Local-Token': session['token']}
                status, _, body = self.request('POST', '/api/new', {'title': 'LAN score', 'beats': 6, 'unit': 8}, headers, token=False)
                self.assertEqual(status, 201)
                path = '/api/project/' + json.loads(body)['id']
                state = json.loads(self.request('GET', path, headers={'Host': host}, token=False)[2])
                state['project']['title'] = 'LAN saved'
                self.assertEqual(self.request('PUT', path, state, headers, token=False)[0], 200)
                loaded = json.loads(self.request('GET', path, headers={'Host': host}, token=False)[2])
                self.assertEqual(loaded['project']['title'], 'LAN saved')
                self.assertEqual(self.request('POST', '/api/new', {}, {**headers, 'Origin': 'https://example.com'}, token=False)[0], 403)
                self.assertEqual(self.request('POST', '/api/new', {}, {**headers, 'Origin': f'http://localhost:{self.http.server_port}'}, token=False)[0], 403)
                self.assertEqual(self.request('GET', '/', headers={'Host': host}, token=False)[0], 200)
            finally:
                self.http.allowed_hostnames.remove(name)

    def test_new_score_tempo_meter_and_bar_lengths(self):
        for beats, unit, bpm in [(3,4,90), (4,4,134), (6,8,120), (7,8,92.5), (2,2,60), (5,16,200)]:
            with self.subTest(meter=f'{beats}/{unit}', tempo=bpm):
                status, _, body = self.request('POST', '/api/new', {
                    'title': 'Journey meter', 'bars': 5, 'tempo': bpm, 'beats': beats, 'unit': unit,
                    'tuning': ['E2','A2','D3','G3','B3','E4']})
                self.assertEqual(status, 201)
                state = json.loads(self.request('GET', '/api/project/' + json.loads(body)['id'])[2])
                root = server.valid_xml(state['xml'])
                self.assertEqual(root.findtext('.//time/beats'), str(beats))
                self.assertEqual(root.findtext('.//time/beat-type'), str(unit))
                self.assertEqual(float(root.find('.//sound').get('tempo')), bpm)
                self.assertEqual(float(root.findtext('.//metronome/per-minute')), bpm)
                measures = root.findall('.//measure')
                self.assertEqual(len(measures), 5)
                for m in measures:
                    self.assertEqual(len(m.findall('note/rest')), beats)
                    self.assertEqual(sum(int(d.text) for d in m.findall('note/duration')), 480 * beats * 4 / unit)
                self.assertEqual(state['project']['recordings'], [])

    def test_new_score_rejects_invalid_timing_without_creating_partial_project(self):
        before = set(server.LIBRARY.iterdir())
        for bad in ({'bars': 0}, {'bars': 201}, {'bars': 2.5}, {'beats': 0}, {'beats': 33},
                    {'unit': 3}, {'unit': 32}, {'tempo': 0}, {'tempo': 301}, {'tempo': 'fast'}):
            with self.subTest(bad=bad):
                self.assertEqual(self.request('POST', '/api/new', {'title': 'invalid', **bad})[0], 400)
        self.assertEqual(set(server.LIBRARY.iterdir()), before)

    def test_import_compressed_musicxml_and_reject_entities(self):
        xml = server.new_xml('Compressed', ['E1','A1','D2','G2'], 1)
        stream = io.BytesIO()
        with zipfile.ZipFile(stream,'w') as archive:
            archive.writestr('META-INF/container.xml','<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>')
            archive.writestr('score.xml',xml)
        encoded = base64.b64encode(stream.getvalue()).decode()
        status, _, body = self.request('POST','/api/import',{'name':'sample.mxl','data':encoded})
        self.assertEqual(status,201)
        ident = json.loads(body)['id']
        self.assertEqual(json.loads(self.request('GET','/api/project/'+ident)[2])['xml'],xml)
        bad = '<!DOCTYPE score-partwise [<!ENTITY x "test">]><score-partwise/>'
        self.assertEqual(self.request('POST','/api/import',{'name':'bad.xml','data':base64.b64encode(bad.encode()).decode()})[0],400)

    def test_audio_upload_byte_ranges_and_out_of_range(self):
        ident = self.create()
        content = b'ID3' + bytes(range(256)) * 8
        status, _, body = self.request('POST','/api/audio/'+ident+'?name=demo.mp3',content)
        self.assertEqual(status,201)
        uploaded = json.loads(body)
        self.assertRegex(uploaded['id'], r'^[a-f0-9]{32}$')
        again = json.loads(self.request('POST','/api/audio/'+ident+'?name=demo.mp3',content)[2])
        self.assertNotEqual(uploaded['id'], again['id'])
        self.assertNotEqual(uploaded['file'], again['file'])
        path = '/library/' + ident + '/' + uploaded['file']
        status, headers, data = self.request('GET',path,headers={'Range':'bytes=100-199'})
        self.assertEqual(status,206)
        self.assertEqual(data,content[100:200])
        self.assertEqual(headers['Content-Range'],f'bytes 100-199/{len(content)}')
        self.assertEqual(self.request('GET',path,headers={'Range':'bytes=9000-'})[0],416)

    def test_recording_sync_metadata_round_trips_next_to_score(self):
        ident = self.create()
        path = '/api/project/' + ident
        state = json.loads(self.request('GET', path)[2])
        original_xml = state['xml']
        state['project']['recordings'] = [
            {'id': 'take-a', 'name': 'Original', 'file': 'audio/a.mp3',
             'durationSeconds': 20.125, 'syncAlgorithm': 'tempo-map-v1', 'anchors': []},
            {'id': 'take-b', 'name': 'Alternate', 'file': 'audio/b.mp3',
             'anchors': [{'q': 0, 'seconds': 1.047}]},
        ]
        for points in ([], [{'q': 0, 'seconds': 1}],
                       [{'q': 0, 'seconds': 1}, {'q': 4, 'seconds': 3}], []):
            state['project']['recordings'][0]['anchors'] = points
            expected = state['project']
            self.assertEqual(self.request('PUT', path, state)[0], 200)
            state = json.loads(self.request('GET', path)[2])
            self.assertEqual(state['project'], expected)
            self.assertEqual(state['xml'], original_xml)
            on_disk = json.loads((server.LIBRARY / ident / 'project.json').read_text(encoding='utf-8'))
            self.assertEqual(on_disk, expected)
            self.assertEqual(on_disk['recordings'][1]['anchors'], [{'q': 0, 'seconds': 1.047}])


if __name__ == '__main__':
    unittest.main()
