// Usage: node scripts/gen-rest-chime.js assets/sounds/rest-done.wav

// Generates the rest-timer completion chime as a 16-bit mono WAV.
// WAV (not mp3) because Android's notification-channel sound must be a bundled
// .wav, and the same file then serves the in-app player on both platforms.
const fs = require("fs");

const RATE = 44100;
// A major arpeggio, ascending: reads as "done", not as an error buzz.
const NOTES = [880.0, 1108.73, 1318.51];
const NOTE_S = 0.11;
const GAP_S = 0.045;
const TAIL_S = 0.18; // let the last note ring out instead of clipping

const totalS = NOTES.length * NOTE_S + (NOTES.length - 1) * GAP_S + TAIL_S;
const frames = Math.ceil(totalS * RATE);
const pcm = new Float32Array(frames);

NOTES.forEach((freq, i) => {
  const start = Math.round(i * (NOTE_S + GAP_S) * RATE);
  // Last note gets the tail so the chime decays instead of cutting off.
  const len = Math.round((NOTE_S + (i === NOTES.length - 1 ? TAIL_S : 0)) * RATE);
  for (let n = 0; n < len; n++) {
    const t = n / RATE;
    // 4ms raised-cosine attack kills the click a hard start would produce,
    // then exponential decay for a struck-bell feel.
    const attack = Math.min(1, t / 0.004);
    const env = attack * Math.exp(-t * 11);
    // Second harmonic at -18dB gives it body without sounding buzzy.
    const s = Math.sin(2 * Math.PI * freq * t) + 0.125 * Math.sin(4 * Math.PI * freq * t);
    pcm[start + n] += s * env * 0.42;
  }
});

// Normalize: an alert competing with gym music needs headroom used, not saved.
let peak = 0;
for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(pcm[i]));
if (peak > 0) for (let i = 0; i < frames; i++) pcm[i] = (pcm[i] / peak) * 0.89;

const data = Buffer.alloc(frames * 2);
for (let i = 0; i < frames; i++) {
  const v = Math.max(-1, Math.min(1, pcm[i]));
  data.writeInt16LE(Math.round(v * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

fs.writeFileSync(process.argv[2], Buffer.concat([header, data]));
console.log("wrote", process.argv[2], header.length + data.length, "bytes");
