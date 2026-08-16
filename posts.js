/**
 * Latest Posts — pulls the newest entries from the generated blog index and
 * renders them into the Writing section, in whichever language is active.
 *
 * The index (blog/posts.json) is written by tools/build-blog.mjs. A post can
 * exist in one, two, or all three languages: when the active language is
 * missing, the card falls back to the post's primary language and says so.
 *
 * Loaded before i18n.js, which calls window.renderLatestPosts() every time
 * translations are applied or the visitor switches language.
 */

const LATEST_POSTS_COUNT = 3;
const POSTS_INDEX_URL = 'blog/posts.json';
const LANG_SHORT_LABELS = { 'en': 'EN', 'pt-BR': 'PT', 'de': 'DE' };

let _postsIndexPromise = null;

/** Fetch the generated index once and reuse it for every language switch. */
function loadPostsIndex() {
  if (!_postsIndexPromise) {
    _postsIndexPromise = fetch(POSTS_INDEX_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .catch((err) => {
        console.warn('[blog] Could not load the post index', err);
        return { posts: [] };
      });
  }

  return _postsIndexPromise;
}

/** Resolve a dotted key path against the translation dictionary. */
function translate(translations, keyPath, fallback) {
  const value = keyPath.split('.').reduce((current, key) => current?.[key], translations);
  return typeof value === 'string' ? value : fallback;
}

/** Format an ISO date in the reader's language, e.g. "20 Aug 2026". */
function formatDate(isoDate, lang) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;

  try {
    return new Intl.DateTimeFormat(lang, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return isoDate;
  }
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/**
 * Pick the version of a post to show: the active language when it exists,
 * otherwise the post's primary language.
 */
function pickVersion(post, lang) {
  const preferred = post.translations[lang];
  if (preferred) return { version: preferred, isFallback: false, language: lang };

  const fallbackLang = post.primaryLanguage;
  const version = post.translations[fallbackLang];
  if (!version) return null;

  return { version, isFallback: true, language: fallbackLang };
}

function buildCard(post, lang, translations) {
  const picked = pickVersion(post, lang);
  if (!picked) return null;

  const { version, isFallback, language } = picked;

  const card = element('article', 'article-card glass-card reveal');

  // --- Meta line: date · reading time · (language badge when falling back) ---
  const meta = element('p', 'article-card-meta');

  const time = element('time', null, formatDate(post.date, lang));
  time.setAttribute('datetime', post.date);
  meta.append(time);

  if (version.readingMinutes) {
    const readingLabel = translate(translations, 'blog.reading_time', '{min} min read')
      .replace('{min}', String(version.readingMinutes));
    meta.append(element('span', null, '·'), element('span', null, readingLabel));
  }

  if (isFallback) {
    meta.append(element('span', 'lang-badge', LANG_SHORT_LABELS[language] ?? language));
  }

  card.append(meta);

  // --- Title, summary, link ---
  const title = element('h3', 'article-card-title', version.title);
  const description = element('p', 'article-card-description', version.summary);

  const link = element('a', 'article-card-link');
  link.href = version.url;
  link.setAttribute('lang', language);
  link.append(element('span', null, translate(translations, 'blog.read_post', 'Read post')));

  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.setAttribute('viewBox', '0 0 24 24');
  arrow.setAttribute('fill', 'none');
  arrow.setAttribute('stroke', 'currentColor');
  arrow.setAttribute('stroke-width', '2');
  arrow.setAttribute('stroke-linecap', 'round');
  arrow.setAttribute('stroke-linejoin', 'round');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.style.width = '1em';
  arrow.style.height = '1em';
  arrow.innerHTML = '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>';
  link.append(arrow);

  card.append(title, description, link);

  // The whole card carries the language of the text inside it, so screen
  // readers switch pronunciation on fallback cards.
  card.setAttribute('lang', language);

  return card;
}

/**
 * Render the latest posts. Safe to call repeatedly — it replaces its own output.
 */
window.renderLatestPosts = async function (lang, translations) {
  const container = document.querySelector('[data-latest-posts]');
  if (!container) return;

  const index = await loadPostsIndex();
  const posts = (index.posts ?? []).slice(0, LATEST_POSTS_COUNT);

  container.replaceChildren();

  if (!posts.length) {
    container.append(
      element('p', 'writing-empty', translate(translations, 'blog.empty', 'No posts yet.'))
    );
    return;
  }

  const cards = posts
    .map((post) => buildCard(post, lang, translations))
    .filter(Boolean);

  container.append(...cards);
  window.observeReveals?.(cards);
};
