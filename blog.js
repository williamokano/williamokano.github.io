/**
 * Blog pages are generated one per language, so the page you are reading *is*
 * the language choice — there is nothing to swap at runtime. All this does is
 * remember that choice, so the home page and the next post follow along.
 */

const SUPPORTED_LANGS = ['en', 'pt-BR', 'de'];

(function rememberPageLanguage() {
  const lang = document.documentElement.getAttribute('lang');
  if (!SUPPORTED_LANGS.includes(lang)) return;

  try {
    localStorage.setItem('lang', lang);
  } catch {
    /* Storage unavailable — the visitor simply keeps their per-page language. */
  }
})();
