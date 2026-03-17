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

const CLIPS_DIR = path.resolve("clips");

if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });

// Tracks abort signals for active generation jobs: uploadId → { aborted }
const activeGenerations = new Map<string, { aborted: boolean }>();

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
      const { stdout } = await execAsync("ffprobe", [
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
      const { writeFileSync, unlinkSync } = await import("fs");
      const { join } = await import("path");
      const { tmpdir } = await import("os");
      const execAsync = promisify(exec);

      // Write script to a temp .ps1 file to avoid quoting issues
      const scriptPath = join(tmpdir(), `djclip_picker_${Date.now()}.ps1`);
      const ps = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
        "$dialog.Title  = 'Select DJ Set Recording'",
        "$dialog.Filter = 'Video Files|*.mp4;*.mov;*.avi;*.webm;*.mkv|All Files|*.*'",
        "$dialog.Multiselect = $false",
        "$owner = New-Object System.Windows.Forms.Form",
        "$owner.TopMost = $true",
        "$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual",
        "$owner.Location = New-Object System.Drawing.Point(200, 200)",
        "$owner.Size = New-Object System.Drawing.Size(1, 1)",
        "$owner.ShowInTaskbar = $false",
        "$owner.Show()",
        "$owner.BringToFront()",
        "$null = $dialog.ShowDialog($owner)",
        "$owner.Dispose()",
        "if ($dialog.FileName) { Write-Output $dialog.FileName }",
      ].join("\r\n");

      writeFileSync(scriptPath, ps, "utf8");

      let stdout = "";
      try {
        // windowsHide: false is critical — lets the child process show GUI windows
        const result = await execAsync(
          `powershell -NoProfile -STA -ExecutionPolicy Bypass -File "${scriptPath}"`,
          { timeout: 5 * 60 * 1000, windowsHide: false }
        );
        stdout = result.stdout;
      } finally {
        try { unlinkSync(scriptPath); } catch {}
      }

      const filePath = stdout.trim();
      res.json({ filePath: filePath || null });
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

    const { durations, maxClips, buildUp, sensitivity, recordingType, outputFormat, cropMethod } = req.body;

    if (!durations || !Array.isArray(durations) || durations.length === 0) {
      return res.status(400).json({ message: "Please select at least one clip duration" });
    }

    const maxClipsLimit: number = typeof maxClips === "number" && maxClips > 0 ? maxClips : 0;
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

    const abortSignal = { aborted: false };
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

        // Delete existing clips
        const existing = await storage.getClipsByUpload(found.id);
        for (const c of existing) {
          try { fs.unlinkSync(c.clipPath); } catch {}
        }
        await storage.deleteClipsByUpload(found.id);

        const refUpload = await storage.getUpload(found.id);
        const videoDuration = refUpload?.duration ?? found.duration;
        const srcWidth  = refUpload?.videoWidth  ?? found.videoWidth  ?? 1920;
        const srcHeight = refUpload?.videoHeight ?? found.videoHeight ?? 1080;

        const peaksToUse = maxClipsLimit > 0 ? peaks.slice(0, maxClipsLimit) : peaks;

        // Normalize energy so the best peak = 100%, giving meaningful relative scores
        const maxEnergy = Math.max(...peaksToUse.map((p: any) => p.energyLevel));
        const normalizedPeaks = peaksToUse.map((p: any) => ({
          ...p,
          energyLevel: maxEnergy > 0 ? Math.round((p.energyLevel / maxEnergy) * 100) : p.energyLevel,
        }));

        let count = 0;

        for (const dur of durations as number[]) {
          for (const peak of normalizedPeaks) {
            if (abortSignal.aborted) {
              console.log(`Generation stopped by user after ${count} clips`);
              break;
            }

            const times = computeClipTimes(peak, dur, videoDuration, resolvedBuildUp);
            if (!times) continue;

            const clipFilename = buildClipFilename(found.filename, peak.time, dur);
            const clipPath = path.join(CLIPS_DIR, clipFilename);

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
              clipPath,
              highlightType: peak.type,
              energyLevel: peak.energyLevel,
              outputFormat: resolvedOutputFormat,
            });

            count++;
            console.log(`  Encoded clip ${count}: ${dur}s at ${Math.floor(peak.time)}s (${resolvedOutputFormat})`);
          }
          if (abortSignal.aborted) break;
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
