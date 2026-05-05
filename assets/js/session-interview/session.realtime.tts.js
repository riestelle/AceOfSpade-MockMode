// MockMode — session.realtime.tts.js
// Provides TTS (speakText, toggleSound) and STT (mic → answer input).
// Replaces session.realtime.speech.js — no AI dependency, browser APIs only.
// Globals used by asset_interview.js: startMicCapture(), stopMicCapture()

// ─────────────────────────────────────────────────────────────────────────────
// TTS — Text-to-Speech (interviewer voice output)
// ─────────────────────────────────────────────────────────────────────────────

let soundOn          = false;
let currentUtterance = null;
let ttsRetryCount    = 0;
const TTS_MAX_RETRIES = 3;

const ttsSupported =
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  'SpeechSynthesisUtterance' in window;

function unlockSpeech() {
  if (!ttsSupported) return;
  const unlock = new SpeechSynthesisUtterance('');
  unlock.volume = 0;
  try { window.speechSynthesis.speak(unlock); }
  catch (err) { console.warn('[MockMode] TTS unlock failed:', err); }
}

function toggleSound() {
  if (!ttsSupported) {
    if (typeof showToast === 'function')
      showToast('Speech synthesis is not available in this browser.', 'warning');
    return;
  }

  soundOn = !soundOn;
  const icon = document.getElementById('sound-icon');
  if (icon) icon.textContent = soundOn ? 'volume_up' : 'volume_off';

  if (soundOn) {
    ttsRetryCount = 0;
    unlockSpeech();
  } else {
    window.speechSynthesis.cancel();
  }
}

function speakText(text) {
  if (!soundOn || !ttsSupported || !text) return;

  // Hard stop — user must toggle sound off/on to reset
  if (ttsRetryCount >= TTS_MAX_RETRIES) {
    console.warn('[MockMode] TTS hard-stopped. Toggle sound off/on to reset.');
    return;
  }

  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate   = 0.95;
  utter.pitch  = 1.05;
  utter.volume = 0.9;

  utter.onstart = () => {
    currentUtterance = utter;
    ttsRetryCount = 0; // clean start resets the counter
  };
  utter.onend = () => {
    if (currentUtterance === utter) currentUtterance = null;
  };
  utter.onerror = (event) => {
    console.warn('[MockMode] TTS error:', event.error);
    if (currentUtterance === utter) currentUtterance = null;
    ttsRetryCount++;
    if (ttsRetryCount >= TTS_MAX_RETRIES) {
      console.warn('[MockMode] TTS giving up. Toggle sound off/on to retry.');
      if (typeof showToast === 'function')
        showToast('Voice output failed. Toggle sound off and on to retry.', 'warning');
    }
  };

  currentUtterance = utter;
  window.speechSynthesis.speak(utter);
}

// ─────────────────────────────────────────────────────────────────────────────
// STT — Speech-to-Text (mic → answer input)
// ─────────────────────────────────────────────────────────────────────────────

const sttSupported =
  typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

const STT_MAX_RETRIES = 3;

let micRetryCount  = 0;
let micHardStopped = false; // true after 3 real failures; only resets on user click
let micActive      = false;
let recognition    = null;

// Called by asset_interview.js when a new question is displayed.
// Resets per-question state so the mic button is ready — does NOT auto-start.
function startMicCapture() {
  if (micHardStopped) return;
  micRetryCount = 0;
}

// Called by asset_interview.js on submit and skip.
function stopMicCapture() {
  if (recognition && micActive) {
    try { recognition.stop(); } catch (_) {}
  }
  setMicUI(false);
}

function setMicUI(active) {
  micActive = active;
  const btn  = document.getElementById('mic-btn');
  const icon = btn && btn.querySelector('.mic-icon');
  if (!btn) return;
  if (active) {
    btn.classList.add('recording');
    if (icon) icon.textContent = 'mic_off';
  } else {
    btn.classList.remove('recording');
    if (icon) icon.textContent = 'mic';
  }
}

function toggleMic() {
  if (!sttSupported) {
    if (typeof showToast === 'function')
      showToast('Speech recognition is not available in this browser.', 'warning');
    return;
  }

  if (micActive) {
    stopMicCapture();
    return;
  }

  // User clicked again after a hard stop — give them a fresh attempt
  if (micHardStopped) {
    micHardStopped = false;
    micRetryCount  = 0;
  }

  startRecognition();
}

function startRecognition() {
  // ── Hard-stop gate — nothing gets past this after 3 real errors ──────────
  if (micHardStopped || !sttSupported) return;

  if (micRetryCount >= STT_MAX_RETRIES) {
    micHardStopped = true;
    console.warn(`[MockMode] Mic hard-stopped after ${STT_MAX_RETRIES} errors. Click mic to retry.`);
    if (typeof showToast === 'function')
      showToast('Mic failed to start. Click the mic button to try again.', 'warning');
    setMicUI(false);
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous     = false;
  recognition.interimResults = true;
  recognition.lang           = 'en-US';

  const input = document.getElementById('answer-input');

  recognition.onstart = () => {
    micRetryCount = 0; // clean start resets the counter
    setMicUI(true);
  };

  recognition.onresult = (event) => {
    let interim = '', final = '';
    for (let i = 0; i < event.results.length; i++) {
      if (event.results[i].isFinal) final   += event.results[i][0].transcript;
      else                          interim += event.results[i][0].transcript;
    }
    if (input) input.value = final || interim;
  };

  recognition.onend = () => {
    // Ended cleanly (silence or stopMicCapture called) — do NOT auto-restart.
    // User must click mic again. No recursive restart here.
    setMicUI(false);
  };

  recognition.onerror = (event) => {
    console.warn('[MockMode] Mic error:', event.error);
    setMicUI(false);

    // 'aborted' = we called stop() intentionally.
    // 'no-speech' = user was quiet. Neither counts as a real failure.
    if (event.error === 'aborted' || event.error === 'no-speech') return;

    micRetryCount++;

    if (micRetryCount >= STT_MAX_RETRIES) {
      // Set flag FIRST — this is what blocks any further recognition.start() calls.
      micHardStopped = true;
      console.warn(`[MockMode] Mic hard-stopped after ${STT_MAX_RETRIES} errors.`);
      if (typeof showToast === 'function')
        showToast('Mic failed repeatedly. Click the mic button to try again.', 'warning');
      return; // no retry, no recursive call — stops here
    }

    // Only retry on transient errors (e.g. 'network', 'audio-capture')
    // with a short delay so we don't hammer the browser.
    console.info(`[MockMode] Mic retry ${micRetryCount}/${STT_MAX_RETRIES}...`);
    setTimeout(startRecognition, 800);
  };

  try {
    recognition.start();
  } catch (err) {
    // recognition.start() can throw synchronously if already started
    console.warn('[MockMode] Mic start threw:', err);
    micRetryCount++;
    setMicUI(false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM wiring — guarded so this file is safe to import in Node / test runners
// ─────────────────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {

    // ── TTS diagnostics ──
    if (ttsSupported) {
      const voices = window.speechSynthesis.getVoices();
      console.info(`[MockMode] TTS voices available: ${voices.length}`);
    } else {
      console.warn('[MockMode] TTS is not supported in this browser.');
    }

    if (!sttSupported) {
      console.warn('[MockMode] STT (SpeechRecognition) is not supported in this browser.');
    }

    // ── Sound icon initial state ──
    const soundIcon = document.getElementById('sound-icon');
    if (soundIcon) soundIcon.textContent = soundOn ? 'volume_up' : 'volume_off';

    // ── Sound button ──
    const soundBtn = document.getElementById('sound-btn');
    if (soundBtn) {
      soundBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSound();
      });
    }

    // ── Mic button ──
    const micBtn = document.getElementById('mic-btn');
    if (micBtn) {
      micBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMic();
      });
    }

    // ── Keyboard shortcuts ([S] sound, [M] mic) ──
    document.addEventListener('keydown', (event) => {
      if (document.activeElement === document.getElementById('answer-input')) return;
      if (event.key.toLowerCase() === 's') toggleSound();
      if (event.key.toLowerCase() === 'm') toggleMic();
    });
  });
}