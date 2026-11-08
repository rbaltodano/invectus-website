# inVectus website

The site for [inVectus](https://github.com/rbaltodano/inVectus), served at
[invectus.app](https://invectus.app) by GitHub Pages from `main` (root). Plain HTML, CSS and
JavaScript; no build step.

- `index.html`, `styles.css`, `main.js`: the page. Colours, type and motion follow the desktop
  app (`src/App.css`, `src/DataCircle.tsx`, `src/motion.ts` in the app repository).
- `assets/ophthalmology-map.js`: the hero map, the real Ophthalmology Research collection
  (5,000 PubMed papers): titles, years, roles and map positions only, no abstracts. Rebuild it
  from the app's CLI exports with `scripts/build_map_data.py`.
- Fonts: Inter and Martian Mono (SIL OFL 1.1; licenses in `assets/fonts/`).

Preview locally (fonts need HTTP, not `file://`):

```sh
python3 -m http.server 8765
```

MIT licensed, like the app. The Claude and OpenAI marks are their owners' trademarks, used only
to name the agent clients.

When publishing CSS or JavaScript changes, refresh the matching asset URL’s `?v=` value in
`index.html` using the first 12 characters of its SHA-256 hash so browsers fetch the new file.
