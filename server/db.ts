import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

let _pool: pg.Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

if (process.env.ELECTRON_APP !== "true") {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
  }
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  _db = drizzle(_pool, { schema });
}

export const pool = _pool;
export const db = _db;
