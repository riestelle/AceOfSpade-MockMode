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
  try { window.speechSynthesis.speak(unlock); }
  catch (err) { console.warn('[MockMode] TTS unlock failed:', err); }
}

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

  // If the browser hasn't been unlocked by a user gesture yet, queue it.
  // It will be flushed the moment the user first clicks or presses a key.
  if (!_audioUnlockedByGesture) {
    _pendingSpeechQueue = [{ text, onDone }]; // only keep the latest
    console.info('[MockMode] TTS queued — waiting for user gesture to unlock audio.');
    return;
  }

  _speakNow(text, onDone);
}

function _speakNow(text, onDone) {
  if (!soundOn || !ttsSupported || !text) {
    if (typeof onDone === 'function') onDone();
    return;
  }

  if (ttsRetryCount >= TTS_MAX_RETRIES) {
    console.warn('[MockMode] TTS hard-stopped. Toggle sound off/on to reset.');
    if (typeof onDone === 'function') onDone(); // still unlock the UI
    return;
  }

  // ── Wait for voices to load before speaking ──
  const trySpeak = () => {
    const voices = window.speechSynthesis.getVoices();
    
    if (voices.length === 0) {
      // Voices not ready — use separate counter so error quota isn't burned
      if (voiceLoadRetries < 5) {
        voiceLoadRetries++;
        setTimeout(trySpeak, 150);
        return;
      }
      console.warn('[MockMode] TTS: No voices available after waiting.');
      if (typeof onDone === 'function') onDone(); // unlock UI even if voices missing
      return;
    }
    voiceLoadRetries = 0; // reset once voices are found

    // ✅ Voices ready — proceed with speech
    const preferredVoice = voices.find(v => 
      v.lang.startsWith('en-') && (v.name.includes('Google') || v.name.includes('Natural'))
    ) || voices[0];

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate   = 0.95;
    utter.pitch  = 1.05;
    utter.volume = 0.9;
    if (preferredVoice) utter.voice = preferredVoice;
    
    utter.onstart = () => {
      currentUtterance = utter;
      ttsRetryCount = 0; // reset on successful start
    };
    utter.onend = () => {
      if (currentUtterance === utter) currentUtterance = null;
      if (typeof onDone === 'function') onDone(); // ✅ unlock UI after speech ends
    };
    utter.onerror = (event) => {
      console.warn('[MockMode] TTS error:', event.error);
      if (currentUtterance === utter) currentUtterance = null;
      ttsRetryCount++;
      if (ttsRetryCount >= TTS_MAX_RETRIES) {
        if (typeof showToast === 'function')
          showToast('Voice output failed. Toggle sound to retry.', 'warning');
      }
      if (typeof onDone === 'function') onDone(); // ✅ unlock UI even on error
    };
    
    currentUtterance = utter;
    window.speechSynthesis.speak(utter);
  };

  trySpeak(); // Start the attempt
} // end _speakNow

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
  micHardStopped = false;
  // Note: we do NOT auto-call startRecognition() here — user must press mic btn.
  // This avoids the "network" error from browsers that reject mic start
  // before a deliberate user gesture on the mic button specifically.
}

function stopMicCapture() {
  if (retryTimeout) { clearTimeout(retryTimeout); retryTimeout = null; }
  if (recognition) { 
    recognition.onend = null; // Prevent the auto-restart loop
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
  const input = document.getElementById('answer-input');
  let finalTranscript = (input && input.value.trim()) ? input.value.trim() + ' ' : '';

  recognition.onstart = () => setMicUI(true);
  
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
      else interim += event.results[i][0].transcript;
    }
    if (input) input.value = finalTranscript + interim;
  };

  recognition.onend = () => {
    // AUTO-RESTART: If we didn't manually stop it, kick it back on
    if (micActive && !micHardStopped) {
      setTimeout(startRecognition, 200); 
    } else {
      setMicUI(false);
    }
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
      retryTimeout = setTimeout(startRecognition, 800);
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
          console.info(`[MockMode] ✅ TTS voices loaded: ${v.length}`);
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