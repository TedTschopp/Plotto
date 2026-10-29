import sys
import unittest
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from model import ROOT, parse_reference, parse_groups, edition_lines, read_book, validate_book, references


class SourceRules(unittest.TestCase):
    def test_compound_and_alternative_references_keep_their_order(self):
        tree = parse_reference('688 -*; 307 or 197 ch B to B-3 or 973')
        self.assertEqual(tree['type'], 'sequence')
        self.assertEqual(tree['items'][0]['section'], [0, 1])
        choices = tree['items'][1]
        self.assertEqual(choices['type'], 'choice')
        self.assertEqual([r['id'] for r in choices['items']], [307, 197, 973])
        self.assertEqual(choices['items'][1]['operations'][0]['changes'][0],
                         {'from': 'B', 'to': 'B-3', 'last': False})

    def test_change_groups_last_occurrence_and_literal_phrases(self):
        ref = parse_reference('1323c-2 ch A to A-5 & A-8 to A')
        self.assertEqual(ref['numbers'], [2])
        self.assertEqual(len(ref['operations'][0]['changes']), 2)
        ref = parse_reference('1039 ch A-5 to A & last A to A-3')
        self.assertTrue(ref['operations'][0]['changes'][1]['last'])
        ref = parse_reference('21 ch A-2 to BR-B & F-A and M-A to B')
        self.assertEqual([r['from'] for r in ref['operations'][0]['changes']], ['A-2', 'F-A', 'M-A'])
        ref = parse_reference('110 ch “wife of A” to “sweetheart of A”')
        self.assertEqual(ref['operations'][0]['changes'][0]['to'], 'sweetheart of A')

    def test_transpose_then_change_and_added_characters(self):
        ref = parse_reference('36 tr A & B, ch A-3 to B-3')
        self.assertEqual([r['type'] for r in ref['operations']], ['transpose', 'change'])
        ref = parse_reference('687 add B')
        self.assertEqual(ref['operations'], [{'type': 'add', 'value': 'B'}])
        self.assertEqual(len(parse_groups('(572; 402) (687 add B)')), 2)
        self.assertEqual(parse_groups('()'), [])
        with self.assertRaises(ValueError):
            parse_groups('(12 unknown command)')

    def test_ambiguous_pronouns_use_source_annotations_in_both_directions(self):
        source = '-- HER obj poss\nA gives her her book\nA visits her\n'
        lines = list(edition_lines(source, 'fm'))
        self.assertEqual(lines[1], 'A gives him his book')
        self.assertEqual(lines[2], 'A visits his')
        self.assertEqual(list(edition_lines(source, 'mf'))[1], 'A gives her her book')

    def test_complete_source_and_gendered_relatives(self):
        for edition in ['mf', 'fm']:
            book = read_book(edition)
            self.assertEqual(validate_book(book), [])
            self.assertEqual(sum(len(c['variants']) for c in book['conflicts']), 1852)
            text = book['conflicts'][541]['variants'][0]['text']
            self.assertIn('her husband' if edition == 'fm' else 'his wife', text)
            self.assertIn('mother' if edition == 'fm' else 'father', book['characters']['M-A' if edition == 'fm' else 'F-A'])

    def test_character_roles_come_from_the_key_instead_of_later_index_entries(self):
        for edition, gender in [('mf', 'male'), ('fm', 'female')]:
            characters = read_book(edition)['characters']
            self.assertEqual(characters['A'], f'{gender} protagonist')
            self.assertEqual(characters['A-3'], f'{gender} rival or enemy of A')
            self.assertEqual(characters['F-B'], 'father of B')
            self.assertEqual(characters['CH'], 'a child')

    def test_all_21_scan_audited_references_are_restored_and_editorials_are_disclosed(self):
        rows = json.loads((ROOT / 'data/source-corrections.json').read_text())[3:]
        self.assertEqual(len(rows), 21)
        self.assertEqual(sum(row['kind'] == 'transcription' for row in rows), 5)
        self.assertEqual(sum(row['kind'].startswith('editorial-') for row in rows), 16)
        for edition in ['mf', 'fm']:
            book = read_book(edition)
            self.assertEqual(validate_book(book), [])
            for row in rows:
                conflict = book['conflicts'][row['conflict'] - 1]
                variant = next(v for v in conflict['variants'] if v['id'] == row['variant'])
                matches = [ref for group in variant[row['direction']] for ref in references(group['expression'])
                           if ref['label'] == row['after']]
                self.assertEqual(len(matches), 1, row['id'])
                ref = matches[0]
                self.assertFalse(ref.get('unavailable'), row['id'])
                if row['kind'].startswith('editorial-'):
                    self.assertEqual(ref['correctionId'], row['id'])
                    self.assertIn(row['printed'], ref['notes'][-1])
                else:
                    self.assertEqual(row['printed'], row['after'])
                self.assertIn(row['page'], [e['page'] for e in row['evidence']])
                for evidence in row['evidence']:
                    self.assertRegex(evidence['sha256'], r'^[a-f0-9]{64}$')

    def test_unknown_subvariants_fail_validation_instead_of_being_silently_disabled(self):
        book = read_book()
        ref = book['conflicts'][1]['variants'][0]['after'][0]['expression']
        ref['variants'] = ['m']
        errors = validate_book(book)
        self.assertTrue(any('unknown variant' in error for error in errors))
        self.assertNotIn('unavailable', ref)


if __name__ == '__main__':
    unittest.main()
