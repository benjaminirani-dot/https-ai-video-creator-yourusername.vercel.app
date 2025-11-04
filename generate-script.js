import { OpenAI } from 'openai';
import { config } from 'dotenv';
config();

const openai = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' });

function buildSRT(script, dur) {
  const lines = script.split('\n').map(l => l.trim()).filter(Boolean);
  const per = Math.max(2, Math.floor(dur / lines.length));
  let srt = '';
  lines.forEach((l, i) => {
    const s = i * per, e = Math.min(s + per, dur);
    const fmt = (sec) => {
      const h = String(Math.floor(sec / 3600)).padStart(2, '0');
      const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      const secs = String(Math.floor(sec % 60)).padStart(2, '0');
      return `${h}:${m}:${secs},000`;
    };
    srt += `${i + 1}\n${fmt(s)} --> ${fmt(e)}\n${l}\n\n`;
  });
  return srt;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { topic, duration = 60, style, voice, unlimited } = req.body;
  const model = unlimited ? 'grok-4' : 'grok-3-mini';
  const prompt = `Write a ${duration}s video script about "${topic}". Style: ${style}. Voice: ${voice}. One short line per subtitle.`;

  try {
    const c = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 600
    });
    const script = c.choices[0].message.content.trim();
    res.json({ script, srt: buildSRT(script, duration) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
