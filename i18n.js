/**
 * i18n Module — Lightweight internationalization for static sites.
 *
 * Language resolution order:
 *  1. localStorage saved preference (user explicitly chose a language)
 *  2. navigator.language / navigator.languages match
 *  3. Default: 'en'
 */

const I18N_STORAGE_KEY = 'lang';
const DEFAULT_LANG = 'en';
const SUPPORTED_LANGS = ['en', 'pt-BR', 'de'];

const LANG_LABELS = {
  'en': 'EN',
  'pt-BR': 'PT',
  'de': 'DE',
};

const LANG_NAMES = {
  'en': 'English',
  'pt-BR': 'Português',
  'de': 'Deutsch',
};

// Cache for loaded translations
const translationCache = {};

/**
 * Detect the best language from the browser's navigator.language(s).
 * Returns a supported lang code or null if no match.
 */
function detectBrowserLang() {
  const langs = navigator.languages ?? [navigator.language];

  for (const browserLang of langs) {
    // Exact match (e.g., "pt-BR")
    if (SUPPORTED_LANGS.includes(browserLang)) {
      return browserLang;
    }

    // Prefix match (e.g., "pt" matches "pt-BR", "de-AT" matches "de")
    const prefix = browserLang.split('-')[0];
    const match = SUPPORTED_LANGS.find((supported) => {
      return supported === prefix || supported.startsWith(prefix + '-');
    });
    if (match) return match;
  }

  return null;
}

/**
 * Resolve the current language.
 * Priority: localStorage > browser detect > default
 */
function resolveLanguage() {
  const stored = localStorage.getItem(I18N_STORAGE_KEY);
  if (stored && SUPPORTED_LANGS.includes(stored)) {
    return stored;
  }

  const detected = detectBrowserLang();
  if (detected) return detected;

  return DEFAULT_LANG;
}

/**
 * Fetch and cache a translation file.
 */
async function loadTranslation(lang) {
  if (translationCache[lang]) {
    return translationCache[lang];
  }

  try {
    const response = await fetch(`i18n/${lang}.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    translationCache[lang] = data;
    return data;
  } catch (err) {
    console.warn(`[i18n] Failed to load ${lang}, falling back to ${DEFAULT_LANG}`, err);
    if (lang !== DEFAULT_LANG) {
      return loadTranslation(DEFAULT_LANG);
    }
    return {};
  }
}

/**
 * Resolve a dotted key path (e.g., "hero.subtitle") from an object.
 */
function getNestedValue(obj, keyPath) {
  return keyPath.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Apply translations to all elements with data-i18n attributes.
 */
function applyTranslations(translations) {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const value = getNestedValue(translations, key);
    if (value != null) {
      el.textContent = value;
    }
  });

  // Handle data-i18n-placeholder, data-i18n-aria-label, etc.
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    const value = getNestedValue(translations, key);
    if (value != null) {
      el.setAttribute('aria-label', value);
    }
  });

  // Update page title and meta description
  const metaTitle = getNestedValue(translations, 'meta.title');
  const metaDesc = getNestedValue(translations, 'meta.description');
  if (metaTitle) document.title = metaTitle;
  if (metaDesc) {
    document.querySelector('meta[name="description"]')?.setAttribute('content', metaDesc);
  }
}

/**
 * Update the language picker to reflect the active language.
 */
function updatePicker(activeLang) {
  document.querySelectorAll('.lang-option').forEach((btn) => {
    const lang = btn.getAttribute('data-lang');
    btn.classList.toggle('active', lang === activeLang);
    btn.setAttribute('aria-current', lang === activeLang ? 'true' : 'false');
  });

  // Update html lang attribute
  const htmlLang = activeLang === 'pt-BR' ? 'pt-BR' : activeLang;
  document.documentElement.setAttribute('lang', htmlLang);
}

/**
 * Switch language, save preference, and apply.
 */
async function switchLanguage(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return;

  localStorage.setItem(I18N_STORAGE_KEY, lang);
  const translations = await loadTranslation(lang);
  applyTranslations(translations);
  updatePicker(lang);
}

/**
 * Build the language picker UI and inject it.
 */
function createLanguagePicker() {
  const currentLang = resolveLanguage();

  // Create picker for desktop nav
  const desktopPicker = document.createElement('div');
  desktopPicker.className = 'lang-picker';
  desktopPicker.setAttribute('role', 'group');
  desktopPicker.setAttribute('aria-label', 'Language selection');

  SUPPORTED_LANGS.forEach((lang) => {
    const btn = document.createElement('button');
    btn.className = 'lang-option';
    btn.setAttribute('data-lang', lang);
    btn.setAttribute('aria-label', LANG_NAMES[lang]);
    btn.setAttribute('aria-current', lang === currentLang ? 'true' : 'false');
    btn.textContent = LANG_LABELS[lang];
    if (lang === currentLang) btn.classList.add('active');

    btn.addEventListener('click', () => switchLanguage(lang));
    desktopPicker.appendChild(btn);
  });

  // Insert into nav-actions (before theme toggle)
  const navActions = document.querySelector('.nav-actions');
  const themeToggle = navActions?.querySelector('.theme-toggle');
  if (navActions && themeToggle) {
    navActions.insertBefore(desktopPicker, themeToggle);
  }

  // Create picker for mobile nav
  const mobilePicker = desktopPicker.cloneNode(true);
  mobilePicker.querySelectorAll('.lang-option').forEach((btn) => {
    btn.addEventListener('click', () => switchLanguage(btn.getAttribute('data-lang')));
  });

  const mobileNav = document.querySelector('.nav-mobile');
  if (mobileNav) {
    mobileNav.appendChild(mobilePicker);
  }
}

/**
 * Initialize i18n system.
 */
async function initI18n() {
  createLanguagePicker();

  const lang = resolveLanguage();
  const translations = await loadTranslation(lang);
  applyTranslations(translations);
  updatePicker(lang);
}

// Run on DOM ready (this script is deferred)
initI18n();
