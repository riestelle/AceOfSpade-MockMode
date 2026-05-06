// assets/js/session-interview/vendor/test.synthesis.js
// Browser SpeechSynthesis TTS. No storage. No retries loop. Hard-stops after 3 errors until you toggle sound again.
// Exposes: window.speakText(text, onDone), window.toggleSound(), window.unlockSpeech()

(() => {
  'use strict';
  if (typeof window === 'undefined') return;

  const supported = ('speechSynthesis' in window) && ('SpeechSynthesisUtterance' in window);
  const TTS_MAX_ERRORS = 3;

  let soundOn = true;   // auto-enabled; user can toggle off
  let errorCount = 0;
  let currentUtterance = null;
  let voices = [];
  let chosenVoice = null;

  function log(...args) { console.info('[MockMode][TTS]', ...args); }
  function warn(...args) { console.warn('[MockMode][TTS]', ...args); }

  function updateIcon() {
    const icon = document.getElementById('sound-icon');
    if (icon) icon.textContent = soundOn ? 'volume_up' : 'volume_off';
  }

  function refreshVoices() {
    if (!supported) return;
    voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return;

    const preferredLang = (document.documentElement.lang || 'en').toLowerCase();
    const byLang = voices.filter(v => (v.lang || '').toLowerCase().startsWith(preferredLang));
    const pool = byLang.length ? byLang : voices;

    // Prefer non-local-service voices for better quality; fall back to first available.
    chosenVoice = pool.find(v => !v.localService) || pool[0] || null;
    log('voices:', voices.length, 'chosen:', chosenVoice ? `${chosenVoice.name} (${chosenVoice.lang})` : 'none');
  }

  function unlockSpeech() {
    if (!supported) return;
    try {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch (e) {
      // ignore
    }
  }

  function toggleSound() {
    if (!supported) {
      if (typeof showToast === 'function') showToast('Speech synthesis is not available in this browser.', 'warning');
      return;
    }
    soundOn = !soundOn;
    if (!soundOn) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
      currentUtterance = null;
    } else {
      errorCount = 0;
      unlockSpeech();
      refreshVoices();
    }
    updateIcon();
  }

  // speakText(text, onDone) — onDone is called when speech ends, errors, or is skipped.
  // This signature matches what asset.interview.js expects.
  function speakText(text, onDone) {
    if (!supported || !soundOn || !text) {
      if (typeof onDone === 'function') onDone();
      return;
    }

    if (errorCount >= TTS_MAX_ERRORS) {
      warn('hard-stopped after errors; toggle sound to reset');
      if (typeof onDone === 'function') onDone();
      return;
    }

    try { window.speechSynthesis.cancel(); } catch (_) {}

    const utter = new SpeechSynthesisUtterance(String(text));
    if (chosenVoice) utter.voice = chosenVoice;
    utter.rate = 1.0;   // normal speed for clear interview question delivery
    utter.pitch = 1.05;
    utter.volume = 0.9;

    // Keep hard reference on window so GC does not collect mid-speech.
    window._currentUtterance = utter;

    function fireOnDone() {
      if (typeof onDone === 'function') {
        const cb = onDone;
        onDone = null; // prevent double-fire
        cb();
      }
    }

    utter.onstart = () => {
      currentUtterance = utter;
    };

    utter.onend = () => {
      if (window._currentUtterance === utter) window._currentUtterance = null;
      if (currentUtterance === utter) currentUtterance = null;
      fireOnDone();
    };

    utter.onerror = (ev) => {
      if (window._currentUtterance === utter) window._currentUtterance = null;
      if (currentUtterance === utter) currentUtterance = null;

      // 'interrupted' means cancel() was called intentionally (skip-voice button).
      // Do not count as error; onDone is intentionally NOT called here so the skip
      // handler fires _safeEnableAnsweringPhase() directly via window._skipVoiceBridge
      // (defined in asset.interview.js).
      if (ev && ev.error === 'interrupted') return;

      errorCount++;
      warn('error:', ev && ev.error ? ev.error : ev);
      if (errorCount >= TTS_MAX_ERRORS) {
        warn('giving up; toggle sound to retry');
        if (typeof showToast === 'function') showToast('Voice output failed. Toggle sound off and on to retry.', 'warning');
      }
      // Always unlock the UI even on error
      fireOnDone();
    };

    currentUtterance = utter;
    try {
      window.speechSynthesis.speak(utter);
    } catch (e) {
      errorCount++;
      warn('speak threw:', e);
      fireOnDone();
    }
  }

  function wire() {
    updateIcon();

    if (supported) {
      refreshVoices();
      // Voices load async in many browsers — retry when the event fires.
      try {
        window.speechSynthesis.addEventListener('voiceschanged', () => {
          refreshVoices();
        });
      } catch (_) {}
    }

    const soundBtn = document.getElementById('sound-btn');
    if (soundBtn) {
      soundBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSound();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (document.activeElement === document.getElementById('answer-input')) return;
      if (e.key.toLowerCase() === 's') toggleSound();
    });
  }

  // Expose globals expected by the rest of the app.
  window.toggleSound = toggleSound;
  window.speakText = speakText;
  window.unlockSpeech = unlockSpeech;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
