import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

export interface PeakMoment {
  time: number;        // seconds from start
  energyLevel: number; // 0-100
  type: "drop" | "transition" | "build";
}

export interface AudioAnalysisResult {
  duration: number;
  peaks: PeakMoment[];
}

/**
 * Get the total duration of a video file using ffprobe
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
 * Analyze audio loudness over time using ffmpeg's ebur128 filter.
 * ebur128 outputs time-stamped loudness measurements to stderr every ~400ms.
 * This is far more reliable than astats for detecting energy over time.
 */
export async function analyzeAudioLoudness(
  filePath: string
): Promise<{ time: number; loudness: number }[]> {
  const { stderr } = await execFileAsync("ffmpeg", [
    "-i", filePath,
    "-af", "ebur128=peak=true",
    "-f", "null",
    "-",
  ], { maxBuffer: 50 * 1024 * 1024 });

  // Parse ebur128 output lines:
  // [Parsed_ebur128_0 @ 0x...] t: 1.0000 TARGET:-23 LUFS M: -20.5 S: -18.2 I: -19.0 LRA: 2.0
  const results: { time: number; loudness: number }[] = [];
  const pattern = /t:\s*([\d.]+)\s+TARGET[^\s]+\s+LUFS\s+M:\s*([-\d.]+)/g;

  let match;
  while ((match = pattern.exec(stderr)) !== null) {
    const time = parseFloat(match[1]);
    const momentaryLufs = parseFloat(match[2]);

    // Skip silence / below noise floor
    if (momentaryLufs < -70 || isNaN(momentaryLufs)) continue;

    results.push({ time, loudness: momentaryLufs });
  }

  return results;
}

/**
 * Convert raw loudness measurements to a normalised 0-100 energy scale,
 * using the actual min/max of the recording (adaptive to any audio level).
 */
function normalizeToEnergy(
  measurements: { time: number; loudness: number }[]
): { time: number; energy: number }[] {
  if (measurements.length === 0) return [];

  const values = measurements.map(m => m.loudness);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range < 1) {
    // Nearly flat audio — assign mid energy to all
    return measurements.map(m => ({ time: m.time, energy: 50 }));
  }

  return measurements.map(m => ({
    time: m.time,
    energy: Math.round(((m.loudness - min) / range) * 100),
  }));
}

/**
 * Smooth energy values with a rolling average window.
 */
function smooth(data: { time: number; energy: number }[], windowSecs: number = 3): { time: number; energy: number }[] {
  // Estimate average time step
  if (data.length < 2) return data;
  const avgStep = (data[data.length - 1].time - data[0].time) / (data.length - 1);
  const halfWindow = Math.max(1, Math.round(windowSecs / avgStep / 2));

  return data.map((point, i) => {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(data.length - 1, i + halfWindow);
    const slice = data.slice(start, end + 1);
    const avg = slice.reduce((s, p) => s + p.energy, 0) / slice.length;
    return { time: point.time, energy: Math.round(avg) };
  });
}

/**
 * Detect significant peak moments from normalised, smoothed energy data.
 * Uses adaptive thresholds relative to the recording's actual energy levels.
 */
export function detectPeakMoments(
  data: { time: number; energy: number }[],
  minPeakGapSecs: number = 25
): PeakMoment[] {
  if (data.length < 10) return [];

  const smoothed = smooth(data, 3);

  // Use the 65th percentile as a minimum threshold so we only pick
  // genuinely high-energy moments, not just the best of a quiet file
  const sorted = [...smoothed.map(d => d.energy)].sort((a, b) => a - b);
  const p65 = sorted[Math.floor(sorted.length * 0.65)];
  const minThreshold = Math.max(p65, 30); // never go below 30

  const peaks: PeakMoment[] = [];
  const lookAhead = Math.round(minPeakGapSecs / 2); // samples, roughly
  let lastPeakTime = -minPeakGapSecs;

  for (let i = lookAhead; i < smoothed.length - lookAhead; i++) {
    const current = smoothed[i];
    if (current.energy < minThreshold) continue;
    if (current.time - lastPeakTime < minPeakGapSecs) continue;

    // Must be a local maximum within the window
    const window = smoothed.slice(Math.max(0, i - lookAhead), Math.min(smoothed.length, i + lookAhead + 1));
    const localMax = Math.max(...window.map(w => w.energy));
    if (current.energy < localMax) continue;

    // Classify the type based on energy shape before vs after peak
    const before = smoothed.slice(Math.max(0, i - lookAhead), i);
    const after = smoothed.slice(i + 1, Math.min(smoothed.length, i + lookAhead + 1));
    const beforeAvg = before.length ? before.reduce((s, p) => s + p.energy, 0) / before.length : current.energy;
    const afterAvg = after.length ? after.reduce((s, p) => s + p.energy, 0) / after.length : current.energy;
    const rise = current.energy - beforeAvg;
    const fall = current.energy - afterAvg;

    let type: "drop" | "transition" | "build";
    if (rise > 12 && fall > 8) {
      type = "drop";
    } else if (rise > 12) {
      type = "build";
    } else {
      type = "transition";
    }

    peaks.push({
      time: current.time,
      energyLevel: current.energy,
      type,
    });

    lastPeakTime = current.time;
  }

  // Sort best first
  return peaks.sort((a, b) => b.energyLevel - a.energyLevel);
}

/**
 * Full pipeline: analyze a video file and return detected peak moments
 */
export async function analyzeVideoFile(filePath: string): Promise<AudioAnalysisResult> {
  const duration = await getVideoDuration(filePath);
  const raw = await analyzeAudioLoudness(filePath);

  if (raw.length === 0) {
    // Fallback: if ebur128 returned nothing, space peaks evenly every 3 minutes
    console.warn("ebur128 returned no data — using evenly spaced fallback peaks");
    const step = 180; // every 3 minutes
    const fallback: PeakMoment[] = [];
    for (let t = step; t < duration - 60; t += step) {
      fallback.push({ time: t, energyLevel: 60, type: "transition" });
    }
    return { duration: Math.floor(duration), peaks: fallback };
  }

  const normalized = normalizeToEnergy(raw);
  const peaks = detectPeakMoments(normalized);

  // Fallback: if still no peaks (e.g. extremely flat audio), evenly space some
  if (peaks.length === 0) {
    console.warn("No peaks detected — using evenly spaced fallback peaks");
    const step = 180;
    const fallback: PeakMoment[] = [];
    for (let t = step; t < duration - 60; t += step) {
      fallback.push({ time: t, energyLevel: 60, type: "transition" });
    }
    return { duration: Math.floor(duration), peaks: fallback };
  }

  return { duration: Math.floor(duration), peaks };
}

/**
 * Extract a video clip using ffmpeg
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
 * Biases slightly before the peak (40/60 split) to capture the build-up.
 */
export function computeClipTimes(
  peak: PeakMoment,
  clipDuration: number,
  videoDuration: number
): { startTime: number; endTime: number } | null {
  const halfBefore = Math.floor(clipDuration * 0.4);
  let startTime = Math.floor(peak.time) - halfBefore;
  let endTime = startTime + clipDuration;

  if (startTime < 0) {
    startTime = 0;
    endTime = clipDuration;
  }
  if (endTime > videoDuration) {
    endTime = videoDuration;
    startTime = Math.max(0, endTime - clipDuration);
  }
  if (endTime - startTime < clipDuration * 0.8) return null;

  return { startTime, endTime };
}
