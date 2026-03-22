import type { Express } from "express";
import type { Server } from "http";
import path from "path";
import fs from "fs";
import os from "os";
import { storage } from "./storage";
import {
  analyzeVideoFile,
  extractClip,
  computeClipTimes,
  getVideoInfo,
  type BuildUp,
  type Sensitivity,
  type RecordingType,
  type OutputFormat,
  type CropMethod,
} from "./audioAnalyzer";
import type { PeaksCache } from "@shared/schema";

const CLIPS_DIR = process.env.CLIPS_DIR || path.resolve("clips");

if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });

// Tracks state for active generation jobs: uploadId → { aborted, current, total }
const activeGenerations = new Map<string, { aborted: boolean; current: number; total: number }>();

// ── helpers ──────────────────────────────────────────────────────────────────

const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".webm", ".mkv"]);

function isVideoFile(name: string) {
  return VIDEO_EXTS.has(path.extname(name).toLowerCase());
}

/** Build a human-readable clip filename: basename_14m23s_20s.mp4 */
function buildClipFilename(sourceFilename: string, peakTimeSec: number, durSec: number): string {
  const base = path.basename(sourceFilename, path.extname(sourceFilename))
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 24);

  const totalSec = Math.floor(peakTimeSec);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${base}_${mm}m${ss}s_${durSec}s.mp4`;
}

// ── routes ───────────────────────────────────────────────────────────────────

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // === VIDEO DIAGNOSTIC (dev helper) ===
  // GET /api/diagnose-video?path=... — dumps raw ffprobe stream data for rotation debugging
  app.get("/api/diagnose-video", async (req, res) => {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(execFile);
    const filePath = typeof req.query.path === "string" ? req.query.path : null;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(400).json({ message: "Provide a valid ?path= parameter" });
    }
    try {
      const ffprobe = process.env.FFMPEG_BIN_DIR
        ? path.join(process.env.FFMPEG_BIN_DIR, process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
        : "ffprobe";
      const { stdout } = await execAsync(ffprobe, [
        "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath,
      ]);
      const parsed = JSON.parse(stdout);
      const vs = parsed.streams?.find((s: any) => s.codec_type === "video");
      res.json({
        raw_width:      vs?.width,
        raw_height:     vs?.height,
        tags_rotate:    vs?.tags?.rotate,
        side_data_list: vs?.side_data_list,
        stream_rotation: vs?.rotation,
        format_tags:    parsed.format?.tags,
      });
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  // === NATIVE FILE PICKER (Windows only) ===
  // Opens the real Windows OpenFileDialog via PowerShell and returns the chosen path.
  // Blocks until the user picks a file or cancels — this is intentional.
  app.post("/api/browse-native", async (req, res) => {
    if (process.platform !== "win32") {
      return res.status(400).json({ message: "Native picker only available on Windows" });
    }
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const { writeFileSync, unlinkSync, existsSync, readFileSync } = await import("fs");
      const { join } = await import("path");
      const { tmpdir } = await import("os");
      const execAsync = promisify(exec);

      const ts = Date.now();
      const scriptPath = join(tmpdir(), `djclip_pick_${ts}.ps1`);
      const resultPath = join(tmpdir(), `djclip_result_${ts}.txt`);

      // Paths need double-backslashes inside PowerShell strings
      const psScriptPath  = scriptPath.replace(/\\/g, "\\\\");
      const psResultPath  = resultPath.replace(/\\/g, "\\\\");

      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        `$out = '${psResultPath}'`,
        "try {",
        "  $d = New-Object System.Windows.Forms.OpenFileDialog",
        "  $d.Title = 'Select DJ Set Recording'",
        "  $d.Filter = 'Video Files|*.mp4;*.mov;*.avi;*.webm;*.mkv|All Files|*.*'",
        "  $d.Multiselect = $false",
        "  if ($d.ShowDialog() -eq 'OK') { [IO.File]::WriteAllText($out, $d.FileName) }",
        "  else { [IO.File]::WriteAllText($out, '') }",
        "} catch { [IO.File]::WriteAllText($out, '') }",
      ].join("\r\n");

      writeFileSync(scriptPath, script, "utf8");

      // Run PowerShell hidden — the file dialog (Windows Forms) still appears
      // as a GUI element, but the PowerShell console window stays invisible.
      await execAsync(
        `powershell.exe -WindowStyle Hidden -NoProfile -STA -ExecutionPolicy Bypass -File "${psScriptPath}"`,
        { shell: false, windowsHide: true, timeout: 5 * 60 * 1000 }
      );

      let filePath: string | null = null;
      if (existsSync(resultPath)) {
        filePath = readFileSync(resultPath, "utf8").trim() || null;
        try { unlinkSync(resultPath); } catch {}
      }
      try { unlinkSync(scriptPath); } catch {}

      res.json({ filePath });
    } catch (err) {
      res.status(500).json({ message: "Native file picker failed: " + String(err) });
    }
  });

  // === FILE BROWSER (tree fallback for non-Windows) ===

  app.get("/api/browse", (req, res) => {
    try {
      const requestedPath = typeof req.query.path === "string"
        ? req.query.path
        : os.homedir();

      if (!fs.existsSync(requestedPath)) {
        return res.status(404).json({ message: "Path not found" });
      }

      const stat = fs.statSync(requestedPath);
      if (!stat.isDirectory()) {
        return res.status(400).json({ message: "Path is not a directory" });
      }

      const entries = fs.readdirSync(requestedPath, { withFileTypes: true });
      const dirs: string[] = [];
      const files: { name: string; size: number; fullPath: string }[] = [];

      for (const entry of entries) {
        try {
          if (entry.isDirectory()) {
            dirs.push(entry.name);
          } else if (entry.isFile() && isVideoFile(entry.name)) {
            const fullPath = path.join(requestedPath, entry.name);
            const s = fs.statSync(fullPath);
            files.push({ name: entry.name, size: s.size, fullPath });
          }
        } catch {
          // skip inaccessible entries
        }
      }

      dirs.sort((a, b) => a.localeCompare(b));
      files.sort((a, b) => a.name.localeCompare(b.name));

      // Compute parent path (null at filesystem root)
      const parentPath = path.dirname(requestedPath);
      const parent = parentPath === requestedPath ? null : parentPath;

      res.json({ path: requestedPath, parent, dirs, files });
    } catch (err) {
      res.status(500).json({ message: "Browse failed: " + String(err) });
    }
  });

  // === UPLOADS ===

  app.get("/api/uploads", async (_req, res) => {
    const all = await storage.getUploads();
    res.json(all);
  });

  app.get("/api/uploads/:id", async (req, res) => {
    const found = await storage.getUpload(req.params.id);
    if (!found) return res.status(404).json({ message: "Upload not found" });
    res.json(found);
  });

  // Register a video by local file path (no file transfer)
  app.post("/api/uploads/local", async (req, res) => {
    const { filePath } = req.body;
    if (!filePath || typeof filePath !== "string") {
      return res.status(400).json({ message: "filePath is required" });
    }

    const trimmed = filePath.trim();
    if (!fs.existsSync(trimmed)) {
      return res.status(400).json({
        message: "File not found at that path. Make sure the app is running on the same computer as your video files.",
      });
    }

    const stat = fs.statSync(trimmed);
    if (!stat.isFile()) {
      return res.status(400).json({ message: "Path points to a directory, not a file." });
    }

    const ext = path.extname(trimmed).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) {
      return res.status(400).json({ message: "File must be a video (MP4, MOV, AVI, WebM, MKV)." });
    }

    try {
      const record = await storage.createUpload({
        filename: path.basename(trimmed),
        filePath: trimmed,
        duration: 0,
      });

      res.status(201).json({ ...record, status: "processing" });

      // Run analysis asynchronously to get duration + video dimensions
      (async () => {
        try {
          const info = await getVideoInfo(trimmed);
          await storage.updateUpload(record.id, {
            duration: Math.floor(info.duration),
            videoWidth: info.width,
            videoHeight: info.height,
            status: "analyzed",
          });
        } catch (err) {
          console.error("Analysis failed:", err);
          await storage.updateUpload(record.id, {
            status: "error",
            error: String(err),
          });
        }
      })();
    } catch (err) {
      res.status(500).json({ message: "Failed to register file: " + String(err) });
    }
  });

  // Delete an upload and all its clips
  app.delete("/api/uploads/:id", async (req, res) => {
    const found = await storage.getUpload(req.params.id);
    if (!found) return res.status(404).json({ message: "Upload not found" });

    const uploadClips = await storage.getClipsByUpload(req.params.id);
    for (const clip of uploadClips) {
      try { fs.unlinkSync(clip.clipPath); } catch {}
    }

    // Never delete the user's original video — only delete clips from our clips/ dir
    await storage.deleteUpload(req.params.id);
    res.status(204).send();
  });

  // === CLIPS ===

  // Stop an in-progress generation job
  app.post("/api/uploads/:uploadId/stop", (req, res) => {
    const signal = activeGenerations.get(req.params.uploadId);
    if (signal) {
      signal.aborted = true;
      res.json({ message: "Stop signal sent" });
    } else {
      res.json({ message: "No active generation found" });
    }
  });

  // Live progress for an active generation: { current, total }
  app.get("/api/uploads/:uploadId/progress", (req, res) => {
    const gen = activeGenerations.get(req.params.uploadId);
    res.json(gen ? { current: gen.current, total: gen.total } : { current: 0, total: 0 });
  });

  app.get("/api/uploads/:uploadId/clips", async (req, res) => {
    const found = await storage.getUpload(req.params.uploadId);
    if (!found) return res.status(404).json({ message: "Upload not found" });
    const uploadClips = await storage.getClipsByUpload(req.params.uploadId);
    res.json(uploadClips);
  });

  // Generate clips for an upload
  app.post("/api/uploads/:uploadId/generate", async (req, res) => {
    const found = await storage.getUpload(req.params.uploadId);
    if (!found) return res.status(404).json({ message: "Upload not found" });

    if (found.status !== "analyzed") {
      return res.status(400).json({
        message: found.status === "processing"
          ? "Video is still being analyzed. Please wait."
          : found.status === "generating"
          ? "Already generating clips. Please wait."
          : "Video analysis failed. Cannot generate clips.",
      });
    }

    const { durations, maxClips, buildUp, sensitivity, recordingType, outputFormat, cropMethod, append, moreCount, skipFirstN } = req.body;

    if (!durations || !Array.isArray(durations) || durations.length === 0) {
      return res.status(400).json({ message: "Please select at least one clip duration" });
    }

    const maxClipsLimit: number = typeof maxClips === "number" && maxClips > 0 ? maxClips : 0;
    const isAppend = Boolean(append);
    // For append mode, moreCount controls how many NEW clips to add
    const appendLimit: number = typeof moreCount === "number" && moreCount > 0 ? moreCount : maxClipsLimit;
    // skipFirstN: number of SUCCESSFUL peaks to skip before starting to encode (used for "delete+continue" behavior)
    const peakSkipCount: number = typeof skipFirstN === "number" && skipFirstN > 0 ? Math.round(skipFirstN) : 0;
    const validBuildUps: BuildUp[] = ["none", "short", "medium", "long", "auto"];
    const resolvedBuildUp: BuildUp = validBuildUps.includes(buildUp) ? buildUp : "short";
    const resolvedSensitivity: Sensitivity = ["conservative", "balanced", "aggressive"].includes(sensitivity)
      ? sensitivity : "balanced";
    const resolvedRecordingType: RecordingType = ["cable", "mic", "auto"].includes(recordingType)
      ? recordingType : "auto";
    const resolvedOutputFormat: OutputFormat = ["original", "9:16", "3:4", "4:5", "1:1", "16:9"].includes(outputFormat)
      ? outputFormat : "original";
    const resolvedCropMethod: CropMethod = cropMethod === "crop" ? "crop" : "blur";

    res.json({ message: "Clip generation started", uploadId: found.id });
    await storage.updateUpload(found.id, { status: "generating" });

    const abortSignal = { aborted: false, current: 0, total: 0 };
    activeGenerations.set(found.id, abortSignal);

    (async () => {
      try {
        // Check peak cache — skip re-analysis if sensitivity & recording type match
        let peaks: any[];
        const cache = found.peaksCache as PeaksCache | null | undefined;
        const cacheValid =
          cache != null &&
          Array.isArray(cache.peaks) &&
          cache.peaks.length > 0 &&
          cache.sensitivity === resolvedSensitivity &&
          cache.recordingType === resolvedRecordingType;

        if (cacheValid && cache) {
          console.log(`Using cached ${cache.peaks.length} peaks for upload ${found.id}`);
          peaks = cache.peaks;
        } else {
          console.log(`Re-analyzing upload ${found.id} (sensitivity=${resolvedSensitivity}, recording=${resolvedRecordingType})`);
          const analysis = await analyzeVideoFile(found.filePath, resolvedSensitivity, resolvedRecordingType);
          peaks = analysis.peaks;

          // Cache the new peaks
          const newCache: PeaksCache = {
            peaks,
            sensitivity: resolvedSensitivity,
            recordingType: resolvedRecordingType,
          };
          await storage.updateUpload(found.id, {
            peaksCache: newCache,
            duration: analysis.duration,
          });
        }

        if (peaks.length === 0) {
          await storage.updateUpload(found.id, {
            status: "error",
            error: "No highlight moments could be detected in this recording. The audio energy may be too consistent throughout the set. Try 'Aggressive' sensitivity or a recording with more dynamic range.",
          });
          return;
        }

        // Delete existing clips (unless appending to them)
        // In append mode, build a set of peak times already covered in the DB so
        // we can skip them even when the new duration produces a different filename.
        let existingPeakTimes = new Set<number>();
        if (!isAppend) {
          const existing = await storage.getClipsByUpload(found.id);
          for (const c of existing) {
            try { fs.unlinkSync(c.clipPath); } catch {}
          }
          await storage.deleteClipsByUpload(found.id);
        } else {
          const existing = await storage.getClipsByUpload(found.id);
          for (const c of existing) existingPeakTimes.add(c.peakTime);
        }

        const refUpload = await storage.getUpload(found.id);
        const videoDuration = refUpload?.duration ?? found.duration;
        const srcWidth  = refUpload?.videoWidth  ?? found.videoWidth  ?? 1920;
        const srcHeight = refUpload?.videoHeight ?? found.videoHeight ?? 1080;

        // Normalize energy so the best peak = 100% (based on full peak set)
        const maxEnergy = Math.max(...peaks.map((p: any) => p.energyLevel));
        const normalizedPeaks = peaks.map((p: any) => ({
          ...p,
          energyLevel: maxEnergy > 0 ? Math.round((p.energyLevel / maxEnergy) * 100) : p.energyLevel,
        }));

        // Per-duration clip limit — for append, use moreCount; otherwise maxClipsLimit
        const perDurLimit = isAppend ? appendLimit : maxClipsLimit;

        // Progress tracking: estimate total (may be slightly less if peaks near end are skipped)
        const estimatedTotal = (durations as number[]).length * (perDurLimit > 0 ? perDurLimit : normalizedPeaks.length);
        activeGenerations.get(found.id)!.total   = estimatedTotal;
        activeGenerations.get(found.id)!.current = 0;

        let count = 0;

        console.log(`Starting generation: ${durations.join(",")}s clips, limit=${perDurLimit > 0 ? perDurLimit : "all"}, peaks=${normalizedPeaks.length}, append=${isAppend}, skipFirstN=${peakSkipCount}`);

        for (const dur of durations as number[]) {
          let durCount   = 0; // successfully encoded for this duration
          let skipRemain = peakSkipCount; // successful peaks still to skip before encoding
          console.log(`  [${dur}s] Iterating ${normalizedPeaks.length} peaks, need ${perDurLimit > 0 ? perDurLimit : "all"}, skip=${skipRemain}`);

          for (const peak of normalizedPeaks) {
            if (abortSignal.aborted) {
              console.log(`  Generation stopped by user after ${count} clips`);
              break;
            }
            // Stop once we have enough clips for this duration
            if (perDurLimit > 0 && durCount >= perDurLimit) {
              console.log(`  [${dur}s] Reached limit (${perDurLimit}), stopping`);
              break;
            }

            const times = computeClipTimes(peak, dur, videoDuration, resolvedBuildUp);
            if (!times) {
              console.log(`  [${dur}s] Skipped peak @${Math.floor(peak.time)}s (too close to end or too short)`);
              continue; // null peaks don't count toward skipRemain
            }

            // Skip the first N successful peaks (used for "delete+continue same settings")
            if (skipRemain > 0) {
              skipRemain--;
              console.log(`  [${dur}s] Offset-skipped peak @${Math.floor(peak.time)}s (${peakSkipCount - skipRemain}/${peakSkipCount})`);
              continue;
            }

            const clipFilename = buildClipFilename(found.filename, peak.time, dur);
            const clipPath = path.join(CLIPS_DIR, clipFilename);

            // In append mode skip peaks already covered in the DB (works even when
            // the duration / settings changed, which would produce a different filename)
            if (isAppend && existingPeakTimes.has(Math.round(peak.time))) {
              console.log(`  [${dur}s] Skipped peak @${Math.floor(peak.time)}s (already covered in DB)`);
              continue;
            }

            console.log(`  [${dur}s] Encoding clip ${durCount + 1}: peak @${Math.floor(peak.time)}s → ${times.startTime}–${times.endTime}s`);
            await extractClip(found.filePath, clipPath, times.startTime, times.endTime - times.startTime, {
              srcWidth,
              srcHeight,
              outputFormat: resolvedOutputFormat,
              cropMethod: resolvedCropMethod,
            });

            await storage.createClip({
              uploadId: found.id,
              startTime: times.startTime,
              endTime: times.endTime,
              duration: dur,
              peakTime: Math.round(peak.time),
              clipPath,
              highlightType: peak.type,
              energyLevel: peak.energyLevel,
              outputFormat: resolvedOutputFormat,
              buildUp: resolvedBuildUp,
            });

            durCount++;
            count++;
            const gen = activeGenerations.get(found.id);
            if (gen) gen.current = count;
            console.log(`  [${dur}s] ✓ Clip ${count} saved (${durCount}/${perDurLimit > 0 ? perDurLimit : "∞"} for this duration)`);
          }
          if (abortSignal.aborted) break;
          console.log(`  [${dur}s] Done: ${durCount} clips encoded`);
        }

        activeGenerations.delete(found.id);
        await storage.updateUpload(found.id, { status: "analyzed" });
        console.log(`Generated ${count} clips for upload ${found.id}`);
      } catch (err) {
        activeGenerations.delete(found.id);
        console.error("Clip generation failed:", err);
        await storage.updateUpload(found.id, {
          status: "error",
          error: "Clip generation failed: " + String(err),
        });
      }
    })();
  });

  // Re-cut a clip variant: same peak, different duration/buildUp/outputFormat
  app.post("/api/clips/:clipId/variant", async (req, res) => {
    const clip = await storage.getClip(req.params.clipId);
    if (!clip) return res.status(404).json({ message: "Clip not found" });

    const upload = await storage.getUpload(clip.uploadId);
    if (!upload) return res.status(404).json({ message: "Upload not found" });

    if (!upload.filePath || !fs.existsSync(upload.filePath)) {
      return res.status(400).json({ message: "Original video file not found" });
    }

    const { duration, buildUp, outputFormat, cropMethod } = req.body;

    const dur: number = typeof duration === "number" && duration >= 3 && duration <= 3600
      ? Math.round(duration) : clip.duration;

    const validBuildUps: BuildUp[] = ["none", "short", "medium", "long", "auto"];
    const resolvedBuildUp: BuildUp = validBuildUps.includes(buildUp) ? buildUp : "short";
    const resolvedOutputFormat: OutputFormat = ["original", "9:16", "3:4", "4:5", "1:1", "16:9"].includes(outputFormat)
      ? outputFormat : "original";
    const resolvedCropMethod: CropMethod = cropMethod === "crop" ? "crop" : "blur";

    const srcWidth  = upload.videoWidth  ?? 1920;
    const srcHeight = upload.videoHeight ?? 1080;

    const peak = {
      time: clip.peakTime,
      energyLevel: clip.energyLevel,
      type: clip.highlightType as "drop" | "transition" | "build",
    };

    const times = computeClipTimes(peak, dur, upload.duration, resolvedBuildUp);
    if (!times) return res.status(400).json({ message: "Clip would extend beyond the video duration" });

    // Build a unique filename using a short timestamp to avoid collisions
    const ts = Date.now().toString(36).slice(-5);
    const base = buildClipFilename(upload.filename, clip.peakTime, dur).replace(".mp4", "");
    const fmtTag = resolvedOutputFormat !== "original" ? `_${resolvedOutputFormat.replace(":", "x")}` : "";
    const clipFilename = `${base}${fmtTag}_${ts}.mp4`;
    const clipPath = path.join(CLIPS_DIR, clipFilename);

    try {
      await extractClip(upload.filePath, clipPath, times.startTime, times.endTime - times.startTime, {
        srcWidth,
        srcHeight,
        outputFormat: resolvedOutputFormat,
        cropMethod: resolvedCropMethod,
      });

      const newClip = await storage.createClip({
        uploadId: upload.id,
        startTime: times.startTime,
        endTime: times.endTime,
        duration: dur,
        peakTime: clip.peakTime,
        clipPath,
        highlightType: clip.highlightType,
        energyLevel: clip.energyLevel,
        outputFormat: resolvedOutputFormat,
        buildUp: resolvedBuildUp,
      });

      console.log(`Variant created: ${clipFilename} (peak@${clip.peakTime}s, ${dur}s, ${resolvedOutputFormat})`);
      res.json(newClip);
    } catch (err) {
      console.error("Variant generation failed:", err);
      res.status(500).json({ message: "Variant generation failed: " + String(err) });
    }
  });

  // Serve clip file for download/preview
  app.get("/api/clips/:clipId/download", async (req, res) => {
    const clip = await storage.getClip(req.params.clipId);
    if (!clip) return res.status(404).json({ message: "Clip not found" });
    if (!fs.existsSync(clip.clipPath)) {
      return res.status(404).json({ message: "Clip file not found on disk" });
    }
    const filename = path.basename(clip.clipPath);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "video/mp4");
    res.sendFile(path.resolve(clip.clipPath));
  });

  // Stream clip for in-browser preview
  app.get("/api/clips/:clipId/stream", async (req, res) => {
    const clip = await storage.getClip(req.params.clipId);
    if (!clip) return res.status(404).json({ message: "Clip not found" });
    if (!fs.existsSync(clip.clipPath)) {
      return res.status(404).json({ message: "Clip file not found on disk" });
    }

    const stat = fs.statSync(clip.clipPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const file = fs.createReadStream(clip.clipPath, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": "video/mp4",
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": "video/mp4",
      });
      fs.createReadStream(clip.clipPath).pipe(res);
    }
  });

  // Delete a single clip
  app.delete("/api/clips/:clipId", async (req, res) => {
    const clip = await storage.getClip(req.params.clipId);
    if (!clip) return res.status(404).json({ message: "Clip not found" });
    try { fs.unlinkSync(clip.clipPath); } catch {}
    await storage.deleteClip(req.params.clipId);
    res.status(204).send();
  });

  return httpServer;
}
