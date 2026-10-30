# Plotto

[Open Plotto](https://plotto.tedt.org/) · [Illustrated guide](https://plotto.tedt.org/how-to.html) · [Original book scans](https://archive.org/details/plottonewmethodo00cook)

Plotto is a static writing tool based on William Wallace Cook’s *Plotto: A New Method of Plot Suggestion for Writers of Creative Fiction* (1928). It combines a masterplot with linked situations from the book’s 1,462 conflicts and 1,852 variants.

Choose a theme and character-role edition, then generate an outline. Each outline includes a protagonist/action/outcome framework, a main conflict, and linked lead-up and carry-on suggestions. Replace a stage, choose a linked alternative, search for a conflict, name the cast, copy or download an outline, or share a link that restores it exactly.

Use **Your stories** to title the current outline and switch between saved stories. **New story** saves the current work before creating another story; **Save a copy** keeps a separate version of the same outline. Changes to the title, outline, names, edition, and settings save automatically to the open story. **Save story** also saves pending generator settings. Returning to the app reopens the last selected story, including after restarting the browser. Your previous single saved outline is imported as “My saved story,” with its original storage retained as a backup.

Each story keeps its own masterplot, conflict, lead-up, carry-on, cast and generator settings. Shared links open a separate draft; saving or editing it adds a story without replacing the existing stories. Titles are included in copied text, downloads and shared links. If storage fails, switching is blocked and the current work stays open. Changes from another tab are detected before overwriting a newer version; “Save a copy” keeps both versions. Unreadable library data is left intact. An outdated story remains in the library while a new working story is created.

## The story rules

- Masterplots combine one of 15 A clauses, 62 B clauses, and 15 C clauses in one sentence. The display identifies the protagonist, action and outcome clauses by number. Clause letters describe story structure; character symbols A and B describe people.
- The main conflict determines the B clause, except B62, the book’s universal “any sort of complication” clause. Theme and action filters narrow the starting choices; an explicit conflict number takes precedence over a narrower action filter.
- An unspecified protagonist uses A15, “Any Person,” rather than assigning an unsupported personality. An automatic outcome follows an exact, unambiguous reference in the book’s terminal-conflict index for the last complete linked situation; otherwise C15 leaves the outcome open. When a specific outcome is chosen, generation prefers a compatible book-linked carry-on if one is available. Partial excerpts, ambiguous outcomes and unresolved index references are not treated as confirmed endings.
- Lead-ups and carry-ons follow that main variant’s actual references. Semicolons retain their sequence; `or` and comma-separated variant letters offer alternatives.
- Star limits and numbered options select the requested section. Character changes are simultaneous within a change group; transpositions swap both symbols. Added-character instructions remain visible writing notes.
- Names replace complete character symbols in displayed and exported text. All name fields are together in “Names & a starting conflict”: A and B first, followed by detected symbols such as SN, A-3 and F-B, with their roles. “Name characters” above the outline opens this group. Blank fields leave symbols intact. Names stay with their symbols through new suggestions, regeneration, and edition changes; shared links include the names used in that outline.
- Entered names are saved with each story and also provide defaults for new stories. Clear an individual field to forget that default, or use “Clear saved names” to clear the open story’s cast and the defaults. Other saved stories keep their own cast. Shared links restore their own names without overwriting the defaults. If browser storage is unavailable, names still work for the current visit.
- A C clause supplies a writing direction. The display distinguishes an ending listed in the book’s terminal index from a planned outcome not established by the current carry-on. Source links offer situations to adapt, not a guarantee of literal continuity. Develop causes, motives and character relationships to earn the chosen ending, as Cook’s worked examples do. Existing saved masterplots keep their clauses.
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

For optional browser checks, install Playwright separately and run `node tests/browser.mjs`, `node tests/cast-browser.mjs`, `node tests/names-browser.mjs`, `node tests/story-browser.mjs`, `node tests/library-browser.mjs`, and `node tests/masterplot-browser.mjs` against the local server. `node tests/cache-upgrade-browser.mjs` starts an isolated fixture server to verify upgrading with old scripts and data already cached. The persistence and library checks use temporary browser profiles and verify persistence after a full browser restart. `PLAYWRIGHT_MODULE` can point to an existing Playwright module; `PLOTTO_URL` selects another server. Browser screenshots go into the ignored `test-results/` directory.

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
| `js/story-storage.js` | Legacy saved-story reader and generator-settings normalization for library migration. |
| `js/story-library.js` | Titled story library, migration, independent saves, and protection against stale-tab overwrites. |
| `index.html`, `css/app.css` | Generator interface, responsive layout, light/dark appearance and print styles. |
| `scripts/app_assets.py`, `assets/app/` | Generated app modules and styles with matching fingerprints; older versions remain available to cached pages. |
| `plotto-mf.html`, `plotto-fm.html` | Generated readers. Native contents and edition links work without JavaScript. |
| `how-to.html` | Illustrated guide to the app and original method. |
| `scripts/corrections.py`, `corrections.html` | Generated correction history, scan evidence, and explicit editorial decisions. |

Run the build after editing application JavaScript, styles, the source, or the renderer, then commit the generated app assets, HTML and JSON. The generator loads one fingerprinted set of modules and styles, and a matching versioned dataset URL, so a cached older module cannot silently disable new name fields or library controls. Verification checks the generated app assets as well as source fidelity and dataset freshness. The engine tests exercise all 1,852 variants in each edition, in addition to focused checks of the book’s reference rules, including the bare SN symbol in conflict 813.

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
