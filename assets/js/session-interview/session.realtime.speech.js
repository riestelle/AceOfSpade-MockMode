// STT support for the interview session.
// Provides: setupSTT(), toggleMic(), startMicCapture(), stopMicCapture().

let recognition = null;
let isRecording = false;
let micArmed = false;

// Soft-pause is used when the app (submit/skip) temporarily stops mic capture
// without changing the user's "armed" state.
let softPaused = false;

// Prevent restart loops after fatal permission errors.
let fatalError = false;

// Transcript buffering to avoid wiping prior text on each result event.
let finalTranscript = '';

const speechPermissionSupported =
  typeof navigator !== 'undefined' && !!(navigator.permissions && navigator.permissions.query);

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function updateMicUi() {
  const micBtn = document.getElementById('mic-btn');
  if (!micBtn) return;

  micBtn.setAttribute('aria-pressed', micArmed ? 'true' : 'false');
  micBtn.title = micArmed ? 'Mic ON (click to turn off) [M]' : 'Mic OFF (click to turn on) [M]';
}

async function logSpeechDiagnostics() {
  const SpeechRecognition = getSpeechRecognitionCtor();
  if (!SpeechRecognition) {
    console.warn('[MockMode] SpeechRecognition is not supported in this browser.');
    return;
  }

  if (speechPermissionSupported) {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      console.info(`[MockMode] Mic permission state: ${status.state}`);
      status.onchange = () => console.info(`[MockMode] Mic permission changed: ${status.state}`);
    } catch (err) {
      console.warn('[MockMode] Mic permission query failed:', err);
    }
  }
}

function setupSTT() {
  const SpeechRecognition = getSpeechRecognitionCtor();
  if (!SpeechRecognition) {
    if (typeof showToast === 'function') {
      showToast('Speech recognition not supported. Use Chrome or Edge.', 'warning');
    }
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  const answerInput = document.getElementById('answer-input');
  const micBtn = document.getElementById('mic-btn');

  recognition.onstart = () => {
    isRecording = true;
    if (micBtn) micBtn.classList.add('recording');
    if (answerInput) answerInput.placeholder = 'LISTENING...';
    console.info('[MockMode] Mic recording started.');
  };

  recognition.onresult = (event) => {
    if (!answerInput) return;

    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const text = (res && res[0] && res[0].transcript) ? res[0].transcript : '';
      if (!text) continue;

      if (res.isFinal) {
        const trimmed = text.trim();
        if (trimmed) {
          finalTranscript = finalTranscript
            ? (finalTranscript.trimEnd() + ' ' + trimmed)
            : trimmed;
        }
      } else {
        interim += text;
      }
    }

    const composed = (finalTranscript + (interim ? (' ' + interim.trimStart()) : '')).trim();
    answerInput.value = composed;
  };

  recognition.onend = () => {
    isRecording = false;
    if (micBtn) micBtn.classList.remove('recording');
    if (answerInput) answerInput.placeholder = 'TYPE YOUR DEFENSE...';
    console.info('[MockMode] Mic recording ended.');

    // Keep it alive if the user armed it, unless we are soft-paused or hit a fatal error.
    if (micArmed && !softPaused && !fatalError) {
      // Small delay avoids "start called too soon" issues.
      setTimeout(() => startMicCapture(), 200);
    }
  };

  recognition.onerror = (event) => {
    isRecording = false;
    if (micBtn) micBtn.classList.remove('recording');
    if (answerInput) answerInput.placeholder = 'TYPE YOUR DEFENSE...';

    const error = event && event.error ? event.error : 'unknown-error';
    console.warn('[MockMode] Mic error:', error);

    // Fatal permission errors: stop trying and disarm.
    if (error === 'not-allowed' || error === 'service-not-allowed') {
      fatalError = true;
      micArmed = false;
      softPaused = false;
      updateMicUi();
      if (typeof showToast === 'function') {
        showToast('Mic permission blocked. Allow microphone access in browser settings.', 'error');
      }
      return;
    }

    // Transient errors: try to restart if still armed and not soft-paused.
    if (micArmed && !softPaused && !fatalError) {
      setTimeout(() => startMicCapture(), 350);
    } else if (typeof showToast === 'function') {
      showToast(`Mic error: ${error}. Check permissions and browser support.`, 'error');
    }
  };
}

function toggleMic() {
  if (!recognition) {
    if (typeof showToast === 'function') {
      showToast('Speech recognition not supported in this browser.', 'warning');
    }
    return;
  }

  micArmed = !micArmed;
  fatalError = false;

  // If user is explicitly toggling, remove any soft pause.
  softPaused = false;

  // If turning ON, start listening; if turning OFF, stop listening.
  updateMicUi();
  if (micArmed) startMicCapture();
  else stopMicCapture(true);
}

// startMicCapture() respects "armed", but clears softPause because this is an active capture request.
function startMicCapture() {
  if (!micArmed || !recognition || isRecording || fatalError) return;

  softPaused = false;
  finalTranscript = ''; // reset transcript for new question

  try {
    recognition.start();
  } catch (err) {
    // Some browsers throw if start is called while already starting/stopping.
    console.warn('[MockMode] Mic start failed:', err);
  }
}

// stopMicCapture(userInitiated=false): if userInitiated is false, we soft-pause instead of disarming.
function stopMicCapture(userInitiated = false) {
  if (!recognition) return;

  if (!userInitiated) {
    softPaused = true; // prevents auto-restart from onend while the app processes submit/skip
  }

  if (!isRecording) return;

  try {
    recognition.stop();
  } catch (err) {
    console.warn('[MockMode] Mic stop failed:', err);
  }
}

// Expose globals used elsewhere (e.g., interview flow)
window.startMicCapture = startMicCapture;
window.stopMicCapture = stopMicCapture;
window.isMicArmed = () => micArmed;

window.addEventListener('DOMContentLoaded', () => {
  logSpeechDiagnostics();
  setupSTT();
  updateMicUi();

  const micBtn = document.getElementById('mic-btn');
  if (micBtn) {
    micBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMic();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (document.activeElement === document.getElementById('answer-input')) return;
    if (event.key.toLowerCase() === 'm') toggleMic();
  });
});