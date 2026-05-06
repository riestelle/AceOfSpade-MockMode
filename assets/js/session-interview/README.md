# Session Interview Assets

This folder contains the interview-specific frontend logic and webcam support for the MockMode interview experience.

## What is included

- `asset.interview.js` — interview session flow, question loading, answer submission, score evaluation, stress meter, history drawer, TTS/STT wiring, and skip-question handling.
- `asset.webcam.js` — webcam consent, camera startup, face monitoring, and webcam UI status updates.
- `session.realtime.tts.js` / `session.realtime.speech.js` — optional session-level browser TTS/STT bridge scripts used by the interview page when those flow paths are enabled.
- `vendor/face-api.min.js` — bundled `face-api.js` library used by webcam monitoring.
- `models/` — face detection model files required by `asset.webcam.js`.

## Related files used by interview mode

- `interview.html` — interview game page markup. Loads the Tailwind theme, interview CSS, and the session interview scripts.
- `assets/tailwind/tailwind.styling.interview.js` — Tailwind configuration overrides for the interview screen, including dark-theme colors, typography, spacing, and custom design tokens.
- `assets/css/styling.interview.css` — interview-specific styling for the CRT overlay, reaction box, answer history drawer, keyboard hint badges, loading pulses, skip button states, webcam consent banner, and webcam status pill.

## How it works

1. `interview.html` loads the page skeleton and UI elements.
2. `assets/tailwind/tailwind.styling.interview.js` configures Tailwind colors and theme tokens used by the page.
3. `assets/css/styling.interview.css` adds custom visual polish and session-specific classes that are not covered by Tailwind utilities alone.
4. `asset.interview.js` initializes the interview experience after DOM load, reads session data from storage, loads or generates questions, and controls the question/answer lifecycle.
5. `asset.webcam.js` handles webcam permissions, starts the video stream, updates the camera status UI, and optionally monitors face detection using the models in `models/`.

## Key page elements

The interview page depends on the following elements being present:

- `#dialogue-text` — where the current interview question is displayed
- `#answer-input` — text input for candidate answers
- `#submit-answer-btn` — submit button for answers
- `#skip-btn` — one-time skip button for the session
- `#q-current` / `#q-total` — question progress indicators
- `#stress-fill` / `#stress-label` — stress meter UI
- `#reaction-box` — feedback display after each answer
- `#history-drawer` — answer history drawer container
- `#webcam-video` — webcam preview video element
- `#webcam-consent` — webcam consent banner
- `#webcam-status-pill` / `#webcam-status-text` — camera state indicator

## Notes

- `asset.interview.js` depends on shared utilities from `assets/js/main.js` and AI helper code in `assets/js/ai.js`.
- `asset.webcam.js` requires the model files in `assets/js/session-interview/models/` and the bundled `vendor/face-api.min.js` library.
- `session.realtime.tts.js` and `session.realtime.speech.js` provide the alternate browser TTS/STT wiring paths used by the interview session.
- `interview.html` is the entry point for the interview experience and must keep the script import order: Tailwind config first, then interview CSS, then the page's JS.
