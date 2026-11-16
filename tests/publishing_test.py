"""Transactional publishing tests: no network and no real repository writes."""
import base64
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import quote, unquote

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from publishing import Publisher, PublishError, GitHubError, write_json, score_slug, unique_score_slug, valid_score_slug
from server import new_xml


class FakeGitHub:
    def __init__(self, files):
        self.blobs = {}
        self.trees = {}
        self.commits = {}
        self.calls = []
        self.private = False
        self.race = False
        self.lost_response = False
        self.head = self.commit_files(files)

    def commit_files(self, files):
        tree = {path: self.store(data) for path, data in files.items()}
        tree_sha = 'tree' + str(len(self.trees))
        self.trees[tree_sha] = tree
        commit_sha = 'commit' + str(len(self.commits))
        self.commits[commit_sha] = {'tree': {'sha': tree_sha}}
        return commit_sha

    def store(self, data):
        sha = Publisher.blob_sha(data)
        self.blobs[sha] = data
        return sha

    def files(self):
        tree = self.trees[self.commits[self.head]['tree']['sha']]
        return {path: self.blobs[sha] for path, sha in tree.items()}

    def __call__(self, endpoint, method='GET', data=None):
        self.calls.append((endpoint, method, copy.deepcopy(data)))
        route = endpoint.removeprefix('/repos/test/scores')
        if route == '':
            return {'private': self.private}
        if route.startswith('/git/ref/heads/'):
            return {'object': {'sha': self.head}}
        if method == 'GET' and route.startswith('/git/commits/'):
            return self.commits[route.split('/')[-1]]
        if method == 'GET' and route.startswith('/git/trees/'):
            sha = route.split('/')[-1].split('?')[0]
            return {'tree': [{'path': path, 'sha': blob, 'type': 'blob'} for path, blob in self.trees[sha].items()]}
        if method == 'GET' and route.startswith('/git/blobs/'):
            return {'content': base64.b64encode(self.blobs[route.split('/')[-1]]).decode()}
        if route == '/git/blobs':
            return {'sha': self.store(base64.b64decode(data['content']))}
        if route == '/git/trees':
            tree = dict(self.trees[data['base_tree']])
            tree.update({entry['path']: entry['sha'] for entry in data['tree']})
            sha = 'tree' + str(len(self.trees))
            self.trees[sha] = tree
            return {'sha': sha}
        if route == '/git/commits':
            sha = 'commit' + str(len(self.commits))
            self.commits[sha] = {'tree': {'sha': data['tree']}, 'parent': data['parents'][0]}
            return {'sha': sha}
        if route.startswith('/git/refs/heads/'):
            assert data['force'] is False
            if self.race:
                self.race = False
                self.head = self.commit_files({**self.files(), 'other.txt': b'another writer'})
                raise GitHubError('HTTP 422 race')
            if self.commits[data['sha']]['parent'] != self.head:
                raise GitHubError('HTTP 422 non-fast-forward')
            self.head = data['sha']
            if self.lost_response:
                self.lost_response = False
                raise GitHubError('network response lost')
            return {'object': {'sha': self.head}}
        raise AssertionError((route, method))


class PublishingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        write_json(self.root / '.local/publish.json', {'repository': 'test/scores', 'branch': 'main'})
        self.publisher = Publisher(self.root)
        self.xml = new_xml('Original guitar | study', ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], 4)
        self.fake = FakeGitHub({'README.md': b'# Scores\n\n## Score index\n\nold table\n\n## Notes\nKeep this.\n',
                              'scores/other/score.musicxml': self.xml.encode(), 'notes.txt': b'untouched'})
        self.publisher.api = self.fake
        self.ident = 'a' * 32
        self.draft = {'id': self.ident, 'projectId': 'score-test', 'revision': 'v1', 'repository': 'test/scores',
                      'branch': 'main', 'slug': 'score-test', 'xml': self.xml, 'ready': True,
                      'created': '2026-01-01T00:00:00+00:00',
                      'info': {'title': 'Original guitar | study', 'instrument': 'Guitar', 'tuning': ['E2','A2','D3','G3','B3','E4'],
                               'measures': 4, 'meter': '4/4', 'tempo': '120'}}
        write_json(self.publisher.draft_path(self.ident) / 'snapshot.json', self.draft)
        self.pdf = b'%PDF-1.7\n' + b'original exercise PDF' * 40
        (self.publisher.draft_path(self.ident) / 'score.pdf').write_bytes(self.pdf)

    def publish(self):
        return self.publisher.publish(self.ident, 'v1')

    def test_atomic_publish_updates_both_formats_and_bilingual_catalog(self):
        result = self.publish()
        files = self.fake.files()
        self.assertEqual(files['scores/score-test/score.musicxml'], self.xml.encode())
        self.assertEqual(files['scores/score-test/score.pdf'], self.pdf)
        self.assertEqual(files['notes.txt'], b'untouched')
        self.assertIn('other', json.loads(files['catalog.json'])['scores'])
        self.assertIn(b'Keep this.', files['README.md'])
        for path in ['README.md', 'README.zh-CN.md']:
            self.assertIn(b'score-test/score.pdf', files[path])
            self.assertIn(b'Original guitar \\| study', files[path])
        self.assertEqual(sum(method == 'PATCH' for _, method, _ in self.fake.calls), 1)
        self.assertEqual(result['url'], 'https://github.com/test/scores/tree/main/scores/score-test')
        self.assertFalse(any(path.endswith('.mp3') or path.endswith('project.json') for path in files))
        self.assertEqual(self.publisher.state()['score-test']['commit'], result['commit'])

    def test_multi_instrument_preview_keeps_all_parts(self):
        import xml.etree.ElementTree as ET
        root = ET.fromstring(self.xml)
        definition = copy.deepcopy(root.find('./part-list/score-part'))
        definition.set('id', 'P2')
        definition.find('part-name').text = 'Second Guitar'
        root.find('part-list').append(definition)
        part = copy.deepcopy(root.find('part'))
        part.set('id', 'P2')
        root.append(part)
        text = ET.tostring(root, encoding='unicode')
        def render(ident, _):
            snapshot = self.publisher.draft(ident)
            self.assertEqual(len(ET.fromstring(snapshot['xml']).findall('part')), 2)
            (self.publisher.draft_path(ident) / 'score.pdf').write_bytes(self.pdf)
        with patch.object(self.publisher, 'render_pdf', render):
            result = self.publisher.prepare('ensemble', {'xml': text, 'revision': 'v1',
                'project': {'title': 'Original duet'}}, 'http://localhost')
        self.assertEqual(self.publisher.draft(result['draftId'])['xml'], text)

    def test_same_draft_retry_is_idempotent_and_update_keeps_url_and_manual_notes(self):
        first = self.publish()
        self.assertEqual(self.publish()['commit'], first['commit'])
        files = self.fake.files()
        files['scores/score-test/README.md'] += b'\nMy manual notes.\n'
        self.fake.head = self.fake.commit_files(files)
        self.draft['xml'] = self.xml.replace('<per-minute>120', '<per-minute>110')
        self.draft['created'] = '2026-01-02T00:00:00+00:00'
        write_json(self.publisher.draft_path(self.ident) / 'snapshot.json', self.draft)
        self.assertEqual(self.publish()['url'], first['url'])
        readme = self.fake.files()['scores/score-test/README.md']
        self.assertIn(b'My manual notes.', readme)
        self.assertEqual(readme.count(b'localtab:downloads:start'), 1)

    def test_stale_preview_and_changed_destination_do_not_write(self):
        with self.assertRaisesRegex(PublishError, '变化'):
            self.publisher.publish(self.ident, 'v2')
        self.assertEqual(self.fake.calls, [])
        write_json(self.root / '.local/publish.json', {'repository': 'other/repo'})
        with self.assertRaisesRegex(PublishError, '目标'):
            self.publish()
        self.assertEqual(self.fake.calls, [])

    def test_public_destination_required(self):
        self.fake.private = True
        with self.assertRaisesRegex(PublishError, '不是公开'):
            self.publish()
        self.assertFalse(any(method != 'GET' for _, method, _ in self.fake.calls))

    def test_concurrent_remote_commit_is_preserved_without_force_push(self):
        self.fake.race = True
        self.publish()
        self.assertEqual(self.fake.files()['other.txt'], b'another writer')
        self.assertIn('scores/score-test/score.pdf', self.fake.files())

    def test_lost_success_response_recovers_without_second_commit(self):
        self.fake.lost_response = True
        self.publish()
        self.assertEqual(sum(method == 'PATCH' for _, method, _ in self.fake.calls), 1)

    def test_existing_different_score_is_not_overwritten(self):
        self.fake.head = self.fake.commit_files({**self.fake.files(), 'scores/score-test/score.musicxml': b'other score'})
        before = self.fake.head
        with self.assertRaisesRegex(PublishError, '已有不同'):
            self.publish()
        self.assertEqual(self.fake.head, before)

    def test_existing_identical_score_can_gain_pdf(self):
        self.fake.head = self.fake.commit_files({**self.fake.files(), 'scores/score-test/score.musicxml': self.xml.encode()})
        self.publish()
        self.assertEqual(self.fake.files()['scores/score-test/score.pdf'], self.pdf)

    def test_invalid_draft_path_and_unfinished_pdf_rejected(self):
        for ident in ['../x', 'a/../../x', '', 'z' * 32]:
            with self.assertRaises(PublishError):
                self.publisher.draft(ident)
        self.draft['ready'] = False
        write_json(self.publisher.draft_path(self.ident) / 'snapshot.json', self.draft)
        with self.assertRaisesRegex(PublishError, '尚未完成'):
            self.publish()
        self.assertEqual(self.fake.calls, [])

    def test_pdf_failure_never_contacts_github_and_snapshot_excludes_private_metadata(self):
        def render(ident, base):
            snapshot = self.publisher.draft(ident)
            self.assertNotIn('recordings', snapshot)
            self.assertNotIn('secret.mp3', json.dumps(snapshot))
            raise PublishError('PDF failed')
        with patch.object(self.publisher, 'render_pdf', render):
            with self.assertRaisesRegex(PublishError, 'PDF failed'):
                self.publisher.prepare('score-new', {'xml': self.xml, 'revision': 'v1',
                    'project': {'title': 'Original', 'recordings': [{'file': 'secret.mp3'}]}}, 'http://127.0.0.1:1234')
        self.assertEqual(self.fake.calls, [])

    def test_title_names_are_portable_and_case_insensitive_collisions_get_numbers(self):
        self.assertEqual(score_slug('  波 / Rain: 夜?  '), '波 - Rain - 夜 -')
        self.assertEqual(score_slug('CON.txt'), 'Score - CON.txt')
        self.assertEqual(score_slug('......... - しづかの海'), '......... - しづかの海')
        self.assertEqual(score_slug('.git'), 'Score - .git')
        self.assertEqual(unique_score_slug('Rain', ['rain', 'RAIN (2)']), 'Rain (3)')
        self.assertEqual(unique_score_slug('Café', ['Cafe\u0301']), 'Café (2)')
        long_name = unique_score_slug('曲' * 120, [score_slug('曲' * 120)])
        self.assertLessEqual(len(long_name.encode('utf-8')), 200)
        self.assertTrue(long_name.endswith(' (2)'))
        for unsafe in ['../escape', 'a/b', 'a\\b', 'NUL', 'name.', 'name ', '', '\x00']:
            self.assertFalse(valid_score_slug(unsafe), unsafe)

    def test_prepare_uses_title_and_preserves_name_after_later_title_edits(self):
        def render(ident, base):
            (self.publisher.draft_path(ident) / 'score.pdf').write_bytes(self.pdf)
        data = {'xml': self.xml, 'revision': 'v1', 'project': {'title': '夜の曲 (Live)'}}
        write_json(self.publisher.work / 'state.json', {
            'other': {'repository': 'test/scores', 'slug': '夜の曲 (Live)'}})
        with patch.object(self.publisher, 'render_pdf', render):
            first = self.publisher.prepare('score-new', data, 'http://localhost')
            self.assertEqual(first['slug'], '夜の曲 (Live) (2)')
            write_json(self.publisher.work / 'state.json', {
                'score-new': {'repository': 'test/scores', 'slug': first['slug']}})
            data['project']['title'] = 'Renamed title'
            self.assertEqual(self.publisher.prepare('score-new', data, 'http://localhost')['slug'], first['slug'])

    def test_unicode_catalog_survives_publish_and_links_are_encoded(self):
        name = '夜の曲 #1 (Live)'
        other = '雨 & Café'
        files = self.fake.files()
        files.update({f'scores/{other}/score.musicxml': self.xml.encode(),
                      f'scores/{other}/score.pdf': self.pdf,
                      f'scores/{name}/score.musicxml': self.xml.encode(),
                      'catalog.json': json.dumps({'schemaVersion': 1, 'scores': {
                          other: {**self.draft['info'], 'title': other, 'flatId': 'original-other'},
                          name: {**self.draft['info'], 'title': name, 'flatId': 'original-id'}}}).encode()})
        self.fake.head = self.fake.commit_files(files)
        self.draft['slug'] = name
        write_json(self.publisher.draft_path(self.ident) / 'snapshot.json', self.draft)
        result = self.publish()
        published = self.fake.files()
        catalog = json.loads(published['catalog.json'])['scores']
        self.assertIn(other, catalog)
        self.assertEqual(catalog[name]['flatId'], 'original-id')
        self.assertIn('/scores/' + quote(name, safe=''), result['url'])
        self.assertTrue(unquote(result['pdfUrl']).endswith('/scores/' + name + '/score.pdf'))
        for readme in ['README.md', 'README.zh-CN.md']:
            self.assertIn(('scores/' + quote(other, safe='') + '/score.pdf').encode(), published[readme])
            self.assertIn(('scores/' + quote(name, safe='') + '/README.md').encode(), published[readme])

    def test_preview_from_before_folder_rename_cannot_recreate_old_directory(self):
        write_json(self.publisher.work / 'state.json', {
            'score-test': {'repository': 'test/scores', 'slug': '曲名'}})
        with self.assertRaisesRegex(PublishError, '已改名'):
            self.publish()
        self.assertEqual(self.fake.calls, [])


if __name__ == '__main__':
    unittest.main()
