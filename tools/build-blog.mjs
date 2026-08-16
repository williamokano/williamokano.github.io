#!/usr/bin/env node
/**
 * Blog build — turns content/blog/<slug>/<lang>.md into a static, multilingual blog.
 *
 * Why a build step at all: the rest of the site translates itself in the browser,
 * which is fine for a single page a human already found. Blog posts need to be
 * findable — real URLs, real <title>, real meta description, per-language
 * hreflang — and none of that survives client-side rendering. So posts are
 * compiled to plain HTML at build time and committed alongside the source.
 *
 * Everything under blog/ and the root sitemap.xml is generated. Do not hand-edit
 * them; edit the Markdown and re-run `npm run build`.
 *
 * Usage:
 *   node tools/build-blog.mjs           # write the generated site
 *   node tools/build-blog.mjs --check   # verify the committed output is current (CI)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderMarkdown, parseFrontMatter, countWords, escapeHtml } from './markdown.mjs';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = path.join(ROOT, 'content', 'blog');
const BLOG_DIR = path.join(ROOT, 'blog');

const SITE_URL = 'https://okano.dev';
const AUTHOR = 'William Okano';
const LANGS = ['en', 'pt-BR', 'de'];
const DEFAULT_LANG = 'en';
const WORDS_PER_MINUTE = 220;

const LANG_LABELS = { 'en': 'EN', 'pt-BR': 'PT', 'de': 'DE' };
const LANG_NAMES = { 'en': 'English', 'pt-BR': 'Português', 'de': 'Deutsch' };
const OG_LOCALES = { 'en': 'en_US', 'pt-BR': 'pt_BR', 'de': 'de_DE' };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const listUrl = (lang) => (lang === DEFAULT_LANG ? '/blog/' : `/blog/${lang}/`);
const postUrl = (slug, lang) => (lang === DEFAULT_LANG ? `/blog/${slug}/` : `/blog/${lang}/${slug}/`);
const feedUrl = (lang) => `/blog/feed.${lang}.xml`;
const absolute = (url) => `${SITE_URL}${url}`;
/** '/blog/x/' -> 'blog/x/index.html' (a path relative to the repo root) */
const outputPathFor = (url) => `${url.slice(1)}index.html`;

const escapeXml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Resolve a dotted key path in a translation dictionary. */
function t(dict, keyPath, fallback = '') {
  const value = keyPath.split('.').reduce((current, key) => current?.[key], dict);
  return typeof value === 'string' ? value : fallback;
}

function formatDate(isoDate, lang) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;

  return new Intl.DateTimeFormat(lang, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function readingMinutes(markdownBody) {
  return Math.max(1, Math.round(countWords(markdownBody) / WORDS_PER_MINUTE));
}

// ---------------------------------------------------------------------------
// Content loading
// ---------------------------------------------------------------------------

async function loadDictionaries() {
  const dictionaries = {};

  for (const lang of LANGS) {
    const raw = await fs.readFile(path.join(ROOT, 'i18n', `${lang}.json`), 'utf8');
    dictionaries[lang] = JSON.parse(raw);
  }

  return dictionaries;
}

/**
 * Read every post directory. A post is a directory under content/blog/ holding
 * one file per language it exists in: en.md, pt-BR.md, de.md.
 */
async function loadPosts() {
  let entries = [];
  try {
    entries = await fs.readdir(CONTENT_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return [];
  }

  const posts = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const slug = entry.name;
    const dir = path.join(CONTENT_DIR, slug);
    const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.md'));

    const translations = {};

    for (const file of files) {
      const lang = file.replace(/\.md$/, '');
      if (!LANGS.includes(lang)) {
        throw new Error(`content/blog/${slug}/${file}: "${lang}" is not a supported language`);
      }

      const raw = await fs.readFile(path.join(dir, file), 'utf8');
      const { data, body } = parseFrontMatter(raw, `content/blog/${slug}/${file}`);

      for (const required of ['title', 'summary', 'date']) {
        if (!data[required]) {
          throw new Error(`content/blog/${slug}/${file}: missing "${required}" in front matter`);
        }
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
        throw new Error(`content/blog/${slug}/${file}: date must be YYYY-MM-DD`);
      }

      const { html, headings } = renderMarkdown(body);

      translations[lang] = {
        lang,
        title: data.title,
        summary: data.summary,
        date: data.date,
        updated: data.updated ?? null,
        tags: data.tags ?? [],
        url: postUrl(slug, lang),
        readingMinutes: readingMinutes(body),
        html,
        headings,
      };
    }

    if (!Object.keys(translations).length) {
      throw new Error(`content/blog/${slug}: no Markdown files found`);
    }

    // The primary language is the one a reader falls back to when their own
    // language is missing: English if written, otherwise whatever exists.
    const primaryLanguage = LANGS.find((lang) => translations[lang]);
    const primary = translations[primaryLanguage];

    posts.push({
      slug,
      date: primary.date,
      tags: primary.tags,
      primaryLanguage,
      languages: LANGS.filter((lang) => translations[lang]),
      translations,
    });
  }

  // Newest first; ties broken by slug so the output is deterministic.
  posts.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));

  return posts;
}

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

function renderLangPicker(lang, hrefFor) {
  const options = LANGS.map((code) => {
    const isActive = code === lang;
    return (
      `<a class="lang-option${isActive ? ' active' : ''}" href="${hrefFor(code)}" ` +
      `hreflang="${code}" lang="${code}" data-lang="${code}" ` +
      `aria-label="${escapeHtml(LANG_NAMES[code])}" aria-current="${isActive ? 'true' : 'false'}">` +
      `${LANG_LABELS[code]}</a>`
    );
  }).join('');

  return `<div class="lang-picker" role="group" aria-label="Language selection">${options}</div>`;
}

function renderHeader(lang, dict, hrefFor) {
  const home = `/?lang=${encodeURIComponent(lang)}`;
  const links = [
    [`${home}#about`, t(dict, 'nav.about')],
    [`${home}#projects`, t(dict, 'nav.projects')],
    [`${home}#experience`, t(dict, 'nav.experience')],
    [`${home}#contact`, t(dict, 'nav.contact')],
    [listUrl(lang), t(dict, 'nav.blog')],
  ];

  const anchors = links
    .map(([href, label], i) => {
      const isBlog = i === links.length - 1;
      return `<a href="${href}"${isBlog ? ' class="active" aria-current="page"' : ''}>${escapeHtml(label)}</a>`;
    })
    .join('\n        ');

  return `  <header class="site-header">
    <nav class="nav-container" aria-label="Main navigation">
      <a href="${home}" class="nav-logo" aria-label="${escapeHtml(AUTHOR)}">w<span>.</span>okano</a>

      <div class="nav-links">
        ${anchors}
      </div>

      <div class="nav-actions">
        ${renderLangPicker(lang, hrefFor)}
        <button class="theme-toggle" aria-label="${escapeHtml(t(dict, 'aria.theme_toggle_light'))}"
                data-aria-light="${escapeHtml(t(dict, 'aria.theme_toggle_light'))}"
                data-aria-dark="${escapeHtml(t(dict, 'aria.theme_toggle_dark'))}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
        </button>
        <button class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="nav-mobile" aria-label="Mobile navigation">
        ${anchors}
        ${renderLangPicker(lang, hrefFor)}
      </div>
    </nav>
  </header>`;
}

function renderFooter(lang, dict) {
  return `  <footer class="site-footer">
    <div class="footer-content">
      <p class="footer-tagline">${escapeHtml(t(dict, 'footer.tagline'))}</p>
      <div class="footer-links">
        <a href="/?lang=${encodeURIComponent(lang)}">okano.dev</a>
        <a href="${listUrl(lang)}">${escapeHtml(t(dict, 'nav.blog'))}</a>
        <a href="${feedUrl(lang)}">${escapeHtml(t(dict, 'blog.rss'))}</a>
        <a href="https://github.com/williamokano" target="_blank" rel="noopener">GitHub</a>
        <a href="https://www.linkedin.com/in/williamokano" target="_blank" rel="noopener">LinkedIn</a>
      </div>
    </div>
  </footer>`;
}

/**
 * Full page shell. Generated pages are language-fixed, so their copy is baked in
 * rather than swapped at runtime — no flash of the wrong language, and crawlers
 * see the real text.
 */
function layout({ lang, dict, title, description, canonical, alternates, extraHead = '', body }) {
  const alternateLinks = alternates
    .map((alt) => `  <link rel="alternate" hreflang="${alt.hreflang}" href="${absolute(alt.url)}">`)
    .join('\n');

  const localeAlternates = LANGS.filter((code) => code !== lang)
    .map((code) => `  <meta property="og:locale:alternate" content="${OG_LOCALES[code]}">`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="author" content="${escapeHtml(AUTHOR)}">
  <link rel="canonical" href="${absolute(canonical)}">
${alternateLinks}

  <meta property="og:type" content="article">
  <meta property="og:url" content="${absolute(canonical)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:locale" content="${OG_LOCALES[lang]}">
${localeAlternates}
  <meta property="og:image" content="${SITE_URL}/og-image.png">
  <meta property="og:site_name" content="${escapeHtml(AUTHOR)}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${SITE_URL}/og-image.png">

  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(AUTHOR)} — ${escapeHtml(t(dict, 'blog.title'))} (${LANG_NAMES[lang]})" href="${feedUrl(lang)}">

  <meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#f8fafc" media="(prefers-color-scheme: light)">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/blog.css">

  <script>
    (function () {
      try {
        var theme = localStorage.getItem('theme');
        if (theme !== 'light' && theme !== 'dark') {
          theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        }
        document.documentElement.setAttribute('data-theme', theme);
      } catch (err) {
        /* Storage unavailable — fall back to the CSS defaults. */
      }
    })();
  </script>
${extraHead}
</head>

<body>
  <a href="#main-content" class="skip-link">${escapeHtml(t(dict, 'aria.skip_to_content'))}</a>

${renderHeader(lang, dict, body.hrefFor)}

${body.main}

${renderFooter(lang, dict)}

  <script src="/script.js" defer></script>
  <script src="/blog.js" defer></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function renderPostCard(post, lang, dict) {
  const version = post.translations[lang] ?? post.translations[post.primaryLanguage];
  const versionLang = version.lang;
  const isFallback = versionLang !== lang;

  const readingLabel = t(dict, 'blog.reading_time', '{min} min').replace('{min}', String(version.readingMinutes));
  const tags = (version.tags ?? [])
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');

  return `        <article class="post-list-item glass-card" lang="${versionLang}">
          <p class="article-card-meta">
            <time datetime="${post.date}">${escapeHtml(formatDate(post.date, lang))}</time>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(readingLabel)}</span>
            ${isFallback ? `<span class="lang-badge">${LANG_LABELS[versionLang]}</span>` : ''}
          </p>
          <h2 class="post-list-title"><a href="${version.url}">${escapeHtml(version.title)}</a></h2>
          <p class="post-list-summary">${escapeHtml(version.summary)}</p>
          ${tags ? `<div class="article-card-tags">${tags}</div>` : ''}
          <a class="article-card-link" href="${version.url}">
            <span>${escapeHtml(t(dict, 'blog.read_post'))}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:1em;height:1em;"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </a>
        </article>`;
}

function renderListingPage(lang, dict, posts) {
  const cards = posts.length
    ? posts.map((post) => renderPostCard(post, lang, dict)).join('\n')
    : `        <div class="blog-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><polyline points="14 4 14 10 20 10"/></svg>
          <p>${escapeHtml(t(dict, 'blog.empty'))}</p>
        </div>`;

  const main = `  <main id="main-content" class="blog-page">
    <div class="container">
      <div class="blog-hero">
        <p class="blog-eyebrow"><a href="/?lang=${encodeURIComponent(lang)}">${escapeHtml(t(dict, 'blog.back_home'))}</a></p>
        <h1>${escapeHtml(t(dict, 'blog.title'))}</h1>
        <p class="blog-lede">${escapeHtml(t(dict, 'blog.subtitle'))}</p>
        <a class="feed-link" href="${feedUrl(lang)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:1em;height:1em;"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
          <span>${escapeHtml(t(dict, 'blog.rss'))}</span>
        </a>
      </div>

      <div class="post-list">
${cards}
      </div>
    </div>
  </main>`;

  return layout({
    lang,
    dict,
    title: `${t(dict, 'blog.title')} — ${AUTHOR}`,
    description: t(dict, 'blog.subtitle'),
    canonical: listUrl(lang),
    alternates: [
      ...LANGS.map((code) => ({ hreflang: code, url: listUrl(code) })),
      { hreflang: 'x-default', url: listUrl(DEFAULT_LANG) },
    ],
    body: { main, hrefFor: (code) => listUrl(code) },
  });
}

function renderPostPage(post, lang, dict, neighbours) {
  const version = post.translations[lang];
  const readingLabel = t(dict, 'blog.reading_time', '{min} min').replace('{min}', String(version.readingMinutes));

  const tags = (version.tags ?? [])
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');

  const otherLanguages = post.languages.filter((code) => code !== lang);
  const translationNote = otherLanguages.length
    ? `<p class="post-translations">${escapeHtml(t(dict, 'blog.translations'))}: ` +
      otherLanguages
        .map(
          (code) =>
            `<a href="${post.translations[code].url}" hreflang="${code}" lang="${code}">${escapeHtml(LANG_NAMES[code])}</a>`
        )
        .join(', ') +
      '</p>'
    : `<p class="post-translations post-translations--single">${escapeHtml(t(dict, 'blog.only_in_this_language'))}</p>`;

  const pagerLink = (neighbour, labelKey, className) => {
    if (!neighbour) return '';
    const targetLang = neighbour.languages.includes(lang) ? lang : neighbour.primaryLanguage;
    const target = neighbour.translations[targetLang];
    return `        <a class="post-pager-link ${className}" href="${target.url}" lang="${targetLang}">
          <span class="post-pager-label">${escapeHtml(t(dict, labelKey))}</span>
          <span class="post-pager-title">${escapeHtml(target.title)}</span>
        </a>`;
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: version.title,
    description: version.summary,
    datePublished: post.date,
    dateModified: version.updated ?? post.date,
    inLanguage: lang,
    keywords: (version.tags ?? []).join(', '),
    author: { '@type': 'Person', name: AUTHOR, url: SITE_URL },
    publisher: { '@type': 'Person', name: AUTHOR, url: SITE_URL },
    mainEntityOfPage: { '@type': 'WebPage', '@id': absolute(version.url) },
  };

  const extraHead = `  <meta property="article:published_time" content="${post.date}">
${(version.tags ?? []).map((tag) => `  <meta property="article:tag" content="${escapeHtml(tag)}">`).join('\n')}
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>`;

  const main = `  <main id="main-content" class="blog-page">
    <div class="container post-container">
      <p class="blog-eyebrow"><a href="${listUrl(lang)}">&#8592; ${escapeHtml(t(dict, 'blog.back_to_blog'))}</a></p>

      <article class="post">
        <header class="post-header">
          <h1>${escapeHtml(version.title)}</h1>
          <p class="post-meta">
            <time datetime="${post.date}">${escapeHtml(formatDate(post.date, lang))}</time>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(readingLabel)}</span>
          </p>
          ${tags ? `<div class="article-card-tags">${tags}</div>` : ''}
          <p class="post-summary">${escapeHtml(version.summary)}</p>
          ${translationNote}
        </header>

        <div class="prose">
${version.html}
        </div>
      </article>

      <nav class="post-pager" aria-label="${escapeHtml(t(dict, 'blog.back_to_blog'))}">
${pagerLink(neighbours.newer, 'blog.newer', 'post-pager-link--newer')}
${pagerLink(neighbours.older, 'blog.older', 'post-pager-link--older')}
      </nav>

      <p class="post-footer-cta">
        <a class="btn btn-outline" href="${listUrl(lang)}">${escapeHtml(t(dict, 'blog.back_to_blog'))}</a>
      </p>
    </div>
  </main>`;

  return layout({
    lang,
    dict,
    title: `${version.title} — ${AUTHOR}`,
    description: version.summary,
    canonical: version.url,
    alternates: [
      ...post.languages.map((code) => ({ hreflang: code, url: post.translations[code].url })),
      { hreflang: 'x-default', url: post.translations[post.primaryLanguage].url },
    ],
    extraHead,
    // A language the post was not written in leads to that language's listing.
    body: {
      main,
      hrefFor: (code) => (post.languages.includes(code) ? post.translations[code].url : listUrl(code)),
    },
  });
}

function renderFeed(lang, dict, posts) {
  const items = posts
    .filter((post) => post.languages.includes(lang))
    .map((post) => {
      const version = post.translations[lang];
      const pubDate = new Date(`${post.date}T09:00:00Z`).toUTCString();

      return `    <item>
      <title>${escapeXml(version.title)}</title>
      <link>${absolute(version.url)}</link>
      <guid isPermaLink="true">${absolute(version.url)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(version.summary)}</description>
${(version.tags ?? []).map((tag) => `      <category>${escapeXml(tag)}</category>`).join('\n')}
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(AUTHOR)} — ${escapeXml(t(dict, 'blog.title'))} (${LANG_NAMES[lang]})</title>
    <link>${absolute(listUrl(lang))}</link>
    <description>${escapeXml(t(dict, 'blog.subtitle'))}</description>
    <language>${lang}</language>
    <atom:link href="${absolute(feedUrl(lang))}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

function renderSitemap(posts) {
  const entry = (url, alternates) => `  <url>
    <loc>${absolute(url)}</loc>
${alternates.map((alt) => `    <xhtml:link rel="alternate" hreflang="${alt.hreflang}" href="${absolute(alt.url)}"/>`).join('\n')}
  </url>`;

  const homeAlternates = LANGS.map((lang) => ({ hreflang: lang, url: lang === DEFAULT_LANG ? '/' : `/?lang=${lang}` }));
  const listingAlternates = LANGS.map((lang) => ({ hreflang: lang, url: listUrl(lang) }));

  const urls = [
    entry('/', homeAlternates),
    ...LANGS.map((lang) => entry(listUrl(lang), listingAlternates)),
    ...posts.flatMap((post) => {
      const alternates = post.languages.map((lang) => ({ hreflang: lang, url: post.translations[lang].url }));
      return post.languages.map((lang) => entry(post.translations[lang].url, alternates));
    }),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

function renderIndexJson(posts) {
  return `${JSON.stringify(
    {
      generator: 'tools/build-blog.mjs',
      languages: LANGS,
      defaultLanguage: DEFAULT_LANG,
      posts: posts.map((post) => ({
        slug: post.slug,
        date: post.date,
        tags: post.tags,
        primaryLanguage: post.primaryLanguage,
        languages: post.languages,
        translations: Object.fromEntries(
          post.languages.map((lang) => {
            const version = post.translations[lang];
            return [
              lang,
              {
                title: version.title,
                summary: version.summary,
                url: version.url,
                readingMinutes: version.readingMinutes,
                tags: version.tags,
              },
            ];
          })
        ),
      })),
    },
    null,
    2
  )}\n`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function build() {
  const dictionaries = await loadDictionaries();
  const posts = await loadPosts();

  /** @type {Map<string, string>} repo-relative path -> file contents */
  const outputs = new Map();

  for (const lang of LANGS) {
    const dict = dictionaries[lang];

    outputs.set(outputPathFor(listUrl(lang)), renderListingPage(lang, dict, posts));
    outputs.set(`blog/feed.${lang}.xml`, renderFeed(lang, dict, posts));

    for (const [index, post] of posts.entries()) {
      if (!post.languages.includes(lang)) continue;

      const neighbours = { newer: posts[index - 1] ?? null, older: posts[index + 1] ?? null };
      outputs.set(outputPathFor(post.translations[lang].url), renderPostPage(post, lang, dict, neighbours));
    }
  }

  outputs.set('blog/posts.json', renderIndexJson(posts));
  outputs.set('sitemap.xml', renderSitemap(posts));

  return { outputs, posts };
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Every file currently committed under blog/, as repo-relative paths. */
async function listExistingBlogFiles() {
  const found = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        found.push(path.relative(ROOT, full));
      }
    }
  }

  await walk(BLOG_DIR);
  return found;
}

async function writeOutputs(outputs) {
  // blog/ is generated in full: clearing it first means renamed or deleted posts
  // cannot leave orphaned pages behind.
  await fs.rm(BLOG_DIR, { recursive: true, force: true });

  for (const [relativePath, contents] of outputs) {
    const full = path.join(ROOT, relativePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents, 'utf8');
  }
}

async function checkOutputs(outputs) {
  const problems = [];

  for (const [relativePath, expected] of outputs) {
    const actual = await readIfExists(path.join(ROOT, relativePath));
    if (actual === null) problems.push(`missing:   ${relativePath}`);
    else if (actual !== expected) problems.push(`outdated:  ${relativePath}`);
  }

  for (const relativePath of await listExistingBlogFiles()) {
    if (!outputs.has(relativePath)) problems.push(`orphaned:  ${relativePath}`);
  }

  return problems;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const { outputs, posts } = await build();

  if (checkOnly) {
    const problems = await checkOutputs(outputs);

    if (problems.length) {
      console.error('The generated blog is out of date. Run `npm run build` and commit the result.\n');
      problems.forEach((problem) => console.error(`  ${problem}`));
      process.exitCode = 1;
      return;
    }

    console.log(`Blog output is up to date (${posts.length} posts, ${outputs.size} files).`);
    return;
  }

  await writeOutputs(outputs);

  const translationCount = posts.reduce((total, post) => total + post.languages.length, 0);
  console.log(`Built ${posts.length} posts (${translationCount} translations) into ${outputs.size} files.`);
  for (const post of posts) {
    console.log(`  ${post.date}  ${post.slug}  [${post.languages.join(', ')}]`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
