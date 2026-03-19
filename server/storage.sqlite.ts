import { randomUUID } from "crypto";
import type { IStorage } from "./storage";
import type { Upload, Clip, InsertUpload, InsertClip } from "@shared/schema";

// node:sqlite is a built-in module available in Node.js 22.5+ (Electron 41+).
// Enable it by passing --experimental-sqlite to the utility process (Node 22.x).
// @types/node v20 doesn't include these types; cast via any at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqlite: any;

export function initSQLite(dbPath: string) {
  // require("node:sqlite") works at Electron 41 runtime with --experimental-sqlite.
  // We cast to any because @types/node v20 predates the sqlite built-in.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require("node:sqlite") as any;
  sqlite = new DatabaseSync(dbPath);

  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      video_width INTEGER,
      video_height INTEGER,
      status TEXT NOT NULL DEFAULT 'processing',
      error TEXT,
      peaks_cache TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      duration INTEGER NOT NULL,
      peak_time INTEGER NOT NULL DEFAULT 0,
      clip_path TEXT NOT NULL,
      highlight_type TEXT NOT NULL,
      energy_level INTEGER NOT NULL,
      output_format TEXT DEFAULT 'original',
      build_up TEXT DEFAULT 'short',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function rowToUpload(row: any): Upload {
  return {
    id: row.id,
    filename: row.filename,
    filePath: row.file_path,
    duration: Number(row.duration),
    videoWidth: row.video_width != null ? Number(row.video_width) : null,
    videoHeight: row.video_height != null ? Number(row.video_height) : null,
    status: row.status as Upload["status"],
    error: row.error ?? null,
    peaksCache: row.peaks_cache ? JSON.parse(row.peaks_cache) : null,
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
  };
}

function rowToClip(row: any): Clip {
  return {
    id: row.id,
    uploadId: row.upload_id,
    startTime: Number(row.start_time),
    endTime: Number(row.end_time),
    duration: Number(row.duration),
    peakTime: row.peak_time != null ? Number(row.peak_time) : 0,
    clipPath: row.clip_path,
    highlightType: row.highlight_type,
    energyLevel: Number(row.energy_level),
    outputFormat: row.output_format ?? "original",
    buildUp: row.build_up ?? "short",
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
  };
}

export class SQLiteStorage implements IStorage {
  async getUploads(): Promise<Upload[]> {
    const rows = sqlite
      .prepare("SELECT * FROM uploads ORDER BY created_at ASC")
      .all() as any[];
    return rows.map(rowToUpload);
  }

  async getUpload(id: string): Promise<Upload | undefined> {
    const row = sqlite
      .prepare("SELECT * FROM uploads WHERE id = ?")
      .get(id) as any;
    return row ? rowToUpload(row) : undefined;
  }

  async createUpload(upload: InsertUpload): Promise<Upload> {
    const id = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO uploads (id, filename, file_path, duration, video_width, video_height, status)
         VALUES (?, ?, ?, ?, ?, ?, 'processing')`
      )
      .run(
        id,
        upload.filename,
        upload.filePath,
        upload.duration ?? 0,
        upload.videoWidth ?? null,
        upload.videoHeight ?? null
      );
    return (await this.getUpload(id))!;
  }

  async updateUpload(id: string, updates: Partial<Upload>): Promise<Upload> {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      setClauses.push("status = ?");
      values.push(updates.status);
    }
    if (updates.error !== undefined) {
      setClauses.push("error = ?");
      values.push(updates.error);
    }
    if (updates.duration !== undefined) {
      setClauses.push("duration = ?");
      values.push(updates.duration);
    }
    if (updates.videoWidth !== undefined) {
      setClauses.push("video_width = ?");
      values.push(updates.videoWidth);
    }
    if (updates.videoHeight !== undefined) {
      setClauses.push("video_height = ?");
      values.push(updates.videoHeight);
    }
    if (updates.peaksCache !== undefined) {
      setClauses.push("peaks_cache = ?");
      values.push(
        updates.peaksCache ? JSON.stringify(updates.peaksCache) : null
      );
    }

    if (setClauses.length > 0) {
      values.push(id);
      sqlite
        .prepare(`UPDATE uploads SET ${setClauses.join(", ")} WHERE id = ?`)
        .run(...values);
    }

    return (await this.getUpload(id))!;
  }

  async deleteUpload(id: string): Promise<void> {
    sqlite.prepare("DELETE FROM uploads WHERE id = ?").run(id);
  }

  async getClipsByUpload(uploadId: string): Promise<Clip[]> {
    const rows = sqlite
      .prepare(
        "SELECT * FROM clips WHERE upload_id = ? ORDER BY energy_level DESC"
      )
      .all(uploadId) as any[];
    return rows.map(rowToClip);
  }

  async getClip(id: string): Promise<Clip | undefined> {
    const row = sqlite
      .prepare("SELECT * FROM clips WHERE id = ?")
      .get(id) as any;
    return row ? rowToClip(row) : undefined;
  }

  async createClip(clip: InsertClip): Promise<Clip> {
    const id = randomUUID();
    sqlite
      .prepare(
        `INSERT INTO clips
          (id, upload_id, start_time, end_time, duration, peak_time,
           clip_path, highlight_type, energy_level, output_format, build_up)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        clip.uploadId,
        clip.startTime,
        clip.endTime,
        clip.duration,
        clip.peakTime ?? 0,
        clip.clipPath,
        clip.highlightType,
        clip.energyLevel,
        clip.outputFormat ?? "original",
        (clip as any).buildUp ?? "short"
      );
    return (await this.getClip(id))!;
  }

  async deleteClipsByUpload(uploadId: string): Promise<void> {
    sqlite.prepare("DELETE FROM clips WHERE upload_id = ?").run(uploadId);
  }

  async deleteClip(id: string): Promise<void> {
    sqlite.prepare("DELETE FROM clips WHERE id = ?").run(id);
  }
}
