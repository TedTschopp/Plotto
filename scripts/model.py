"""Read the annotated Plotto source and retain its reference instructions.

The book is the source of truth. This module creates data, never invented prose.
Sequences, alternatives, section limits and character changes stay explicit.
"""

import hashlib
import json
import re
from pathlib import Path

from build import Parser as BookParser

ROOT = Path(__file__).resolve().parents[1]
TOKEN = r'(?:“[^”]+”|"[^"]+"|[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)'


def unquote(value):
    return value.strip('“”"')


def parse_operations(text):
    """Parse the book's small instruction language without evaluating code."""
    operations, notes = [], []
    text = text.strip()
    while text:
        text = text.strip()
        text = re.sub(r'^(?:\s*[,;&]\s*|and\s+)', '', text).strip()
        if not text:
            break
        match = re.match(rf'tr ({TOKEN}) & ({TOKEN})', text)
        if match:
            operations.append({'type': 'transpose', 'from': unquote(match[1]), 'to': unquote(match[2])})
            text = text[match.end():]
            continue
        if text.startswith('ch '):
            text = text[3:]
            changes = []
            while True:
                match = re.match(rf'(?P<last>last )?(?P<from>{TOKEN})(?: and (?P<other>{TOKEN}))? to (?P<to>{TOKEN})', text)
                if not match:
                    raise ValueError(f'Unrecognized character change: {text}')
                sources = [match['from']] + ([match['other']] if match['other'] else [])
                for source in sources:
                    changes.append({'from': unquote(source), 'to': unquote(match['to']), 'last': bool(match['last'])})
                text = text[match.end():]
                next_text = re.sub(r'^(?:\s*[,;&]\s*| and )', '', text).strip()
                if re.match(rf'(?:last )?{TOKEN}(?: and {TOKEN})? to ', next_text):
                    text = next_text
                    continue
                break
            operations.append({'type': 'change', 'changes': changes})
            continue
        match = re.match(rf'(add|eliminate) ({TOKEN})', text)
        if match:
            operations.append({'type': match[1], 'value': unquote(match[2])})
            text = text[match.end():]
            continue
        # Descriptive tails explain a new role or qualify an inline suggestion.
        if text.startswith(('with ', 'without ', 'son ', 'daughter ', 'mother ', 'father ', 'brother ', 'sister ', '“', '"')):
            notes.append(text)
            break
        raise ValueError(f'Unrecognized reference instruction: {text}')
    return operations, notes


def parse_reference(label):
    label = label.strip()
    if ';' in label:
        return {'type': 'sequence', 'items': [parse_reference(x) for x in label.split(';')]}
    if ' or ' in label:
        return {'type': 'choice', 'items': [parse_reference(x) for x in label.split(' or ')]}
    match = re.fullmatch(r'(\d+)([a-m](?:, [a-m])*)?((?:-\d+)*)(?:\s+(-\*+|\*+-\*+))?(.*)', label)
    if not match:
        raise ValueError(f'Unrecognized reference: {label}')
    operations, notes = parse_operations(match[5])
    limits = match[4].split('-') if match[4] else None
    return {
        'type': 'reference', 'id': int(match[1]),
        'variants': match[2].split(', ') if match[2] else [],
        'numbers': [int(x) for x in match[3].split('-') if x],
        'section': [len(x) for x in limits] if limits else None,
        'operations': operations, 'notes': notes, 'label': label,
    }


def parse_groups(text):
    groups = []
    while text.strip():
        match = re.match(r'^\s*\(([^()]*)\)', text)
        if not match:
            raise ValueError(f'Invalid reference group: {text}')
        label = match[1].strip()
        if label:
            groups.append({'label': label, 'expression': parse_reference(label)})
        text = text[match.end():]
    return groups


def edition_lines(source, edition):
    """Use the same contextual gender transformations as the printed reader."""
    converter = BookParser()
    for raw in source.splitlines():
        line = raw.strip()
        if line.startswith('--'):
            for key, attr in [('HER', 'her_info'), ('A', 'a_info'), ('U', 'u_info')]:
                if line.startswith(f'-- {key} '):
                    setattr(converter, attr, line[len(key) + 4:].split())
            if line == '-- HUSBAND verb':
                converter.husband_info = 'verb'
            if line == '-- MISTRESS master':
                converter.mistress_info = 'master'
            yield line
            continue
        yield converter.preprocess_line(line) if edition == 'fm' else line
        for attr in ['her_info', 'a_info', 'u_info', 'husband_info', 'mistress_info']:
            setattr(converter, attr, None)


def read_book(edition='mf', source_path=None):
    source = (source_path or ROOT / 'plotto.txt').read_text(encoding='utf-8')
    book = {'version': 1, 'edition': edition, 'sourceHash': hashlib.sha256(source.encode()).hexdigest(),
            'clauses': {'a': [], 'b': [], 'c': []}, 'characters': {}, 'conflicts': []}
    section, active, group, subgroup, b_clause = '', False, '', '', None
    conflict, variant, body = None, None, []
    for line in edition_lines(source, edition):
        if line.startswith('-- ID:'):
            section = line[6:]
        if line == '-- page 18':
            active = True
            section = ''  # The character key ends here; later indexes are not definitions.
        if line == '-- page 190':
            active = False
        if line.startswith('--') or not line:
            continue
        if not active:
            if section in ['a-clauses', 'b-clauses', 'c-clauses']:
                match = re.match(r'^\(?([0-9]+)[.)] (.+)', line)
                if match:
                    book['clauses'][section[0]].append({'id': int(match[1]), 'text': match[2].rstrip(',.')})
            if section == 'character-symbols':
                match = re.match(r'^([A-Z][A-Z0-9-]*),\s+(.+)', line)
                if match:
                    book['characters'][match[1]] = match[2]
            continue
        match = re.fullmatch(r'ConflictGroup\{(.+)\}', line)
        if match:
            group = match[1]
            continue
        match = re.fullmatch(r'ConflictSubGroup\{(.*)\}', line)
        if match:
            subgroup = match[1]
            continue
        match = re.fullmatch(r'B\{(\d+)\} (.+)', line)
        if match:
            b_clause = int(match[1])
            continue
        match = re.fullmatch(r'Conflict\{(\d+)\}', line)
        if match:
            conflict = {'id': int(match[1]), 'group': group, 'subgroup': subgroup, 'bClause': b_clause, 'variants': []}
            book['conflicts'].append(conflict)
            continue
        match = re.fullmatch(r'(?:\(([a-m])\) )?PRE: (.*)', line)
        if match:
            if variant is not None:
                raise ValueError(f'Missing POST in conflict {conflict["id"]}')
            variant = {'id': match[1] or '', 'before': parse_groups(match[2])}
            body = []
            continue
        if line.startswith('POST: '):
            if variant is None:
                raise ValueError(f'POST without PRE in conflict {conflict["id"]}')
            variant['text'] = ' '.join(body)
            variant['after'] = parse_groups(line[6:])
            conflict['variants'].append(variant)
            variant = None
            continue
        if variant is not None:
            body.append(line)
    if variant is not None:
        raise ValueError('Unclosed conflict at end of source')
    annotate_corrections(book)
    return book


def annotate_corrections(book):
    """Make editorial choices visible whenever a repaired suggestion is used."""
    ledger = json.loads((ROOT / 'data/source-corrections.json').read_text(encoding='utf-8'))
    editorial = {(row['conflict'], row.get('variant', ''), row['direction'], row['after']): row
                 for row in ledger if row.get('kind', '').startswith('editorial-')}
    for conflict in book['conflicts']:
        for variant in conflict['variants']:
            for direction in ['before', 'after']:
                for group in variant[direction]:
                    for ref in references(group['expression']):
                        row = editorial.get((conflict['id'], variant['id'], direction, ref['label']))
                        if row:
                            ref['correctionId'] = row['id']
                            ref['notes'].append(f'Editorial repair: the book prints {row["printed"]}; this edition uses {row["after"]}.')


def references(expression):
    if expression['type'] == 'reference':
        yield expression
    else:
        for child in expression['items']:
            yield from references(child)


def validate_book(book):
    errors = []
    conflicts = {c['id']: c for c in book['conflicts']}
    if len(book['conflicts']) != 1462 or set(conflicts) != set(range(1, 1463)):
        errors.append('Expected each conflict numbered 1–1462 exactly once')
    for letter, size in [('a', 15), ('b', 62), ('c', 15)]:
        if [c['id'] for c in book['clauses'][letter]] != list(range(1, size + 1)):
            errors.append(f'Expected {size} ordered {letter.upper()} clauses')
    for conflict in book['conflicts']:
        if not conflict['variants']:
            errors.append(f'{conflict["id"]}: empty conflict')
        for variant in conflict['variants']:
            if not variant['text']:
                errors.append(f'{conflict["id"]}{variant["id"]}: empty text')
            for direction in ['before', 'after']:
                for group in variant[direction]:
                    for ref in references(group['expression']):
                        target = conflicts.get(ref['id'])
                        if not target:
                            errors.append(f'{conflict["id"]}{variant["id"]}: unknown target {ref["label"]}')
                        elif ref['variants'] and not set(ref['variants']) <= {v['id'] for v in target['variants']}:
                            errors.append(f'{conflict["id"]}{variant["id"]}: unknown variant {ref["label"]}')
    return errors


def export_data():
    destination = ROOT / 'data'
    destination.mkdir(exist_ok=True)
    for edition in ['mf', 'fm']:
        book = read_book(edition)
        errors = validate_book(book)
        if errors:
            raise ValueError('\n'.join(errors))
        (destination / f'plotto-{edition}.json').write_text(
            json.dumps(book, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        print(f'Built data/plotto-{edition}.json ({len(book["conflicts"])} conflicts)')


if __name__ == '__main__':
    export_data()
