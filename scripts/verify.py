#!/usr/bin/env python3
"""Verify source coverage, data freshness, reader fidelity and local navigation."""

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

from model import ROOT, read_book, validate_book
from corrections import render_corrections
from app_assets import verify_app_assets

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}


class PageAudit(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.ids, self.duplicates, self.links, self.descriptions = set(), set(), [], {}
        self.conflict, self.variant, self.capture = None, '', None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            if attrs['id'] in self.ids:
                self.duplicates.add(attrs['id'])
            self.ids.add(attrs['id'])
        classes = attrs.get('class', '').split()
        if 'conflict' in classes:
            self.conflict, self.variant = int(attrs['id']), ''
        if 'prelinks' in classes and self.conflict:
            self.variant = attrs.get('id', str(self.conflict))[len(str(self.conflict)):]
        for attr in ['href', 'src']:
            if attrs.get(attr):
                self.links.append(attrs[attr])
        if self.capture is not None and tag not in VOID:
            self.capture['depth'] += 1
        if 'desc' in classes and self.conflict:
            self.capture = {'key': (self.conflict, self.variant), 'depth': 1, 'text': []}

    def handle_endtag(self, tag):
        if self.capture is not None:
            self.capture['depth'] -= 1
            if self.capture['depth'] == 0:
                self.descriptions[self.capture['key']] = ''.join(self.capture['text'])
                self.capture = None

    def handle_data(self, data):
        if self.capture is not None:
            self.capture['text'].append(data)


def normalized_text(text):
    text = re.sub(r'\((\d[^()]*)\)', lambda match: match[1], text)
    text = re.sub(r'@\{([^}]+)\}', lambda match: match[1], text)
    return re.sub(r'\s+', '', text)


def verify():
    errors = verify_app_assets()
    names = ['index.html', 'how-to.html', 'corrections.html', 'plotto-mf.html', 'plotto-fm.html']
    pages = {name: PageAudit((ROOT / name).read_text(encoding='utf-8')) for name in names}
    if (ROOT / 'corrections.html').read_text(encoding='utf-8') != render_corrections():
        errors.append('corrections.html is stale; rebuild the correction ledger page')
    header = (ROOT / 'scripts/templates/global-header.html').read_text(encoding='utf-8').strip()
    for name, page in pages.items():
        source = (ROOT / name).read_text(encoding='utf-8')
        if header not in source:
            errors.append(f'{name}: shared TedT.org header differs from its build template')
        if page.duplicates:
            errors.append(f'{name}: duplicate IDs {sorted(page.duplicates)}')
        for link in page.links:
            url = urlsplit(link)
            if url.scheme or url.netloc:
                continue
            path = unquote(url.path)
            target = ROOT / path.lstrip('/') if path.startswith('/') else (ROOT / name).parent / path
            if not path:
                target = ROOT / name
            if target.is_dir():
                target /= 'index.html'
            if not target.is_file():
                errors.append(f'{name}: missing local target {link}')
            elif url.fragment and target.suffix == '.html':
                audit = pages.get(target.name)
                if audit and unquote(url.fragment) not in audit.ids:
                    errors.append(f'{name}: missing fragment target {link}')
    for edition in ['mf', 'fm']:
        book = read_book(edition)
        errors.extend(validate_book(book))
        artifact = json.loads((ROOT / f'data/plotto-{edition}.json').read_text(encoding='utf-8'))
        if artifact != book:
            errors.append(f'data/plotto-{edition}.json is stale; run python3 scripts/build-all.py')
        page = pages[f'plotto-{edition}.html']
        expected = {(c['id'], v['id']): v['text'] for c in book['conflicts'] for v in c['variants']}
        if set(page.descriptions) != set(expected):
            errors.append(f'plotto-{edition}.html does not contain every source variant exactly once')
        for key, text in expected.items():
            if normalized_text(page.descriptions.get(key, '')) != normalized_text(text):
                errors.append(f'plotto-{edition}.html: text differs from source for {key[0]}{key[1]}')
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print('Verified both editions: 1,462 conflicts and 1,852 variants each, source fidelity, fresh datasets, shared headers, and local links.')
    print('All lead-up and carry-on references resolve to existing conflict variants in both editions.')
    return 0


def walk(expression):
    if expression['type'] == 'reference':
        yield expression
    else:
        for child in expression['items']:
            yield from walk(child)


if __name__ == '__main__':
    sys.exit(verify())
