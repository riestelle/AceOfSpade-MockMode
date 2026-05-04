// MockMode — upload.js
// Depends on: main.js, ai.js

let selectedPersonality = null;
let selectedRole = null;

document.addEventListener('DOMContentLoaded', () => {
  clearSession();
  // Clear keys that main.js clearSession() missed
  localStorage.removeItem('mm_resume_validated');
  localStorage.removeItem('mm_detected_role');
  bindResumeTextarea();
  bindFileUpload();
});

async function runResumeValidation(text) {
  const indicator = document.getElementById('resume-validation');
  if (!indicator) return;

  setValidationState('loading', '🔍 Analyzing resume...');

  // ── RULE-BASED PRE-CHECK (runs regardless of AI) ──
  const lower = text.toLowerCase();

  const codeSignals = [
    'function ', 'const ', 'let ', 'var ', 'import ', 'export ',
    'console.log', '=>', '{}', '();', '<!doctype', '<html', 'def ',
    'class ', 'return ', 'printf', '#include'
  ];
  const resumeSignals = [
    'experience', 'education', 'skills', 'work', 'university',
    'college', 'bachelor', 'master', 'intern', 'email', 'phone',
    'linkedin', 'objective', 'summary', 'project', 'certification'
  ];

  const codeHits   = codeSignals.filter(s => lower.includes(s)).length;
  const resumeHits = resumeSignals.filter(s => lower.includes(s)).length;

  // block obvious code or non-resume text immediately
  if (codeHits >= 3) {
    setValidationState('error', '❌ This looks like code, not a resume.');
    saveToStorage('resume_validated', false);
    return;
  }
  if (resumeHits < 3) {
    setValidationState('error', '❌ This doesn\'t look like a resume. Missing key sections.');
    saveToStorage('resume_validated', false);
    return;
  }

  // ── AI CHECK (runs only if pre-check passes) ──
  try {
    const messages = [
      {
        role: 'system',
        content: `You are an extremely strict resume validator. Your default answer is FAIL.
        A VALID resume MUST have ALL of these:
        - A person's name
        - Contact info (email, phone, or LinkedIn)
        - At least one real job or internship with dates
        - Education section with a school name
        - Skills section

        AUTOMATICALLY FAIL:
        - Code blocks or programming scripts
        - Analysis or critique of a resume
        - Cover letters, articles, job postings
        - Text that talks ABOUT a resume instead of BEING one

        Return ONLY JSON:
        {
          "isResume": false,
          "confidence": 85,
          "reason": "one short sentence",
          "detectedRole": "job title or null",
          "missingFields": ["missing fields"]
        }`
      },
      {
        role: 'user',
        content: `Validate this. Is it a real resume or something else?\n\n${text.slice(0, 2000)}`
      }
    ];

    const result = await askAI(messages);
    const parsed = parseJSON(result);

    if (!parsed) throw new Error('Invalid AI response');

    if (parsed.isResume && parsed.confidence >= 70) {
      setValidationState('success', `✅ Valid resume! Detected: ${parsed.detectedRole}`);
      saveToStorage('resume_validated', true); 
      saveToStorage('detected_role', (parsed.detectedRole ?? 'general').toLowerCase());
    } else if (parsed.isResume && parsed.confidence < 70) {
      const missing = parsed.missingFields?.join(', ') || 'some sections';
      setValidationState('warn', `⚠️ Looks incomplete. Missing: ${missing}`);
      saveToStorage('resume_validated', false);
    } else {
      setValidationState('error', `❌ Not a resume. ${parsed.reason}`);
      saveToStorage('resume_validated', false);
    }

  } catch (err) {
    console.error('[Validation] AI failed:', err.message);

    // ── FALLBACK: trust the pre-check if AI is down ──
    if (resumeHits >= 5) {
      setValidationState('success', `✅ Looks like a resume! (offline check)`);
      saveToStorage('resume_validated', true);
      saveToStorage('detected_role', 'general');
    } else {
      setValidationState('warn', `⚠️ Could not fully verify. Proceed carefully.`);
      saveToStorage('resume_validated', false);
    }
  }
}

function setValidationState(state, message) {
  const indicator = document.getElementById('resume-validation');
  if (!indicator) return;

  indicator.textContent = message;
  indicator.className   = `resume-validation ${state}`; // style via CSS
  indicator.style.display = 'block';
}

function clearResumeValidation() {
  const indicator = document.getElementById('resume-validation');
  if (!indicator) return;
  indicator.style.display = 'none';
  saveToStorage('resume_validated', false);
}

function bindResumeTextarea() {
  const textarea = document.getElementById('resume-input');
  const counter  = document.getElementById('resume-char-count');
  if (!textarea) return;

  // ── live character count ──
  textarea.addEventListener('input', () => {
    const len = textarea.value.trim().length;
    if (counter) {
      counter.textContent = `${len} characters`;
      counter.classList.toggle('text-tertiary', len >= 100);
    }
    textarea.classList.remove('border-error');
    clearResumeValidation(); // clear old result when user edits
  });

  // ── AI validation fires when user clicks away ──
  textarea.addEventListener('blur', async () => {
    const text = textarea.value.trim();
    if (text.length < 100) return;
    saveToStorage('resume_validated', false); // reset before async call
    await runResumeValidation(text);
  });
}

function bindFileUpload() {
  const fileInput = document.getElementById('resume-file');
  if (!fileInput) return;

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const textarea = document.getElementById('resume-input');
    if (!textarea) return;

    // ── TXT ──
    if (file.type === 'text/plain') {
      const text = await file.text();
      textarea.value = text;
      textarea.dispatchEvent(new Event('input'));
      showToast('Resume loaded from file!', 'success');
      return;
    }

    // ── PDF ──
    if (file.type === 'application/pdf') {
      showToast('Reading PDF...', 'info');
      try {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        const buffer      = await file.arrayBuffer();
        const pdf         = await pdfjsLib.getDocument({ data: buffer }).promise;
        let fullText      = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page    = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map(item => item.str).join(' ');
          fullText += pageText + '\n';
        }

        textarea.value = fullText.trim();
        textarea.dispatchEvent(new Event('input'));
        showToast('PDF loaded successfully!', 'success');
      } catch (err) {
        console.error('[FileUpload] PDF parse failed:', err);
        showToast('Could not read PDF. Try copy-pasting instead.', 'error');
      }
      return;
    }

    // ── DOCX ──
    if (file.name.endsWith('.docx') ||
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      showToast('Reading DOCX...', 'info');
      try {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');

        const buffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buffer });

        textarea.value = result.value.trim();
        textarea.dispatchEvent(new Event('input'));
        showToast('DOCX loaded successfully!', 'success');
      } catch (err) {
        console.error('[FileUpload] DOCX parse failed:', err);
        showToast('Could not read DOCX. Try copy-pasting instead.', 'error');
      }
      return;
    }

    // ── UNSUPPORTED ──
    showToast('Unsupported file type. Please upload a PDF, DOCX, or TXT file.', 'warning');
  });
}

// ── HELPER: lazy-load external scripts only once ──
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s   = document.createElement('script');
    s.src     = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

/* ── PHASE 1 DATA ── */
function pickJob(job) {
  selectedRole = job;
  saveToStorage('role', job.toLowerCase().trim()); // ← normalize here
  const indicator = document.getElementById('role-validation');
  if (indicator) indicator.style.display = 'none';
}

function validatePhase1() {
  const resume = document.getElementById('resume-input').value.trim();

  if (!resume || resume.length < 50) {
    showToast('Please paste your resume (at least 50 characters).', 'error');
    return false;
  }

  // Save early so enterRoom() always has it regardless of role-match outcome
  saveToStorage('resume', resume);

  const validated = getFromStorage('resume_validated');
  if (!validated) {
    showToast('Please wait for resume validation or fix the issues flagged.', 'warning');
    document.getElementById('resume-input').classList.add('border-error');
    return false;
  }

  const role         = getFromStorage('role')?.toLowerCase().trim();
  const detectedRole = getFromStorage('detected_role')?.toLowerCase().trim();

  if (!role) {
    showToast('Pick a role first!', 'warning');
    return false;
  }

  // ── ROLE MATCH CHECK ──
  const roleKeywords = {
    developer:  ['developer', 'engineer', 'software', 'frontend', 'backend', 'fullstack', 'programmer', 'coding', 'javascript', 'python', 'react', 'node'],
    designer:   ['designer', 'design', 'ui', 'ux', 'graphic', 'visual', 'creative', 'figma', 'adobe', 'wireframe', 'prototype'],
    analyst:    ['analyst', 'data', 'analytics', 'business intelligence', 'sql', 'reporting', 'excel', 'tableau', 'metrics'],
    marketing:  ['marketing', 'growth', 'seo', 'content', 'brand', 'social media', 'campaign', 'advertising', 'copywriting'],
    general:    []
  };

  const keywords    = roleKeywords[role] ?? [];
  const detected    = detectedRole?.toLowerCase() ?? '';
  // ── ALSO scan the actual resume text, not just detectedRole ──
  const resumeText  = resume.toLowerCase();

  // general always passes
  if (role === 'general') {
    //saveToStorage('resume', resume);
    return true;
  }

  // check BOTH detectedRole string AND resume text for role keywords
  const matchInDetected = keywords.some(k => detected.includes(k));
  const matchInResume   = keywords.some(k => resumeText.includes(k));
  const isMatch         = matchInDetected || matchInResume;

  // cross-check: does resume contain keywords from OTHER roles more than selected role?
  const otherRoles = Object.entries(roleKeywords).filter(([r]) => r !== role && r !== 'general');
  const otherHits  = otherRoles.map(([r, kws]) => ({
    role: r,
    hits: kws.filter(k => resumeText.includes(k)).length
  }));
  const selectedHits  = keywords.filter(k => resumeText.includes(k)).length;
  const strongerMatch = otherRoles.length > 0 && otherHits.some(o => o.hits > selectedHits + 2);

 if (!isMatch || strongerMatch) {
    const bestMatch = otherHits.sort((a, b) => b.hits - a.hits)[0];
    setRoleValidationState('error',
      `❌ Role mismatch! Your resume fits "${bestMatch?.role ?? detectedRole}" better than "${role}". Please select the correct role.`
    );
    return false;
  }

  // ── MATCH CONFIRMED ──
  setRoleValidationState('success', `✅ Role matched! Your resume fits "${role}".`);
  //saveToStorage('resume', resume);
  return true;
}

// ── ROLE VALIDATION INDICATOR ──
function setRoleValidationState(state, message) {
  const indicator = document.getElementById('role-validation');
  if (!indicator) return;
  indicator.textContent   = message;
  indicator.className     = `resume-validation ${state}`; // reuse same CSS
  indicator.style.display = 'block';
}
/* ── PHASE 2 DATA ── */
function pickDoor(personality) {
  selectedPersonality = personality;
  saveToStorage('personality', personality);
  console.log('[upload.js] Personality saved:', personality); // debug
}

/* ── PHASE 2 SUBMIT ── */
async function enterRoom() {
  const btn = document.getElementById('enter-btn');
  if (btn.disabled) return;
  btn.disabled = true;

  const resumeText  = getFromStorage('resume');
  const personality = getFromStorage('personality');
  const role        = getFromStorage('role');

  console.log('[enterRoom] resume:', !!resumeText, '| personality:', personality, '| role:', role); // debug

  if (!resumeText || !personality || !role) {
    showToast('Something went wrong. Please start over.', 'error');
    btn.disabled = false;
    navigateTo('upload.html');
    return;
  }

  showLoader('Analyzing your resume...');

  // In enterRoom(), replace the existing try/catch with this:
try {
    const analysis = await analyzeResume(resumeText);
    if (!analysis) throw new Error('Empty analysis result.');

    saveToStorage('resume_analysis', analysis);
    hideLoader();
    showToast('Resume analyzed! Starting your interview...', 'success');
    setTimeout(() => navigateTo('interview.html'), 800);

    } catch (err) {
    hideLoader();
    btn.disabled = false;
    console.error('[MockMode] Resume analysis failed:', err.message);
    showToast('Resume analysis failed. Please try again.', 'error');
}
}