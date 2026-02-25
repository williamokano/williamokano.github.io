/**
 * Personal Developer Landing Page
 * Vanilla JS — no frameworks, no dependencies.
 * Loaded with `defer`; DOM is ready when this executes.
 */

// ---------------------------------------------------------------------------
// Constants & Configuration
// ---------------------------------------------------------------------------

const SCROLL_THRESHOLD = 50;
const THEME_STORAGE_KEY = 'theme';
const TYPING_SPEED_MS = 35;
const TYPING_CURSOR_CLASS = 'typing-cursor';
const THROTTLE_MS = 16; // ~60 fps

// ---------------------------------------------------------------------------
// DOM References (resolved once at init)
// ---------------------------------------------------------------------------

const dom = {
  header:        () => document.querySelector('header.site-header'),
  navToggle:     () => document.querySelector('.nav-toggle'),
  navLinks:      () => document.querySelectorAll('.site-header nav a[href^="#"]'),
  themeToggle:   () => document.querySelector('.theme-toggle'),
  heroSubtitle:  () => document.querySelector('.hero-subtitle'),
  revealEls:     () => document.querySelectorAll('.reveal'),
  sections:      () => document.querySelectorAll('section[id]'),
};

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/** Returns true when the user prefers reduced motion. */
const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Classic trailing-edge throttle backed by rAF for scroll handlers.
 * Returns a function that calls `fn` at most once per `limit` ms,
 * scheduled inside requestAnimationFrame for paint-aligned updates.
 */
function throttle(fn, limit = THROTTLE_MS) {
  let waiting = false;
  let lastArgs = null;

  return function (...args) {
    lastArgs = args;
    if (waiting) return;
    waiting = true;

    requestAnimationFrame(() => {
      fn.apply(this, lastArgs);
      setTimeout(() => { waiting = false; }, limit);
    });
  };
}

/**
 * Return all focusable elements inside a container.
 */
function getFocusableElements(container) {
  return container.querySelectorAll(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
  );
}

// ---------------------------------------------------------------------------
// 1. Scroll Reveal System
// ---------------------------------------------------------------------------

function initScrollReveal() {
  const elements = dom.revealEls();
  if (!elements.length) return;

  if (prefersReducedMotion()) {
    elements.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const el = entry.target;

        // Staggered children: compute delay from sibling index
        const parent = el.parentElement;
        if (parent?.classList.contains('stagger')) {
          const siblings = [...parent.querySelectorAll(':scope > .reveal')];
          const index = siblings.indexOf(el);
          el.style.transitionDelay = `${index * 100}ms`;
        }

        el.classList.add('is-visible');
        observer.unobserve(el);
      });
    },
    {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px',
    }
  );

  elements.forEach((el) => observer.observe(el));
}

// ---------------------------------------------------------------------------
// 2. Navigation Behavior
// ---------------------------------------------------------------------------

function initNavigation() {
  const header = dom.header();
  if (!header) return;

  const navToggleBtn = dom.navToggle();
  const navLinks     = dom.navLinks();
  const sections     = dom.sections();

  // --- Scrolled header class ---
  const updateHeaderClass = throttle(() => {
    header.classList.toggle('scrolled', window.scrollY > SCROLL_THRESHOLD);
  });

  window.addEventListener('scroll', updateHeaderClass, { passive: true });
  updateHeaderClass();

  // --- Smooth scroll on nav link click ---
  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      const target   = document.querySelector(targetId);
      if (!target) return;

      e.preventDefault();
      closeMobileMenu();

      target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      history.pushState(null, '', targetId);
    });
  });

  // --- Active nav link highlighting via IntersectionObserver ---
  if (sections.length && navLinks.length) {
    const activateLink = (id) => {
      navLinks.forEach((link) => {
        const isMatch = link.getAttribute('href') === `#${id}`;
        link.classList.toggle('active', isMatch);
        link.setAttribute('aria-current', isMatch ? 'true' : 'false');
      });
    };

    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible.length) {
          activateLink(visible[0].target.id);
        }
      },
      {
        threshold: [0, 0.25, 0.5, 0.75, 1],
        rootMargin: '-80px 0px -40% 0px',
      }
    );

    sections.forEach((s) => sectionObserver.observe(s));
  }

  // --- Mobile menu toggle ---
  function openMobileMenu() {
    header.classList.add('nav-open');
    navToggleBtn?.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';

    const firstLink = header.querySelector('.nav-mobile a');
    firstLink?.focus();

    document.addEventListener('click', onOutsideClick);
    document.addEventListener('keydown', onMenuKeydown);
  }

  function closeMobileMenu() {
    if (!header.classList.contains('nav-open')) return;

    header.classList.remove('nav-open');
    navToggleBtn?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';

    document.removeEventListener('click', onOutsideClick);
    document.removeEventListener('keydown', onMenuKeydown);

    navToggleBtn?.focus();
  }

  function onOutsideClick(e) {
    if (!header.contains(e.target)) {
      closeMobileMenu();
    }
  }

  function onMenuKeydown(e) {
    if (e.key === 'Escape') {
      closeMobileMenu();
      return;
    }

    if (e.key === 'Tab') {
      const focusable = getFocusableElements(header);
      if (!focusable.length) return;

      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  navToggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    header.classList.contains('nav-open') ? closeMobileMenu() : openMobileMenu();
  });
}

// ---------------------------------------------------------------------------
// 3. Theme Toggle
// ---------------------------------------------------------------------------

function initThemeToggle() {
  const btn  = dom.themeToggle();
  const root = document.documentElement;

  function getInitialTheme() {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;

    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    const targetMode = theme === 'dark' ? 'light' : 'dark';
    const label = targetMode === 'light'
      ? (btn?.dataset.ariaLight || 'Switch to light mode')
      : (btn?.dataset.ariaDark || 'Switch to dark mode');
    btn?.setAttribute('aria-label', label);
  }

  applyTheme(getInitialTheme());

  btn?.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') ?? 'dark';
    const next    = current === 'dark' ? 'light' : 'dark';

    btn.classList.add('theme-toggle--animating');
    btn.addEventListener(
      'transitionend',
      () => btn.classList.remove('theme-toggle--animating'),
      { once: true }
    );

    applyTheme(next);
  });
}

// ---------------------------------------------------------------------------
// 4. Typing Effect (Hero Section)
// ---------------------------------------------------------------------------

let _typingTimer = null;

/**
 * Type text into the hero subtitle with a character-by-character animation.
 * Called by the i18n module after translations are loaded or switched.
 * Cancels any in-progress typing before starting.
 */
window.typeHeroSubtitle = function (text) {
  const el = dom.heroSubtitle();
  if (!el || !text) return;

  // Cancel any in-progress typing
  if (_typingTimer != null) {
    clearTimeout(_typingTimer);
    _typingTimer = null;
  }

  el.setAttribute('aria-label', text);

  if (prefersReducedMotion()) {
    el.textContent = text;
    el.classList.remove(TYPING_CURSOR_CLASS);
    return;
  }

  el.textContent = '';
  el.classList.add(TYPING_CURSOR_CLASS);

  let index = 0;

  function typeChar() {
    if (index < text.length) {
      el.textContent += text[index];
      index++;
      _typingTimer = setTimeout(typeChar, TYPING_SPEED_MS);
    } else {
      _typingTimer = setTimeout(() => {
        el.classList.remove(TYPING_CURSOR_CLASS);
        _typingTimer = null;
      }, 1500);
    }
  }

  typeChar();
};

// ---------------------------------------------------------------------------
// 5. Scroll Progress Indicator
// ---------------------------------------------------------------------------

function initScrollProgress() {
  let bar = document.querySelector('.scroll-progress');
  if (!bar) {
    bar = document.createElement('div');
    bar.classList.add('scroll-progress');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Page scroll progress');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    document.body.prepend(bar);
  }

  const update = throttle(() => {
    const scrollTop    = window.scrollY;
    const docHeight    = document.documentElement.scrollHeight - window.innerHeight;
    const progress     = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    const clampedValue = Math.min(100, Math.max(0, progress));

    bar.style.width = `${clampedValue}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(clampedValue)));
  });

  window.addEventListener('scroll', update, { passive: true });
  update();
}

// ---------------------------------------------------------------------------
// 6. Reduced Motion — global handling
// ---------------------------------------------------------------------------

function applyReducedMotionStyles() {
  if (prefersReducedMotion()) {
    document.documentElement.classList.add('reduce-motion');
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

(function init() {
  applyReducedMotionStyles();
  initThemeToggle();
  initScrollReveal();
  initNavigation();
  initScrollProgress();
})();
