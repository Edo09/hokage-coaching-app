// Usage: node scripts/gen-rest-chime.js <done|start|silent> <out.wav>
//   node scripts/gen-rest-chime.js done assets/sounds/rest_done.wav
//   node scripts/gen-rest-chime.js start assets/sounds/rest_start.wav
//   node scripts/gen-rest-chime.js silent assets/sounds/rest_silent.wav

// Generates the rest-timer sounds as 16-bit mono WAVs.
// WAV (not mp3) because Android's notification-channel sound must be a bundled
// .wav, and the same file then serves the in-app player on both platforms.
// File names use underscores: they become Android raw resources, which allow
// only a-z, 0-9 and "_" (a hyphen fails the prebuild).
const { Buffer } = require("buffer");
const fs = require("fs");

const RATE = 44100;

const SOUNDS = {
  // A major arpeggio, ascending: reads as "done", not as an error buzz.
  done: { notes: [880.0, 1108.73, 1318.51], noteS: 0.11, gapS: 0.045, tailS: 0.18, peak: 0.89 },
  // Rest started: the arpeggio's first two notes, quicker and quieter — an
  // acknowledgement of the tap, not an alarm.
  start: { notes: [880.0, 1108.73], noteS: 0.07, gapS: 0.03, tailS: 0.06, peak: 0.6 },
  // iOS only buzzes for a notification that has a sound; "vibrate only" plays this.
  silent: { notes: [], durationS: 0.3 },
};

const kind = process.argv[2];
const out = process.argv[3];
const spec = SOUNDS[kind];
if (spec == null || out == null) {
  console.error("usage: node scripts/gen-rest-chime.js <done|start|silent> <out.wav>");
  process.exit(1);
}

const totalS =
  spec.durationS ?? spec.notes.length * spec.noteS + (spec.notes.length - 1) * spec.gapS + spec.tailS;
const frames = Math.ceil(totalS * RATE);
const pcm = new Float32Array(frames);

spec.notes.forEach((freq, i) => {
  const start = Math.round(i * (spec.noteS + spec.gapS) * RATE);
  // Last note gets the tail so the chime decays instead of cutting off.
  const len = Math.round((spec.noteS + (i === spec.notes.length - 1 ? spec.tailS : 0)) * RATE);
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
if (peak > 0) for (let i = 0; i < frames; i++) pcm[i] = (pcm[i] / peak) * spec.peak;

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

fs.writeFileSync(out, Buffer.concat([header, data]));
console.log("wrote", out, header.length + data.length, "bytes");
