// TTS support for the interview session.
// This file provides speakText() and toggleSound().

let soundOn = false;
let currentUtterance = null;
const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function logTtsDiagnostics() {
  if (!speechSupported) {
    console.warn('[MockMode] TTS is not supported in this browser.');
    return;
  }

  const voices = window.speechSynthesis.getVoices();
  console.info(`[MockMode] TTS voices available: ${voices.length}`);
}

function unlockSpeech() {
  if (!speechSupported) return;
  const unlock = new SpeechSynthesisUtterance('');
  unlock.volume = 0;
  unlock.pitch = 1;
  unlock.rate = 1;
  try {
    window.speechSynthesis.speak(unlock);
  } catch (err) {
    console.warn('[MockMode] TTS unlock failed:', err);
  }
}

function toggleSound() {
  if (!speechSupported) {
    if (typeof showToast === 'function') {
      showToast('Speech synthesis is not available in this browser.', 'warning');
    }
    return;
  }

  soundOn = !soundOn;
  const icon = document.getElementById('sound-icon');
  if (icon) icon.textContent = soundOn ? 'volume_up' : 'volume_off';
  if (soundOn) {
    unlockSpeech();
  } else {
    window.speechSynthesis.cancel();
  }
}

function speakText(text) {
  if (!soundOn || !speechSupported || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.95;
  utter.pitch = 1.05;
  utter.volume = 0.9;
  utter.onstart = () => {
    currentUtterance = utter;
  };
  utter.onend = () => {
    if (currentUtterance === utter) currentUtterance = null;
  };
  utter.onerror = (event) => {
    console.warn('[MockMode] TTS error:', event.error);
    if (currentUtterance === utter) currentUtterance = null;
  };
  currentUtterance = utter;
  window.speechSynthesis.speak(utter);
}

window.addEventListener('DOMContentLoaded', () => {
  logTtsDiagnostics();

  const soundIcon = document.getElementById('sound-icon');
  if (soundIcon) {
    soundIcon.textContent = soundOn ? 'volume_up' : 'volume_off';
  }

  const soundBtn = document.getElementById('sound-btn');
  if (soundBtn) soundBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleSound();
  });

  document.addEventListener('keydown', (event) => {
    if (document.activeElement === document.getElementById('answer-input')) return;
    if (event.key.toLowerCase() === 's') toggleSound();
  });
});
