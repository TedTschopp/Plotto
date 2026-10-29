"""Publish the scan audit and distinguish transcriptions from editorial repairs."""

import json
import re
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KINDS = {
    'transcription': 'Transcription correction',
    'editorial-context': 'Editorial inference from context',
    'editorial-unlettered': 'Editorial normalization to the whole conflict',
    'editorial-numbered': 'Editorial interpretation of a numbered example',
}


def render_corrections():
    ledger = json.loads((ROOT / 'data/source-corrections.json').read_text(encoding='utf-8'))
    header = (ROOT / 'scripts/templates/global-header.html').read_text(encoding='utf-8')
    parts = ['''<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plotto · Reference corrections</title>
<meta name="description" content="Original scan evidence and editorial reasoning for corrected Plotto references.">
<script src="js/tedt-theme-init.js"></script>
<link rel="stylesheet" href="css/tedt-header-embed.css"><link rel="stylesheet" href="css/plotto.css">
</head><body>
<a class="skip-link" href="#corrections">Skip to corrections</a>
''', header, '''
<nav class="book-nav" aria-label="Plotto"><a href="./">Plot generator</a><a href="plotto-mf.html">Original roles</a><a href="plotto-fm.html">Reversed roles</a><a href="how-to.html">How to use Plotto</a></nav>
<main id="corrections" class="container guide">
<p class="eyebrow">Source audit · 29 October 2026</p><h1>Reference corrections</h1>
<p>The original scans resolve five transcription mistakes among the 21 previously unavailable subvariant references. The other sixteen references are already invalid in the 1928 printing. Their repaired links are marked as editorial decisions in the readers and generated outlines.</p>
<p>Editorial entries record this edition’s interpretation of broken printed links. Ten normalize an absent suffix to the existing unlettered conflict; six use contextual or numbered-example interpretations. Each records the printed form, the chosen reference, and the evidence. The book’s 1,852 existing variants remain intact.</p>
<p>The ledger also retains the three transcription corrections from the initial app release. Reference spellings below use the original-role edition; both editions apply the same repairs. Scan page numbers refer to the printed pages.</p>
<p><a href="data/source-corrections.json">Download the correction ledger (JSON)</a>. Scan checksums identify the inspected JPEGs; the source links open the original book.</p>
''']
    for row in ledger:
        key = f'{row["conflict"]}{row.get("variant", "")}'
        direction = {'before': 'lead-up', 'after': 'carry-on', 'inline': 'inline reference'}[row['direction']]
        target = re.match(r'\d+[a-m]?', row['after'])[0]
        parts.append(f'<article id="{escape(row["id"], quote=True)}" class="correction-entry">\n')
        parts.append(f'<p class="eyebrow">{escape(KINDS[row["kind"]])}</p><h2>{key} · {direction}</h2>\n')
        parts.append(f'<p>Transcription: <code>{escape(row["before"])}</code><br>Printed reference: <code>{escape(row["printed"])}</code><br>This edition: <strong><code>{escape(row["after"])}</code></strong></p>\n')
        parts.append(f'<p>{escape(row["reason"])}</p>\n<p>')
        evidence = row.get('evidence', [{'page': row['page'], 'source': row['source']}])
        parts.append(' · '.join(f'<a href="{escape(item["source"], quote=True)}">Scan p. {item["page"]}</a>' for item in evidence))
        parts.append(f' · <a href="plotto-mf.html#{key}">Read conflict {key}</a> · <a href="plotto-mf.html#{target}">Read the repaired target</a></p>\n</article>\n')
    parts.append('</main><footer class="book-footer"><a href="./">Back to the plot generator</a> · William Wallace Cook, 1928</footer></body></html>\n')
    return ''.join(parts)


def build_corrections():
    (ROOT / 'corrections.html').write_text(render_corrections(), encoding='utf-8')
    print('Built corrections.html (scan evidence and editorial decisions)')


if __name__ == '__main__':
    build_corrections()
