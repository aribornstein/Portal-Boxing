import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const sampleRate = 22_050;
const outputDirectory = path.resolve("public-runtime/assets/audio");

interface CueDefinition {
  readonly name: string;
  readonly duration: number;
  readonly sample: (time: number, noise: number) => number;
}

const cues: readonly CueDefinition[] = [
  {
    name: "portal",
    duration: 0.55,
    sample: (time) => {
      const frequency = 110 + time * 360;
      return Math.sin(time * frequency * Math.PI * 2) * fade(time, 0.55);
    },
  },
  {
    name: "hit",
    duration: 0.14,
    sample: (time, noise) =>
      (Math.sin(time * 95 * Math.PI * 2) * 0.75 + noise * 0.25) *
      Math.exp(-time * 25),
  },
  {
    name: "kick-hit",
    duration: 0.24,
    sample: (time, noise) =>
      (Math.sin(time * 58 * Math.PI * 2) * 0.72 +
        Math.sin(time * 116 * Math.PI * 2) * 0.18 +
        noise * 0.1) *
      Math.exp(-time * 14),
  },
  {
    name: "player-hit",
    duration: 0.2,
    sample: (time, noise) =>
      (Math.sin(time * 68 * Math.PI * 2) * 0.7 + noise * 0.3) *
      Math.exp(-time * 17),
  },
  {
    name: "guard",
    duration: 0.18,
    sample: (time) =>
      (Math.sin(time * 720 * Math.PI * 2) * 0.65 +
        Math.sin(time * 1_180 * Math.PI * 2) * 0.35) *
      Math.exp(-time * 18),
  },
  {
    name: "telegraph",
    duration: 0.24,
    sample: (time) => {
      const frequency = 260 + time * 1_500;
      return Math.sin(time * frequency * Math.PI * 2) * fade(time, 0.24);
    },
  },
  {
    name: "wave-clear",
    duration: 0.42,
    sample: (time) => {
      const frequency = time < 0.2 ? 440 : 660;
      return Math.sin(time * frequency * Math.PI * 2) * fade(time, 0.42);
    },
  },
  {
    name: "knockout",
    duration: 0.72,
    sample: (time, noise) => {
      const frequency = 170 - time * 155;
      return (
        (Math.sin(time * frequency * Math.PI * 2) * 0.85 + noise * 0.15) *
        fade(time, 0.72)
      );
    },
  },
];

await mkdir(outputDirectory, { recursive: true });
for (const cue of cues) {
  await writeFile(
    path.join(outputDirectory, `${cue.name}.wav`),
    encodeWave(cue),
  );
}
console.log(`Generated ${cues.length} deterministic combat cues`);

function encodeWave(cue: CueDefinition) {
  const sampleCount = Math.round(cue.duration * sampleRate);
  const dataLength = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);

  let noiseState = hashName(cue.name);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    noiseState = (noiseState * 1_664_525 + 1_013_904_223) >>> 0;
    const noise = (noiseState / 0xffff_ffff) * 2 - 1;
    const time = sampleIndex / sampleRate;
    const value = Math.max(-1, Math.min(1, cue.sample(time, noise) * 0.72));
    buffer.writeInt16LE(Math.round(value * 32_767), 44 + sampleIndex * 2);
  }
  return buffer;
}

function fade(time: number, duration: number) {
  const fadeIn = Math.min(1, time / 0.025);
  const fadeOut = Math.min(1, (duration - time) / 0.08);
  return Math.max(0, fadeIn * fadeOut);
}

function hashName(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
