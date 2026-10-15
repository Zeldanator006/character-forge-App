# Character Forge

An offline character builder for 5th edition (2014 rules) that runs entirely on your phone, tablet or computer. Built-in content is the System Reference Document 5.1; you can add your own entries in Library.

This is the store version of the PC app in [character-forge](https://github.com/Zeldanator006/character-forge). Same screens and the same rules engine, ported to JavaScript so nothing needs a server.

## What works so far

- Step-by-step builder with a live sheet: species, class (multiclass included), background, ability scores, skills, feats, spells, equipment and hit points, with rule checks
- Built-in SRD 5.1 content: 12 classes, 12 subclasses, 9 species, 319 spells
- Characters saved on the device; export one character, or back up and restore everything from Settings
- Library search; add your own spells, feats, backgrounds and other entries
- **Draft with Claude**: describe a character and Claude fills in every step. With an Anthropic API key (Settings) it runs in one tap; without one, copy the app's prompt into a Claude chat and paste the reply back
- **Your PDFs**: add books you own; they stay on the device, their text is searchable, and Claude can pull spells, species, feats, backgrounds, classes and subclasses out of chosen pages
- Works offline once opened (Claude features need a connection), and can be installed to the home screen (Chrome, Android, iOS Safari)

Coming next: importing from web sources, filling PDF character sheets, and the Android/iOS store builds.

### About the API key

The key is saved on the device (IndexedDB) and sent only to Anthropic, straight from the browser. Requests use the official Anthropic SDK with structured outputs, and opt into server-side refusal fallbacks (`fallbacks: "default"`) on models that support them. The default model is Claude Opus 5.5; Settings offers the others.

## Run it

It's plain HTML and JavaScript with no build step. Serve the `www` folder with any static web server:

```
npm start            # same as: python3 -m http.server 8080 --directory www
```

then open http://localhost:8080. (Opening `index.html` straight from disk won't work, because browsers block modules and data files on `file://` pages.)

## Tests

```
npm test
```

- `tests/parity.test.mjs` runs 200 random characters through `www/js/rules.js` and checks every number matches the PC app's Python engine. Regenerate the fixtures with `python3 tools/parity_fixtures.py /path/to/character-forge`.
- `tests/api.test.mjs` exercises the on-device API end to end.
- `tests/claude.test.mjs` covers drafting, PDF extraction and the request sent to Claude, with Claude's side faked (no key or network needed).
- `tests/offline.test.mjs` checks every file the app loads is in the offline cache list.

## Layout

| Path | What it is |
|---|---|
| `www/index.html`, `www/app.js`, `www/style.css` | The interface (adapted from the PC app) |
| `www/js/rules.js` | 2014 rules math, ported from the PC app's `rules.py` |
| `www/js/library.js` | Built-in plus your own entries: search, species traits, class rules, spell lists |
| `www/js/api.js` | The API the interface calls, answered on the device |
| `www/js/store.js` | IndexedDB storage (and an in-memory store for tests) |
| `www/js/claude.js` | Drafting and PDF extraction with Claude (ported from the PC app's `claude_ai.py`) |
| `www/js/pdfs.js` | Your PDFs: text extraction with pdf.js, search, passages for Claude |
| `www/vendor/` | The Anthropic SDK (bundled for the browser) and pdf.js. Rebuilt by `npm run vendor` from the versions pinned in `package.json`; committed so the app needs no build step |
| `www/data/srd-2014.json` | Built-in SRD content, made by `tools/build_srd.py` |
| `www/sw.js`, `www/manifest.webmanifest` | Offline support and home-screen install. Bump `VERSION` in `sw.js` when files change. |

## Content and licensing

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

The SRD data was converted from the [5e-bits database](https://github.com/5e-bits/5e-database) (MIT). Character Forge is unofficial and not affiliated with or endorsed by Wizards of the Coast.
