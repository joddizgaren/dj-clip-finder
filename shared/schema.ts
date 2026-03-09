import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Upload represents a DJ set video upload
export const uploads = pgTable("uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull(),
  filePath: text("file_path").notNull(),
  duration: integer("duration").notNull(), // in seconds
  status: text("status").default("processing").notNull(), // processing, analyzed, error
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Clips represents auto-generated highlight clips
export const clips = pgTable("clips", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploadId: varchar("upload_id")
    .notNull()
    .references(() => uploads.id, { onDelete: "cascade" }),
  startTime: integer("start_time").notNull(), // in seconds
  endTime: integer("end_time").notNull(), // in seconds
  duration: integer("duration").notNull(), // 15, 20, 30, or 45
  clipPath: text("clip_path").notNull(),
  highlightType: text("highlight_type").notNull(), // "drop", "transition", "build"
  energyLevel: integer("energy_level").notNull(), // 0-100
  createdAt: timestamp("created_at").defaultNow(),
});

// === INSERT SCHEMAS ===
export const insertUploadSchema = createInsertSchema(uploads).omit({
  id: true,
  createdAt: true,
  status: true,
  error: true,
});

export const insertClipSchema = createInsertSchema(clips).omit({
  id: true,
  createdAt: true,
});

// === TYPES ===
export type Upload = typeof uploads.$inferSelect;
export type Clip = typeof clips.$inferSelect;
export type InsertUpload = z.infer<typeof insertUploadSchema>;
export type InsertClip = z.infer<typeof insertClipSchema>;

// === API REQUEST/RESPONSE TYPES ===
export type UploadResponse = Upload;
export type ClipResponse = Clip;
export type ClipsListResponse = Clip[];

export interface AnalysisResult {
  peaks: PeakDetection[];
  duration: number;
  status: "success" | "error";
  error?: string;
}

export interface PeakDetection {
  time: number; // seconds
  energyLevel: number; // 0-100
  type: "drop" | "transition" | "build";
}

export interface ClipGenerationRequest {
  uploadId: string;
  durations: (15 | 20 | 30 | 45)[]; // requested clip lengths
}

export interface ClipGenerationResponse {
  uploadId: string;
  clipsGenerated: number;
  clips: ClipResponse[];
}
