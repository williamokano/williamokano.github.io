/**
 * A small Markdown renderer.
 *
 * Deliberately not a full CommonMark implementation — it covers the subset this
 * blog actually uses and nothing else, so it stays readable and dependency-free.
 * Raw HTML in source files is escaped rather than passed through: posts are
 * content, not templates.
 *
 * Supported: ATX headings, fenced code, blockquotes, ordered/unordered lists,
 * pipe tables, thematic breaks, paragraphs, and the inline set below.
 */

// NUL-delimited sentinel: it cannot occur in Markdown source and, unlike a
// word-shaped placeholder, it does not disturb spacing around a code span.
const CODE_OPEN = '\u0000CODE';
const CODE_CLOSE = '\u0000';

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Turn a heading into a URL fragment: "Why it's slow" -> "why-its-slow". */
export function slugify(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Inline formatting. Code spans are pulled out first so their contents are
 * never treated as emphasis or links.
 */
function renderInline(text) {
  const codeSpans = [];

  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_match, code) => {
    codeSpans.push(code);
    return `${CODE_OPEN}${codeSpans.length - 1}${CODE_CLOSE}`;
  });

  out = out
    // Images: ![alt](src)
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (_m, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy" decoding="async">`
    )
    // Links: [text](href)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
      const external = /^https?:/i.test(href);
      const attrs = external ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${href}"${attrs}>${label}</a>`;
    })
    // Autolinks: <https://example.com>
    .replace(
      /&lt;(https?:\/\/[^\s&]+)&gt;/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>'
    )
    // Bold then italic, longest delimiter first
    .replace(/(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1/g, '<strong>$2</strong>')
    .replace(/(\*|_)(?=\S)([\s\S]+?)(?<=\S)\1/g, '<em>$2</em>');

  return out.replace(
    /\u0000CODE(\d+)\u0000/g,
    (_m, index) => `<code>${codeSpans[Number(index)]}</code>`
  );
}

function renderTableRow(line, cellTag) {
  const cells = line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => `<${cellTag}>${renderInline(cell.trim())}</${cellTag}>`);

  return `<tr>${cells.join('')}</tr>`;
}

const isTableDivider = (line) => /^\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

/**
 * Render Markdown to HTML.
 * Returns the HTML plus the headings found, so callers can build a table of contents.
 */
export function renderMarkdown(source) {
  const lines = String(source).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  const headings = [];

  let index = 0;

  const flushList = (ordered, items) => {
    const tag = ordered ? 'ol' : 'ul';
    html.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`);
  };

  while (index < lines.length) {
    const line = lines[index];

    // --- Blank ---
    if (!line.trim()) {
      index += 1;
      continue;
    }

    // --- Fenced code ---
    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      const language = fence[1];
      const body = [];
      index += 1;

      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence

      const classAttr = language ? ` class="language-${language}"` : '';
      html.push(`<pre><code${classAttr}>${escapeHtml(body.join('\n'))}\n</code></pre>`);
      continue;
    }

    // --- Thematic break ---
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html.push('<hr>');
      index += 1;
      continue;
    }

    // --- Heading ---
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugify(text);
      headings.push({ level, text, id });
      html.push(
        `<h${level} id="${id}">${renderInline(text)}` +
          `<a class="heading-anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>`
      );
      index += 1;
      continue;
    }

    // --- Blockquote ---
    if (/^>\s?/.test(line)) {
      const body = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        body.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      html.push(`<blockquote>${renderMarkdown(body.join('\n')).html}</blockquote>`);
      continue;
    }

    // --- Table ---
    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const head = renderTableRow(line, 'th');
      index += 2;

      const body = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        body.push(renderTableRow(lines[index], 'td'));
        index += 1;
      }

      html.push(
        '<div class="table-scroll"><table>' +
          `<thead>${head}</thead><tbody>${body.join('')}</tbody>` +
          '</table></div>'
      );
      continue;
    }

    // --- Lists ---
    const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      const pattern = isOrdered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items = [];

      while (index < lines.length) {
        const match = lines[index].match(pattern);
        if (match) {
          items.push(match[1]);
          index += 1;
          continue;
        }

        // Continuation line belonging to the previous bullet
        if (items.length && lines[index].trim() && !/^\s*([-*+]|\d+[.)])\s/.test(lines[index])) {
          items[items.length - 1] += ` ${lines[index].trim()}`;
          index += 1;
          continue;
        }

        break;
      }

      flushList(isOrdered, items);
      continue;
    }

    // --- Paragraph ---
    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6}\s|>|```|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[index]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }

    if (paragraph.length) {
      html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    } else {
      // Nothing matched (defensive): emit the line as a paragraph and move on.
      html.push(`<p>${renderInline(lines[index])}</p>`);
      index += 1;
    }
  }

  return { html: html.join('\n'), headings };
}

/** Word count of the Markdown body, ignoring code fences and syntax noise. */
export function countWords(source) {
  const prose = String(source)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[#>*_\-|[\]()]/g, ' ');

  return prose.split(/\s+/).filter(Boolean).length;
}

/**
 * Parse the YAML-ish front matter block at the top of a post.
 * Supports strings, quoted strings, and inline arrays: tags: [a, b]
 */
export function parseFrontMatter(raw, sourcePath) {
  const text = String(raw).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  if (!text.startsWith('---\n')) {
    throw new Error(`${sourcePath}: missing front matter (the file must start with "---")`);
  }

  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    throw new Error(`${sourcePath}: front matter is never closed`);
  }

  const block = text.slice(4, end + 1);
  const body = text.slice(text.indexOf('\n', end + 1) + 1);
  const data = {};

  for (const line of block.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const separator = line.indexOf(':');
    if (separator === -1) {
      throw new Error(`${sourcePath}: cannot parse front matter line "${line}"`);
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((entry) => entry.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      continue;
    }

    value = value.replace(/^["']|["']$/g, '');
    data[key] = value;
  }

  return { data, body };
}
