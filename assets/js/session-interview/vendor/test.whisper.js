// assets/js/session-interview/vendor/test.whisper.js
// Whisper STT via Transformers.js in-browser pipeline. No background recording. No infinite loops.
// Toggle mic with button or [M]. Records a short clip, then transcribes into #answer-input.

const MIC_MAX_ERRORS = 3;
const TARGET_SR = 16000;
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

let micErrors = 0;
let micHardStopped = false;

let stream = null;
let recorder = null;
let chunks = [];
let recording = false;

let transcriberPromise = null;
let transformersPipeline = null;

function warn(...args) { console.warn('[MockMode][Whisper]', ...args); }
function info(...args) { console.info('[MockMode][Whisper]', ...args); }

async function loadTransformersPipeline() {
  if (!transformersPipeline) {
    const mod = await import(TRANSFORMERS_CDN);
    transformersPipeline = mod.pipeline;
    if (typeof transformersPipeline !== 'function') {
      throw new Error('Transformers pipeline() not available');
    }
  }
  return transformersPipeline;
}

function setMicUI(active) {
  const btn = document.getElementById('mic-btn');
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

async function ensureTranscriber() {
  if (!transcriberPromise) {
    if (typeof showToast === 'function') {
      showToast('Loading speech model... (first time only)', 'info');
    }

    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');

    // Explicitly use Hugging Face CDN
    transcriberPromise = pipeline('automatic-speech-recognition', 
      'https://huggingface.co/Xenova/whisper-tiny.en',
      {
        cache_dir: 'https://cdn.huggingface.co',
      }
    )
    .then(p => {
      info('model loaded');
      return p;
    })
    .catch(err => {
      transcriberPromise = null;
      throw err;
    });
  }
  return transcriberPromise;
  if (!transcriberPromise) {
    // Show loading toast for first-time model download
    if (typeof showToast === 'function') {
      showToast('Loading speech model... (first time only)', 'info');
    }

    transcriberPromise = loadTransformersPipeline()
      .then((pipeline) => pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en'))
      .then(p => {
        info('model loaded');
        return p;
      })
      .catch(err => {
        transcriberPromise = null;
        if (typeof showToast === 'function') {
          showToast('Failed to load speech model. Check your connection or browser settings.', 'error');
        }
        throw err;
      });
  }
  return transcriberPromise;
}

async function requestMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('getUserMedia not supported');
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const t of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function mergeChannels(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) return audioBuffer.getChannelData(0);
  const len = audioBuffer.length;
  const out = new Float32Array(len);
  const n = audioBuffer.numberOfChannels;
  for (let ch = 0; ch < n; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] += data[i] / n;
  }
  return out;
}

function resampleLinear(input, inRate, outRate) {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const t = i * ratio;
    const i0 = Math.floor(t);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const a = t - i0;
    out[i] = input[i0] * (1 - a) + input[i1] * a;
  }
  return out;
}

async function blobToPCM16k(blob) {
  const buf = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw new Error('AudioContext not supported');

  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    const mono = mergeChannels(decoded);
    const pcm = resampleLinear(mono, decoded.sampleRate, TARGET_SR);
    return pcm;
  } finally {
    try { await ctx.close(); } catch (_) {}
  }
}

async function transcribeBlob(blob) {
  const input = document.getElementById('answer-input');
  const transcriber = await ensureTranscriber();

  const pcm = await blobToPCM16k(blob);

  // Keep it simple: one-shot transcription. No auto-retry loops.
  const out = await transcriber(pcm, { chunk_length_s: 30, stride_length_s: 5 });
  const text = (out && out.text) ? String(out.text).trim() : '';

  if (input && text) {
    input.value = text;
    input.focus();
  }

  return text;
}

async function startRecording() {
  if (micHardStopped) {
    if (typeof showToast === 'function') showToast('Mic is hard-stopped. Click mic again to reset.', 'warning');
    return;
  }
  if (recording) return;

  if (micErrors >= MIC_MAX_ERRORS) {
    micHardStopped = true;
    setMicUI(false);
    return;
  }

  try {
    stream = await requestMic();
    chunks = [];

    const mimeType = pickMimeType();
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onerror = (e) => {
      warn('MediaRecorder error:', e);
      stopRecording(true);
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
      chunks = [];

      // Release the mic immediately after stop.
      if (stream) {
        for (const t of stream.getTracks()) t.stop();
        stream = null;
      }

      if (!blob || blob.size < 8000) {
        setMicUI(false);
        recording = false;
        return;
      }

      try {
        if (typeof showToast === 'function') showToast('Transcribing...', 'info');
        await transcribeBlob(blob);
        micErrors = 0;
      } catch (err) {
        micErrors++;
        warn('transcribe failed:', err);
        if (micErrors >= MIC_MAX_ERRORS) {
          micHardStopped = true;
          if (typeof showToast === 'function') showToast('Mic failed repeatedly. Click mic to reset.', 'warning');
        } else {
          if (typeof showToast === 'function') showToast(`Transcription failed (${micErrors}/${MIC_MAX_ERRORS}).`, 'warning');
        }
      } finally {
        setMicUI(false);
        recording = false;
      }
    };

    recorder.start();
    recording = true;
    setMicUI(true);
  } catch (err) {
    micErrors++;
    warn('mic start failed:', err);
    setMicUI(false);
    recording = false;

    if (micErrors >= MIC_MAX_ERRORS) {
      micHardStopped = true;
      if (typeof showToast === 'function') showToast('Mic failed repeatedly. Click mic to reset.', 'warning');
    } else {
      if (typeof showToast === 'function') showToast(`Mic error (${micErrors}/${MIC_MAX_ERRORS}).`, 'warning');
    }
  }
}

function stopRecording(force = false) {
  if (!recording) {
    setMicUI(false);
    return;
  }

  try {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  } catch (e) {
    warn('stop threw:', e);
  }

  if (force) {
    // Ensure mic is released even if recorder is unhappy.
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null;
    }
    recording = false;
    setMicUI(false);
  }
}

function toggleMic() {
  if (micHardStopped) {
    micHardStopped = false;
    micErrors = 0;
  }
  if (recording) stopRecording(false);
  else startRecording();
}

// Globals expected by asset.interview.js
window.startMicCapture = function startMicCapture() {
  // No auto-record. This only resets per-question failure state.
  // It does not touch the microphone at all.
};

window.stopMicCapture = function stopMicCapture() {
  stopRecording(true);
};

// Wire UI
function wire() {
  const micBtn = document.getElementById('mic-btn');
  if (micBtn) {
    micBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMic();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (document.activeElement === document.getElementById('answer-input')) return;
    if (e.key.toLowerCase() === 'm') toggleMic();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}