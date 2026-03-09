import { db } from "./db";
import { uploads, clips } from "@shared/schema";
import type { Upload, Clip, InsertUpload, InsertClip } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  // Uploads
  getUploads(): Promise<Upload[]>;
  getUpload(id: string): Promise<Upload | undefined>;
  createUpload(upload: InsertUpload): Promise<Upload>;
  updateUpload(id: string, updates: Partial<Upload>): Promise<Upload>;
  deleteUpload(id: string): Promise<void>;

  // Clips
  getClipsByUpload(uploadId: string): Promise<Clip[]>;
  getClip(id: string): Promise<Clip | undefined>;
  createClip(clip: InsertClip): Promise<Clip>;
  deleteClipsByUpload(uploadId: string): Promise<void>;
  deleteClip(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUploads(): Promise<Upload[]> {
    return await db.select().from(uploads).orderBy(uploads.createdAt);
  }

  async getUpload(id: string): Promise<Upload | undefined> {
    const results = await db.select().from(uploads).where(eq(uploads.id, id));
    return results[0];
  }

  async createUpload(upload: InsertUpload): Promise<Upload> {
    const results = await db.insert(uploads).values(upload).returning();
    return results[0];
  }

  async updateUpload(id: string, updates: Partial<Upload>): Promise<Upload> {
    const results = await db
      .update(uploads)
      .set(updates)
      .where(eq(uploads.id, id))
      .returning();
    return results[0];
  }

  async deleteUpload(id: string): Promise<void> {
    await db.delete(uploads).where(eq(uploads.id, id));
  }

  async getClipsByUpload(uploadId: string): Promise<Clip[]> {
    return await db
      .select()
      .from(clips)
      .where(eq(clips.uploadId, uploadId))
      .orderBy(clips.energyLevel);
  }

  async getClip(id: string): Promise<Clip | undefined> {
    const results = await db.select().from(clips).where(eq(clips.id, id));
    return results[0];
  }

  async createClip(clip: InsertClip): Promise<Clip> {
    const results = await db.insert(clips).values(clip).returning();
    return results[0];
  }

  async deleteClipsByUpload(uploadId: string): Promise<void> {
    await db.delete(clips).where(eq(clips.uploadId, uploadId));
  }

  async deleteClip(id: string): Promise<void> {
    await db.delete(clips).where(eq(clips.id, id));
  }
}

export const storage = new DatabaseStorage();
