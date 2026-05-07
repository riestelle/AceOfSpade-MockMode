// MockMode — interview.js  (updated)
// Manages question flow, AI evaluation, stress meter, and
// transitions to the results page.
// Depends on: main.js, ai.js
// New in this version:
//   - TTS via speakText() (defined in session.realtime.tts.js)
//   - STT via mic button (wired in session.realtime.speech.js)
//   - Skip question button (one per session, +15 stress)
//   - Answer history drawer integration
//   - Loading indicator between questions
//   - Interviewer flavored name/title display
//   - Progress label fix (q-current / q-total spans)

// ── Session state ──────────────────────────────────────────────────────────

let resumeText = null;
let personality = null;
let role = null;
let questions = [];
let scores = [];
let currentIndex = 0;
let stressLevel = 30;     // SPEC: starts at 30, not 0
let peakStressLevel = 30;
let moodScore = 0;      // hidden: -100 to +100, affects AI tone only
let comboCount = 0;      // live combo counter, resets on score < 70
let isProcessing = false;
let skipUsed = false;
let isBossQuestion = false;  // true when currentIndex === 4 (Q5)
let lastAnswerContext = null; // { answer, score } from previous question — used to connect questions
let verdictAttempts = 0;    // counts finishInterview retries — hard-stops at 3

// ── Face expression → stress integration ──────────────────────────────────
// Option B: tracks a running expression summary (tick counts per expression)
//           saved to storage so generateVerdict can reference it.
// Option C: stress spikes only fire after 3+ consecutive ticks of a negative
//           expression — sustained panic, not a random blink.

const FACE_STRESS_EXPRESSIONS = new Set(['fearful', 'angry', 'disgusted', 'sad']);
const FACE_STRESS_SPIKE = {
  fearful:   8,
  angry:     6,
  disgusted: 5,
  sad:       4,
};

// Running totals — counts how many ticks each expression was dominant
const _exprTickCounts = {
  happy: 0, neutral: 0, sad: 0,
  fearful: 0, angry: 0, disgusted: 0, surprised: 0,
};
let _exprTotalTicks = 0;

// Consecutive-tick counter for Option C (sustained spike logic)
let _consecutiveNegTicks = 0;
let _lastNegExpr = null;
const SUSTAINED_TICK_THRESHOLD = 3; // ticks before a stress spike fires

document.addEventListener('mm:face-monitor', (e) => {
  // Only affect stress while an answer is being composed (not mid-AI-response)
  if (isProcessing) return;

  const exprs = e.detail?.expressions;
  if (!exprs) return;

  // Dominant expression this tick
  const [topExpr] = Object.entries(exprs).reduce((a, b) => b[1] > a[1] ? b : a);

  // ── Option B: accumulate expression summary ────────────────────────────
  if (topExpr in _exprTickCounts) {
    _exprTickCounts[topExpr]++;
    _exprTotalTicks++;
  }

  // ── Option C: sustained-expression stress spike ────────────────────────
  if (FACE_STRESS_EXPRESSIONS.has(topExpr)) {
    if (topExpr === _lastNegExpr) {
      _consecutiveNegTicks++;
    } else {
      // Different negative expression — reset streak, start fresh
      _consecutiveNegTicks = 1;
      _lastNegExpr = topExpr;
    }

    if (_consecutiveNegTicks === SUSTAINED_TICK_THRESHOLD) {
      // Sustained panic — fire a real spike
      const spike = FACE_STRESS_SPIKE[topExpr] ?? 4;
      stressLevel = Math.max(0, Math.min(100, stressLevel + spike));
      if (stressLevel > peakStressLevel) peakStressLevel = stressLevel;
      updateStressMeter(stressLevel);
      // Reset so it can fire again after another 3 sustained ticks
      _consecutiveNegTicks = 0;
    }
  } else {
    // Neutral or happy — break the streak
    _consecutiveNegTicks = 0;
    _lastNegExpr = null;
  }
});

// Returns a human-readable expression summary for the verdict prompt.
// e.g. { fearful: "42%", neutral: "50%", happy: "8%" }
// Only expressions that appeared at all are included.
function buildExpressionSummary() {
  if (_exprTotalTicks === 0) return null;
  const summary = {};
  for (const [expr, count] of Object.entries(_exprTickCounts)) {
    if (count > 0) {
      summary[expr] = Math.round((count / _exprTotalTicks) * 100) + '%';
    }
  }
  return summary;
}

// ── Timer state ────────────────────────────────────────────────────────────
// Logic is wired — UI hookup (display element) is frontend's job.
let timerInterval = null;
let timeRemaining = 45;
const TIMER_DURATION = 45; // fallback default
const TIMER_DURATION_BY_PERSONALITY = {
  startup:   45,  // Kai — casual, short answers are fine
  corporate: 60,  // Ms. Reyes — expects structured, polished answers
  technical: 75,  // Dr. Matsuda — needs time for technical depth
};
function getTimerDuration() {
  return TIMER_DURATION_BY_PERSONALITY[personality] ?? TIMER_DURATION;
}

// ── Personality score multipliers (SPEC) ──────────────────────────────────
const PERSONALITY_MULTIPLIER = {
  corporate: 0.9,   // strict  → penalises score
  startup: 1.1,   // chill   → boosts score
  technical: 1.0,   // neutral
};

// ── Boss question multiplier (SPEC) ───────────────────────────────────────
const BOSS_MULTIPLIER = 1.5;  // Q5 score × 1.5 before capping at 100

// ── Interviewer flavoring (NEW) ────────────────────────────────────────────
// Each personality gets a fake name + title for immersion.

const INTERVIEWER_PERSONAS = {
  corporate: {
    label: 'Ms. Reyes',
    title: 'VP of Operations',
    display: 'Ms. Reyes — VP of Operations',
  },
  startup: {
    label: 'Kai',
    title: 'Co-founder & Culture Lead',
    display: 'Kai — Co-founder & Culture Lead',
  },
  technical: {
    label: 'Dr. Matsuda',
    title: 'Principal Engineer',
    display: 'Dr. Matsuda — Principal Engineer',
  },
};

// ── Interviewer Lottie animation map ──────────────────────────────────────
// Maps each personality to its Lottie JSON path and eye definitions.
// Paths are relative to the project root — adjust if your asset folder differs.
const INTERVIEWER_ANIMATIONS = {
  startup: {
    // Kai — Co-founder & Culture Lead
    path: 'assets/animations/kai.json',
    eyes: [
      { left: '28%', top: '30%', w: '14%', h: '8%', color: '#c8b89a' },
      { left: '57%', top: '30%', w: '14%', h: '8%', color: '#c8b89a' },
    ],
  },
  technical: {
    // Dr. Matsuda — Principal Engineer
    path: 'assets/animations/matsuda.json',
    eyes: [
      { left: '27%', top: '28%', w: '14%', h: '8%', color: '#c8b89a' },
      { left: '57%', top: '28%', w: '14%', h: '8%', color: '#c8b89a' },
    ],
  },
  corporate: {
    // Ms. Reyes — VP of Operations
    path: 'assets/animations/reyes.json',
    eyes: [
      { left: '28%', top: '30%', w: '14%', h: '8%', color: '#c8b89a' },
      { left: '57%', top: '30%', w: '14%', h: '8%', color: '#c8b89a' },
    ],
  },
};

// ── CharacterController ────────────────────────────────────────────────────
// Manages the Lottie animation for the active interviewer character.
// startTalking() → play animation
// stopTalking()  → pause at frame 0 (idle)
// destroy()      → cleanup

class CharacterController {
  constructor(containerId, animPath, eyeDefs = []) {
    this.container   = document.getElementById(containerId);
    this.animPath    = animPath;
    this.eyeDefs     = eyeDefs;
    this.anim        = null;
    this.state       = 'stopped';
    this._mouthTimer = null;
    this._lottieWrap = null;
  }

  async init() {
    if (!this.container) throw new Error('[MockMode Lottie] Container not found: ' + this.container);

    this.container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:100%;height:100%;position:relative;';
    this.container.appendChild(wrap);
    this._lottieWrap = wrap;

    this.anim = lottie.loadAnimation({
      container: wrap,
      renderer:  'svg',
      loop:      true,
      autoplay:  false,
      path:      this.animPath,
    });

    return new Promise(resolve => {
      this.anim.addEventListener('DOMLoaded', () => {
        const svgEl = this._lottieWrap?.querySelector('svg');
        if (svgEl) {
          const groups = svgEl.querySelectorAll('g');
          
          groups.forEach(g => {
            const titleEl = g.querySelector(':scope > title');
            if (titleEl) {
              const layerName = titleEl.textContent.trim().toLowerCase();
              
              // DEBUG: Uncomment the line below to see all layer names in your console
              console.log('Lottie Layer Found:', layerName);

              // Improved matching: checks if the name INCLUDES these keywords
              // Look for this block in CharacterController.init()[cite: 2]
              if (
                layerName.includes('group 7') || 
                layerName.includes('background') || 
                layerName.includes('bg') ||
                layerName.includes('solid') ||
                layerName.includes('layer') // Add more keywords if the box persists
              ) {
                g.style.display = 'none';
              }
            }
          });
        }

        const skeleton = document.getElementById('lottie-interviewer-skeleton');
        if (skeleton) skeleton.classList.add('hidden');
        resolve();
      });
      
      setTimeout(resolve, 3000);
    });
  }
  // ── Idle: pause at frame 0
  goIdle() {
    this.state = 'idle';
    if (this.anim) this.anim.goToAndStop(0, true);
    this._stopMouthAnim();
    if (this.container) {
      this.container.classList.remove('is-talking');
      this.container.classList.add('is-idle');
    }
  }

  // ── Talking: play animation + mouth wobble
  startTalking() {
    if (this.state === 'talking') return;
    this.state = 'talking';
    if (this.anim) {
      this.anim.setSpeed(1.0);
      this.anim.play();
    }
    //this._startMouthAnim();
    if (this.container) {
      this.container.classList.remove('is-idle');
      this.container.classList.add('is-talking');
    }
  }

  stopTalking() {
    if (this.state !== 'talking') return;
    this._stopMouthAnim();
    this.goIdle();
  }

  // ── Mouth animation — animates the 'mouth' layer rect in the Lottie SVG
  _startMouthAnim() {
    this._stopMouthAnim();
    const svgEl = this._lottieWrap?.querySelector('svg');
    if (!svgEl) return;

    const mouthEl = this._findLayerEl(svgEl, 'mouth');
    if (!mouthEl) return; // Graceful fallback — animation still plays

    let t = 0;
    const origH = parseFloat(
      mouthEl.getAttribute('height') || mouthEl.style.height || 14
    );

    this._mouthTimer = setInterval(() => {
      const newH = origH + Math.abs(Math.sin(t++ * 0.45)) * (origH * 0.8);
      try {
        mouthEl.setAttribute('height', newH);
        mouthEl.setAttribute(
          'y',
          parseFloat(mouthEl.getAttribute('y') || 0) - (newH - origH) * 0.5
        );
      } catch (_) { /* SVG element may be mid-update */ }
    }, 30);
  }

  _stopMouthAnim() {
    clearInterval(this._mouthTimer);
    this._mouthTimer = null;
  }

  // Traverse Lottie SVG <g> tree to find a group whose title matches layerName
  _findLayerEl(svgEl, layerName) {
    const groups = svgEl.querySelectorAll('g');
    for (const g of groups) {
      const title = g.querySelector(':scope > title');
      if (title && title.textContent.toLowerCase().includes(layerName.toLowerCase())) {
        return g.querySelector('rect, path, ellipse') || g;
      }
    }
    return null;
  }

  destroy() {
    this._stopMouthAnim();
    if (this.anim) { this.anim.destroy(); this.anim = null; }
    if (this.container) this.container.innerHTML = '';
  }
}

// Module-level reference to the active controller — exposed for speakText bridge
let _interviewerCtrl = null;

// ── DOM references ─────────────────────────────────────────────────────────

let dialogueBox = null;
let answerInput = null;
let submitBtn = null;
let skipBtn = null;    // NEW
let stressFill = null;
let stressLabel = null;
let reactionBox = null;
let qCurrentSpan = null;    // FIX: was progressLabel (full element)
let qTotalSpan = null;

// ── Toast notification system ──────────────────────────────────────────────

function showToast(message, type = 'info') {
  const host = document.getElementById('mm-toast-host');
  if (!host) { console.warn('[MockMode] Toast host not found'); return; }

  while (host.children.length >= 4) {
    const oldest = host.firstElementChild;
    if (!oldest) break;
    if (oldest._closeTimeout) {
      clearTimeout(oldest._closeTimeout);
    }
    oldest.remove();
  }

  const toast = document.createElement('div');
  toast.className = `mm-toast ${type}`;
  toast.setAttribute('role', 'alert');

  const content = document.createElement('div');
  content.className = 'mm-toast__content';
  content.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'mm-toast__close';
  closeBtn.innerHTML = '×';
  closeBtn.setAttribute('aria-label', 'Close notification');
  closeBtn.addEventListener('click', () => closeToast(toast));

  toast.appendChild(content);
  toast.appendChild(closeBtn);
  host.appendChild(toast);

  const timeoutId = setTimeout(() => closeToast(toast), 5000);
  toast._closeTimeout = timeoutId;
  toast.addEventListener('click', (e) => {
    if (e.target !== closeBtn && !closeBtn.contains(e.target)) {
      closeToast(toast);
    }
  });
}

function closeToast(toast) {
  if (!toast || toast.classList.contains('closing')) return;

  // Clear auto-close timeout
  if (toast._closeTimeout) {
    clearTimeout(toast._closeTimeout);
  }

  toast.classList.add('closing');
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 200);
}

// Make showToast globally available
window.showToast = showToast;

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  dialogueBox = document.getElementById('dialogue-text');
  answerInput = document.getElementById('answer-input');
  submitBtn = document.getElementById('submit-answer-btn');
  skipBtn = document.getElementById('skip-btn');           // NEW
  stressFill = document.getElementById('stress-fill');
  stressLabel = document.getElementById('stress-label');
  reactionBox = document.getElementById('reaction-box');
  qCurrentSpan = document.getElementById('q-current');         // FIX
  qTotalSpan = document.getElementById('q-total');           // FIX

  resumeText = getFromStorage('resume');
  personality = getFromStorage('personality');
  role = getFromStorage('role') ?? 'general';

  if (!resumeText || !personality) {
    showToast('Session expired. Please start over.', 'warning');
    setTimeout(() => navigateTo('upload.html'), 1500);
    return;
  }

  // ── Set flavored interviewer name ──────────────────────────────────────
  const nameEl = document.getElementById('interviewer-name');
  if (nameEl) {
    const persona = INTERVIEWER_PERSONAS[personality];
    nameEl.textContent = persona ? `${persona.display}:` : `${formatPersonality(personality)}:`;
  }

  // ── Boot the Lottie character animation ────────────────────────────────
  // FIX: Awaited inline so _interviewerCtrl is guaranteed to exist before
  // waitForVoicesThenStart() → startInterview() → askCurrentQuestion() runs.
  // Previously this was a fire-and-forget IIFE, meaning speakText() could
  // call startTalking() while _interviewerCtrl was still null.
  const animDef = INTERVIEWER_ANIMATIONS[personality] ?? INTERVIEWER_ANIMATIONS['corporate'];
  if (typeof lottie !== 'undefined') {
    try {
      _interviewerCtrl = new CharacterController('lottie-interviewer', animDef.path, animDef.eyes);
      await _interviewerCtrl.init();
      _interviewerCtrl.goIdle();
      window._interviewerCtrl = _interviewerCtrl;
      console.info('[MockMode] Lottie character ready.');
    } catch (err) {
      console.warn('[MockMode] Lottie init failed — running without character animation:', err);
    }
  } else {
    console.warn('[MockMode] lottie-web not loaded — character animation skipped.');
  }

  // Load or generate questions — only after Lottie is ready
  const cached = getFromStorage('questions');
  if (Array.isArray(cached) && cached.length === 5) {
    questions = cached;
    // Wait for TTS voices before starting so the loading screen persists
    // until everything is truly ready.
    waitForVoicesThenStart();
  } else {
    await loadQuestions();
  }

  // Wire submit button
  if (submitBtn) submitBtn.addEventListener('click', submitAnswer);

  // Enter key submits (single-line input)
  if (answerInput && answerInput.tagName === 'INPUT') {
    answerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitAnswer();
    });
  }

  // ── Wire skip button (NEW) ─────────────────────────────────────────────
  if (skipBtn) {
    skipBtn.addEventListener('click', skipQuestion);
  }
});

// ── Voice readiness helper ─────────────────────────────────────────────────
// Waits until the browser has loaded TTS voices (or times out after 3 s),
// then hides the loader and kicks off the interview.
// This ensures the loading screen stays up until everything is truly ready.

function waitForVoicesThenStart() {
  const ttsOk = typeof window !== 'undefined' && 'speechSynthesis' in window;
  if (!ttsOk) {
    hideLoader();
    startInterview();
    return;
  }

  // FIX: Check both the browser voice list AND whether test.synthesis.js has
  // already picked a voice (chosenVoice). The synthesis module caches voices
  // independently; if it's already ready we can start immediately without
  // waiting for the voiceschanged event (which may have already fired and been
  // consumed by the synthesis module's own listener).
  const voicesReady = () => {
    const v = window.speechSynthesis.getVoices();
    return v.length > 0;
  };

  if (voicesReady()) {
    hideLoader();
    startInterview();
    return;
  }

  // Voices not yet loaded -- wait for them (max 4 s, up from 3 s to give
  // slow connections and Firefox more breathing room).
  let resolved = false;
  const resolve = () => {
    if (resolved) return;
    resolved = true;
    clearTimeout(timeout);
    clearInterval(poll);
    hideLoader();
    startInterview();
  };

  // Belt-and-suspenders: both the event AND a poll so we never miss it.
  const timeout = setTimeout(resolve, 4000);
  window.speechSynthesis.addEventListener('voiceschanged', resolve, { once: true });

  // Poll every 200ms as fallback for Brave/Firefox which sometimes don't fire
  // voiceschanged reliably.
  const poll = setInterval(() => { if (voicesReady()) resolve(); }, 200);
}

// ── Question generation ────────────────────────────────────────────────────

let loadQuestionsAttempts = 0;
const MAX_LOAD_ATTEMPTS = 2; // 2 retries = 3 total attempts max, then give up

async function loadQuestions() {
  // Hard stop — never recurse past the limit under any circumstance
  if (loadQuestionsAttempts > MAX_LOAD_ATTEMPTS) {
    showToast('AI is currently unavailable. Please try again later.', 'error');
    setTimeout(() => navigateTo('upload.html'), 2000);
    return;
  }

  showLoader('Preparing your interview questions...');
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI timeout")), 15000)
    );

    const generated = await Promise.race([
      generateQuestions(resumeText, personality, role),
      timeout
    ]);
    if (!generated || !Array.isArray(generated) || generated.length !== 5) {
      console.error("Invalid questions:", generated);
      throw new Error('Invalid questions returned from AI.');
    }
    loadQuestionsAttempts = 0; // reset on success
    questions = generated;
    saveToStorage('questions', questions);

    // FIX: Don't hide the loader until TTS voices are actually ready.
    // This prevents the "Preparing your interview..." screen from disappearing
    // while the voice list is still loading, which caused the first question
    // to play silently (or not at all) while the UI was already live.
    waitForVoicesThenStart();
  } catch (err) {
    hideLoader();
    loadQuestionsAttempts++;
    console.error(`[MockMode] generateQuestions failed (attempt ${loadQuestionsAttempts}/${MAX_LOAD_ATTEMPTS + 1}):`, err);
    if (loadQuestionsAttempts <= MAX_LOAD_ATTEMPTS) {
      const delay = loadQuestionsAttempts * 5000; // 5s, 10s — increasing backoff
      showToast(`Could not load questions. Retrying in ${delay / 1000}s... (${loadQuestionsAttempts}/${MAX_LOAD_ATTEMPTS})`, 'error');
      setTimeout(loadQuestions, delay);
    } else {
      loadQuestionsAttempts = 0; // reset so page reload works
      showToast('AI is currently unavailable. Please try again later.', 'error');
      setTimeout(() => navigateTo('upload.html'), 2000);
    }
  }
}

// ── Interview flow ─────────────────────────────────────────────────────────

function startInterview() {
  // FIX #4: Ensure any loader/thinking state is cleared before first question
  if (typeof hideLoader === 'function') hideLoader();
  if (typeof hideThinkingIndicator === 'function') hideThinkingIndicator();

  if (typeof unlockSpeech === 'function') {
    unlockSpeech();
  }

  updateProgressLabel();
  updateStressMeter(30);
  askCurrentQuestion();
}

// ── Timer ──────────────────────────────────────────────────────────────────
// startTimer() / stopTimer() are called around each question.
// Frontend dev wires updateTimerDisplay() to a DOM element.

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startTimer() {
  stopTimer(); // Always clear previous intervals first
  timeRemaining = getTimerDuration();

  // Force immediate UI update to 00:45
  if (typeof updateTimerDisplay === 'function') {
    updateTimerDisplay(timeRemaining);
  }

  console.log("Timer started at:", timeRemaining);

  timerInterval = setInterval(() => {
    timeRemaining--;

    if (typeof updateTimerDisplay === 'function') {
      updateTimerDisplay(timeRemaining);
    }

    if (timeRemaining <= 0) {
      stopTimer();
      handleTimerTimeout();
    }
  }, 1000);
}



function handleTimerTimeout() {
  if (isProcessing) return;

  // Apply penalty
  stressLevel = Math.min(100, stressLevel + 15);
  if (stressLevel > peakStressLevel) peakStressLevel = stressLevel;
  updateStressMeter(stressLevel);

  if (checkLoseCondition()) return;

  // Reset display immediately so it doesn't stay at 0:00
  timeRemaining = getTimerDuration();

  if (answerInput) answerInput.value = '[No answer — time ran out]';
  submitAnswer();
}



// Helper to enable the UI once audio is done or skipped.
// IMPORTANT: This must only be called once per question — callers use
// _safeEnableAnsweringPhase() inside askCurrentQuestion() to enforce that.
function enableAnsweringPhase() {
  // FIX #5: Hide the skip-voice button — audio is now done or skipped
  const skipVoiceBtn = document.getElementById('skip-voice-btn');
  if (skipVoiceBtn) skipVoiceBtn.classList.add('hidden');

  // Unlock answer input
  if (answerInput) {
    answerInput.disabled = false;
    answerInput.placeholder = "Type your answer here...";
    answerInput.focus();
  }
  if (submitBtn) submitBtn.disabled = false;

  // Prepare mic (user must still press the mic button to start recording)
  if (typeof startMicCapture === 'function') {
    try { startMicCapture(); } catch (e) { console.error('[MockMode] startMicCapture error:', e); }
  }

  // FIX #3: Start timer — stopTimer() is called first inside startTimer()
  // so any stale interval from a previous question is always cleared.
  startTimer();
}

async function askCurrentQuestion() {
  if (!dialogueBox) return;

  clearReactionBox();

  // Hide the thinking indicator now that we're starting a new question
  if (typeof hideThinkingIndicator === 'function') hideThinkingIndicator();

  if (answerInput) {
    answerInput.value = '';
    answerInput.disabled = true;
    answerInput.placeholder = "Interviewer is speaking...";
  }
  if (submitBtn) submitBtn.disabled = true;

  const question = questions[currentIndex];
  const skipVoiceBtn = document.getElementById('skip-voice-btn');

  // Ensure skip-voice is hidden at the start of each question
  if (skipVoiceBtn) skipVoiceBtn.classList.add('hidden');

  let questionPrompt = currentIndex > 0 && lastAnswerContext
    ? `React to: "${lastAnswerContext.answer}". Then ask: "${question}"`
    : `Ask: "${question}"`;

  // Guard: only the first call to enableAnsweringPhase per question does anything.
  // This prevents competing timeouts (stream-timeout, TTS-fallback, TTS-onDone)
  // from double-firing the timer / double-disabling the input.
  let _answeringPhaseStarted = false;
  function _safeEnableAnsweringPhase() {
    if (_answeringPhaseStarted) return;
    _answeringPhaseStarted = true;
    enableAnsweringPhase();
  }

  // FIX: Expose _safeEnableAnsweringPhase so the skip-voice button (wired in
  // session.realtime.tts.js) can fire through the guard without double-enabling.
  // Also reset the spurious-interrupt guard flag for this new question.
  window._skipVoiceBridgeFired = false;
  window._skipVoiceBridge = () => {
    window._skipVoiceBridgeFired = true; // tells TTS onerror this was a real skip
    _safeEnableAnsweringPhase();
  };

  let streamFinished = false;

  // FIX: Stream timeout no longer directly calls _safeEnableAnsweringPhase().
  // Instead it routes through speakText() so the timer only starts AFTER the
  // interviewer finishes speaking -- even in the stream-hang fallback path.
  // Previously a 10s stream hang would start the timer immediately, racing
  // against TTS that hadn't even begun yet.
  const streamTimeout = setTimeout(() => {
    if (!streamFinished) {
      streamFinished = true;
      console.warn('[MockMode] Stream timeout -- falling back to raw question text');
      dialogueBox.textContent = question;
      if (skipVoiceBtn) skipVoiceBtn.classList.remove('hidden');
      if (typeof speakText === 'function') {
        const wordCount = question.split(' ').length;
        // FIX: 800ms/word + 5s buffer -- generous enough that TTS always
        // finishes before the safety timeout fires prematurely.
        const estimatedMs = Math.max(10000, wordCount * 800 + 5000);
        const ttsFallback = setTimeout(() => {
          console.warn('[MockMode] TTS fallback (stream-timeout path) -- forcing UI unlock');
          if (window._interviewerCtrl) window._interviewerCtrl.stopTalking();
          _safeEnableAnsweringPhase();
        }, estimatedMs);
        if (window._interviewerCtrl) window._interviewerCtrl.startTalking();
        speakText(question, () => {
          clearTimeout(ttsFallback);
          if (window._interviewerCtrl) window._interviewerCtrl.stopTalking();
          _safeEnableAnsweringPhase();
        });
      } else {
        _safeEnableAnsweringPhase();
      }
    }
  }, 10000);

  try {
    await streamInterviewerMessage(
      questionPrompt,
      personality,
      dialogueBox,
      (fullText) => {
        // Stream is complete -- clear the stream-hang timeout
        streamFinished = true;
        clearTimeout(streamTimeout);

        // Show the skip-voice button NOW, before TTS starts,
        // so the user can skip even if TTS takes a moment to initialise.
        if (skipVoiceBtn) skipVoiceBtn.classList.remove('hidden');

        if (typeof speakText === 'function') {
          // FIX: 800ms/word + 5s buffer. At speech rate ~0.85-1.0 a 60-word question
          // takes ~27-35s. 800ms*60+5s = 53s ceiling -- safely above the real
          // duration but below the 45s answer timer so the interviewer always
          // finishes speaking before the player's clock starts running.
          const textWordCount = (fullText || question).split(' ').length;
          const estimatedMs = Math.max(10000, textWordCount * 800 + 5000);

          const ttsFallback = setTimeout(() => {
            console.warn('[MockMode] TTS fallback timeout -- forcing UI unlock');
            if (window._interviewerCtrl) window._interviewerCtrl.stopTalking();
            _safeEnableAnsweringPhase();
          }, estimatedMs);

          // Start the character animation before TTS speaks
          if (window._interviewerCtrl) window._interviewerCtrl.startTalking();

          // speakText onDone is the ONLY normal path to enableAnsweringPhase.
          // The timer ONLY starts when the interviewer finishes speaking.
          speakText(fullText || question, () => {
            clearTimeout(ttsFallback);
            if (window._interviewerCtrl) window._interviewerCtrl.stopTalking();
            _safeEnableAnsweringPhase();
          });

        } else {
          // TTS not available -- unlock immediately
          _safeEnableAnsweringPhase();
        }
      }
    );

  } catch (err) {
    console.error('[MockMode] streamInterviewerMessage error:', err);
    clearTimeout(streamTimeout);
    dialogueBox.textContent = question;
    // Even on stream error, route through TTS so the timer waits for speech to end
    if (typeof speakText === 'function') {
      if (skipVoiceBtn) skipVoiceBtn.classList.remove('hidden');
      const wordCount = question.split(' ').length;
      const estimatedMs = Math.max(10000, wordCount * 800 + 5000);
      const ttsFallback = setTimeout(() => {
        if (window._interviewerCtrl) window._interviewerCtrl.stopTalking();
        _safeEnableAnsweringPhase();
      }, estimatedMs);
      if (window._interviewerCtrl) window._interviewerCtrl.startTalking();
      speakText(question, () => {
        clearTimeout(ttsFallback);
        if (window._interviewerCtrl) window._interviewerCtrl.stopTalking();
        _safeEnableAnsweringPhase();
      });
    } else {
      _safeEnableAnsweringPhase();
    }
  }
}

// Global voice stopper (called by skip button and when submitting)
function stopVoiceAudio() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

// Wire the Skip Voice button and spacebar shortcut — deferred until DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const skipVoiceBtn = document.getElementById('skip-voice-btn');
  if (skipVoiceBtn) {
    skipVoiceBtn.addEventListener('click', (e) => {
      if (typeof spawnBurst === 'function') spawnBurst(e);
      // FIX: Cancel TTS — the 'interrupted' onerror handler intentionally
      // does NOT call onDone (to avoid double-firing). We call the safe
      // bridge instead so the guard in askCurrentQuestion() is respected.
      window.speechSynthesis && window.speechSynthesis.cancel();
      // Stop character animation immediately on voice skip
      if (window._interviewerCtrl) window._interviewerCtrl.stopTalking();
      if (typeof window._skipVoiceBridge === 'function') {
        window._skipVoiceBridge();
      } else {
        // Fallback if bridge not yet set (shouldn't happen, but safe)
        enableAnsweringPhase();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    const btn = document.getElementById('skip-voice-btn');
    if (e.code === 'Space' && btn && !btn.classList.contains('hidden')) {
      e.preventDefault();
      window.speechSynthesis && window.speechSynthesis.cancel();
      if (window._interviewerCtrl) window._interviewerCtrl.stopTalking();
      if (typeof window._skipVoiceBridge === 'function') {
        window._skipVoiceBridge();
      } else {
        enableAnsweringPhase();
      }
    }
  });
});

// ── Answer submission ──────────────────────────────────────────────────────

async function submitAnswer() {
  if (isProcessing) return;

  const answer = answerInput ? answerInput.value.trim() : '';
  if (!answer) {
    showToast('Type your answer before submitting!', 'warning');
    if (answerInput) answerInput.focus();
    return;
  }

  if (typeof stopMicCapture === 'function') {
    stopMicCapture();
  }

  isProcessing = true;
  stopTimer();  // stop countdown the moment they submit
  if (submitBtn) submitBtn.disabled = true;
  if (skipBtn) skipBtn.disabled = true;
  if (answerInput) answerInput.disabled = true;

  const question = questions[currentIndex];

  showLoader('Evaluating your answer...');

  try {
    const evaluation = await evaluateAnswer(question, answer, personality, role);
    if (!evaluation) throw new Error('Empty evaluation returned.');

    hideLoader();

    // ── Score pipeline ─────────────────────────────────────────────────
    let score = Math.max(0, Math.min(100, evaluation.score ?? 50));

    // 1. Personality multiplier (SPEC: strict ×0.9, chill ×1.1)
    const multiplier = PERSONALITY_MULTIPLIER[personality] ?? 1.0;
    score = Math.round(score * multiplier);

    // 2. Boss question multiplier (SPEC: Q5 ×1.5)
    if (isBossQuestion) {
      score = Math.round(score * BOSS_MULTIPLIER);
    }

    // 3. Cap at 100
    score = Math.max(0, Math.min(100, score));

    scores.push(score);

    // Save context so next question can reference this answer
    lastAnswerContext = { answer, score };

    // ── Mood tracking (hidden, passed to AI on next turn) ──────────────
    // Good answer → mood up, bad answer → mood down
    moodScore = Math.max(-100, Math.min(100, moodScore + (score >= 60 ? 5 : -5)));

    // ── Live combo tracking (SPEC: ≥70, resets on failure) ────────────
    if (score >= 70) {
      comboCount++;
    } else {
      comboCount = 0;
    }

    // ── Stress calculation ─────────────────────────────────────────────
    const stressDelta = Math.max(1, Math.min(10, evaluation.stress_increase ?? 5));
    const stressChange = score >= 60 ? -(stressDelta * 0.5) : stressDelta;
    stressLevel = Math.max(0, Math.min(100, stressLevel + stressChange));
    if (stressLevel > peakStressLevel) peakStressLevel = stressLevel;
    updateStressMeter(stressLevel);

    // ── Lose condition: stress ≥ 100 → instant Fired (SPEC) ───────────
    if (checkLoseCondition()) return;

    showReaction(evaluation);

    // ── Add to history drawer (NEW) ────────────────────────────────────
    if (typeof addToHistory === 'function') {
      addToHistory(question, answer, score);
    }

    if (currentIndex < 4) {
      // ── Branching flag (SPEC: follow-up if score < 60) ────────────
      // Frontend dev reads needsFollowUp to inject a follow-up question.
      // For now the game always advances — branching UI is pending.
      const needsFollowUp = score < 60;
      saveToStorage('needs_follow_up', needsFollowUp);
      saveToStorage('current_mood', moodScore);
      saveToStorage('current_combo', comboCount);

      currentIndex++;
      updateProgressLabel();

      // Show thinking indicator during the 3-second gap (NEW)
      if (typeof showThinkingIndicator === 'function') showThinkingIndicator();

      setTimeout(() => {
        isProcessing = false;
        // Re-enable skip only if not used
        if (skipBtn && !skipUsed) skipBtn.disabled = false;
        askCurrentQuestion();
      }, 3000);
    } else {
      await finishInterview();
    }

  } catch (err) {
    hideLoader();
    console.error('[MockMode] evaluateAnswer failed:', err);
    showToast('AI evaluation failed. Try submitting again.', 'error');
    isProcessing = false;
    if (submitBtn) submitBtn.disabled = false;
    if (skipBtn && !skipUsed) skipBtn.disabled = false;
    if (answerInput) answerInput.disabled = false;
  }
}

// ── Skip question (NEW) ────────────────────────────────────────────────────
// One skip per session. Applies +15 stress penalty and a score of 0.

function skipQuestion() {
  if (isProcessing || skipUsed) return;

  if (typeof stopMicCapture === 'function') {
    stopMicCapture();
  }

  skipUsed = true;
  if (skipBtn) {
    skipBtn.disabled = true;
    skipBtn.title = 'Skip already used this session.';
    skipBtn.innerHTML = `
      <span class="material-symbols-outlined text-base">block</span>
      SKIP USED
    `;
  }

  // +15 stress penalty
  stressLevel = Math.min(100, stressLevel + 15);
  if (stressLevel > peakStressLevel) peakStressLevel = stressLevel; // track peak
  updateStressMeter(stressLevel);
  showToast('Question skipped. +15 stress penalty applied.', 'warning');

  // Log a score of 0 for this question (skipped)
  scores.push(0);

  // Add to history with a skip marker
  const question = questions[currentIndex];
  if (typeof addToHistory === 'function') {
    addToHistory(question, '[Skipped]', 0);
  }

  if (currentIndex < 4) {
    currentIndex++;
    updateProgressLabel();
    if (typeof showThinkingIndicator === 'function') showThinkingIndicator();

    setTimeout(() => {
      isProcessing = false;
      askCurrentQuestion();
    }, 2000);
  } else {
    finishInterview();
  }
}

// ── Reaction display ───────────────────────────────────────────────────────

function showReaction(evaluation) {
  if (!reactionBox) return;
  const { reaction, mood_emoji, feedback, score } = evaluation;
  const sentiment = score >= 75 ? 'positive' : score >= 50 ? 'neutral' : 'negative';

  reactionBox.innerHTML = `
    <div class="reaction reaction--${sentiment}">
      <span class="reaction-emoji">${mood_emoji ?? '😐'}</span>
      <div class="reaction-content">
        <p class="reaction-text">${reaction ?? ''}</p>
        <p class="reaction-feedback">${feedback ?? ''}</p>
      </div>
    </div>
  `;
  reactionBox.classList.add('reaction--visible');
}

function clearReactionBox() {
  if (!reactionBox) return;
  reactionBox.innerHTML = '';
  reactionBox.classList.remove('reaction--visible');
}

// ── Stress meter (BUG FIX: style.height, not style.width) ─────────────────

function updateStressMeter(level) {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));

  if (stressFill) {
    // FIX: thermometer is vertical, so we set height (not width)
    stressFill.style.height = `${clamped}%`;

    if (clamped < 40) {
      stressFill.style.background = 'var(--stress-low, #1aff7a)';
    } else if (clamped < 70) {
      stressFill.style.background = 'var(--stress-mid, #ffcc00)';
    } else {
      stressFill.style.background = 'var(--stress-high, #ff4444)';
    }
  }

  if (stressLabel) {
    stressLabel.textContent = `Stress: ${clamped}%`;
  }
}

// ── Progress label (FIX: update q-current / q-total spans) ────────────────

function updateProgressLabel() {
  // FIX: the HTML has two <span> elements (q-current and q-total),
  // not a single element whose textContent is replaced.
  if (qCurrentSpan) qCurrentSpan.textContent = currentIndex + 1;
  if (qTotalSpan) qTotalSpan.textContent = questions.length || 5;
}

// ── Lose condition ─────────────────────────────────────────────────────────
// SPEC: stress ≥ 100 → instant Fired, bypass normal verdict flow.
// Returns true if the condition was triggered (caller should return early).

function checkLoseCondition() {
  if (stressLevel < 100) return false;

  stopTimer();
  saveToStorage('scores', scores);
  saveToStorage('peak_stress', Math.round(peakStressLevel));
  saveToStorage('personality', personality);
  saveToStorage('question_count', questions.length || scores.length || 5);
  saveToStorage('best_combo', comboCount);
  saveToStorage('current_mood', moodScore);
  saveToStorage('session_complete', Date.now());

  // Force a FIRED verdict without calling the AI
  saveToStorage('verdict', {
    verdict: 'FIRED',
    verdict_message: 'Your stress levels went critical. Interview terminated.',
    final_tip: 'Work on staying calm under pressure.',
    average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    scores,
  });

  showToast('STRESS CRITICAL — Interview terminated!', 'error');
  setTimeout(() => navigateTo('results.html'), 1500);
  return true;
}


// ── Finish interview ───────────────────────────────────────────────────────

async function finishInterview() {
  saveToStorage('scores', scores);

  // ── Save left-panel stat data for results.html ─────────────────────────
  // If stress meter never updated (e.g. AI failures), estimate from scores
  if (peakStressLevel === 0 && scores.length > 0) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    peakStressLevel = Math.round(Math.max(0, 100 - avg));
  }
  saveToStorage('peak_stress', Math.round(peakStressLevel) || 0);
  saveToStorage('personality', personality);
  saveToStorage('question_count', questions.length || scores.length || 5);
  saveToStorage('current_mood', moodScore);
  saveToStorage('current_combo', comboCount);

  // Best combo: longest streak of consecutive scores >= 60
  // Use the scores we just saved to storage to guarantee accuracy
  const finalScores = scores.length > 0 ? scores : (getFromStorage('scores') || []);
  let bestCombo = 0, currentCombo = 0;
  for (const s of finalScores) {
    if (s >= 60) { currentCombo++; bestCombo = Math.max(bestCombo, currentCombo); }
    else { currentCombo = 0; }
  }
  saveToStorage('best_combo', bestCombo);
  saveToStorage('session_complete', Date.now());

  // ── Option B: save expression summary for results page + verdict ───────
  const expressionSummary = buildExpressionSummary();
  if (expressionSummary) {
    saveToStorage('expression_summary', expressionSummary);
  }

  showLoader('Calculating your verdict...');

  try {
    const resumeAnalysis = getFromStorage('resume_analysis');
    if (!resumeAnalysis) throw new Error('Resume analysis not found in storage.');

    const verdict = await generateVerdict(scores, resumeAnalysis, personality, role, expressionSummary);
    if (!verdict) throw new Error('Verdict generation returned empty.');

    saveToStorage('verdict', verdict);
    hideLoader();
    showToast('Interview complete! Revealing your verdict...', 'success');
    setTimeout(() => navigateTo('results.html'), 1200);

  } catch (err) {
    hideLoader();
    console.error('[MockMode] generateVerdict failed:', err);
    verdictAttempts++;
    isProcessing = false;
    console.error(`[MockMode] generateVerdict failed (attempt ${verdictAttempts}/3):`, err);
    if (verdictAttempts < 3) {
      const delay = verdictAttempts * 3000; // 3s, 6s — increasing backoff
      showToast(`Could not generate verdict. Retrying in ${delay / 1000}s...`, 'error');
      setTimeout(finishInterview, delay);
    } else {
      // Hard stop — navigate anyway with whatever scores we have
      showToast('Could not generate verdict. Showing partial results.', 'error');
      saveToStorage('verdict', {
        verdict: 'UNKNOWN',
        verdict_message: 'The AI could not be reached to generate your verdict.',
        final_tip: 'Please try again later.',
        average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
        scores,
      });
      setTimeout(() => navigateTo('results.html'), 1500);
    }
  }
}
// ── Timer UI Bridge ──
// asset.interview.js calls this every second[cite: 1]
function updateTimerDisplay(seconds) {
  const display = document.getElementById('timer-display');
  const container = document.getElementById('timer-container');
  if (!display || !container) return;

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  display.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  // Visual warning when time is low (under 10s)
  if (seconds <= 10) {
    display.classList.replace('text-tertiary', 'text-error');
    container.classList.add('animate-pulse-slow'); // Uses your CSS pulse[cite: 5]
    container.style.borderColor = '#ff4444';
  } else {
    display.classList.replace('text-error', 'text-tertiary');
    container.classList.remove('animate-pulse-slow');
    container.style.borderColor = '';
  }
}

// Ensure the main logic file can find this function[cite: 1]
window.updateTimerDisplay = updateTimerDisplay;