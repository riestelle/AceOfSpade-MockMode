// TTS / STT support for the interview session.
// This file provides speakText(), toggleSound(), setupSTT(), and toggleMic().

let soundOn = false;
let currentUtterance = null;
let recognition = null;
let isRecording = false;
const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

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

function setupSTT() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  const answerInput = document.getElementById('answer-input');
  const micBtn = document.getElementById('mic-btn');

  recognition.onstart = () => {
    isRecording = true;
    if (micBtn) micBtn.classList.add('recording');
    if (answerInput) answerInput.placeholder = 'LISTENING...';
  };

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    if (answerInput) answerInput.value = transcript;
  };

  recognition.onend = () => {
    isRecording = false;
    if (micBtn) micBtn.classList.remove('recording');
    if (answerInput) answerInput.placeholder = 'TYPE YOUR DEFENSE...';
  };

  recognition.onerror = () => {
    isRecording = false;
    if (micBtn) micBtn.classList.remove('recording');
    if (answerInput) answerInput.placeholder = 'TYPE YOUR DEFENSE...';
  };
}

function toggleMic() {
  if (!recognition) {
    if (typeof showToast === 'function') {
      showToast('Speech recognition not supported in this browser.', 'warning');
    }
    return;
  }

  if (isRecording) {
    recognition.stop();
  } else {
    recognition.start();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setupSTT();

  const soundIcon = document.getElementById('sound-icon');
  if (soundIcon) {
    soundIcon.textContent = soundOn ? 'volume_up' : 'volume_off';
  }

  const micBtn = document.getElementById('mic-btn');
  if (micBtn) micBtn.addEventListener('click', toggleMic);

  const soundBtn = document.getElementById('sound-btn');
  if (soundBtn) soundBtn.addEventListener('click', toggleSound);

  document.addEventListener('keydown', (event) => {
    if (document.activeElement === document.getElementById('answer-input')) return;
    switch (event.key.toLowerCase()) {
      case 's':
        toggleSound();
        break;
      case 'm':
        toggleMic();
        break;
    }
  });
});
