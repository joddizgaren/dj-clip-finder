import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

export type BuildUp = "none" | "short" | "medium" | "long" | "auto";

export interface PeakMoment {
  time: number;        // seconds from start
  energyLevel: number; // 0-100 relative to the recording
  type: "drop" | "transition" | "build"; // kept for internal logic, not shown in UI
}

export interface AudioAnalysisResult {
  duration: number;
  peaks: PeakMoment[];
}

/**
 * Get the total duration of a video file using ffprobe.
 */
export async function getVideoDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    filePath,
  ]);
  const info = JSON.parse(stdout);
  return parseFloat(info.format.duration);
}

/**
 * Extract audio as raw 16-bit PCM at a low sample rate (100 Hz) using ffmpeg.
 * At 100 Hz, 1 hour of audio = ~720 KB — very manageable.
 */
function extractPcm(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ff = spawn("ffmpeg", [
      "-i", filePath,
      "-ac", "1",
      "-ar", "100",
      "-f", "s16le",
      "pipe:1",
    ]);

    ff.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ff.on("close", (code) => {
      if (chunks.length === 0) {
        reject(new Error(`FFmpeg exited with code ${code} and produced no audio data`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    ff.on("error", reject);
  });
}

/**
 * Compute RMS energy in non-overlapping 2-second windows from raw PCM buffer.
 */
function computeRmsWindows(
  pcm: Buffer,
  sampleRate: number = 100,
  windowSecs: number = 2
): { time: number; rms: number }[] {
  const windowSize = Math.floor(sampleRate * windowSecs);
  const numSamples = Math.floor(pcm.length / 2);
  const results: { time: number; rms: number }[] = [];

  for (let i = 0; i + windowSize <= numSamples; i += windowSize) {
    let sumSq = 0;
    for (let j = 0; j < windowSize; j++) {
      const sample = pcm.readInt16LE((i + j) * 2);
      sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / windowSize);
    results.push({ time: i / sampleRate, rms });
  }

  return results;
}

/**
 * Normalize RMS values to 0-100 relative to the recording's own min/max.
 * Works for quiet mic recordings and hot cable-in feeds alike.
 */
function normalize(windows: { time: number; rms: number }[]): { time: number; energy: number }[] {
  if (windows.length === 0) return [];

  const values = windows.map(w => w.rms);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;

  if (range < 1) {
    return windows.map(w => ({ time: w.time, energy: 50 }));
  }

  return windows.map(w => ({
    time: w.time,
    energy: Math.round(((w.rms - min) / range) * 100),
  }));
}

/**
 * Rolling average smoother to reduce noise from room reflections / mic transients.
 */
function smooth(
  data: { time: number; energy: number }[],
  smoothSecs: number = 4
): { time: number; energy: number }[] {
  if (data.length < 3) return data;
  const halfWin = Math.max(1, Math.round(smoothSecs / 2));

  return data.map((point, i) => {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(data.length - 1, i + halfWin);
    const slice = data.slice(lo, hi + 1);
    const avg = slice.reduce((s, p) => s + p.energy, 0) / slice.length;
    return { time: point.time, energy: Math.round(avg) };
  });
}

/**
 * Per-window energy derivative — positive = rising energy, negative = falling.
 */
function derivative(data: { time: number; energy: number }[]): number[] {
  return data.map((point, i) => {
    if (i === 0) return 0;
    return point.energy - data[i - 1].energy;
  });
}

/**
 * Compute an adaptive minimum gap between peaks based on video duration.
 * Short videos: minimum 10s gap. Long sets: up to 120s gap.
 * This prevents clusters of clips in the same section of a long set.
 */
function adaptiveMinGap(videoDurationSecs: number): number {
  // 1.5% of video duration, clamped between 10s and 120s
  return Math.min(120, Math.max(10, Math.floor(videoDurationSecs * 0.015)));
}

/**
 * Detect peak moments using both absolute energy and rate-of-change signals.
 * Minimum gap between peaks is adaptive to video duration for better spread.
 */
export function detectPeakMoments(
  raw: { time: number; energy: number }[],
  videoDurationSecs: number
): PeakMoment[] {
  if (raw.length < 10) return [];

  const minPeakGapSecs = adaptiveMinGap(videoDurationSecs);
  const smoothed = smooth(raw, 4);
  const diff = derivative(smoothed);

  // Must be in the top 40% of energy for this specific recording
  const sortedEnergy = [...smoothed.map(d => d.energy)].sort((a, b) => a - b);
  const p60 = sortedEnergy[Math.floor(sortedEnergy.length * 0.60)];

  // Significant attack: top 25% of positive derivatives
  const sortedDiff = [...diff].filter(d => d > 0).sort((a, b) => a - b);
  const p75attack = sortedDiff.length > 0
    ? sortedDiff[Math.floor(sortedDiff.length * 0.75)]
    : 0;

  const peaks: PeakMoment[] = [];
  const lookAhead = Math.max(3, Math.round(minPeakGapSecs / 4));
  let lastPeakTime = -minPeakGapSecs;

  for (let i = lookAhead; i < smoothed.length - lookAhead; i++) {
    const cur = smoothed[i];
    const attack = diff[i];

    if (cur.time - lastPeakTime < minPeakGapSecs) continue;
    if (cur.energy < p60) continue;

    // Must be a local maximum within the look-ahead window
    const window = smoothed.slice(i - lookAhead, i + lookAhead + 1);
    const localMax = Math.max(...window.map(w => w.energy));
    if (cur.energy < localMax) continue;

    // Classify for internal use (not shown in UI)
    const beforeSlice = smoothed.slice(Math.max(0, i - lookAhead), i);
    const afterSlice  = smoothed.slice(i + 1, Math.min(smoothed.length, i + lookAhead + 1));
    const beforeAvg = beforeSlice.length ? beforeSlice.reduce((s, p) => s + p.energy, 0) / beforeSlice.length : cur.energy;
    const afterAvg  = afterSlice.length  ? afterSlice.reduce((s, p)  => s + p.energy, 0) / afterSlice.length  : cur.energy;
    const rise = cur.energy - beforeAvg;
    const fall = cur.energy - afterAvg;

    let type: "drop" | "transition" | "build";
    if (rise > 10 && fall > 8 && attack >= p75attack) {
      type = "drop";
    } else if (rise > 10 && attack >= p75attack) {
      type = "build";
    } else {
      type = "transition";
    }

    peaks.push({ time: cur.time, energyLevel: cur.energy, type });
    lastPeakTime = cur.time;
  }

  return peaks.sort((a, b) => b.energyLevel - a.energyLevel);
}

/**
 * Full pipeline: analyze a video file and return detected peak moments.
 */
export async function analyzeVideoFile(filePath: string): Promise<AudioAnalysisResult> {
  const duration = await getVideoDuration(filePath);
  const pcm = await extractPcm(filePath);
  const windows = computeRmsWindows(pcm);
  const normalized = normalize(windows);
  const peaks = detectPeakMoments(normalized, duration);

  if (peaks.length === 0) {
    console.log(`Analysis complete — no clear highlight moments detected in "${path.basename(filePath)}".`);
  } else {
    console.log(`Analysis complete — found ${peaks.length} highlight moments in "${path.basename(filePath)}". Min gap used: ${adaptiveMinGap(duration)}s`);
  }

  return { duration: Math.floor(duration), peaks };
}

/**
 * Extract a video clip using ffmpeg.
 */
export async function extractClip(
  inputPath: string,
  outputPath: string,
  startTime: number,
  duration: number
): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-ss", String(startTime),
    "-i", inputPath,
    "-t", String(duration),
    "-c:v", "libx264",
    "-profile:v", "high",
    "-level:v", "4.0",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-preset", "fast",
    "-movflags", "+faststart",
    outputPath,
  ], { maxBuffer: 50 * 1024 * 1024 });
}

/**
 * Resolve what fraction of the clip duration falls BEFORE the peak.
 *
 * none   → 0%   peak at start — full clip is after the drop
 * short  → 20%  small build-up
 * medium → 40%  balanced (4s of build in a 20s clip)
 * long   → 65%  extended build-up (13s in a 20s clip)
 * auto   → energy-adaptive: high energy peaks get long build-up,
 *           mid energy get medium, lower energy get short
 */
function resolveBuildUpRatio(buildUp: BuildUp, peak: PeakMoment): number {
  switch (buildUp) {
    case "none":   return 0.0;
    case "short":  return 0.20;
    case "medium": return 0.40;
    case "long":   return 0.65;
    case "auto": {
      if (peak.energyLevel >= 75) return 0.65;  // strong peak → capture the build
      if (peak.energyLevel >= 50) return 0.40;  // average peak → balanced
      return 0.20;                               // weaker peak → short build
    }
  }
}

/**
 * Given a detected peak, compute clip start/end times.
 * The build-up parameter controls how much of the clip duration falls
 * before the peak moment.
 */
export function computeClipTimes(
  peak: PeakMoment,
  clipDuration: number,
  videoDuration: number,
  buildUp: BuildUp = "medium"
): { startTime: number; endTime: number } | null {
  const ratio = resolveBuildUpRatio(buildUp, peak);
  const secondsBefore = Math.floor(clipDuration * ratio);
  let startTime = Math.floor(peak.time) - secondsBefore;
  let endTime = startTime + clipDuration;

  if (startTime < 0) { startTime = 0; endTime = clipDuration; }
  if (endTime > videoDuration) {
    endTime = videoDuration;
    startTime = Math.max(0, endTime - clipDuration);
  }
  if (endTime - startTime < clipDuration * 0.8) return null;

  return { startTime, endTime };
}
