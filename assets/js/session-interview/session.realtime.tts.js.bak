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
  
  if (ttsRetryCount >= TTS_MAX_RETRIES) {
    console.warn('[MockMode] TTS hard-stopped. Toggle sound off/on to reset.');
    return;
  }

  // ── NEW: Wait for voices to load before speaking ──
  const trySpeak = () => {
    const voices = window.speechSynthesis.getVoices();
    
    if (voices.length === 0) {
      // Voices not ready — retry once after 100ms (max 3 retries)
      if (ttsRetryCount < 3) {
        ttsRetryCount++;
        setTimeout(trySpeak, 100);
        return;
      }
      console.warn('[MockMode] TTS: No voices available after waiting.');
      return;
    }

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
    };
    utter.onerror = (event) => {
      console.warn('[MockMode] TTS error:', event.error);
      if (currentUtterance === utter) currentUtterance = null;
      ttsRetryCount++;
      if (ttsRetryCount >= TTS_MAX_RETRIES) {
        if (typeof showToast === 'function')
          showToast('Voice output failed. Toggle sound to retry.', 'warning');
      }
    };
    
    currentUtterance = utter;
    window.speechSynthesis.speak(utter);
  };

  trySpeak(); // Start the attempt
}

// ────────────────────────────────────────────────────────────────────────────
// STT — Speech-to-Text (mic → answer input)
// ─────────────────────────────────────────────────────────────────────────────
const sttSupported =
  typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
const STT_MAX_RETRIES = 3;
let micRetryCount  = 0;
let micHardStopped = false;
let micActive      = false;
let recognition    = null;
let retryTimeout   = null; // NEW: Tracks pending retry to prevent stacking

// Called by asset_interview.js when a new question is displayed.
// Resets per-question state so the mic button is ready — does NOT auto-start.
function startMicCapture() {
  if (micHardStopped) return;
  
  // Clear any pending retries from previous questions/errors
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  
  // Only reset counter when explicitly starting a fresh question
  micRetryCount = 0;
}

// Called by asset_interview.js on submit and skip.
function stopMicCapture() {
  // Kill any pending retry timeouts immediately
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  
  if (recognition && micActive) {
    try { recognition.stop(); } catch (_) {}
  }
  
  setMicUI(false);
  // Reset retry counter when user explicitly stops/submits
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
  if (typeof showToast === 'function')
    showToast('Speech recognition is not available in this browser. Try Chrome or Edge.', 'warning');
    return;
  }

  if (micActive) {
    stopMicCapture();
  if (typeof showToast === 'function')
    showToast('Microphone disabled', 'info');
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
  // Add this debug check
  if (!window.isSecureContext) {
    showToast('Speech recognition requires HTTPS or localhost. Use http://localhost instead.', 'error');
    console.error('[MockMode] Not a secure context! SpeechRecognition will fail.');
    micHardStopped = true;
    return;
  }

  // ── Hard-stop gate — nothing gets past this after 3 real errors ──────────
  if (micHardStopped || !sttSupported) return;
  if (micRetryCount >= STT_MAX_RETRIES) {
    micHardStopped = true;
    console.warn(`[MockMode] Mic hard-stopped after ${STT_MAX_RETRIES} errors. Click mic to retry.`);
    
    if (typeof showToast === 'function')
      showToast('Mic failed repeatedly. Click the mic button to try again.', 'error');
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
    setMicUI(true);
    if (typeof showToast === 'function')
      showToast('Microphone enabled — speaking...', 'success');
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
    setMicUI(false);
  };

  recognition.onerror = (event) => {
    console.warn('[MockMode] Mic error:', event.error);
    setMicUI(false);

    if (event.error === 'aborted' || event.error === 'no-speech') return;

    // Brave-specific hint
    if (event.error === 'network' && /Brave/i.test(navigator.userAgent)) {
      showToast('Ad-blockers may be blocking speech recognition.', 'error');
    } else if (event.error === 'network') {
      showToast('Network error: Cannot connect to speech service. Check connection or ad-blockers.', 'error');
    } else if (event.error === 'not-allowed') {
      showToast('Microphone access denied. Enable permissions in browser settings.', 'error');
    } else {
      showToast(`Mic error: ${event.error}`, 'error');
    }

    micRetryCount++;

    if (micRetryCount >= STT_MAX_RETRIES) {
      micHardStopped = true;
      showToast('Mic disabled after 3 failures. Click mic button to retry.', 'error');
      return;
    }

    console.info(`[MockMode] Mic retry ${micRetryCount}/${STT_MAX_RETRIES}...`);
    setTimeout(startRecognition, 800);
  };

  try {
    recognition.start();
  } catch (err) {
    console.warn('[MockMode] Mic start threw:', err);
    micRetryCount++;
    setMicUI(false);

    if (typeof showToast === 'function')
      showToast('Failed to start microphone. Check permissions.', 'error');

    if (micRetryCount >= STT_MAX_RETRIES) {
      micHardStopped = true;
      if (typeof showToast === 'function')
        showToast('Mic disabled. Click to retry.', 'error');
    } else {
      setTimeout(startRecognition, 800);
    }
  }
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