# okano.dev

Source for [okano.dev](https://okano.dev) — a personal site and multilingual blog.
No framework, no bundler, no runtime dependencies. HTML, CSS, and vanilla JavaScript,
served by GitHub Pages from `master`.

## Layout

```
index.html          Home page (single page, translated in the browser)
style.css           Design tokens + all shared components
script.js           Theme, navigation, scroll reveal, progress bar
i18n.js             Language detection, dictionary loading, DOM translation
posts.js            "From the blog" cards on the home page
i18n/<lang>.json    Every string on the home page, one file per language
blog.css / blog.js  Blog-only styles and the language-memory helper

content/blog/       Blog source (Markdown) — edit this
blog/               Blog output (generated) — do not edit
sitemap.xml         Generated
tools/              Build script and Markdown renderer
```

Supported languages: **en** (default), **pt-BR**, **de**.

## Home page copy

All home page text lives in `i18n/<lang>.json` and is applied to elements carrying
`data-i18n="section.key"`. The three files must hold exactly the same key set —
a missing key renders as the English fallback baked into `index.html`.

To check parity after editing:

```bash
node -e '
const fs=require("fs");
const flat=(o,p="")=>Object.entries(o).flatMap(([k,v])=>typeof v==="object"&&v?flat(v,p+k+"."):[p+k]);
const keys=l=>new Set(flat(JSON.parse(fs.readFileSync(`i18n/${l}.json`,"utf8"))));
const en=keys("en");
for (const l of ["pt-BR","de"]) {
  const missing=[...en].filter(k=>!keys(l).has(k));
  console.log(l, missing.length ? "MISSING "+missing.join(", ") : "ok");
}'
```

## Blog

### No posts yet

`content/blog/` is empty, so the blog is in its empty state: the home page hides
the "From the blog" group and the hero's blog button entirely, and `/blog/`
itself says "No posts yet" in the reader's language. Feeds, `posts.json`, and
the sitemap are still generated and valid.

Both surfaces appear on their own the moment the first post is built — nothing
to switch on.

### Writing a post

One directory per post, one Markdown file per language it exists in:

```
content/blog/my-post/
  en.md
  pt-BR.md      # optional
  de.md         # optional
```

Each file starts with front matter:

```markdown
---
title: The title of the post
summary: One or two sentences. Used as the meta description and the card text.
date: 2026-08-16
tags: [go, distributed-systems]
---

The body, in Markdown.
```

`title`, `summary`, and `date` (as `YYYY-MM-DD`) are required — the build fails
loudly without them. `tags` is optional, and may differ per language.

Then rebuild and commit both the source and the output:

```bash
npm run build
```

### A post does not need every language

Whichever files exist define the post's languages. A reader whose language is
missing sees the post in its primary language (English if present, otherwise
whatever exists) with a small badge saying so. `hreflang` alternates only list
languages that actually exist, so search engines never advertise a missing page.

Adding a translation later is just dropping a new file next to the others and
rebuilding — URLs, feeds, listings, and alternates all update themselves.

### URLs

| Language | Listing | Post |
|----------|---------|------|
| en (default) | `/blog/` | `/blog/<slug>/` |
| pt-BR | `/blog/pt-BR/` | `/blog/pt-BR/<slug>/` |
| de | `/blog/de/` | `/blog/de/<slug>/` |

Plus one RSS feed per language at `/blog/feed.<lang>.xml`.

### Markdown support

Headings, paragraphs, bold/italic, inline code, fenced code blocks, links,
images, blockquotes, ordered and unordered lists, pipe tables, and thematic
breaks. Raw HTML inside a post is escaped, not rendered.

## Commands

```bash
npm run build     # regenerate blog/ and sitemap.xml from content/blog/
npm run check     # fail if the committed output has drifted from the source
npm run serve     # serve the site at http://localhost:8000
```

`npm run check` also runs in CI (`.github/workflows/build.yml`) on every push, so
a forgotten rebuild is caught before it reaches the live site.

Everything under `blog/` and the root `sitemap.xml` is generated. The build wipes
and rewrites `blog/` on every run, so anything hand-written there will be lost —
put new pages elsewhere.
