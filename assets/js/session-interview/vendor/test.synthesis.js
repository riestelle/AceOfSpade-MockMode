// assets/js/session-interview/vendor/test.synthesis.js
// Browser SpeechSynthesis TTS. No storage. No retries loop. Hard-stops after 3 errors until you toggle sound again.

(() => {
  'use strict';
  if (typeof window === 'undefined') return;

  const supported = ('speechSynthesis' in window) && ('SpeechSynthesisUtterance' in window);
  const TTS_MAX_ERRORS = 3;

  let soundOn = false;
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

    // Prefer non-local-service voices if available (often better quality), otherwise first match.
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

  function speakText(text) {
    if (!supported || !soundOn) return;
    if (!text) return;

    if (errorCount >= TTS_MAX_ERRORS) {
      warn('hard-stopped after errors; toggle sound to reset');
      return;
    }

    try { window.speechSynthesis.cancel(); } catch (_) {}

    const utter = new SpeechSynthesisUtterance(String(text));
    if (chosenVoice) utter.voice = chosenVoice;
    utter.rate = 0.95;
    utter.pitch = 1.05;
    utter.volume = 0.9;

    utter.onstart = () => {
      currentUtterance = utter;
    };

    utter.onend = () => {
      if (currentUtterance === utter) currentUtterance = null;
    };

    utter.onerror = (ev) => {
      if (currentUtterance === utter) currentUtterance = null;
      errorCount++;
      warn('error:', ev && ev.error ? ev.error : ev);
      if (errorCount >= TTS_MAX_ERRORS) {
        warn('giving up; toggle sound to retry');
        if (typeof showToast === 'function') showToast('Voice output failed. Toggle sound off and on to retry.', 'warning');
      }
    };

    currentUtterance = utter;
    try {
      window.speechSynthesis.speak(utter);
    } catch (e) {
      errorCount++;
      warn('speak threw:', e);
    }
  }

  function wire() {
    updateIcon();

    if (supported) {
      refreshVoices();
      // Voices commonly load async; this fixes the “0 voices” first-call issue.
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();