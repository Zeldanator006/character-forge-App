# Character Forge

An offline character builder for 5th edition (2014 rules) that runs entirely on your phone, tablet or computer. Built-in content is the System Reference Document 5.1; you can add your own entries in Library.

This is the store version of the PC app in [character-forge](https://github.com/Zeldanator006/character-forge). Same screens and the same rules engine, ported to JavaScript so nothing needs a server.

## What works so far

- Step-by-step builder with a live sheet: species, class (multiclass included), background, ability scores, skills, feats, spells, equipment and hit points, with rule checks
- Built-in SRD 5.1 content: 12 classes, 12 subclasses, 9 species, 319 spells
- Characters saved on the device; export one character, or back up and restore everything from Settings
- Library search; add your own spells, feats, backgrounds and other entries
- Works offline once opened, and can be installed to the home screen (Chrome, Android, iOS Safari)

Coming next: Claude drafting, importing from PDFs and web sources, filling PDF character sheets, and the Android/iOS store builds.

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

## Layout

| Path | What it is |
|---|---|
| `www/index.html`, `www/app.js`, `www/style.css` | The interface (adapted from the PC app) |
| `www/js/rules.js` | 2014 rules math, ported from the PC app's `rules.py` |
| `www/js/library.js` | Built-in plus your own entries: search, species traits, class rules, spell lists |
| `www/js/api.js` | The API the interface calls, answered on the device |
| `www/js/store.js` | IndexedDB storage (and an in-memory store for tests) |
| `www/data/srd-2014.json` | Built-in SRD content, made by `tools/build_srd.py` |
| `www/sw.js`, `www/manifest.webmanifest` | Offline support and home-screen install. Bump `VERSION` in `sw.js` when files change. |

## Content and licensing

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

The SRD data was converted from the [5e-bits database](https://github.com/5e-bits/5e-database) (MIT). Character Forge is unofficial and not affiliated with or endorsed by Wizards of the Coast.
