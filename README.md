# Plotto

[Open Plotto](https://plotto.tedt.org/) · [Illustrated guide](https://plotto.tedt.org/how-to.html) · [Original book scans](https://archive.org/details/plottonewmethodo00cook)

Plotto is a static writing tool based on William Wallace Cook’s *Plotto: A New Method of Plot Suggestion for Writers of Creative Fiction* (1928). It combines a masterplot with linked situations from the book’s 1,462 conflicts and 1,852 variants.

Choose a theme and character-role edition, then generate an outline. Each outline includes a protagonist/action/outcome framework, a main conflict, and linked lead-up and carry-on suggestions. Replace a stage, choose a linked alternative, search for a conflict, name the cast, copy or download an outline, or share a link that restores it exactly.

The current story saves automatically in this browser whenever you generate an outline, replace a suggestion, change editions, or edit names. Return to the app to resume the same masterplot, main conflict, lead-up, carry-on, edition, names, and generator settings, including after restarting the browser. Generating another outline replaces the saved story. Opening a shared link shows its story without replacing your saved work until you make a change. Unreadable or outdated saved stories fall back to a new outline; unavailable storage leaves the app usable and offers a shared link as a way to keep the story.

## The story rules

- Masterplots combine one of 15 A clauses, 62 B clauses, and 15 C clauses. Clause letters describe story structure; character symbols A and B describe people.
- The main conflict determines the B clause. Theme and action filters narrow the starting choices; an explicit conflict number takes precedence.
- Lead-ups and carry-ons follow that main variant’s actual references. Semicolons retain their sequence; `or` and comma-separated variant letters offer alternatives.
- Star limits and numbered options select the requested section. Character changes are simultaneous within a change group; transpositions swap both symbols. Added-character instructions remain visible writing notes.
- Names replace complete character symbols in displayed and exported text. A and B have name fields in the options. The app scans the adapted outline and offers optional fields under “Name the supporting cast” for symbols such as A-3 and F-B, with their roles. Blank fields leave the symbols intact. Names stay with their symbols through new suggestions, regeneration, and edition changes; shared links include the names used in that outline.
- Entered names are saved automatically in this browser and restored on future visits, including supporting symbols that do not appear in the current outline. Clear an individual field to forget that name, or use “Clear saved names” in the name options to remove the whole cast. Shared links restore their own names without overwriting your saved cast. If browser storage is unavailable, names still work for the current visit.
- A C clause supplies a writing direction. Linked situations may need further development to reach that outcome. Adapt pronouns, relationships, motives and setting as needed.
- Shared links contain the selected edition, source revision, masterplot clauses, main variant, linked choices, and any names entered. They use no server-side storage. Links to an older source revision report the mismatch and allow a new outline.

The original text includes dated language and prejudiced depictions. Both editions retain that material. The reversed-role edition exchanges gendered language and family relationships.

## Local development

Python 3.12+ and Node.js 22+ are sufficient. There are no application packages to install and no server, API key, database, or paid service to configure.

```sh
python3 scripts/build-all.py
python3 scripts/verify.py
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.js
python3 -m http.server 8765 --bind 127.0.0.1
```

Open [the local preview](http://127.0.0.1:8765/). Use HTTP because the generator fetches its dataset. The linked book editions also work without JavaScript. `npm run build`, `npm test`, `npm run verify`, and `npm run dev` are shortcuts for the corresponding commands.

For optional browser checks, install Playwright separately and run `node tests/browser.mjs`, `node tests/cast-browser.mjs`, `node tests/names-browser.mjs`, and `node tests/story-browser.mjs` against the local server. The saved-name and current-story checks use temporary browser profiles and verify persistence after a full browser restart. `PLAYWRIGHT_MODULE` can point to an existing Playwright module; `PLOTTO_URL` selects another server. Browser screenshots go into the ignored `test-results/` directory.

## Source and build

| Path | Responsibility |
| --- | --- |
| `plotto.txt` | Annotated source text: groups, clauses, conflicts, PRE/POST links, formatting and pronoun hints. |
| `scripts/build.py` | Python 3 renderer for the two linked book editions, including the shared header. |
| `scripts/model.py` | Structured source parser, reference-instruction parser and per-edition data export. |
| `scripts/build-all.py` | Rebuild both readers and datasets from any working directory; stop on a failed build. |
| `scripts/verify.py` | Verify source fidelity, dataset freshness, all variants, shared headers and local navigation. |
| `data/plotto-mf.json`, `data/plotto-fm.json` | Generated browser datasets. Rebuild these rather than editing them. |
| `js/engine.js` | Pure selection, section extraction, character adaptation and export rules. |
| `js/app.js` | Accessible controls, search, rendering, shared links and clipboard/download handling. |
| `js/name-storage.js` | Browser-local character name persistence and recovery when storage is unavailable. |
| `js/story-storage.js` | Current story and generator settings saved in this browser for the next visit. |
| `index.html`, `css/app.css` | Generator interface, responsive layout, light/dark appearance and print styles. |
| `plotto-mf.html`, `plotto-fm.html` | Generated readers. Native contents and edition links work without JavaScript. |
| `how-to.html` | Illustrated guide to the app and original method. |
| `scripts/corrections.py`, `corrections.html` | Generated correction history, scan evidence, and explicit editorial decisions. |

Run the build after editing the source or renderer, then commit the updated HTML and JSON. Verification compares every rendered variant against its source and checks that datasets are current. The engine tests exercise all 1,852 variants in each edition, in addition to focused checks of the book’s reference rules.

The [reference correction ledger](https://plotto.tedt.org/corrections.html) records 24 repairs, with printed forms, corrected targets, scan pages, checksums for the latest audit, and reasoning. The latest audit resolves all 21 formerly unavailable subvariant references: five were transcription errors, and sixteen were already broken in print. Ten editorial repairs normalize a missing suffix to the existing unlettered conflict; six use explicitly documented contextual or numbered-example interpretations. Editorial references carry a dagger in the readers and a visible note and evidence link in generated outlines. No missing story text is invented, and the 1,852-variant inventory is unchanged. Every lead-up and carry-on now resolves to existing variants; the build fails on unknown subvariants. Section references without matching markers remain excluded from generation.

`scripts/fixup.py` is an optional transcription maintenance utility. It writes `plotto_new.txt` for manual review and is not part of the app build.

## Publishing

GitHub Actions rebuilds and verifies the source, runs Python and JavaScript tests, checks that generated files are committed, and publishes through the existing Jekyll/GitHub Pages workflow. `CNAME` retains `plotto.tedt.org`. Build tools and tests are excluded from the published Jekyll output.

The app runs entirely in the browser. Google Fonts supplies typography; the collection itself is served from this repository. The generator makes no external generation requests and keeps the current story and character names in this browser’s local storage and the optional shared link. Saved work stays in this browser; clearing site data removes it.

## Shared TedT.org navigation

The global header loads `https://tedt.org/assets/global-header/v1/header.js`. Menu changes belong in the TedT.org repository. Local fallback links and the appearance bootstrap keep navigation usable while loading. The `tedt-appearance` cookie and shared header synchronize appearance.

The reader build uses `scripts/templates/global-header.html`. Keep that fragment identical in the generator and guide; verification checks all five pages. Global navigation stays separate from Plotto’s application controls.

## Credits

William Wallace Cook wrote the original book, published in 1928. The Internet Archive digitized it in 2012, and Gary Kacmarcik cleaned and annotated the digital text in 2016. This application builds on [Gary’s original project](https://github.com/garykac/plotto).

The Internet Archive hosts the scans used by this project. Consider [supporting its work](https://archive.org/donate/).
