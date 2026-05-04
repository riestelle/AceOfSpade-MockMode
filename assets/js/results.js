// MockMode — results.js
// Handles results.html: verdict reveal, score chart,
// strengths/weaknesses display, dynamic compensation package,
// combo streak display, and session reset.
// Depends on: main.js, Chart.js, GSAP (all loaded via CDN in HTML)


// ─── Verdict config ──────────────────────────────────────────────────────────
// Each key maps to: stamp text, status label, CSS data-verdict value,
// interviewer message, and final tip.

const VERDICT_CONFIG = {
  'hired-confident': {
    stamp:          'HIRED',
    status:         'STATUS: CONFIRMED',
    dataVerdict:    'hired',
    defaultMessage: "Textbook performance. You came prepared, stayed composed, and delivered exactly what we needed. Welcome aboard — don't make us regret it.",
    defaultTip:     'Keep documenting your wins. The next review comes sooner than you think.',
  },
  'hired-lucky': {
    stamp:          'HIRED',
    status:         'STATUS: CONFIRMED',
    dataVerdict:    'hired-lucky',
    defaultMessage: "You scraped through — high stress, but your answers pulled you back from the edge. You got the job. Barely. Impress us in Week 1.",
    defaultTip:     'High stress responses cost you clarity. Practice staying calm under pressure.',
  },
  'waitlisted': {
    stamp:          'WAITLISTED',
    status:         'STATUS: PENDING',
    dataVerdict:    'waitlisted',
    defaultMessage: "Not bad. Not great. You showed potential but left too much on the table. We're keeping your file — but don't wait by the phone.",
    defaultTip:     'Sharpen your answers on experience-based questions. Be specific, not general.',
  },
  'fired-breakdown': {
    stamp:          'FIRED',
    status:         'STATUS: TERMINATED',
    dataVerdict:    'fired-breakdown',
    defaultMessage: "You cracked under pressure. The stress got to you before the questions did. This wasn't about skill — it was about composure. Try again when you're ready.",
    defaultTip:     'Simulate high-pressure interviews. Familiarity kills anxiety.',
  },
  'fired-technical': {
    stamp:          'FIRED',
    status:         'STATUS: REJECTED',
    dataVerdict:    'fired-technical',
    defaultMessage: "The technical gaps were too wide. Vague answers in a precision role don't cut it. Study the fundamentals and come back with receipts.",
    defaultTip:     'For technical roles: always back answers with concrete examples or numbers.',
  },
  'fired-attitude': {
    stamp:          'FIRED',
    status:         'STATUS: BLACKLISTED',
    dataVerdict:    'fired-attitude',
    defaultMessage: "The answers weren't the only problem. Your approach rubbed the panel the wrong way. Skills can be trained. Attitude is harder to fix.",
    defaultTip:     'In strict environments: be concise, direct, and leave the ego at the door.',
  },
};


// ─── Compensation package config ─────────────────────────────────────────────
// Maps verdict group → state for each of the 3 cards.
// Each card: { chip, desc, void }
// void = true applies comp--void (greyed out + grayscale)

const COMP_CONFIG = {
  hired: {
    offer:    { chip: 'SIGNED',      desc: 'Legally binding employment agreement across all sectors and sub-terminal layers.',      void: false },
    access:   { chip: 'ISSUED',      desc: 'Clearance for standard cafeteria, dormitory, and core terminal facilities.',             void: false },
    caffeine: { chip: 'PENDING',     desc: 'Subject to availability at regional hub dispensers and supply chain stability.',         void: false },
  },
  waitlisted: {
    offer:    { chip: 'PENDING',     desc: 'Awaiting secondary review. Do not sign anything yet.',                                   void: false },
    access:   { chip: 'PENDING',     desc: 'Provisional access only. Escorted entry required until status is confirmed.',            void: false },
    caffeine: { chip: 'LOCKED',      desc: 'Benefit locked pending final hire decision. Check back in 30 business days.',           void: true  },
  },
  fired: {
    offer:    { chip: 'VOID',        desc: 'Agreement nullified. All terms rescinded effective immediately.',                        void: true  },
    access:   { chip: 'REVOKED',     desc: 'Access denied. Badge deactivated. Security has been notified.',                         void: true  },
    caffeine: { chip: 'CONFISCATED', desc: 'Benefit revoked. Please return any issued dispensary tokens at the front desk.',        void: true  },
  },
};


// ─── Dev / preview seed ───────────────────────────────────────────────────────
// If the URL contains ?mock or ?preview, seed fake data so results.html
// can be viewed and styled without completing the full interview flow.
// Remove this block (or the query param) before shipping to production.

(function seedMockDataIfRequested() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('mock') && !params.has('preview')) return;

  const mockVerdict = {
    verdict:         'HIRED',
    average:         92,
    verdict_message: 'We are pleased to inform you that after careful consideration of your application and interview performance, we are offering you the analyst position. Your technical skills and experience in performance optimization and code quality improvement were particularly impressive. We believe your strengths outweigh your weaknesses and are excited to see you grow with our team.',
    final_tip:       'To further develop as an analyst, focus on seeking out opportunities to lead small projects or mentor junior team members to build your leadership and management skills.',
  };

  saveToStorage('verdict',         mockVerdict);
  saveToStorage('scores',          [88, 95, 90, 93, 94]);
  saveToStorage('resume_analysis', {
    strengths:  ['Strong system design fundamentals', 'Excellent code quality track record', 'Clear communicator under pressure'],
    weaknesses: ['Limited leadership experience', 'Could elaborate more on project impact'],
  });
  saveToStorage('best_combo',      4);
  saveToStorage('peak_stress',     62);
  saveToStorage('personality',     'startup');
  saveToStorage('question_count',  5);

  console.info('[MockMode] 🧪 Mock data seeded. Remove ?mock from URL for production.');
})();


// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const verdict        = getFromStorage('verdict');
  const scores         = getFromStorage('scores');
  const resumeAnalysis = getFromStorage('resume_analysis');
  const combo          = getFromStorage('best_combo');
  const peakStress     = getFromStorage('peak_stress');
  const personality    = getFromStorage('personality');
  const questionCount  = getFromStorage('question_count');
  const sessionComplete = getFromStorage('session_complete');

  // Guard: if critical data is missing, bounce to start
  if (!verdict || !scores) {
    showToast('No results found. Please complete an interview first.', 'warning');
    setTimeout(() => navigateTo('index.html'), 2000);
    return;
  }

  // Guard: stale data check — scores from a previous session may linger
  // even after clearSession() if the page was opened without completing
  // a new interview. session_complete is written last in finishInterview(),
  // so its absence means the stat keys (peak_stress, best_combo, etc.) are
  // from a different run or were never written.
  if (!sessionComplete) {
    console.warn('[MockMode] session_complete token missing — clearing stale data and redirecting.');
    clearSession();
    showToast('Session data incomplete. Please complete an interview first.', 'warning');
    setTimeout(() => navigateTo('index.html'), 2000);
    return;
  }

  // Resolve the full verdict key
  const verdictKey = resolveVerdictKey(verdict);
  const config     = VERDICT_CONFIG[verdictKey] ?? VERDICT_CONFIG['waitlisted'];

  // Populate data (before animations so elements have content)
  applyVerdictData(verdict, config);
  renderStatPanel(peakStress, combo, personality, questionCount);
  renderScoreChart(scores);
  renderResumeInsights(resumeAnalysis);
  renderCompensation(verdictKey);
  renderCombo(combo);
  bindActions();

  // Run entrance animations after a short paint delay
  requestAnimationFrame(() => runEntranceAnimations(verdictKey));
});


// ─── Verdict resolution ───────────────────────────────────────────────────────

/**
 * Determines which of the 6 ending keys applies based on stored verdict data.
 * Falls back to 'waitlisted' if data is ambiguous.
 *
 * @param {{ verdict: string, average: number, personality: string, peak_stress: number }} v
 * @returns {string} one of the VERDICT_CONFIG keys
 */
function resolveVerdictKey(v) {
  const avg    = typeof v.average === 'number' ? v.average : null;
  const result = (v.verdict ?? '').toUpperCase();

  // Score-based override: don't let a 0% average be "waitlisted" or "hired".
  // The AI verdict string is used for flavour, but the math wins for the bucket.
  if (avg !== null) {
    if (avg >= 75) return result === 'HIRED' ? 'hired-confident' : 'hired-lucky';
    if (avg >= 50) return 'waitlisted';
    // avg < 50 → always fired
    if (result === 'FIRED') return 'fired-technical';
    return 'fired-breakdown';
  }

  // Fallback if average somehow missing — trust AI string
  if (result === 'HIRED') return 'hired-confident';
  if (result === 'FIRED') return 'fired-breakdown';
  return 'waitlisted';
}

/**
 * Maps a verdictKey to one of three compensation groups: hired / waitlisted / fired.
 * @param {string} verdictKey
 * @returns {'hired'|'waitlisted'|'fired'}
 */
function verdictToCompGroup(verdictKey) {
  if (verdictKey.startsWith('hired'))    return 'hired';
  if (verdictKey.startsWith('fired'))    return 'fired';
  return 'waitlisted';
}


// ─── Left panel stats ─────────────────────────────────────────────────────────

/**
 * Populates the four stat rows in the Recruit Stats Panel.
 * @param {number|null} peakStress
 * @param {number|null} combo
 * @param {string|null} personality
 * @param {number|null} questionCount
 */
function renderStatPanel(peakStress, combo, personality, questionCount) {
  const stressEl = document.getElementById('stat-stress');
  if (stressEl) {
    stressEl.textContent = (peakStress != null && peakStress !== '') ? `${peakStress}%` : '0%';
  }

  const comboEl = document.getElementById('stat-combo');
  if (comboEl) {
    comboEl.textContent = (combo != null && combo > 0) ? `${combo}x` : '0x';
  }

  const personalityEl = document.getElementById('stat-personality');
  if (personalityEl) {
    personalityEl.textContent = personality ? formatPersonality(personality) : '—';
  }

  const questionsEl = document.getElementById('stat-questions');
  if (questionsEl) {
    // Fall back to 5 (default question count) if not saved
    questionsEl.textContent = (questionCount != null && questionCount !== '') ? `${questionCount}` : '5';
  }
}


// ─── Verdict reveal ───────────────────────────────────────────────────────────

/**
 * Populates all verdict-driven text content (no animation here — GSAP handles that).
 *
 * @param {{ verdict: string, verdict_message: string, final_tip: string, average: number }} v
 * @param {object} config - entry from VERDICT_CONFIG
 */
function applyVerdictData(v, config) {
  const { verdict_message, final_tip, average } = v;

  // Stamp text
  const verdictEl = document.getElementById('verdict-text');
  if (verdictEl) verdictEl.textContent = config.stamp;

  // Status label in portrait
  const statusEl = document.getElementById('status-label');
  if (statusEl) statusEl.textContent = config.status;

  // Page-level color theme
  document.body.dataset.verdict = config.dataVerdict;

  // Average score
  const scoreEl = document.getElementById('verdict-score');
  if (scoreEl && average !== undefined) {
    scoreEl.textContent = `Average Score: ${average}%`;
  }

  // Interviewer message — prefer AI-generated, fall back to config default
  const messageEl = document.getElementById('verdict-message');
  if (messageEl) {
    messageEl.textContent = verdict_message || config.defaultMessage;
  }

  // Actionable tip
  const tipEl = document.getElementById('verdict-tip');
  if (tipEl) {
    const tip = final_tip || config.defaultTip;
    tipEl.innerHTML = `<strong>💡 Tip:</strong> ${tip}`;
  }
}


// ─── Score chart ──────────────────────────────────────────────────────────────

/**
 * Renders a Chart.js bar chart of per-question scores.
 * Green ≥ 75, Yellow ≥ 50, Red < 50.
 * @param {number[]} scores
 */
function renderScoreChart(scores) {
  const canvas = document.getElementById('scores-chart');
  if (!canvas) return;

  if (typeof Chart === 'undefined') {
    console.warn('[MockMode] Chart.js not loaded — skipping chart.');
    return;
  }

  const labels = scores.map((_, i) => `Q${i + 1}`);

  const backgroundColors = scores.map(s => {
    if (s >= 75) return 'rgba(26, 255, 122, 0.75)';
    if (s >= 50) return 'rgba(255, 204, 0, 0.75)';
    return 'rgba(255, 68, 68, 0.75)';
  });

  const borderColors = scores.map(s => {
    if (s >= 75) return '#1aff7a';
    if (s >= 50) return '#ffcc00';
    return '#ff4444';
  });

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Score',
        data: scores,
        backgroundColor: backgroundColors,
        borderColor: borderColors,
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 900, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` Score: ${ctx.parsed.y}/100` },
        },
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: {
            color: 'rgba(255,255,255,0.6)',
            stepSize: 25,
            callback: val => `${val}%`,
          },
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
        x: {
          ticks: { color: 'rgba(255,255,255,0.6)' },
          grid:  { display: false },
        },
      },
    },
  });
}


// ─── Resume insights ──────────────────────────────────────────────────────────

/**
 * Renders strengths and weaknesses lists.
 * @param {{ strengths: string[], weaknesses: string[] } | null} analysis
 */
function renderResumeInsights(analysis) {
  if (!analysis) return;

  const strengthsList  = document.getElementById('strengths-list');
  const weaknessesList = document.getElementById('weaknesses-list');

  if (strengthsList && Array.isArray(analysis.strengths)) {
    strengthsList.innerHTML = analysis.strengths
      .map(s => `<li class="insight-item insight-item--strength">✓ ${s}</li>`)
      .join('');
  }

  if (weaknessesList && Array.isArray(analysis.weaknesses)) {
    weaknessesList.innerHTML = analysis.weaknesses
      .map(w => `<li class="insight-item insight-item--weakness">✕ ${w}</li>`)
      .join('');
  }
}


// ─── Compensation package ─────────────────────────────────────────────────────

/**
 * Updates all 3 compensation cards based on the resolved verdict key.
 * @param {string} verdictKey
 */
function renderCompensation(verdictKey) {
  const group  = verdictToCompGroup(verdictKey);
  const config = COMP_CONFIG[group] ?? COMP_CONFIG['waitlisted'];

  _applyCompCard('comp-offer',    'comp-offer-chip',    'comp-offer-desc',    config.offer);
  _applyCompCard('comp-access',   'comp-access-chip',   'comp-access-desc',   config.access);
  _applyCompCard('comp-caffeine', 'comp-caffeine-chip', 'comp-caffeine-desc', config.caffeine);
}

/**
 * Applies a single compensation card's state.
 * @param {string} cardId
 * @param {string} chipId
 * @param {string} descId
 * @param {{ chip: string, desc: string, void: boolean }} cfg
 */
function _applyCompCard(cardId, chipId, descId, cfg) {
  const card = document.getElementById(cardId);
  const chip = document.getElementById(chipId);
  const desc = document.getElementById(descId);

  if (chip) chip.textContent = cfg.chip;
  if (desc) desc.textContent = cfg.desc;

  if (card) {
    if (cfg.void) {
      card.classList.add('comp--void');
    } else {
      card.classList.remove('comp--void');
    }
  }
}


// ─── Combo streak display ─────────────────────────────────────────────────────

/**
 * Renders the best combo streak stat.
 * @param {number|null} combo
 */
function renderCombo(combo) {
  const el = document.getElementById('combo-display');
  if (!el) return;
  if (combo && combo > 0) {
    el.textContent = `${combo}x`;
  } else {
    el.textContent = '—';
  }
}


// ─── GSAP entrance animations ─────────────────────────────────────────────────

/**
 * Runs the full entrance animation sequence using GSAP.
 * Order: portrait → stat cards stagger → verdict stamp slam.
 * @param {string} verdictKey
 */
function runEntranceAnimations(verdictKey) {
  if (typeof gsap === 'undefined') {
    // GSAP not loaded — make everything visible with null-safe guards
    const portraitCard = document.getElementById('portrait-card');
    if (portraitCard) portraitCard.style.opacity = '1';
    const verdictStamp = document.getElementById('verdict-stamp');
    if (verdictStamp) verdictStamp.style.opacity = '1';
    document.querySelectorAll('.stat-card').forEach(el => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    const verdictText = document.getElementById('verdict-text');
    if (verdictText) verdictText.classList.add('verdict--revealed');
    return;
  }

  const tl = gsap.timeline();

  // 1. Portrait card fades in
  tl.to('#portrait-card', {
    opacity: 1,
    duration: 0.5,
    ease: 'power2.out',
  });

  // 2. Stat cards stagger up
  tl.to('.stat-card', {
    opacity: 1,
    y: 0,
    duration: 0.4,
    stagger: 0.1,
    ease: 'power2.out',
  }, '-=0.2');

  // 3. Verdict stamp slams in with overshoot
  tl.to('#verdict-stamp', {
    opacity: 0.9,
    scale: 1,
    rotation: -12,
    duration: 0.45,
    ease: 'back.out(1.7)',
    onComplete: () => {
      // Add the glow pulse after stamp lands
      const verdictEl = document.getElementById('verdict-text');
      if (verdictEl) verdictEl.classList.add('verdict--revealed');
    },
  }, '-=0.05');

  // 4. For fired endings: brief red flash on the portrait card
  if (verdictKey.startsWith('fired')) {
    tl.to('#portrait-card', {
      boxShadow: '0 0 0 4px #ff4444',
      duration: 0.12,
      yoyo: true,
      repeat: 3,
      ease: 'none',
    }, '+=0.1');
  }

  // 5. For hired endings: brief green flash
  if (verdictKey.startsWith('hired')) {
    tl.to('#portrait-card', {
      boxShadow: '0 0 0 4px #1aff7a',
      duration: 0.12,
      yoyo: true,
      repeat: 2,
      ease: 'none',
    }, '+=0.1');
  }
}


// ─── CTA buttons ──────────────────────────────────────────────────────────────

function bindActions() {
  const tryAgainBtn = document.getElementById('try-again-btn');
  if (tryAgainBtn) {
    tryAgainBtn.addEventListener('click', () => {
      clearSession();
      navigateTo('index.html');
    });
  }

  const printBtn = document.getElementById('print-results-btn');
  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }

  const shareBtn = document.getElementById('share-results-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', shareResults);
  }
}

/**
 * Web Share API with clipboard fallback.
 */
async function shareResults() {
  const verdict  = getFromStorage('verdict');
  const result   = verdict?.verdict ?? 'Interview result';
  const average  = verdict?.average ?? '?';
  const shareText = `I just completed a MockMode AI interview and got: ${result} (avg score: ${average}%) 🎯`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'MockMode — My Interview Result',
        text:  shareText,
        url:   window.location.href,
      });
    } catch (_) {
      // User cancelled — fine
    }
  } else {
    try {
      await navigator.clipboard.writeText(shareText);
      showToast('Result copied to clipboard!', 'success');
    } catch (_) {
      showToast('Could not share. Screenshot this page instead!', 'warning');
    }
  }
}