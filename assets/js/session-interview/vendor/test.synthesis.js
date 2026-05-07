// assets/js/session-interview/vendor/test.synthesis.js
// Browser SpeechSynthesis TTS. No storage. No retries loop. Hard-stops after 3 errors until you toggle sound again.
// Exposes: window.speakText(text, onDone), window.toggleSound(), window.unlockSpeech()

(() => {
  'use strict';
  if (typeof window === 'undefined') return;

  const supported = ('speechSynthesis' in window) && ('SpeechSynthesisUtterance' in window);
  const TTS_MAX_ERRORS = 3;
  const EMPHASIS_KEYWORDS = ['important', 'critical', 'must', 'always', 'never'];
  const SENTENCE_ABBREVIATIONS = ['mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'u.s.', 'e.g.', 'i.e.'];
  const SENTENCE_ABBREVIATION_PATTERNS = SENTENCE_ABBREVIATIONS.map((abbr) => new RegExp(abbr.replace(/\./g, '\\.'), 'gi'));
  const EMPHASIS_REGEX = new RegExp(`\\b(${EMPHASIS_KEYWORDS.join('|')})\\b`, 'gi');
  const BASE_SENTENCE_PAUSE_MS = 200;
  const SENTENCE_PAUSE_STEP_MS = 100;
  const RATE_MIN = 0.8;
  const RATE_MAX = 1.05;
  const RATE_VARIATION_STEP = 0.015;
  const BASE_PITCH = 0.97;
  const PITCH_UP_VARIATION = 0.015;
  const PITCH_DOWN_VARIATION = -0.01;
  const PITCH_MIN = 0.95;
  const PITCH_MAX = 1.0;

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
    const isPremiumVoice = (voice) => /\b(neural|premium|enhanced|natural)\b/i.test(voice.name || '');
    const isModernVendorVoice = (voice) => /\b(google|microsoft|apple|siri)\b/i.test(voice.name || '');

    const tiers = [
      { name: 'preferred-lang modern premium', voice: voices.find(v => startsWithLang(v, preferredLang) && (isPremiumVoice(v) || isModernVendorVoice(v))) },
      { name: 'preferred-lang premium', voice: voices.find(v => startsWithLang(v, preferredLang) && isPremiumVoice(v)) },
      { name: 'preferred-lang any', voice: voices.find(v => startsWithLang(v, preferredLang)) },
      { name: 'english modern premium', voice: voices.find(v => startsWithLang(v, 'en') && (isPremiumVoice(v) || isModernVendorVoice(v))) },
      { name: 'english premium', voice: voices.find(v => startsWithLang(v, 'en') && isPremiumVoice(v)) },
      { name: 'english any', voice: voices.find(v => startsWithLang(v, 'en')) },
      { name: 'any modern premium', voice: voices.find(v => isPremiumVoice(v) || isModernVendorVoice(v)) },
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
    let normalized = String(text).replace(/\s+/g, ' ').trim();
    if (!normalized) return [];

    SENTENCE_ABBREVIATION_PATTERNS.forEach((pattern) => {
      normalized = normalized.replace(pattern, (match) => match.replace(/\./g, '<DOT>'));
    });
    normalized = normalized.replace(/\.{3,}/g, '<ELLIPSIS>');

    const matches = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    return matches
      .map((s) => s.replace(/<DOT>/g, '.').replace(/<ELLIPSIS>/g, '...').trim())
      .filter(Boolean);
  }

  function emphasizeInterviewWords(text) {
    return String(text)
      .replace(EMPHASIS_REGEX, ', $1,')
      .replace(/,\s*,+/g, ', ')
      .replace(/\s{2,}/g, ' ')
      .trim();
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

      // Cycles through -0.015, 0, +0.015 to reduce monotone delivery.
      // Rate cycles through -step, 0, +step so sentence starts measured and grows slightly.
      const variation = ((sentenceIndex % 3) - 1) * RATE_VARIATION_STEP;
      utter.rate = clamp(baseRate + variation, RATE_MIN, RATE_MAX);
      utter.pitch = clamp(BASE_PITCH + ((sentenceIndex % 2) ? PITCH_UP_VARIATION : PITCH_DOWN_VARIATION), PITCH_MIN, PITCH_MAX);
      utter.volume = 1.0;

      // Keep hard reference on window so GC does not collect mid-speech.
      window._currentUtterance = utter;

      utter.onstart = () => {
        currentUtterance = utter;
      };

      utter.onend = () => {
        if (window._currentUtterance === utter) window._currentUtterance = null;
        if (currentUtterance === utter) currentUtterance = null;

        const pauseMs = BASE_SENTENCE_PAUSE_MS + ((sentenceIndex % 3) * SENTENCE_PAUSE_STEP_MS); // repeating 200/300/400ms sentence pacing
        sentenceIndex++;
        if (sentenceIndex >= sentences.length) {
          fireOnDone();
          return;
        }
        setTimeout(speakNextSentence, pauseMs);
      };

      utter.onerror = (ev) => {
        if (window._currentUtterance === utter) window._currentUtterance = null;
        if (currentUtterance === utter) currentUtterance = null;

        // 'interrupted' fires when cancel() is called externally (skip-voice button OR
        // the cancel() at the top of speakText clearing a stale unlockSpeech utterance).
        //
        // CRITICAL FIX: In the sentence-by-sentence model, 'interrupted' on sentence[0]
        // used to silently return without calling fireOnDone(), killing the entire TTS
        // chain on Q1 — nothing would unlock the UI or start the timer.
        //
        // New rule:
        //   - If _skipVoiceBridgeFired is set, this was a real intentional skip.
        //     Bail silently so the skip bridge handles enableAnsweringPhase.
        //   - Otherwise it's a spurious interrupt (stale cancel / race on first load).
        //     Advance to the next sentence instead of dying.
        if (ev && ev.error === 'interrupted') {
          if (window._skipVoiceBridgeFired) return; // intentional skip
          // Spurious interrupt — advance to next sentence
          sentenceIndex++;
          if (sentenceIndex < sentences.length) {
            setTimeout(speakNextSentence, 80);
          } else {
            fireOnDone();
          }
          return;
        }

        errorCount++;
        warn('error:', ev && ev.error ? ev.error : ev);
        if (errorCount >= TTS_MAX_ERRORS) {
          warn('giving up; toggle sound to retry');
          if (typeof showToast === 'function') showToast('Voice output failed. Toggle sound off and on to retry.', 'warning');
        }
        // Always unlock the UI even on error
        fireOnDone();
      };

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