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
  let premiumVoiceNoticeShown = false;

  function log(...args) { console.info('[MockMode][TTS]', ...args); }
  function warn(...args) { console.warn('[MockMode][TTS]', ...args); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function updateIcon() {
    const icon = document.getElementById('sound-icon');
    if (icon) icon.textContent = soundOn ? 'volume_up' : 'volume_off';
  }

  function refreshVoices() {
    if (!supported) return;
    voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return;

    const preferredLang = (document.documentElement.lang || 'en').toLowerCase();
    const startsWithLang = (voice, lang) => (voice.lang || '').toLowerCase().startsWith(lang);
    const isPremiumVoice = (voice) => /(neural|natural|premium|google|microsoft|apple|siri|enhanced|online)/i.test(voice.name || '');

    const tiers = [
      { name: 'preferred-lang premium', voice: voices.find(v => startsWithLang(v, preferredLang) && isPremiumVoice(v)) },
      { name: 'preferred-lang any', voice: voices.find(v => startsWithLang(v, preferredLang)) },
      { name: 'english premium', voice: voices.find(v => startsWithLang(v, 'en') && isPremiumVoice(v)) },
      { name: 'english any', voice: voices.find(v => startsWithLang(v, 'en')) },
      { name: 'any premium', voice: voices.find(isPremiumVoice) },
      { name: 'first available', voice: voices[0] || null }
    ];

    const selectedTier = tiers.find(t => t.voice) || tiers[tiers.length - 1];
    chosenVoice = selectedTier.voice || null;

    const premiumAvailable = voices.some(isPremiumVoice);
    if (!premiumAvailable) {
      warn('premium/neural voices are not available in this browser');
      if (!premiumVoiceNoticeShown && typeof showToast === 'function') {
        premiumVoiceNoticeShown = true;
        showToast('Premium interview voices are not available. Using the best available system voice.', 'info');
      }
    }

    log('voices:', voices.length, 'tier:', selectedTier.name, 'chosen:', chosenVoice ? `${chosenVoice.name} (${chosenVoice.lang})` : 'none');
  }

  function splitIntoSentences(text) {
    const matches = String(text).replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g);
    if (!matches) return [];
    return matches.map(s => s.trim()).filter(Boolean);
  }

  function emphasizeInterviewWords(text) {
    return String(text).replace(/\b(important|critical|must|always|never)\b/gi, ', $1,');
  }

  function getBaseRateByWordCount(wordCount) {
    if (wordCount < 20) return 1.0;
    if (wordCount <= 50) return 0.95;
    return 0.85;
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

    function fireOnDone() {
      if (typeof onDone === 'function') {
        const cb = onDone;
        onDone = null; // prevent double-fire
        cb();
      }
    }

    const fullText = String(text).trim();
    const sentences = splitIntoSentences(fullText);
    const words = fullText.split(/\s+/).filter(Boolean).length;
    const baseRate = getBaseRateByWordCount(words);

    let sentenceIndex = 0;

    const speakNextSentence = () => {
      if (sentenceIndex >= sentences.length) {
        fireOnDone();
        return;
      }

      const sentence = emphasizeInterviewWords(sentences[sentenceIndex]);
      const utter = new SpeechSynthesisUtterance(sentence);
      if (chosenVoice) utter.voice = chosenVoice;

      const variation = ((sentenceIndex % 3) - 1) * 0.015;
      utter.rate = clamp(baseRate + variation, 0.8, 1.05);
      utter.pitch = clamp(0.97 + ((sentenceIndex % 2) ? 0.015 : -0.01), 0.95, 1.0);
      utter.volume = 1.0;

      // Keep hard reference on window so GC does not collect mid-speech.
      window._currentUtterance = utter;

      utter.onstart = () => {
        currentUtterance = utter;
      };

      utter.onend = () => {
        if (window._currentUtterance === utter) window._currentUtterance = null;
        if (currentUtterance === utter) currentUtterance = null;

        sentenceIndex++;
        if (sentenceIndex >= sentences.length) {
          fireOnDone();
          return;
        }

        const pauseMs = 200 + ((sentenceIndex * 67) % 201); // 200-400ms
        setTimeout(speakNextSentence, pauseMs);
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
    };

    try {
      speakNextSentence();
    } catch (e) {
      errorCount++;
      warn('sentence speech failed:', e);
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
