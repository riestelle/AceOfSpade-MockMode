# MockMode

**[MockMode — Hired or Fired?](https://mockmode.vercel.app/)**

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
- **Combo system** tracks consecutive good answers (70+). It resets on failure.
- **45-second timer** per question. Let it run out and you take a stress penalty.
- **Follow-up questions** trigger automatically if your answer scores below 60.
- **One skip** allowed per session — but it costs +15 stress.
- **Boss question** on the last round with a score multiplier.
- **Final verdict**: Hired (avg ≥ 80), Waitlisted (middle ground), or Fired (stress ≥ 100 or low scores).

---

## Tech stack

**Frontend**
- HTML5, Tailwind CSS, Vanilla JS
- Chart.js for the results breakdown
- Web Speech API for voice input/output

**Backend**
- Vercel Serverless Functions (Node.js)
- Single `/api/ai.js` route with key rotation across multiple Groq and Gemini keys

**AI**
- Groq (`llama-3.3-70b-versatile`) — question generation and answer evaluation
- Gemini (`gemini-1.5-flash`) — resume analysis and final feedback
- OpenRouter as optional fallback

---

## Project structure

```
mockmode/
├── index.html                  # Landing page
├── upload.html                 # Resume input + setup
├── interview.html              # Main game screen
├── results.html                # Final verdict + score chart
├── 404.html
├── privacy.html
├── api/
│   └── ai.js                   # Unified AI proxy with key rotation
├── assets/
│   ├── css/
│   │   └── styling.interview.css # Interview-specific styling
│   ├── js/
│   │   ├── ai.js                # Frontend AI caller (askAI, askAIStream)
│   │   ├── main.js              # Shared utilities
│   │   ├── results.js           # Verdict calculation + chart
│   │   ├── upload.js            # Resume handling + session init
│   │   ├── session-interview/    # Webcam + face-api support
│   │   │   ├── asset.interview.js
│   │   │   ├── asset.webcam.js
│   │   │   ├── vendor/face-api.min.js
│   │   │   └── models/
│   │   └── (other page scripts)
│   └── tailwind/
│       └── tailwind.styling.interview.js # Tailwind config helper
└── vercel.json
```

---

## Setup

The easiest way is to just hit the live link above. But if you want to run it locally:

### 1. Clone the repo

```bash
git clone https://github.com/riestelle/AceInSpade-MockMode.git
cd MockMode
```

### 2. Install Vercel CLI and run

```bash
npm install -g vercel
vercel dev
```

Then open `http://localhost:3000`.

---

## Status

This project is still in active development. Things that are working:

- Resume input and session initialization
- AI-generated questions based on resume content
- Answer evaluation with per-question scoring
- Stress meter and combo tracking
- Follow-up question branching
- Skip button (one per session)
- Interviewer personas (Ms. Reyes, Kai, Dr. Matsuda)
- Results page with Chart.js score breakdown
- Voice input/output via Web Speech API

Things that are still being worked on:

- Lottie animated interviewer character
- Webcam confidence tracking (Face API.js)
- Downloadable result summary PDF
- Full mobile responsiveness polish

---
## Contributors
@riestelle
@bugvn
@vectoriunknown
@cantilangalexandramarie-lgtm

## Built for

Ace in Spade — DevKada Hackathon Project, 2026
