import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from '@ffmpeg-installer/ffmpeg';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';

ffmpeg.setFfmpegPath(ffmpegStatic.path);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP = '/tmp';

await fs.ensureDir(TEMP);

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

async function getBg() {
  return 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { script, srt: inputSrt, duration = 60, style } = req.body;
  const srt = inputSrt || buildSRT(script, duration);
  const job = uuidv4();
  const dir = path.join(TEMP, job);
  await fs.ensureDir(dir);

  const p = {
    bg: path.join(dir, 'bg.mp4'),
    tts: path.join(dir, 'tts.wav'),
    srt: path.join(dir, 'subs.srt'),
    vid: path.join(dir, 'video.mp4'),
    final: path.join(dir, 'final.mp4')
  };

  try {
    await fs.writeFile(p.srt, srt);
    const bgUrl = await getBg();
    const bgStream = (await axios({ url: bgUrl, responseType: 'stream' })).data;
    await new Promise((r, j) => bgStream.pipe(fs.createWriteStream(p.bg)).on('finish', r).on('error', j));
    await new Promise((r, j) => ffmpeg(p.bg).setDuration(duration).outputOptions('-c copy').save(p.vid).on('end', r).on('error', j));

    // Silence TTS
    const silence = Buffer.alloc(Math.ceil(duration * 16000 * 2), 0);
    await fs.writeFile(p.tts, silence);
    await new Promise((r, j) => ffmpeg(p.vid).input(p.tts).outputOptions('-c:v copy', '-c:a aac', '-shortest').save(p.vid).on('end', r).on('error', j));

    await new Promise((r, j) => {
      ffmpeg(p.vid)
        .videoFilters(`subtitles=${p.srt.replace(/:/g, '\\:')}:force_style='Fontsize=28,PrimaryColour=&Hffffff&,Bold=1'`)
        .outputOptions('-c:v libx264', '-pix_fmt yuv420p')
        .save(p.final)
        .on('end', r)
        .on('error', j);
    });

    res.setHeader('Content-Type', 'video/mp4');
    fs.createReadStream(p.final).pipe(res);
    res.on('finish', () => setTimeout(() => fs.remove(dir), 5000));
  } catch (e) {
    console.error(e);
    await fs.remove(dir);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };
