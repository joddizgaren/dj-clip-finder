import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

export type BuildUp = "none" | "short" | "medium" | "long" | "auto";
export type Sensitivity = "conservative" | "balanced" | "aggressive";
export type RecordingType = "cable" | "mic" | "auto";

export interface PeakMoment {
  time: number;        // seconds from start
  energyLevel: number; // 0-100 relative to the recording
  type: "drop" | "transition" | "build";
}

export interface AudioAnalysisResult {
  duration: number;
  peaks: PeakMoment[];
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

/**
 * Get video metadata (duration, dimensions) using ffprobe.
 */
export async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  const info = JSON.parse(stdout);
  const videoStream = info.streams?.find((s: any) => s.codec_type === "video");

  // Account for rotation metadata (phones often record 1920x1080 with a 90° rotation flag)
  let width: number = videoStream?.width ?? 0;
  let height: number = videoStream?.height ?? 0;
  const rotation = Math.abs(parseInt(videoStream?.tags?.rotate ?? "0", 10));
  if (rotation === 90 || rotation === 270) {
    [width, height] = [height, width];
  }

  return {
    duration: parseFloat(info.format.duration),
    width,
    height,
  };
}

/**
 * Legacy wrapper for routes that only need duration.
 */
export async function getVideoDuration(filePath: string): Promise<number> {
  const info = await getVideoInfo(filePath);
  return info.duration;
}

/**
 * Extract audio as raw 16-bit PCM at a low sample rate (100 Hz) using ffmpeg.
 * Optionally apply an audio filter (e.g. lowpass for bass extraction).
 */
function extractPcm(filePath: string, audioFilter?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const args = ["-i", filePath];
    if (audioFilter) args.push("-af", audioFilter);
    args.push("-ac", "1", "-ar", "100", "-f", "s16le", "pipe:1");

    const ff = spawn("ffmpeg", args);
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
 * Rolling average smoother to reduce noise.
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
 * Per-window energy derivative — positive = rising energy.
 */
function derivative(data: { time: number; energy: number }[]): number[] {
  return data.map((point, i) => {
    if (i === 0) return 0;
    return point.energy - data[i - 1].energy;
  });
}

/**
 * Adaptive minimum gap between peaks based on video duration.
 */
function adaptiveMinGap(videoDurationSecs: number, sensitivity: Sensitivity): number {
  const base = Math.min(120, Math.max(10, Math.floor(videoDurationSecs * 0.015)));
  if (sensitivity === "conservative") return Math.floor(base * 1.5);
  if (sensitivity === "aggressive")  return Math.floor(base * 0.75);
  return base;
}

/**
 * Sensitivity preset → detection thresholds.
 * energyPct: percentile of energy a window must exceed to be a candidate.
 * attackPct: percentile of attack strength required.
 */
function sensitivityThresholds(sensitivity: Sensitivity): { energyPct: number; attackPct: number } {
  switch (sensitivity) {
    case "conservative": return { energyPct: 0.70, attackPct: 0.80 };
    case "aggressive":   return { energyPct: 0.45, attackPct: 0.60 };
    default:             return { energyPct: 0.60, attackPct: 0.75 }; // balanced
  }
}

/**
 * Recording-type weights for the composite score.
 * Cable-in: rely heavily on bass return (50%) — very clean signal.
 * Mic: more balanced; bass pickup is room-dependent.
 * Auto: if overall and bass are close in strength, assume cable; else assume mic.
 */
function recordingWeights(
  recordingType: RecordingType,
  overallAvg: number,
  bassAvg: number
): { wBass: number; wOverall: number; wBassAttack: number; wOverallAttack: number } {
  let resolved = recordingType;
  if (resolved === "auto") {
    // Heuristic: if bass energy is > 60% of overall energy, the signal is likely cable-in
    resolved = (bassAvg / (overallAvg || 1)) > 0.6 ? "cable" : "mic";
  }

  if (resolved === "cable") {
    return { wBass: 0.50, wOverall: 0.20, wBassAttack: 0.20, wOverallAttack: 0.10 };
  }
  // mic
  return { wBass: 0.25, wOverall: 0.35, wBassAttack: 0.20, wOverallAttack: 0.20 };
}

/**
 * Detect peak moments using multi-band composite score.
 * Overall energy + bass energy (below 200 Hz) are combined with recording-type weights.
 */
export function detectPeakMoments(
  overallWindows: { time: number; energy: number }[],
  bassWindows: { time: number; energy: number }[],
  videoDurationSecs: number,
  sensitivity: Sensitivity = "balanced",
  recordingType: RecordingType = "auto"
): PeakMoment[] {
  if (overallWindows.length < 10) return [];

  // Use shorter bass array if different length (same timestamps, trim to min)
  const len = Math.min(overallWindows.length, bassWindows.length);
  const overallTrimmed = overallWindows.slice(0, len);
  const bassTrimmed    = bassWindows.slice(0, len);

  const smoothedOverall = smooth(overallTrimmed, 4);
  const smoothedBass    = smooth(bassTrimmed, 4);

  const diffOverall = derivative(smoothedOverall);
  const diffBass    = derivative(smoothedBass);

  // Average energies for auto recording-type detection
  const overallAvg = smoothedOverall.reduce((s, w) => s + w.energy, 0) / smoothedOverall.length;
  const bassAvg    = smoothedBass.reduce((s, w) => s + w.energy, 0) / smoothedBass.length;

  const weights = recordingWeights(recordingType, overallAvg, bassAvg);

  // Build composite score for each window
  const composite = smoothedOverall.map((w, i) => {
    const bassEnergy    = smoothedBass[i].energy;
    const bassAttack    = Math.max(0, diffBass[i]);
    const overallAttack = Math.max(0, diffOverall[i]);

    const score =
      weights.wBass          * bassEnergy    +
      weights.wOverall       * w.energy      +
      weights.wBassAttack    * bassAttack    +
      weights.wOverallAttack * overallAttack;

    return { time: w.time, energy: Math.min(100, Math.round(score)) };
  });

  const { energyPct, attackPct } = sensitivityThresholds(sensitivity);
  const minPeakGapSecs = adaptiveMinGap(videoDurationSecs, sensitivity);

  const sortedEnergy = [...composite.map(d => d.energy)].sort((a, b) => a - b);
  const energyThreshold = sortedEnergy[Math.floor(sortedEnergy.length * energyPct)];

  const positiveDiffs = [...diffOverall].filter(d => d > 0).sort((a, b) => a - b);
  const attackThreshold = positiveDiffs.length > 0
    ? positiveDiffs[Math.floor(positiveDiffs.length * attackPct)]
    : 0;

  const peaks: PeakMoment[] = [];
  const lookAhead = Math.max(3, Math.round(minPeakGapSecs / 4));
  let lastPeakTime = -minPeakGapSecs;

  for (let i = lookAhead; i < composite.length - lookAhead; i++) {
    const cur = composite[i];
    const attack = diffOverall[i];

    if (cur.time - lastPeakTime < minPeakGapSecs) continue;
    if (cur.energy < energyThreshold) continue;

    const window = composite.slice(i - lookAhead, i + lookAhead + 1);
    const localMax = Math.max(...window.map(w => w.energy));
    if (cur.energy < localMax) continue;

    // Classify peak
    const beforeSlice = composite.slice(Math.max(0, i - lookAhead), i);
    const afterSlice  = composite.slice(i + 1, Math.min(composite.length, i + lookAhead + 1));
    const beforeAvg = beforeSlice.length ? beforeSlice.reduce((s, p) => s + p.energy, 0) / beforeSlice.length : cur.energy;
    const afterAvg  = afterSlice.length  ? afterSlice.reduce((s, p) => s + p.energy, 0) / afterSlice.length  : cur.energy;
    const rise = cur.energy - beforeAvg;
    const fall = cur.energy - afterAvg;

    let type: "drop" | "transition" | "build";
    if (rise > 10 && fall > 8 && attack >= attackThreshold) {
      type = "drop";
    } else if (rise > 10 && attack >= attackThreshold) {
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
 * Runs two FFmpeg extractions in parallel: full audio + bass-only (<200 Hz).
 */
export async function analyzeVideoFile(
  filePath: string,
  sensitivity: Sensitivity = "balanced",
  recordingType: RecordingType = "auto"
): Promise<AudioAnalysisResult> {
  const duration = await getVideoDuration(filePath);

  console.log(`Extracting audio bands for "${path.basename(filePath)}"...`);

  // Run both extractions in parallel for speed
  const [overallPcm, bassPcm] = await Promise.all([
    extractPcm(filePath),
    extractPcm(filePath, "lowpass=f=200"),
  ]);

  const overallWindows = normalize(computeRmsWindows(overallPcm));
  const bassWindows    = normalize(computeRmsWindows(bassPcm));

  const peaks = detectPeakMoments(
    overallWindows, bassWindows, duration, sensitivity, recordingType
  );

  if (peaks.length === 0) {
    console.log(`Analysis complete — no clear highlight moments detected in "${path.basename(filePath)}".`);
  } else {
    console.log(
      `Analysis complete — found ${peaks.length} highlights in "${path.basename(filePath)}" ` +
      `(sensitivity=${sensitivity}, recording=${recordingType}, minGap=${adaptiveMinGap(duration, sensitivity)}s)`
    );
  }

  return { duration: Math.floor(duration), peaks };
}

// ==================== OUTPUT FORMAT ====================

export type OutputFormat = "original" | "9:16" | "3:4" | "4:5" | "1:1" | "16:9";
export type CropMethod   = "blur" | "crop";

interface FormatDimensions { w: number; h: number }

const FORMAT_DIMS: Record<Exclude<OutputFormat, "original">, FormatDimensions> = {
  "9:16": { w: 1080, h: 1920 },
  "3:4":  { w: 1080, h: 1440 },
  "4:5":  { w: 1080, h: 1350 },
  "1:1":  { w: 1080, h: 1080 },
  "16:9": { w: 1920, h: 1080 },
};

/**
 * Build the FFmpeg -vf / -filter_complex arguments for the requested output format.
 * Returns undefined if no conversion is needed (format matches source or is "original").
 */
export function buildFormatFilter(
  srcWidth: number,
  srcHeight: number,
  outputFormat: OutputFormat,
  cropMethod: CropMethod
): { filterComplex?: string; mapVideo?: string; vf?: string } | null {
  if (outputFormat === "original") return null;

  const target = FORMAT_DIMS[outputFormat];
  const srcRatio = srcWidth / srcHeight;
  const tgtRatio = target.w / target.h;

  // Within 2% → no conversion needed
  if (Math.abs(srcRatio - tgtRatio) / tgtRatio < 0.02) return null;

  const { w, h } = target;

  if (cropMethod === "blur") {
    // Scale source to fill target, blur it as background,
    // then overlay the properly fitted source on top.
    const filterComplex =
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:5[bg];` +
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black@0[fg];` +
      `[bg][fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[v]`;
    return { filterComplex, mapVideo: "[v]" };
  } else {
    // Center crop to target aspect ratio, then scale
    const vf =
      `crop='min(iw,ih*${w}/${h})':'min(ih,iw*${h}/${w})':(iw-min(iw,ih*${w}/${h}))/2:(ih-min(ih,iw*${h}/${w}))/2,scale=${w}:${h}`;
    return { vf };
  }
}

// ==================== CLIP EXTRACTION ====================

/**
 * Extract a video clip using ffmpeg, optionally converting the output format.
 */
export async function extractClip(
  inputPath: string,
  outputPath: string,
  startTime: number,
  duration: number,
  formatOpts?: {
    srcWidth: number;
    srcHeight: number;
    outputFormat: OutputFormat;
    cropMethod: CropMethod;
  }
): Promise<void> {
  const baseArgs = [
    "-y",
    "-ss", String(startTime),
    "-i", inputPath,
    "-t", String(duration),
  ];

  let filterArgs: string[] = [];

  if (formatOpts && formatOpts.outputFormat !== "original") {
    const filter = buildFormatFilter(
      formatOpts.srcWidth, formatOpts.srcHeight,
      formatOpts.outputFormat, formatOpts.cropMethod
    );
    if (filter?.filterComplex) {
      filterArgs = [
        "-filter_complex", filter.filterComplex,
        "-map", filter.mapVideo!,
        "-map", "0:a",
      ];
    } else if (filter?.vf) {
      filterArgs = ["-vf", filter.vf];
    }
  }

  const encodeArgs = [
    "-c:v", "libx264",
    "-profile:v", "high",
    "-level:v", "4.0",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-preset", "fast",
    "-movflags", "+faststart",
  ];

  await execFileAsync("ffmpeg", [
    ...baseArgs,
    ...filterArgs,
    ...encodeArgs,
    outputPath,
  ], { maxBuffer: 50 * 1024 * 1024 });
}

// ==================== CLIP TIMING ====================

function resolveBuildUpRatio(buildUp: BuildUp, peak: PeakMoment): number {
  switch (buildUp) {
    case "none":   return 0.0;
    case "short":  return 0.20;
    case "medium": return 0.40;
    case "long":   return 0.65;
    case "auto": {
      if (peak.energyLevel >= 75) return 0.65;
      if (peak.energyLevel >= 50) return 0.40;
      return 0.20;
    }
  }
}

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
