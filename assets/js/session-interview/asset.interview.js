// MockMode — interview.js  (updated)
// Manages question flow, AI evaluation, stress meter, and
// transitions to the results page.
// Depends on: main.js, ai.js
// New in this version:
//   - TTS via speakText() (defined in session.realtime.tts.js)
//   - STT via mic button (wired in session.realtime.tts.js)
//   - Skip question button (one per session, +15 stress)
//   - Answer history drawer integration
//   - Loading indicator between questions
//   - Interviewer flavored name/title display
//   - Progress label fix (q-current / q-total spans)

// ── Session state ──────────────────────────────────────────────────────────

let resumeText      = null;
let personality     = null;
let role            = null;
let questions       = [];
let scores          = [];
let currentIndex    = 0;
let stressLevel     = 30;     // SPEC: starts at 30, not 0
let peakStressLevel = 30;
let moodScore       = 0;      // hidden: -100 to +100, affects AI tone only
let comboCount      = 0;      // live combo counter, resets on score < 70
let isProcessing    = false;
let skipUsed        = false;
let isBossQuestion  = false;  // true when currentIndex === 4 (Q5)
let lastAnswerContext = null; // { answer, score } from previous question — used to connect questions
let verdictAttempts   = 0;    // counts finishInterview retries — hard-stops at 3

// ── Timer state ────────────────────────────────────────────────────────────
// Logic is wired — UI hookup (display element) is frontend's job.
let timerInterval   = null;
let timeRemaining   = 45;
const TIMER_DURATION = 45;

// ── Personality score multipliers (SPEC) ──────────────────────────────────
const PERSONALITY_MULTIPLIER = {
  corporate:  0.9,   // strict  → penalises score
  startup:    1.1,   // chill   → boosts score
  technical:  1.0,   // neutral
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

// ── DOM references ─────────────────────────────────────────────────────────

let dialogueBox     = null;
let answerInput     = null;
let submitBtn       = null;
let skipBtn         = null;    // NEW
let stressFill      = null;
let stressLabel     = null;
let reactionBox     = null;
let qCurrentSpan    = null;    // FIX: was progressLabel (full element)
let qTotalSpan      = null;

// ── Toast notification system ──────────────────────────────────────────────

function showToast(message, type = 'info') {
  const host = document.getElementById('mm-toast-host');
  if (!host) { console.warn('[MockMode] Toast host not found'); return;}

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
  dialogueBox  = document.getElementById('dialogue-text');
  answerInput  = document.getElementById('answer-input');
  submitBtn    = document.getElementById('submit-answer-btn');
  skipBtn      = document.getElementById('skip-btn');           // NEW
  stressFill   = document.getElementById('stress-fill');
  stressLabel  = document.getElementById('stress-label');
  reactionBox  = document.getElementById('reaction-box');
  qCurrentSpan = document.getElementById('q-current');         // FIX
  qTotalSpan   = document.getElementById('q-total');           // FIX

  resumeText  = getFromStorage('resume');
  personality = getFromStorage('personality');
  role        = getFromStorage('role') ?? 'general';

  if (!resumeText || !personality) {
    showToast('Session expired. Please start over.', 'warning');
    setTimeout(() => navigateTo('upload.html'), 1500);
    return;
  }

  // ── Set flavored interviewer name (NEW) ────────────────────────────────
  const nameEl = document.getElementById('interviewer-name');
  if (nameEl) {
    const persona = INTERVIEWER_PERSONAS[personality];
    nameEl.textContent = persona ? `${persona.display}:` : `${formatPersonality(personality)}:`;
  }

  // Load or generate questions
  const cached = getFromStorage('questions');
  if (Array.isArray(cached) && cached.length === 5) {
    questions = cached;
    startInterview();
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
    const generated = await generateQuestions(resumeText, personality, role);
    if (!Array.isArray(generated) || generated.length === 0) {
      throw new Error('No questions returned from AI.');
    }
    loadQuestionsAttempts = 0; // reset on success
    questions = generated;
    saveToStorage('questions', questions);
    hideLoader();
    startInterview();
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
  updateProgressLabel();
  updateStressMeter(30);
  askCurrentQuestion();
}

// ── Timer ──────────────────────────────────────────────────────────────────
// startTimer() / stopTimer() are called around each question.
// Frontend dev wires updateTimerDisplay() to a DOM element.

function startTimer() {
  stopTimer();
  timeRemaining = TIMER_DURATION;
  if (typeof updateTimerDisplay === 'function') updateTimerDisplay(timeRemaining);

  timerInterval = setInterval(() => {
    timeRemaining--;
    if (typeof updateTimerDisplay === 'function') updateTimerDisplay(timeRemaining);

    if (timeRemaining <= 0) {
      stopTimer();
      handleTimerTimeout();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Called when timer hits 0: auto-submits a blank answer with stress penalty
function handleTimerTimeout() {
  if (isProcessing) return;
  stressLevel = Math.min(100, stressLevel + 15);
  if (stressLevel > peakStressLevel) peakStressLevel = stressLevel;
  updateStressMeter(stressLevel);
  checkLoseCondition();

  // Force-submit a weak answer so the game loop continues
  if (answerInput) answerInput.value = '[No answer — time ran out]';
  submitAnswer();
}

async function askCurrentQuestion() {
  if (!dialogueBox) return;
  clearReactionBox();
  isBossQuestion = (currentIndex === 4);  // flag Q5 as boss question
  
  if (answerInput) {
    answerInput.value = '';
    answerInput.disabled = false;
    answerInput.focus();
  }
  
  // ── ADD THIS LINE ──
  if (typeof startMicCapture === 'function') startMicCapture();
  // ───────────────────
  
  if (submitBtn) submitBtn.disabled = false;
  if (typeof hideThinkingIndicator === 'function') hideThinkingIndicator();
  
  const question = questions[currentIndex];

  // Build a context-aware prompt so the interviewer reacts to the previous answer
  let questionPrompt;
  if (lastAnswerContext && currentIndex > 0) {
    const { answer, score } = lastAnswerContext;
    const quality = score >= 70 ? 'strong' : score >= 50 ? 'mediocre' : 'weak or nonsensical';
    questionPrompt = `The candidate just gave a ${quality} answer to the previous question. Their answer was: "${answer}". Briefly acknowledge it in one short clause (e.g. react naturally in character), then transition into asking this next question: "${question}". Keep the whole thing to 1-2 sentences.`;
  } else {
    questionPrompt = `Ask this interview question naturally, in character: "${question}"`;
  }

  try {
    await streamInterviewerMessage(
      questionPrompt,
      personality,
      dialogueBox,
      (fullText) => {
        if (typeof speakText === 'function') {
          speakText(fullText || question);
        }
        if (answerInput) answerInput.disabled = false;
        startTimer();  // start countdown after question is spoken
      }
    );
  } catch (err) {
    console.warn('[MockMode] Stream failed, using direct text:', err);
    if (dialogueBox) dialogueBox.textContent = question;
    if (typeof speakText === 'function') speakText(question);
    startTimer();
  }
}

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
  if (skipBtn)   skipBtn.disabled   = true;
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
  if (qTotalSpan)   qTotalSpan.textContent   = questions.length || 5;
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
  showLoader('Calculating your verdict...');

  try {
    const resumeAnalysis = getFromStorage('resume_analysis');
    if (!resumeAnalysis) throw new Error('Resume analysis not found in storage.');

    const verdict = await generateVerdict(scores, resumeAnalysis, personality, role);
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