"""Publish a matched set of fingerprinted app assets, retaining older releases."""

import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULES = ['app', 'engine', 'name-storage', 'story-storage', 'story-library', 'tedt-theme-init']


def planned_assets():
    sources = {f'js/{name}.js': (ROOT / f'js/{name}.js').read_text(encoding='utf-8') for name in MODULES}
    sources['css/app.css'] = (ROOT / 'css/app.css').read_text(encoding='utf-8')
    for edition in ['mf', 'fm']:
        sources[f'data/plotto-{edition}.json'] = (ROOT / f'data/plotto-{edition}.json').read_text(encoding='utf-8')
    digest = hashlib.sha256()
    for name, source in sorted(sources.items()):
        digest.update(name.encode() + b'\0' + source.encode() + b'\0')
    version = digest.hexdigest()[:16]
    assets = {}
    for name in MODULES:
        source = sources[f'js/{name}.js']
        source = re.sub(r'(from\s+[\'"])\./([a-z-]+)\.js([\'"])',
                        lambda match: f'{match[1]}./{match[2]}.{version}.js{match[3]}', source)
        if name == 'app':
            fetch = 'fetch(`data/plotto-${edition}.json`)'
            if source.count(fetch) != 1:
                raise ValueError('Update the app asset builder to match the dataset fetch')
            source = source.replace(fetch, f'fetch(`data/plotto-${{edition}}.json?v={version}`)')
        assets[f'assets/app/{name}.{version}.js'] = source
    assets[f'assets/app/app.{version}.css'] = sources['css/app.css']
    index = (ROOT / 'index.html').read_text(encoding='utf-8')
    for original, stem, extension in [('js/app.js', 'app', 'js'), ('js/tedt-theme-init.js', 'tedt-theme-init', 'js'),
                                      ('css/app.css', 'app', 'css')]:
        pattern = rf'(?<=[\'"])(?:{re.escape(original)}|assets/app/{stem}\.[a-f0-9]+\.{extension})(?=[\'"])'
        index, count = re.subn(pattern, f'assets/app/{stem}.{version}.{extension}', index)
        if count != 1:
            raise ValueError(f'Expected one app asset reference for {original}')
    assets['index.html'] = index
    return assets


def build_app_assets():
    for name, source in planned_assets().items():
        path = ROOT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding='utf-8')
    print('Built fingerprinted application modules, styles and dataset URLs')


def verify_app_assets():
    return [f'{name} is stale; run python3 scripts/build-all.py' for name, source in planned_assets().items()
            if not (ROOT / name).is_file() or (ROOT / name).read_text(encoding='utf-8') != source]
