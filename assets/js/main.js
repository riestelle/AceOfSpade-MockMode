// MockMode — main.js
// Shared utilities used across all pages


// Loader 

/**
 * Shows a full-screen loading overlay with an animated message.
 * @param {string} message - Text to display while loading
 */
function showLoader(message = 'Loading...') {
  let overlay = document.getElementById('mm-loader-overlay');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mm-loader-overlay';
    overlay.innerHTML = `
      <div class="mm-loader-box">
        <div class="mm-loader-spinner"></div>
        <p class="mm-loader-message"></p>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  overlay.querySelector('.mm-loader-message').textContent = message;
  overlay.classList.add('active');
}

/**
 * Hides the full-screen loading overlay.
 */
function hideLoader() {
  const overlay = document.getElementById('mm-loader-overlay');
  if (overlay) overlay.classList.remove('active');
}

// Toast

/**
 * Shows a toast notification that auto-dismisses after 3.5 seconds.
 * @param {string} message - Text to display
 * @param {'success'|'error'|'warning'} type - Controls color/icon
 */
function showToast(message, type = 'success') {
  // Remove any existing toast
  const existing = document.querySelector('.mm-toast');
  if (existing) existing.remove();

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
  };

  const toast = document.createElement('div');
  toast.className = `mm-toast mm-toast--${type}`;
  toast.innerHTML = `
    <span class="mm-toast-icon">${icons[type] ?? '•'}</span>
    <span class="mm-toast-text">${message}</span>
  `;

  document.body.appendChild(toast);

  // Trigger entrance animation on next frame
  requestAnimationFrame(() => toast.classList.add('mm-toast--visible'));

  // Auto-dismiss
  setTimeout(() => {
    toast.classList.remove('mm-toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3500);
}

// Storage helpers

/**
 * Saves a value to localStorage as JSON under a mm_ key.
 * @param {string} key - Storage key (without mm_ prefix)
 * @param {*} value - Any JSON-serializable value
 */
function saveToStorage(key, value) {
  try {
    localStorage.setItem(`mm_${key}`, JSON.stringify(value));
  } catch (err) {
    console.error(`[MockMode] saveToStorage failed for key "${key}":`, err);
  }
}

/**
 * Reads and JSON-parses a value from localStorage.
 * @param {string} key - Storage key (without mm_ prefix)
 * @returns {*} Parsed value, or null if missing / parse error
 */
function getFromStorage(key) {
  try {
    const raw = localStorage.getItem(`mm_${key}`);
    return raw !== null ? JSON.parse(raw) : null;
  } catch (err) {
    console.error(`[MockMode] getFromStorage failed for key "${key}":`, err);
    return null;
  }
}

/**
 * Removes all mm_ keys from localStorage, resetting the session.
 */
function clearSession() {
  const MM_KEYS = [
    'mm_resume',
    'mm_personality',
    'mm_role',
    'mm_questions',
    'mm_scores',
    'mm_resume_analysis',
    'mm_verdict',
    'mm_peak_stress',
    'mm_best_combo',
    'mm_question_count',
  ];

  MM_KEYS.forEach(k => localStorage.removeItem(k));
}

// Navigation 

/**
 * Adds a fade-out class then redirects to a new page.
 * Expects a `.page-transition` or `<body>` to carry the CSS transition.
 * @param {string} page - Target HTML file e.g. 'interview.html'
 */
function navigateTo(page) {
  document.body.classList.add('mm-fade-out');

  // Wait for CSS transition, then redirect
  const delay = 350; // ms — match CSS transition duration
  setTimeout(() => {
    window.location.href = page;
  }, delay);
}

// Formatters 

/**
 * Returns a human-readable label for a personality key.
 * @param {'corporate'|'startup'|'technical'} personality
 * @returns {string}
 */
function formatPersonality(personality) {
  const labels = {
    corporate: 'Strict Corporate',
    startup: 'Chill Startup',
    technical: 'Technical Lead',
  };
  return labels[personality] ?? 'Unknown';
}

// Global CSS injection 
// Inject shared UI styles (loader + toast) once, before DOM is ready.
// This keeps styles co-located with the JS that produces the elements.

(function injectSharedStyles() {
  if (document.getElementById('mm-shared-styles')) return;

  const style = document.createElement('style');
  style.id = 'mm-shared-styles';
  style.textContent = `
    /*  Loader overlay  */
    #mm-loader-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(10, 10, 15, 0.88);
      backdrop-filter: blur(6px);
      align-items: center;
      justify-content: center;
      flex-direction: column;
    }
    #mm-loader-overlay.active {
      display: flex;
    }
    .mm-loader-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
    }
    .mm-loader-spinner {
      width: 48px;
      height: 48px;
      border: 3px solid rgba(255,255,255,0.1);
      border-top-color: var(--accent, #00e5ff);
      border-radius: 50%;
      animation: mm-spin 0.8s linear infinite;
    }
    .mm-loader-message {
      color: #fff;
      font-size: 0.95rem;
      letter-spacing: 0.05em;
      opacity: 0.85;
      margin: 0;
      font-family: inherit;
    }
    @keyframes mm-spin {
      to { transform: rotate(360deg); }
    }

    /*  Toast notification  */
    .mm-toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 0.65rem;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      font-size: 0.9rem;
      font-family: inherit;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      opacity: 0;
      transform: translateY(12px);
      transition: opacity 0.3s ease, transform 0.3s ease;
      max-width: 360px;
    }
    .mm-toast--visible {
      opacity: 1;
      transform: translateY(0);
    }
    .mm-toast--success {
      background: #0d2b1a;
      border: 1px solid #1aff7a;
      color: #1aff7a;
    }
    .mm-toast--error {
      background: #2b0d0d;
      border: 1px solid #ff4444;
      color: #ff4444;
    }
    .mm-toast--warning {
      background: #2b2200;
      border: 1px solid #ffcc00;
      color: #ffcc00;
    }
    .mm-toast-icon {
      font-size: 1rem;
      font-weight: 700;
      flex-shrink: 0;
    }
    .mm-toast-text {
      line-height: 1.4;
    }

    /*  Page transition  */
    body {
      transition: opacity 0.35s ease;
    }
    body.mm-fade-out {
      opacity: 0;
    }
  `;

  // Insert before any other styles so page CSS can override
  const firstStyle = document.querySelector('link, style');
  if (firstStyle) {
    document.head.insertBefore(style, firstStyle);
  } else {
    document.head.appendChild(style);
  }
})();