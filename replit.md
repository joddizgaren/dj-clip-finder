# DJ Clip Studio

An AI-powered web application that automatically detects highlight moments in DJ set recordings and generates short social-media-ready clips.

## Features

- **Video Upload**: Drag & drop or browse for video files (MP4, MOV, AVI, WebM, MKV) up to 2 GB
- **Audio Analysis**: Automatically analyzes audio energy levels to detect drops, builds, and transitions
- **Clip Generation**: Generates 15, 20, 30, or 45-second clips centered on the best detected moments
- **Preview & Download**: In-browser video preview with streaming support and direct download
- **Dark/Light Mode**: Full dark/light theme support with system preference detection

## Architecture

- **Frontend**: React + Vite + TanStack Query + Shadcn UI + Tailwind CSS
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL via Drizzle ORM
- **Video Processing**: FFmpeg (system dependency) for audio analysis and clip extraction
- **File Upload**: Multer for multipart/form-data handling

## Data Model

- **uploads**: Stores uploaded DJ set metadata (filename, filePath, duration, status)
  - Status lifecycle: `processing` → `analyzed` → `generating` → `analyzed` (or `error`)
- **clips**: Stores generated highlight clips (startTime, endTime, duration, clipPath, highlightType, energyLevel)

## API Routes

- `GET /api/uploads` — List all uploads
- `POST /api/uploads` — Upload a new video (multipart/form-data)
- `GET /api/uploads/:id` — Get single upload (used for polling status)
- `DELETE /api/uploads/:id` — Delete upload and all its clips
- `GET /api/uploads/:uploadId/clips` — List clips for an upload
- `POST /api/uploads/:uploadId/generate` — Generate clips (body: `{ durations: [15, 20, 30, 45] }`)
- `GET /api/clips/:clipId/stream` — Stream clip for preview
- `GET /api/clips/:clipId/download` — Download clip file
- `DELETE /api/clips/:clipId` — Delete a single clip

## Audio Analysis Pipeline (server/audioAnalyzer.ts)

1. `getVideoDuration()` — Uses `ffprobe` to get total video duration
2. `analyzeAudioChunks()` — Uses FFmpeg's `astats` filter to measure RMS energy in 2-second windows
3. `detectPeakMoments()` — Finds local maxima in the energy curve with configurable minimum gap between peaks; classifies as `drop`, `build`, or `transition` based on the shape of the energy curve
4. `computeClipTimes()` — Centers the clip on the peak with a 40/60 before/after split
5. `extractClip()` — Re-encodes the clip with FFmpeg using `libx264`/`aac` with `+faststart` for web playback

## File Storage

- Uploaded videos: `./uploads/` directory (persisted)
- Generated clips: `./clips/` directory (persisted)

## Future Features (planned)

- Social media trend analysis from DJ handles (IG/TikTok)
- Batch download as ZIP
- Clip title overlays and captions
- Waveform visualization
