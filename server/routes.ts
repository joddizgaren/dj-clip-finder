import type { Express } from "express";
import type { Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import {
  analyzeVideoFile,
  extractClip,
  computeClipTimes,
  type BuildUp,
} from "./audioAnalyzer";

const UPLOAD_DIR = path.resolve("uploads");
const CLIPS_DIR = path.resolve("clips");

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024 * 1024 }, // 20GB
  fileFilter: (_req, file, cb) => {
    const allowed = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm", "video/x-matroska"];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp4|mov|avi|webm|mkv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // === UPLOADS ===

  // List all uploads
  app.get("/api/uploads", async (_req, res) => {
    const all = await storage.getUploads();
    res.json(all);
  });

  // Get single upload
  app.get("/api/uploads/:id", async (req, res) => {
    const found = await storage.getUpload(req.params.id);
    if (!found) return res.status(404).json({ message: "Upload not found" });
    res.json(found);
  });

  // Upload a new video and kick off analysis
  app.post("/api/uploads", upload.single("video"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No video file provided" });
    }

    // Rename to keep original extension
    const ext = path.extname(req.file.originalname) || ".mp4";
    const newPath = req.file.path + ext;
    fs.renameSync(req.file.path, newPath);

    try {
      // Create upload record first with a placeholder duration
      const record = await storage.createUpload({
        filename: req.file.originalname,
        filePath: newPath,
        duration: 0,
      });

      // Respond immediately so the client can start polling
      res.status(201).json({ ...record, status: "processing" });

      // Run analysis asynchronously
      (async () => {
        try {
          const analysis = await analyzeVideoFile(newPath);
          await storage.updateUpload(record.id, {
            duration: analysis.duration,
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
      // Clean up temp file
      try { fs.unlinkSync(newPath); } catch {}
      res.status(500).json({ message: "Upload failed: " + String(err) });
    }
  });

  // Register a video by local file path (no upload transfer)
  app.post("/api/uploads/local", async (req, res) => {
    const { filePath } = req.body;
    if (!filePath || typeof filePath !== "string") {
      return res.status(400).json({ message: "filePath is required" });
    }

    const trimmed = filePath.trim();
    if (!fs.existsSync(trimmed)) {
      return res.status(400).json({ message: "File not found at that path. Make sure the app is running on the same machine as your video files." });
    }

    const stat = fs.statSync(trimmed);
    if (!stat.isFile()) {
      return res.status(400).json({ message: "Path points to a directory, not a file." });
    }

    const ext = path.extname(trimmed).toLowerCase();
    if (![".mp4", ".mov", ".avi", ".webm", ".mkv"].includes(ext)) {
      return res.status(400).json({ message: "File must be a video (MP4, MOV, AVI, WebM, MKV)." });
    }

    try {
      const record = await storage.createUpload({
        filename: path.basename(trimmed),
        filePath: trimmed,
        duration: 0,
      });

      res.status(201).json({ ...record, status: "processing" });

      // Run analysis asynchronously
      (async () => {
        try {
          const analysis = await analyzeVideoFile(trimmed);
          await storage.updateUpload(record.id, {
            duration: analysis.duration,
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

    // Delete clip files (always safe — these are always app-owned)
    const uploadClips = await storage.getClipsByUpload(req.params.id);
    for (const clip of uploadClips) {
      try { fs.unlinkSync(clip.clipPath); } catch {}
    }

    // Only delete the video file if it lives inside the app's own uploads dir.
    // Local-path registrations reference the user's original file — never delete those.
    const resolvedFilePath = path.resolve(found.filePath);
    const isAppOwnedFile = resolvedFilePath.startsWith(UPLOAD_DIR + path.sep) ||
                           resolvedFilePath.startsWith(UPLOAD_DIR + "/");
    if (isAppOwnedFile) {
      try { fs.unlinkSync(found.filePath); } catch {}
    }

    await storage.deleteUpload(req.params.id);
    res.status(204).send();
  });

  // === CLIPS ===

  // List clips for an upload
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
          : "Video analysis failed. Cannot generate clips.",
      });
    }

    const { durations, maxClips, buildUp } = req.body;
    if (!durations || !Array.isArray(durations) || durations.length === 0) {
      return res.status(400).json({ message: "Please select at least one clip duration" });
    }
    const maxClipsLimit: number = typeof maxClips === "number" && maxClips > 0 ? maxClips : 0;
    const validBuildUps: BuildUp[] = ["none", "short", "medium", "long", "auto"];
    const resolvedBuildUp: BuildUp = validBuildUps.includes(buildUp) ? buildUp : "short";

    // Respond quickly, generate asynchronously
    res.json({ message: "Clip generation started", uploadId: found.id });

    // Mark as generating clips
    await storage.updateUpload(found.id, { status: "generating" });

    (async () => {
      try {
        // Re-analyze the file to get fresh peaks
        const analysis = await analyzeVideoFile(found.filePath);

        if (analysis.peaks.length === 0) {
          await storage.updateUpload(found.id, {
            status: "error",
            error: "No highlight moments could be detected in this recording. The audio energy may be too consistent throughout the set for automatic detection. Try a recording with more dynamic range between quiet and loud sections.",
          });
          console.log(`No peaks found for upload ${found.id} — marked as error.`);
          return;
        }

        // Delete existing clips for this upload
        const existing = await storage.getClipsByUpload(found.id);
        for (const c of existing) {
          try { fs.unlinkSync(c.clipPath); } catch {}
        }
        await storage.deleteClipsByUpload(found.id);

        // Apply max clips limit (peaks are already sorted best-first)
        const peaksToUse = maxClipsLimit > 0
          ? analysis.peaks.slice(0, maxClipsLimit)
          : analysis.peaks;

        const created: string[] = [];

        // Generate one clip per peak per selected duration
        for (const dur of durations as number[]) {
          for (const peak of peaksToUse) {
            const times = computeClipTimes(peak, dur, analysis.duration, resolvedBuildUp);
            if (!times) continue;

            const clipFilename = `clip_${found.id}_${dur}s_${Math.floor(peak.time)}s.mp4`;
            const clipPath = path.join(CLIPS_DIR, clipFilename);

            await extractClip(found.filePath, clipPath, times.startTime, times.endTime - times.startTime);

            await storage.createClip({
              uploadId: found.id,
              startTime: times.startTime,
              endTime: times.endTime,
              duration: dur,
              clipPath,
              highlightType: peak.type,
              energyLevel: peak.energyLevel,
            });

            created.push(clipFilename);
            console.log(`  Encoded clip ${created.length}: ${dur}s at ${Math.floor(peak.time)}s`);
          }
        }

        await storage.updateUpload(found.id, { status: "analyzed" });
        console.log(`Generated ${created.length} clips for upload ${found.id}`);
      } catch (err) {
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

  // Stream clip for preview
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
