# Objective
5 UI/UX improvements to clip generation workflow.

# Tasks

### T001: Schema — add peakTime to clips
- **Details**: Add `peakTime integer default(0) notNull` to clips table; run db:push

### T002: Server — progress tracking + variant endpoint
- **Blocked By**: [T001]
- **Details**:
  - Extend activeGenerations to track { aborted, current, total }
  - Add GET /api/uploads/:id/progress endpoint
  - Store peakTime when creating clips
  - Add POST /api/clips/:id/variant endpoint (sync, awaits ffmpeg)

### T003: Client — all 5 UI features in Home.tsx
- **Blocked By**: [T002]
- **Details**:
  1. Custom duration input alongside 15/20/30/45 presets
  2. Progress text "Encoding clip X of Y" (polling /progress)
  3. Progress indicator moved below clips (not above)
  4. Per-clip Re-cut dialog (duration, build-up, format)
  5. Clips grouped by peakTime in horizontal scrollable rows
