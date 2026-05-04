const AI_PROXY_URL = '/api/ai';

async function askAI(messages, provider = 'groq') {
  try {
    const response = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, provider })
    });

    if (!response.ok) throw new Error(`Proxy error: ${response.status}`);

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    return data.content;

  } catch (error) {
    console.error('AI call failed:', error);
    throw error;
  }
}


async function askAIStream(messages, onChunk, onDone) {
  try {
    const response = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, stream: true })
    });

    if (!response.ok) throw new Error(`Stream error: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            if (onDone) onDone();
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.token && onChunk) {
              onChunk(parsed.token);
            }
            if (parsed.error) {
              throw new Error(parsed.error);
            }
          } catch (e) {
          }
        }
      }
    }

  } catch (error) {
    console.error('Stream failed:', error);
    throw error;
  }
}

function parseJSON(text) {
  try {
    const cleaned = text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('JSON parse failed:', e);
    return null;
  }
}

async function analyzeResume(resumeText) {
  const messages = [
    {
      role: 'system',
      content: `You are a brutally honest career coach. 
      Analyze the resume and return ONLY a JSON object with no extra text.
      Format: {
        "strengths": ["strength1", "strength2", "strength3"],
        "weaknesses": ["weakness1", "weakness2", "weakness3"],
        "score": 75,
        "summary": "one sentence summary",
        "suggested_role": "best fitting job title"
      }`
    },
    {
      role: 'user',
      content: `Analyze this resume: ${resumeText}`
    }
  ];

  const result = await askAI(messages);
  return parseJSON(result);
}

async function generateQuestions(resumeText, personality, role = 'general') {
  const personalityPrompts = {
    corporate: 'You are a strict, formal corporate hiring manager. Ask tough, professional questions.',
    startup: 'You are a chill startup founder. Ask casual questions focused on passion and culture fit.',
    technical: 'You are a tough technical lead. Ask specific technical questions based on their stack.'
  };

  const roleContext = {
    developer:  'The candidate is interviewing for a Software Developer / Engineer position. Prioritize questions about their code, projects, problem-solving, and tech stack.',
    designer:   'The candidate is interviewing for a UI/UX Designer position. Prioritize questions about their design process, tools, and portfolio.',
    analyst:    'The candidate is interviewing for a Data Analyst position. Prioritize questions about data, metrics, tools like SQL or Excel, and analytical thinking.',
    marketing:  'The candidate is interviewing for a Marketing role. Prioritize questions about campaigns, content, growth, and audience understanding.',
    general:    'Ask well-rounded questions relevant to their experience and the role they are applying for.'
  };

  const messages = [
    {
      role: 'system',
      content: `${personalityPrompts[personality]}
      ${roleContext[role] ?? roleContext.general}
      Generate exactly 5 interview questions based on the resume.
      Return ONLY a JSON array of 5 strings, no extra text.
      Format: ["question1", "question2", "question3", "question4", "question5"]`
    },
    {
      role: 'user',
      content: `Resume: ${resumeText}`
    }
  ];

  const result = await askAI(messages);
  return parseJSON(result);
}

async function evaluateAnswer(question, answer, personality, role = 'general') {
  const personalityPrompts = {
    corporate: 'You are a strict formal corporate hiring manager. React professionally but coldly to weak answers.',
    startup: 'You are a chill startup founder. React warmly but honestly.',
    technical: 'You are a tough technical lead. React skeptically to vague answers.'
  };

  const roleContext = {
    developer:  'You are evaluating a Software Developer candidate. Hold them to a high technical standard — vague answers about code or architecture should score lower.',
    designer:   'You are evaluating a UI/UX Designer candidate. Look for design thinking, clarity of process, and user empathy.',
    analyst:    'You are evaluating a Data Analyst candidate. Expect structured, data-driven reasoning.',
    marketing:  'You are evaluating a Marketing candidate. Look for creativity, measurable results, and audience awareness.',
    general:    'Evaluate based on clarity, relevance, and confidence.'
  };

  const messages = [
    {
      role: 'system',
      content: `${personalityPrompts[personality]}
      ${roleContext[role] ?? roleContext.general}
      Evaluate this interview answer and return ONLY a JSON object with no extra text.
      Format: {
        "reaction": "your in-character reaction to the answer",
        "score": 75,
        "feedback": "one sentence of honest feedback",
        "mood_emoji": "😐",
        "stress_increase": 5
      }
      score is 0-100, stress_increase is 1-10`
    },
    {
      role: 'user',
      content: `Question: ${question}\nAnswer: ${answer}`
    }
  ];

  const result = await askAI(messages);
  return parseJSON(result);
}

// Tracks the last opening word per personality so the AI knows what to avoid
const _lastOpener = {};

async function streamInterviewerMessage(prompt, personality, targetElement, onDone) {
  const personalityPrompts = {
    corporate: 'You are Ms. Reyes, a strict formal corporate hiring manager. You are direct, composed, and expect precision.',
    startup: 'You are Kai, a chill startup co-founder who values passion and authenticity. You are conversational but thoughtful.',
    technical: 'You are Dr. Matsuda, a tough principal engineer who values depth and specificity. You are measured and skeptical.'
  };

  const avoidHint = _lastOpener[personality]
    ? ` Do not start your response with "${_lastOpener[personality]}".`
    : '';

  const messages = [
    {
      role: 'system',
      content: `${personalityPrompts[personality]} Respond in character in 1-2 sentences only.${avoidHint}`
    },
    {
      role: 'user',
      content: prompt
    }
  ];

  if (targetElement) targetElement.textContent = '';

  // Accumulate full streamed text so onDone receives the complete string
  let fullText = '';

  await askAIStream(
    messages,
    (token) => {
      fullText += token;
      if (targetElement) targetElement.textContent += token;
    },
    () => {
      // Track the opening word so next question avoids repeating it
      const firstWord = fullText.trim().split(/\s+/)[0].replace(/[^a-zA-Z]/g, '');
      if (firstWord) _lastOpener[personality] = firstWord;
      // Pass the fully-accumulated text to onDone so TTS speaks
      // exactly what was shown in the dialogue box
      if (onDone) onDone(fullText);
    }
  );
}

async function generateVerdict(scores, resumeAnalysis, personality, role = 'general') {
  const average = scores.reduce((a, b) => a + b, 0) / scores.length;
  let verdict;

  if (average >= 75) verdict = 'HIRED';
  else if (average >= 50) verdict = 'WAITLISTED';
  else verdict = 'FIRED';

  const messages = [
    {
      role: 'system',
      content: `You are the interviewer for a ${role} position. Give a final verdict message in character.
      Return ONLY a JSON object with no extra text.
      Format: {
        "verdict": "${verdict}",
        "verdict_message": "2-3 sentence in-character final message to the candidate",
        "final_tip": "one specific actionable tip to improve as a ${role}"
      }`
    },
    {
      role: 'user',
      content: `Average score: ${average}. 
      Resume strengths: ${resumeAnalysis.strengths.join(', ')}.
      Resume weaknesses: ${resumeAnalysis.weaknesses.join(', ')}.
      Individual scores: ${scores.join(', ')}.`
    }
  ];

  const result = await askAI(messages);
  const parsed = parseJSON(result);
  parsed.average = Math.round(average);
  parsed.scores = scores;
  return parsed;
}