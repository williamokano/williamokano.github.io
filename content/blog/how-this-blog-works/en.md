---
title: How this blog works
summary: A colophon. Markdown in, static HTML out, one URL per language, and a CI job that refuses to let the generated output drift from the source.
date: 2026-08-15
tags: [meta, static-site, tooling]
---

This site has no framework, no bundler, and no `node_modules` to audit. It is HTML, CSS, and a few hundred lines of vanilla JavaScript, served by GitHub Pages. When I added a blog I wanted to keep that property, so the blog is a small build step rather than a dependency tree.

## The shape of it

Posts live as Markdown, one directory per post and one file per language:

```
content/blog/
  joining-qonto/
    en.md
    pt-BR.md
    de.md
  how-this-blog-works/
    en.md
```

`node tools/build-blog.mjs` reads that tree and writes real pages:

| Generated | What it is |
|-----------|------------|
| `blog/index.html` | the English listing |
| `blog/de/index.html` | the German listing |
| `blog/joining-qonto/` | the English post |
| `blog/de/joining-qonto/` | the German post |
| `blog/feed.<lang>.xml` | one RSS feed per language |
| `blog/posts.json` | the index the home page reads |
| `sitemap.xml` | every URL, with `hreflang` alternates |

The rest of the site translates itself in the browser, which is fine for a single page someone has already found. Posts are different: they need to be findable. A crawler that runs no JavaScript still has to see the title, the description, and the language — so those are compiled in, not swapped in at runtime.

## Not every post exists in every language

This one only exists in English, and that is the interesting case. Each post declares which languages it was written in simply by which files exist. When you are reading in German and a post has no German version, you get the original with a small badge instead of a broken link or a machine translation I did not write.

The `hreflang` alternates only list the languages a post actually has, so search engines never advertise a page that is not there.

## Keeping the output honest

Generated files are committed — GitHub Pages serves the repository as-is, so they have to be. That creates the usual failure mode: someone edits Markdown, forgets to rebuild, and the published page quietly disagrees with the source.

So the build has a second mode:

```bash
node tools/build-blog.mjs --check
```

It builds into memory, compares against what is committed, and exits non-zero on any file that is missing, outdated, or orphaned. A GitHub Actions workflow runs it on every push. The check is three lines of CI and it removes an entire category of "the website is wrong" bugs.

## The Markdown renderer

There is one, and it is deliberately small — headings, lists, code fences, tables, blockquotes, links, emphasis. Raw HTML in a post is escaped rather than passed through, because posts are content, not templates.

Is it a full CommonMark implementation? No. Will it need a fix the first time I write something it does not handle? Almost certainly. That trade is fine: I would rather own eighty lines of parser I can debug than inherit a dependency chain I cannot.

## Writing a post

Create the directory, write the front matter, run the build:

```bash
mkdir -p content/blog/my-post
$EDITOR content/blog/my-post/en.md
npm run build
```

Front matter is four fields — `title`, `summary`, `date`, `tags` — and the build fails loudly if any of the first three is missing. That is the whole workflow. Adding a translation later means dropping a `de.md` next to the `en.md` and rebuilding; every link, feed, and alternate updates itself.
