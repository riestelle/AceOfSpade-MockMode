# MockMode

**[MockMode — Hired or Fired?](https://mockmode.vercel.app/)**

Download `fake.txt` if you want to test with a sample resume.

**MockMode** is a gamified AI-powered interview simulator. You paste your resume, pick an interviewer personality, and get put through a real-time interview where an AI asks you questions, reacts to your answers, and judges whether you're hired, waitlisted, or fired.

It's not a quiz. It's a game.

---

## What it does

You paste your resume and choose how brutal you want it:

- **Ms. Reyes** (Strict Corporate) — zero patience, high standards
- **Kai** (Chill Startup) — laid-back but still paying attention
- **Dr. Matsuda** (Technical Lead) — cares about the details

The AI reads your resume and generates personalized interview questions based on what's actually in it. You answer, it evaluates, and you watch your stress meter creep up or stabilize depending on how you're doing. One bad answer chain and you're fired. String together good ones and you might just get hired.

---

## Game mechanics

There's actual game logic running underneath:

- **Stress meter** starts at 30. Bad answers push it up. Hit 100 and you're done.
- **Combo system** tracks consecutive good answers (60+). It resets on failure.
- **45-second timer** per question. Let it run out and you take a stress penalty.
- **One skip** allowed per session — but it costs +15 stress.
- **Boss question** on the last round with a score multiplier.
- **Final verdict**: Hired, Waitlisted, or Fired — determined by the AI based on your scores and resume. Stress hitting 100 skips the AI and fires you instantly.

---

## Tips for Best Experience

- **Voice input:** Speak clearly and keep answers concise. Whisper performs best with focused responses rather than long continuous speech.
- **Webcam:** Enable camera access in Settings (Menu) before starting your session for a smoother experience.
- **Resume:** Use a well-formatted PDF or TXT file for best parsing results.
- **Browser:** Use a Chromium-based browser (Chrome, Edge) for best Web Speech API and webcam support.

---

## Features

- Resume input and session initialization
- AI-generated questions personalized to resume content
- Answer evaluation with per-question scoring
- Stress meter and combo tracking
- Skip button (one per session, +15 stress)
- Interviewer personas — Ms. Reyes, Kai, Dr. Matsuda — each with Lottie character animations and distinct questioning styles
- Face expression → stress integration: sustained negative expressions during answering apply passive stress spikes
- Answer history drawer (keyboard shortcut `[H]`)
- Results page with Chart.js score breakdown and verdict reveal
- Downloadable results PDF via html2canvas + jsPDF
- Voice output via Web Speech API with sentence-by-sentence delivery, natural pacing, and premium voice selection
- Voice input via Web Speech API (browser-native STT)
- Offline speech recognition via Xenova/whisper-base.en (ONNX, Transformers.js) — prewarmed on page load to reduce first-use latency
- Webcam confidence tracking via face-api.js with consent flow and live expression HUD
- Mobile PiP camera bubble — draggable, resizable, only visible on narrow screens where the dialogue-box camera is hidden
- Dark/light theme support
- Sound effects and lobby music with toggle controls
- How-to-play modal on the landing page
- AI fallback chain: Groq (`llama-3.3-70b-versatile`) → Gemini (`gemini-1.5-flash`) → OpenRouter (`meta-llama/llama-3.3-70b-instruct:free`) with automatic key rotation
- Mobile responsive layout with platform detection

---

## Tech stack

**Frontend**
- HTML5, Tailwind CSS, Vanilla JS
- Chart.js for the results score breakdown
- Lottie (bodymovin) for animated interviewer characters
- Web Speech API for voice input/output (browser-native TTS/STT)
- Xenova/whisper-base.en (ONNX, via Transformers.js) for higher-quality offline speech recognition
- face-api.js for webcam-based confidence tracking

**Backend**
- Vercel Serverless Functions (Node.js 20.x)
- Single `/api/ai.js` route with key rotation across multiple Groq and Gemini keys

**AI**
- Groq (`llama-3.3-70b-versatile`) — question generation and answer evaluation
- Gemini (`gemini-1.5-flash`) — resume analysis and final feedback
- OpenRouter (`meta-llama/llama-3.3-70b-instruct:free`) — fallback when primary keys are exhausted

---

## Project structure

```
mockmode/
├── index.html                    # Landing page (with how-to-play modal + lobby music)
├── upload.html                   # Resume input + setup
├── interview.html                # Main game screen
├── results.html                  # Final verdict + score chart + PDF export
├── 404.html
├── privacy.html
├── api/
│   └── ai.js                     # Unified AI proxy with key rotation and fallback chain
├── assets/
│   ├── animations/               # Lottie JSON character files (Reyes, Kai, Matsuda)
│   ├── css/
│   │   ├── styling.interview.css         # Interview-specific styling
│   │   └── mobile.styling.interview.css  # Mobile responsive overrides
│   ├── img/
│   ├── js/
│   │   ├── ai.js                 # Frontend AI caller (askAI, askAIStream)
│   │   ├── main.js               # Shared utilities
│   │   ├── results.js            # Verdict calculation + chart + PDF export
│   │   ├── upload.js             # Resume handling + session init
│   │   └── session-interview/
│   │       ├── asset.interview.js        # Core interview session logic
│   │       ├── asset.webcam.js           # Webcam consent + face monitoring
│   │       ├── session.realtime.tts.js   # Browser TTS/STT bridge
│   │       ├── session.realtime.speech.js
│   │       ├── sessionators.interface.js # Mobile vs desktop platform detector
│   │       ├── vendor/
│   │       │   ├── face-api.min.js
│   │       │   ├── test.whisper.js
│   │       │   └── test.synthesis.js
│   │       └── models/           # face-api + Whisper ONNX model files
│   └── tailwind/
│       └── tailwind.styling.interview.js
├── sounds/                       # UI sound effects and lobby music
├── fake.txt                      # Sample resume for testing
├── package.json
└── vercel.json
```

---

## Setup

The easiest way is to just hit the live link above. But if you want to run it locally:

### 1. Clone the repo

```bash
git clone https://github.com/riestelle/AceInSpade-MockMode.git
cd AceInSpade-MockMode-main
```

### 2. Install Vercel CLI and run

```bash
npm install -g vercel
vercel dev
```

Then open `http://localhost:3000`.

### 3. Whisper model files

The Whisper ONNX model files are large and not committed to the repo. Download them via the included GitHub Actions workflow:

```
.github/workflows/download-whisper-model.yml
```

You can trigger it manually from the GitHub UI under **Actions → Download Whisper Model**, or run it automatically on push. The workflow downloads `Xenova/whisper-base.en` encoder and decoder ONNX files into `assets/js/session-interview/models/Xenova/whisper-base.en/onnx/`.

---

## Contributors

[@riestelle](https://github.com/riestelle)
[@bugvn](https://github.com/bugvn)
[@vectoriunknown](https://github.com/vectoriunknown)
[@cantilangalexandramarie-lgtm](https://github.com/cantilangalexandramarie-lgtm)

---

## Built for

Ace in Spade — DevKada Hackathon Project, 2026
