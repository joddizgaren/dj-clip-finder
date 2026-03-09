import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

export interface PeakMoment {
  time: number;        // seconds from start
  energyLevel: number; // 0-100 relative to the recording
  type: "drop" | "transition" | "build";
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
 * Returns a Buffer of interleaved s16le samples (mono, 1 channel).
 *
 * At 100 Hz, 1 hour of audio = 3600 * 100 * 2 bytes ≈ 720 KB — very manageable.
 * This works reliably regardless of FFmpeg version, OS, or recording type.
 */
function extractPcm(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ff = spawn("ffmpeg", [
      "-i", filePath,
      "-ac", "1",         // downmix to mono
      "-ar", "100",       // 100 Hz — 1 sample per 10ms
      "-f", "s16le",      // raw 16-bit signed little-endian
      "pipe:1",           // stream to stdout
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
 * Compute RMS energy in sliding windows from raw PCM buffer.
 * WINDOW_SECS: how many seconds per measurement window.
 */
function computeRmsWindows(
  pcm: Buffer,
  sampleRate: number = 100,
  windowSecs: number = 2
): { time: number; rms: number }[] {
  const windowSize = Math.floor(sampleRate * windowSecs); // samples per window
  const numSamples = Math.floor(pcm.length / 2);          // 2 bytes per s16le sample
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
 * Normalize RMS values to a 0-100 scale relative to the recording's own
 * min/max — so it works whether the signal is a quiet room mic or a hot
 * cable-in feed.
 */
function normalize(windows: { time: number; rms: number }[]): { time: number; energy: number }[] {
  if (windows.length === 0) return [];

  const values = windows.map(w => w.rms);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;

  if (range < 1) {
    // Extremely flat audio — still normalize but flag it
    return windows.map(w => ({ time: w.time, energy: 50 }));
  }

  return windows.map(w => ({
    time: w.time,
    energy: Math.round(((w.rms - min) / range) * 100),
  }));
}

/**
 * Apply a rolling average to smooth out transients and room reflections.
 * A wider window (smoothSecs) is better for mic recordings.
 */
function smooth(
  data: { time: number; energy: number }[],
  smoothSecs: number = 4
): { time: number; energy: number }[] {
  if (data.length < 3) return data;

  // Each window is 2 seconds, so we measure in units of windows
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
 * Compute the energy derivative (rate of change) to detect sudden attacks
 * like drops. A large positive derivative = fast energy rise.
 */
function derivative(data: { time: number; energy: number }[]): number[] {
  return data.map((point, i) => {
    if (i === 0) return 0;
    return point.energy - data[i - 1].energy;
  });
}

/**
 * Detect peak moments using both absolute energy and rate-of-change signals.
 * Thresholds are relative to the recording so both mic and line-in work.
 */
export function detectPeakMoments(
  raw: { time: number; energy: number }[],
  minPeakGapSecs: number = 30
): PeakMoment[] {
  if (raw.length < 10) return [];

  const smoothed = smooth(raw, 4);
  const diff = derivative(smoothed);

  // Minimum energy: 60th percentile of the smoothed energy
  // (top 40% of the recording's own energy scale)
  const sortedEnergy = [...smoothed.map(d => d.energy)].sort((a, b) => a - b);
  const p60 = sortedEnergy[Math.floor(sortedEnergy.length * 0.60)];

  // Minimum attack (derivative): 75th percentile — significant rises only
  const sortedDiff = [...diff].filter(d => d > 0).sort((a, b) => a - b);
  const p75attack = sortedDiff.length > 0
    ? sortedDiff[Math.floor(sortedDiff.length * 0.75)]
    : 0;

  const peaks: PeakMoment[] = [];
  const lookAhead = Math.max(3, Math.round(minPeakGapSecs / 4)); // ~7 windows
  let lastPeakTime = -minPeakGapSecs;

  for (let i = lookAhead; i < smoothed.length - lookAhead; i++) {
    const cur = smoothed[i];
    const attack = diff[i];

    if (cur.time - lastPeakTime < minPeakGapSecs) continue;

    // Must have meaningful energy
    if (cur.energy < p60) continue;

    // Must be a local maximum in the window
    const window = smoothed.slice(i - lookAhead, i + lookAhead + 1);
    const localMax = Math.max(...window.map(w => w.energy));
    if (cur.energy < localMax) continue;

    // Classify type by looking at the energy shape around the peak
    const beforeSlice = smoothed.slice(Math.max(0, i - lookAhead), i);
    const afterSlice  = smoothed.slice(i + 1, Math.min(smoothed.length, i + lookAhead + 1));
    const beforeAvg = beforeSlice.length
      ? beforeSlice.reduce((s, p) => s + p.energy, 0) / beforeSlice.length
      : cur.energy;
    const afterAvg  = afterSlice.length
      ? afterSlice.reduce((s, p) => s + p.energy, 0) / afterSlice.length
      : cur.energy;

    const rise = cur.energy - beforeAvg;
    const fall = cur.energy - afterAvg;

    let type: "drop" | "transition" | "build";
    if (rise > 10 && fall > 8 && attack >= p75attack) {
      type = "drop";       // sharp rise AND sharp fall AND fast attack
    } else if (rise > 10 && attack >= p75attack) {
      type = "build";      // sharp rise with fast attack
    } else {
      type = "transition"; // sustained high energy, gradual change
    }

    peaks.push({
      time: cur.time,
      energyLevel: cur.energy,
      type,
    });

    lastPeakTime = cur.time;
  }

  // Return sorted best-first
  return peaks.sort((a, b) => b.energyLevel - a.energyLevel);
}

/**
 * Full pipeline: analyze a video file and return detected peak moments.
 * Returns peaks: [] if no highlights found — no fallback clips are generated.
 */
export async function analyzeVideoFile(filePath: string): Promise<AudioAnalysisResult> {
  const duration = await getVideoDuration(filePath);
  const pcm = await extractPcm(filePath);
  const windows = computeRmsWindows(pcm);
  const normalized = normalize(windows);
  const peaks = detectPeakMoments(normalized);

  if (peaks.length === 0) {
    console.log(`Analysis complete — no clear highlight moments detected in "${path.basename(filePath)}". Peak count: 0.`);
  } else {
    console.log(`Analysis complete — found ${peaks.length} highlight moments in "${path.basename(filePath)}".`);
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
    "-c:a", "aac",
    "-preset", "fast",
    "-movflags", "+faststart",
    outputPath,
  ], { maxBuffer: 50 * 1024 * 1024 });
}

/**
 * Given a detected peak, compute clip start/end times centered on the peak.
 * Uses a 40/60 before/after split to include the build-up leading into the moment.
 */
export function computeClipTimes(
  peak: PeakMoment,
  clipDuration: number,
  videoDuration: number
): { startTime: number; endTime: number } | null {
  const halfBefore = Math.floor(clipDuration * 0.4);
  let startTime = Math.floor(peak.time) - halfBefore;
  let endTime = startTime + clipDuration;

  if (startTime < 0) { startTime = 0; endTime = clipDuration; }
  if (endTime > videoDuration) {
    endTime = videoDuration;
    startTime = Math.max(0, endTime - clipDuration);
  }
  if (endTime - startTime < clipDuration * 0.8) return null;

  return { startTime, endTime };
}
