export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, provider = 'groq', stream = false } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request: messages array required' });
  }

  // ── API Keys ──────────────────────────────────────────────────────────────
  // Multiple Groq keys — rotates automatically if one hits rate limit
  const GROQ_KEYS = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
  ].filter(Boolean); // removes undefined keys so missing ones are skipped

  const GEMINI_KEYS = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
  ].filter(Boolean);

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  // ── Diagnostic log (remove after confirming keys are loaded) ─────────────
  console.log('[MockMode] Key counts:', {
    groq: GROQ_KEYS.length,
    gemini: GEMINI_KEYS.length,
    openrouter: !!OPENROUTER_API_KEY,
  });

  // ── Guard: no keys configured at all ─────────────────────────────────────
  if (GROQ_KEYS.length === 0 && GEMINI_KEYS.length === 0 && !OPENROUTER_API_KEY) {
    console.error('[MockMode] No API keys found in environment variables.');
    return res.status(500).json({ error: 'No API keys configured. Set GROQ_API_KEY in Vercel environment variables.' });
  }

  // ── STREAMING MODE ────────────────────────────────────────────────────────
  // Tries Groq streaming first; if all Groq keys fail, falls back to Gemini
  // (non-streaming) and simulates SSE token-by-token so the client sees the
  // same event format regardless of which provider answered.
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // ── Try each Groq key with real streaming ──────────────────────────
    for (const key of GROQ_KEYS) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages,
            max_tokens: 1024,
            temperature: 0.7,
            stream: true,
          }),
        });

        if (!response.ok) {
          console.warn(`[MockMode] Groq stream key failed with status ${response.status}`);
          continue; // rate limited or bad key, try next
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(l => l.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                res.write(`data: [DONE]\n\n`);
                continue;
              }
              try {
                const parsed = JSON.parse(data);
                const token  = parsed.choices?.[0]?.delta?.content;
                if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
              } catch (_) { /* skip malformed chunks */ }
            }
          }
        }

        res.end();
        return; // success — stop trying other keys

      } catch (_) {
        continue; // this key failed, try next
      }
    }

    // ── All Groq keys failed — fall back to Gemini (simulated stream) ──
    console.warn('[MockMode] All Groq stream keys failed. Falling back to Gemini for stream.');

    const systemMessage = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');
    const contents = otherMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const geminiPayload = { contents };
    if (systemMessage) {
      geminiPayload.systemInstruction = { parts: [{ text: systemMessage.content }] };
    }

    for (const key of GEMINI_KEYS) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload),
          }
        );

        if (!response.ok) {
          console.warn(`[MockMode] Gemini stream-fallback key failed with status ${response.status}`);
          continue;
        }

        const data = await response.json();
        const fullText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

        if (!fullText) {
          console.warn('[MockMode] Gemini stream-fallback empty content:', JSON.stringify(data).slice(0, 200));
          continue;
        }

        // Simulate streaming: send the text in small word-sized chunks
        const words = fullText.split(' ');
        for (let i = 0; i < words.length; i++) {
          const token = (i === 0 ? '' : ' ') + words[i];
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
        res.write(`data: [DONE]\n\n`);
        res.end();
        return;

      } catch (_) {
        continue;
      }
    }

    // All providers failed for stream
    console.error('[MockMode] All stream providers (Groq + Gemini) failed.');
    res.write(`data: ${JSON.stringify({ error: 'All stream providers failed' })}\n\n`);
    res.end();
    return;
  }

  // ── REGULAR MODE (JSON responses) ─────────────────────────────────────────

  // Tries each Groq key in order, returns first success
  async function callGroq(messages) {
    for (const key of GROQ_KEYS) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages,
            max_tokens: 1024,
            temperature: 0.7,
          }),
        });

        if (!response.ok) {
          console.warn(`[MockMode] Groq key failed with status ${response.status}`);
          continue; // rate limited or bad key, try next
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content ?? null;
        if (content) return content; // got a valid response

      } catch (_) {
        continue;
      }
    }
    return null; // all Groq keys failed
  }

  // Gemini fallback — tries each key in order
  async function callGemini(messages) {
    if (!GEMINI_KEYS.length) return null;

    const systemMessage = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const contents = otherMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const payload = { contents };
    if (systemMessage) {
      payload.systemInstruction = { parts: [{ text: systemMessage.content }] };
    }

    for (const key of GEMINI_KEYS) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );

        if (!response.ok) {
          console.warn(`[MockMode] Gemini key failed with status ${response.status}`);
          continue;
        }

        const data = await response.json();
        const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
        if (content) return content;
        console.warn('[MockMode] Gemini empty content:', JSON.stringify(data).slice(0, 200));

      } catch (_) {
        continue;
      }
    }
    return null; // all Gemini keys failed
  }

  // OpenRouter fallback — free tier supports llama models
  async function callOpenRouter(messages) {
    if (!OPENROUTER_API_KEY) return null;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://mockmode.vercel.app',
          'X-Title': 'MockMode',
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages,
          max_tokens: 1024,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        console.warn(`[MockMode] OpenRouter failed with status ${response.status}`);
        return null;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content ?? null;
      if (!content) console.warn('[MockMode] OpenRouter empty content:', JSON.stringify(data).slice(0, 200));
      return content;

    } catch (_) {
      return null;
    }
  }

  // ── Fallback chain ────────────────────────────────────────────────────────
  // Order: Groq (all keys) → Gemini → OpenRouter
  try {
    let result = null;

    if (provider === 'groq') {
      result = await callGroq(messages);
      if (!result) result = await callGemini(messages);
      if (!result) result = await callOpenRouter(messages);
    } else {
      result = await callGemini(messages);
      if (!result) result = await callGroq(messages);
      if (!result) result = await callOpenRouter(messages);
    }

    if (!result) {
      return res.status(500).json({ error: 'All AI providers failed. Please try again.' });
    }

    return res.status(200).json({ content: result });

  } catch (error) {
    console.error('AI handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}