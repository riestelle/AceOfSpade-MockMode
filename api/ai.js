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
    process.env.GEMINI_6,
    process.env.GEMINI_7,
    process.env.GEMINI_8,
    process.env.GEMINI_9,
    process.env.GEMINI_10,
    process.env.GEMINI_11,
    process.env.GEMINI_12,
    process.env.GEMINI_13,
    process.env.GEMINI_14,
    process.env.GEMINI_15,
  ].filter(Boolean);

  const OPENROUTER_KEYS = [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY_2,
    process.env.OPENROUTER_API_KEY_3,
    process.env.OPENROUTER_API_KEY_4,
    process.env.OPENROUTER_API_KEY_5,
  ].filter(Boolean);

  // ── Diagnostic log (remove after confirming keys are loaded) ─────────────
  console.log('[MockMode] Key counts:', {
    groq: GROQ_KEYS.length,
    gemini: GEMINI_KEYS.length,
    openrouter: OPENROUTER_KEYS.length,
  });

  // ── Guard: no keys configured at all ─────────────────────────────────────
  if (GROQ_KEYS.length === 0 && GEMINI_KEYS.length === 0 && OPENROUTER_KEYS.length === 0) {
    console.error('[MockMode] No API keys found in environment variables.');
    return res.status(500).json({ error: 'No API keys configured. Set GROQ_API_KEY in Vercel environment variables.' });
  }

  // ── STREAMING MODE ────────────────────────────────────────────────────────
  // Fallback chain: Groq (real stream) → Gemini (simulated stream) → OpenRouter (simulated stream)
  // All three produce the same SSE format so the client doesn't care who answered.
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // ── Helper: simulate SSE streaming from a plain text string ───────────
    // Used by Gemini and OpenRouter which don't support real streaming here.
    // BUG FIX: old code produced a leading empty token on i===0 because it
    // prepended '' + words[0]. Now we join with a space correctly.
    function simulateStream(fullText) {
      const words = fullText.split(' ');
      for (let i = 0; i < words.length; i++) {
        const token = (i === 0 ? words[i] : ' ' + words[i]);
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
      res.write(`data: [DONE]\n\n`);
      res.end();
    }

    // ── Helper: build Gemini payload from OpenAI-style messages ───────────
    function buildGeminiPayload(messages) {
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
      return payload;
    }

    // ── 1. Try each Groq key with real streaming ───────────────────────────
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
          continue;
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';  // BUG FIX: buffer across chunks so split('\n') never cuts a data line in half

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep the last (potentially incomplete) line in the buffer
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
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

        res.end();
        return; // Groq succeeded — done

      } catch (_) {
        continue;
      }
    }

    // ── 2. All Groq keys failed — fall back to Gemini ─────────────────────
    console.warn('[MockMode] All Groq stream keys failed. Trying Gemini...');
    const geminiPayload = buildGeminiPayload(messages);

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

        console.info('[MockMode] Gemini stream-fallback succeeded.');
        simulateStream(fullText);
        return;

      } catch (_) {
        continue;
      }
    }

    // ── 3. All Gemini keys failed — fall back to OpenRouter ───────────────
    console.warn('[MockMode] All Gemini stream keys failed. Trying OpenRouter...');

    for (const key of OPENROUTER_KEYS) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
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
          console.warn(`[MockMode] OpenRouter stream-fallback key failed with status ${response.status}`);
          continue;
        }

        const data = await response.json();
        const fullText = data?.choices?.[0]?.message?.content ?? null;

        if (!fullText) {
          console.warn('[MockMode] OpenRouter stream-fallback empty content:', JSON.stringify(data).slice(0, 200));
          continue;
        }

        console.info('[MockMode] OpenRouter stream-fallback succeeded.');
        simulateStream(fullText);
        return;

      } catch (_) {
        continue;
      }
    }

    // ── All providers exhausted ────────────────────────────────────────────
    console.error('[MockMode] All stream providers (Groq + Gemini + OpenRouter) failed.');
    res.write(`data: ${JSON.stringify({ error: 'All stream providers failed. Please try again.' })}\n\n`);
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
    if (!OPENROUTER_KEYS.length) return null;

    for (const key of OPENROUTER_KEYS) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
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
          console.warn(`[MockMode] OpenRouter key failed with status ${response.status}`);
          continue;
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content ?? null;
        if (!content) {
          console.warn('[MockMode] OpenRouter empty content:', JSON.stringify(data).slice(0, 200));
          continue;
        }
        return content;

      } catch (_) {
        continue;
      }
    }
    return null; // all keys exhausted
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
