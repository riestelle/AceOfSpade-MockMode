// MockMode — session.realtime.tts.js
// Provides TTS (speakText, toggleSound) and STT (mic → answer input).
// Replaces session.realtime.speech.js — no AI dependency, browser APIs only.
// Globals used by asset_interview.js: startMicCapture(), stopMicCapture()

// ─────────────────────────────────────────────────────────────────────────────
// TTS — Text-to-Speech (interviewer voice output)
// ─────────────────────────────────────────────────────────────────────────────

let soundOn          = true;   // auto-enabled on load — user can toggle off
let currentUtterance = null;
let ttsRetryCount    = 0;   // error counter — resets on success
let voiceLoadRetries = 0;   // separate counter just for voice-load polling
let cachedVoices     = null;  // FIX: Cache voices to avoid repeated getVoices() calls
const TTS_MAX_RETRIES = 3;

const ttsSupported =
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  'SpeechSynthesisUtterance' in window;

// Track whether the browser's audio context has been unlocked by a user gesture.
// Until it is, we queue speech so the first question isn't silently dropped.
let _audioUnlockedByGesture = false;
let _pendingSpeechQueue = []; // texts queued before the first user gesture

function unlockSpeech() {
  
  if (!ttsSupported) return;
  const unlock = new SpeechSynthesisUtterance('');
  unlock.volume = 0;
  try { 
    window.speechSynthesis.speak(unlock);
    // FIX: Mark audio as unlocked immediately so TTS doesn't queue with 1.5s delay
    // The speak() call unlocks the audio context for this gesture/context
    _audioUnlockedByGesture = true;
  }
  catch (err) { console.warn('[MockMode] TTS unlock failed:', err); }
}
window.unlockSpeech = unlockSpeech;
function _flushSpeechQueue() {
  if (_pendingSpeechQueue.length === 0) return;
  const item = _pendingSpeechQueue.shift();
  _pendingSpeechQueue = []; // discard older queued items — only speak latest
  if (item && typeof item === 'object') {
    _speakNow(item.text, item.onDone);
  } else {
    _speakNow(item); // legacy plain-string fallback
  }
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

function speakText(text, onDone) {
  if (!soundOn || !ttsSupported || !text) {
    // Even if TTS is off/unsupported, fire the callback so the UI unlocks
    if (typeof onDone === 'function') onDone();
    return;
  }

  // FIX #1 (delay on first question): If the gesture hasn't fired yet,
  // queue the speech — but also attempt to unlock immediately so the
  // very first question doesn't sit silently waiting.
  if (!_audioUnlockedByGesture) {
    _pendingSpeechQueue = [{ text, onDone }]; // keep only latest
    unlockSpeech();
    // Minimal delay (100ms) since unlockSpeech() sets flag immediately
    setTimeout(() => {
      _audioUnlockedByGesture = true;
      _flushSpeechQueue();
    }, 100);
    console.info('[MockMode] TTS: queued — will flush in 100ms.');
    return;
  }

  _speakNow(text, onDone);
}

// FIX #1 & #2: _speakNow is called immediately after streaming finishes.
// Key fixes here:
//   - window._currentUtterance keeps a hard reference so the browser's GC
//     can't collect the utterance mid-speech (silent-stop bug).
//   - onDone is set to null after first call to prevent any double-fire.
//   - Safety timeout is based on word count so it doesn't fire prematurely
//     on short texts or too late on long ones.
function _speakNow(text, onDone) {
  if (!soundOn || !ttsSupported || !text) {
    if (typeof onDone === 'function') onDone();
    return;
  }

  if (ttsRetryCount >= TTS_MAX_RETRIES) {
    console.warn('[MockMode] TTS hard-stopped after max retries.');
    if (typeof onDone === 'function') onDone();
    return;
  }

  const trySpeak = () => {
    // FIX: Use cached voices if available (loaded during DOMContentLoaded)
    if (!cachedVoices) {
      cachedVoices = window.speechSynthesis.getVoices();
    }
    
    // If still no voices, retry only ONCE more (most browsers have them by now)
    if (cachedVoices.length === 0) {
      // Single attempt: voices will have loaded by the time first question plays
      setTimeout(() => {
        cachedVoices = window.speechSynthesis.getVoices();
        if (cachedVoices.length > 0) {
          trySpeak(); // Retry once with fresh voices
        } else {
          console.warn('[MockMode] No TTS voices available.');
          if (typeof onDone === 'function') onDone();
        }
      }, 100);
      return;
    }

    // Cancel any ongoing speech before starting the new one
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);

    // FIX: Keep a hard window-level reference so the GC can't collect it
    window._currentUtterance = utter;

    utter.rate  = 1.0;   // FIX: Normal speed (0.95 was too slow)
    utter.pitch = 1.05;
    utter.volume = 0.9;

    const preferredVoice = cachedVoices.find(
      v => v.lang.startsWith('en-') && (v.name.includes('Google') || v.name.includes('Natural'))
    ) || cachedVoices.find(v => v.lang.startsWith('en-')) || cachedVoices[0];
    if (preferredVoice) utter.voice = preferredVoice;

    // FIX: Calculate a realistic timeout — not too short, not too long.
    // Now that voices are cached and speak() is fast: 350 ms per word + 2s buffer.
    const wordCount = text.trim().split(/\s+/).length;
    const estimatedDuration = Math.max(5000, wordCount * 350 + 2000);

    const safetyTimeout = setTimeout(() => {
      console.warn('[MockMode] TTS safety timeout fired — forcing UI unlock.');
      // Call onend logic manually
      if (window._currentUtterance === utter) window._currentUtterance = null;
      const skipBtn = document.getElementById('skip-voice-btn');
      if (skipBtn) skipBtn.classList.add('hidden');
      if (typeof onDone === 'function') {
        const cb = onDone;
        onDone = null;
        cb();
      }
    }, estimatedDuration);

    utter.onstart = () => {
      ttsRetryCount = 0;
      voiceLoadRetries = 0;
    };

    utter.onend = () => {
      clearTimeout(safetyTimeout);
      if (window._currentUtterance === utter) window._currentUtterance = null;

      // Hide skip voice button
      const skipBtn = document.getElementById('skip-voice-btn');
      if (skipBtn) skipBtn.classList.add('hidden');

      // FIX: null-guard prevents double-fire from onend + safety timeout race
      if (typeof onDone === 'function') {
        const cb = onDone;
        onDone = null;
        cb();
      }
    };

    utter.onerror = (event) => {
      clearTimeout(safetyTimeout);
      // 'interrupted' just means speechSynthesis.cancel() was called (e.g. skip).
      // Don't retry in that case — the user deliberately skipped.
      if (event.error === 'interrupted') {
        if (window._currentUtterance === utter) window._currentUtterance = null;
        // onDone is intentionally NOT called here — the skip-voice button handler
        // calls enableAnsweringPhase() directly via _safeEnableAnsweringPhase().
        return;
      }
      console.warn('[MockMode] TTS error:', event.error);
      ttsRetryCount++;
      // Fallback to onend logic so the UI always unlocks
      utter.onend();
    };

    window.speechSynthesis.speak(utter);
  };

  trySpeak();
}
// ────────────────────────────────────────────────────────────────────────────
// STT — Speech-to-Text (REPLACED SECTION)
// ─────────────────────────────────────────────────────────────────────────────
const sttSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
const STT_MAX_RETRIES = 3;
let micRetryCount  = 0;
let micHardStopped = false;
let micActive      = false;
let recognition    = null;
let retryTimeout   = null;

function startMicCapture() {
  // Called by enableAnsweringPhase() to prepare mic (but don't auto-start —
  // leave that to the user pressing the mic button to avoid permission errors
  // on page load and the "network" error from starting before user interaction)
  if (retryTimeout) { clearTimeout(retryTimeout); retryTimeout = null; }
  micRetryCount = 0;
  // FIX: Reset micHardStopped so the mic button works again on the next question
  // (stopMicCapture sets this to true to break the auto-restart loop).
  micHardStopped = false;
  micActive = false;
  // Note: we do NOT auto-call startRecognition() here — user must press mic btn.
}

function stopMicCapture() {
  if (retryTimeout) { clearTimeout(retryTimeout); retryTimeout = null; }
  // FIX: Clear micActive BEFORE stopping recognition so the onend handler
  // doesn't see micActive=true and auto-restart the mic.
  micHardStopped = true;
  micActive = false;
  if (recognition) {
    recognition.onend = null; // Belt-and-suspenders: also null the handler
    try { recognition.stop(); } catch (_) {}
  }
  setMicUI(false);
  micRetryCount = 0;
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
    if (typeof showToast === 'function') showToast('Speech recognition not supported.', 'warning');
    return;
  }
  if (micActive) { stopMicCapture(); return; }
  micHardStopped = false;
  micRetryCount = 0;
  startRecognition();
}

function startRecognition() {
  if (!window.isSecureContext || micHardStopped || !sttSupported) return;
  
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;  // FIX: Reduce alternatives for faster processing
  
  const input = document.getElementById('answer-input');
  let finalTranscript = (input && input.value.trim()) ? input.value.trim() + ' ' : '';
  let lastDisplayValue = '';  // Cache to avoid excessive DOM updates

  recognition.onstart = () => {
    setMicUI(true);
    console.info('[MockMode] STT: microphone listening...');
  };
  
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript + ' ';
        console.info('[MockMode] STT final:', transcript);
      } else {
        interim += transcript;
      }
    }
    
    // FIX: Only update DOM if the display value actually changed (reduce reflows)
    const displayValue = finalTranscript + interim;
    if (input && displayValue !== lastDisplayValue) {
      input.value = displayValue;
      lastDisplayValue = displayValue;
      // Dispatch input event so form listeners update
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  recognition.onend = () => {
    if (!micHardStopped) {
      console.info('[MockMode] STT ended; restarting immediately.');
      startRecognition();
      return;
    }
    setMicUI(false);
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech') return; // Ignore silence timeouts, let onend restart it
    if (event.error === 'aborted') return;
    
    setMicUI(false);
    console.warn('[MockMode] Mic error:', event.error);
    
    if (event.error === 'not-allowed') {
      micHardStopped = true;
      if (typeof showToast === 'function') showToast('Mic access denied.', 'error');
      return;
    }

    micRetryCount++;
    if (micRetryCount >= STT_MAX_RETRIES) {
      micHardStopped = true;
      if (typeof showToast === 'function') showToast('Mic disabled after failures.', 'error');
    } else {
      retryTimeout = setTimeout(startRecognition, 100);
    }
  };

  try { recognition.start(); } catch (err) { console.warn(err); }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM wiring — guarded so this file is safe to import in Node / test runners
// ─────────────────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {

    // ── TTS diagnostics + voice loader ──
    if (ttsSupported) {
      let voicesLoaded = false;
      
      const loadVoices = () => {
        const v = window.speechSynthesis.getVoices();
        if (v.length > 0 && !voicesLoaded) {
          voicesLoaded = true;
          cachedVoices = v;  // FIX: Populate the cache so TTS is instantly ready
          console.info(`[MockMode] ✅ TTS voices loaded and cached: ${v.length}`);
          // Optional: log first few voices for debugging
          // v.slice(0, 3).forEach(v => console.log(`  - ${v.name} (${v.lang})`));
          return true;
        }
        return false;
      };

      // Try immediately
      if (!loadVoices()) {
        // Listen for the event
        window.speechSynthesis.addEventListener('voiceschanged', () => loadVoices(), { once: true });
        
        // Fallback: poll every 200ms for up to 3 seconds (Brave/Firefox workaround)
        let attempts = 0;
        const pollInterval = setInterval(() => {
          attempts++;
          if (loadVoices() || attempts >= 15) {
            clearInterval(pollInterval);
            if (!voicesLoaded) {
              console.warn('[MockMode] ⚠️ TTS voices still not loaded after 3s. Speech may fail.');
            }
          }
        }, 200);
      }
    } else {
      console.warn('[MockMode] TTS is not supported in this browser.');
    }

    // ── Sound icon initial state ──
    const soundIcon = document.getElementById('sound-icon');
    if (soundIcon) soundIcon.textContent = soundOn ? 'volume_up' : 'volume_off';

    // ── Auto-unlock audio on first user interaction anywhere ──
    // Browsers block speech synthesis until a user gesture has occurred.
    // We hook the first click/keydown on the page to silently unlock it,
    // then flush any speech that was queued before the gesture.
    let audioUnlocked = false;
    function unlockOnInteraction() {
      if (audioUnlocked) return;
      audioUnlocked = true;
      _audioUnlockedByGesture = true;
      unlockSpeech();
      // Flush any TTS that was queued while waiting for the gesture
      setTimeout(_flushSpeechQueue, 100);
      document.removeEventListener('click', unlockOnInteraction, true);
      document.removeEventListener('keydown', unlockOnInteraction, true);
    }
    document.addEventListener('click', unlockOnInteraction, true);
    document.addEventListener('keydown', unlockOnInteraction, true);

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