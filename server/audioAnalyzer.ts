import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);

export interface PeakMoment {
  time: number;       // seconds from start
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
 * Analyze audio loudness in chunks using ffmpeg's loudnorm/astats filter.
 * Splits the file into segments and measures RMS energy per segment.
 */
export async function analyzeAudioChunks(
  filePath: string,
  duration: number,
  chunkSize: number = 2 // analyze in 2-second windows
): Promise<{ time: number; rms: number }[]> {
  const results: { time: number; rms: number }[] = [];
  const numChunks = Math.floor(duration / chunkSize);

  // Use ffmpeg to extract loudness stats for each chunk
  // We use astats filter to get RMS level per chunk
  const { stderr } = await execFileAsync("ffmpeg", [
    "-i", filePath,
    "-af", `asetnsamples=${Math.floor(44100 * chunkSize)},astats=metadata=1:reset=1`,
    "-f", "null",
    "-",
  ], { maxBuffer: 10 * 1024 * 1024 });

  // Parse RMS values from stderr
  // astats outputs: [Parsed_astats_0 @ ...] RMS level dB: -20.5
  const rmsPattern = /RMS level dB:\s*([-\d.]+)/g;
  let match;
  let idx = 0;
  while ((match = rmsPattern.exec(stderr)) !== null) {
    const rmsDb = parseFloat(match[1]);
    // Convert dB to 0-100 scale. Typical values: -60 (silence) to 0 (peak)
    // Map -60..0 dB to 0..100
    const normalized = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
    results.push({
      time: idx * chunkSize,
      rms: normalized,
    });
    idx++;
  }

  return results;
}

/**
 * Detect significant energy transitions (builds, drops, transitions) in the audio.
 * Looks for sudden increases or sustained high-energy moments.
 */
export function detectPeakMoments(
  chunks: { time: number; rms: number }[],
  minPeakGap: number = 20 // minimum seconds between peaks
): PeakMoment[] {
  if (chunks.length < 5) return [];

  const peaks: PeakMoment[] = [];
  const windowSize = 5; // look ahead/back 5 chunks (10 seconds)

  // Calculate rolling average for smoothing
  const smoothed = chunks.map((chunk, i) => {
    const start = Math.max(0, i - 2);
    const end = Math.min(chunks.length - 1, i + 2);
    const window = chunks.slice(start, end + 1);
    const avg = window.reduce((sum, c) => sum + c.rms, 0) / window.length;
    return { time: chunk.time, rms: avg };
  });

  // Find local maxima that represent significant energy moments
  let lastPeakTime = -minPeakGap;

  for (let i = windowSize; i < smoothed.length - windowSize; i++) {
    const current = smoothed[i];

    // Check if this is a local maximum within the window
    const beforeWindow = smoothed.slice(Math.max(0, i - windowSize), i);
    const afterWindow = smoothed.slice(i + 1, Math.min(smoothed.length, i + windowSize + 1));
    const localMax = beforeWindow.every(c => c.rms <= current.rms) &&
                     afterWindow.every(c => c.rms <= current.rms);

    if (!localMax) continue;
    if (current.rms < 40) continue; // too quiet to be interesting
    if (current.time - lastPeakTime < minPeakGap) continue;

    // Determine type based on the shape of the energy curve
    const beforeAvg = beforeWindow.reduce((s, c) => s + c.rms, 0) / (beforeWindow.length || 1);
    const afterAvg = afterWindow.reduce((s, c) => s + c.rms, 0) / (afterWindow.length || 1);
    const energyRise = current.rms - beforeAvg;
    const energyFall = current.rms - afterAvg;

    let type: "drop" | "transition" | "build";
    if (energyRise > 15 && energyFall > 10) {
      type = "drop"; // sharp rise then fall = a drop
    } else if (energyRise > 15) {
      type = "build"; // sharp rise = build-up
    } else {
      type = "transition"; // sustained high energy = transition zone
    }

    peaks.push({
      time: current.time,
      energyLevel: Math.round(current.rms),
      type,
    });

    lastPeakTime = current.time;
  }

  // Sort by energy level descending so best clips come first
  return peaks.sort((a, b) => b.energyLevel - a.energyLevel);
}

/**
 * Full pipeline: analyze a video file and return detected peak moments
 */
export async function analyzeVideoFile(filePath: string): Promise<AudioAnalysisResult> {
  const duration = await getVideoDuration(filePath);
  const chunks = await analyzeAudioChunks(filePath, duration);
  const peaks = detectPeakMoments(chunks);

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
    "-y",                         // overwrite output
    "-ss", String(startTime),     // seek to start
    "-i", inputPath,
    "-t", String(duration),       // clip duration
    "-c:v", "libx264",           // re-encode video
    "-c:a", "aac",               // re-encode audio
    "-preset", "fast",
    "-movflags", "+faststart",   // web-optimized
    outputPath,
  ], { maxBuffer: 50 * 1024 * 1024 });
}

/**
 * Given a list of detected peaks, compute clip start times centered on peaks,
 * ensuring the clip doesn't go past the end of the video.
 */
export function computeClipTimes(
  peak: PeakMoment,
  clipDuration: number,
  videoDuration: number
): { startTime: number; endTime: number } | null {
  // Center the clip on the peak, biasing slightly before the peak
  // (so you see the build-up)
  const halfBefore = Math.floor(clipDuration * 0.4);
  let startTime = peak.time - halfBefore;
  let endTime = startTime + clipDuration;

  // Clamp to video bounds
  if (startTime < 0) {
    startTime = 0;
    endTime = clipDuration;
  }
  if (endTime > videoDuration) {
    endTime = videoDuration;
    startTime = Math.max(0, endTime - clipDuration);
  }
  if (endTime - startTime < clipDuration * 0.8) {
    return null; // clip too short, skip
  }

  return { startTime, endTime };
}
