# DJ Clip Studio

A web application that automatically detects highlight moments (drops, peaks) in DJ set recordings and generates short social-media-ready clips. Designed to run locally on Windows.

## Features

- **Local file browser**: Server-side directory browsing with a modal picker — no file transfer needed
- **Multi-band audio analysis**: Extracts both full audio and bass-only (<200 Hz) PCM via FFmpeg, combines them with recording-type weights for accurate drop detection
- **Recording type modes**: Cable-in (50% bass weight) vs Mic (25% bass, 35% overall) vs Auto-detect
- **Sensitivity presets**: Conservative / Balanced / Aggressive — adjusts energy percentile thresholds and minimum gap between peaks
- **Peak caching**: Detected peaks stored in the DB; reused across Generate calls with the same sensitivity/recording settings (avoids re-running analysis)
- **Clip generation**: All detected peaks × all selected durations (15 / 20 / 30 / 45 s). Clips appear live as they encode
- **Output format conversion**: Detects source aspect ratio (9:16 / 3:4 / 4:5 / 1:1 / 16:9). Converts via blur-background overlay or center crop using FFmpeg
- **Smart file naming**: `setname_14m23s_20s.mp4` instead of UUIDs
- **Build-up control**: None / Short / Medium / Long / DJ Choice (auto)
- **Maximum clips limit**: Cap the number of peaks used
- **Preview & Download**: In-browser video streaming, direct download

## Architecture

- **Frontend**: React + Vite + TanStack Query + Shadcn UI + Tailwind CSS
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL via Drizzle ORM
- **Video Processing**: FFmpeg + ffprobe (system dependency)
- **Local startup**: `Launch DJ Clip Studio.bat` (opens CMD, starts server, opens browser)

## Data Model

- **uploads**: `id, filename, filePath, duration, videoWidth, videoHeight, status, error, peaksCache (json), createdAt`
  - Status lifecycle: `processing` → `analyzed` → `generating` → `analyzed` (or `error`)
  - `peaksCache`: `{ peaks[], sensitivity, recordingType }` — null until first Generate
- **clips**: `id, uploadId, startTime, endTime, duration, clipPath, highlightType, energyLevel, outputFormat, createdAt`

## API Routes

- `POST /api/browse-native` — Opens native Windows OpenFileDialog (PowerShell); returns `{ filePath }`. 400 on non-Windows → frontend falls back to tree browser
- `GET /api/browse?path=<dir>` — Server-side tree file browser (fallback for non-Windows)
- `GET /api/uploads` — List all uploads
- `POST /api/uploads/local` — Register a local file path (no transfer)
- `GET /api/uploads/:id` — Get single upload (used for polling status)
- `DELETE /api/uploads/:id` — Delete upload + all clips (never deletes user's original file)
- `GET /api/uploads/:uploadId/clips` — List clips for an upload
- `POST /api/uploads/:uploadId/generate` — Generate clips (body: `{ durations, maxClips, buildUp, sensitivity, recordingType, outputFormat, cropMethod }`)
- `GET /api/clips/:clipId/stream` — Stream clip for browser preview
- `GET /api/clips/:clipId/download` — Download clip file
- `DELETE /api/clips/:clipId` — Delete a single clip

## Audio Analysis Pipeline (server/audioAnalyzer.ts)

1. `getVideoInfo()` — ffprobe reads duration + width/height (accounts for rotation metadata)
2. `extractPcm()` — Two parallel FFmpeg spawns: full audio + bass-only (lowpass 200 Hz), both at 100 Hz s16le
3. `computeRmsWindows()` — Non-overlapping 2-second RMS windows on each band
4. `normalize()` — Scale each band to 0–100 relative to its own min/max
5. `detectPeakMoments()` — Composite score = wBass×bassEnergy + wOverall×overallEnergy + wBassAttack×bassAttack + wOverallAttack×overallAttack; local-maxima detection above sensitivity threshold with adaptive min gap
6. `buildFormatFilter()` — Generates FFmpeg blur-overlay or crop filter chain for aspect ratio conversion
7. `extractClip()` — libx264 / aac / yuv420p / faststart with optional format filter

## File Storage

- Generated clips: `./clips/` directory
- Uploads dir: `./uploads/` (kept for multer compatibility but upload route removed)
- User's original video files: **never deleted** — only clips in `./clips/` are removed

## Planned Features (not yet built)

- Multi-band weights already use Gemini-recommended ratios: sub-bass 60%/20%, high-mids 10%/40% cable/mic
- Manual peak review UI + waveform visualization (energy curve + peak markers)
- Beat-synced clip starting (BPM detection → snap to nearest downbeat)
- Fast low-res preview before full encode
- Overlapping windows for finer temporal precision
- Batch processing
