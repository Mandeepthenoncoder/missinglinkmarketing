# Missing Link website

Static site for Missing Link, integrated marketing communications, Hyderabad.

- `index.html`, `css/styles.css`, `js/main.js`: the page
- `js/pitstop.js`: the Three.js pit stop in the hero (loads Three.js from a CDN). Add `?debug` to the URL and call `pit.seek(seconds)` in the console to check any moment of the story.
- `404.html`, `robots.txt`, `sitemap.xml`, `site.webmanifest`: hosting extras
- `dist/missing-link.html`: the whole site bundled into one file

## Run locally

```bash
python3 -m http.server 4321
```

Then open http://localhost:4321.

## Rebuild the single file

```bash
python3 tools/build_single_file.py
```

## Before launch

- Add logo files for Eiliant Advisors, IMRT and Intelligroup (shown as names for now).
- Confirm the domain (`https://mlinkm.com/` is used in the canonical link, social tags, sitemap and robots).
- The diagnostic form opens the visitor's email app; connect a form service to receive submissions directly.
