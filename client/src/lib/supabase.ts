import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Returns null in dev/Replit mode (env vars absent) so the app works normally.
// Only active when built for Electron with the credentials baked in.
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null;

export function isElectron(): boolean {
  return typeof window !== "undefined" && window.electronAPI !== undefined;
}
