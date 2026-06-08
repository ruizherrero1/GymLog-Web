import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const defaultSupabaseUrl = "https://tnuohiyrwnoqsnxyfonn.supabase.co";
const defaultSupabasePublishableKey = "sb_publishable__hfnlx_lrL6XI05FZyITLA_L6aUzK2A";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? defaultSupabaseUrl;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  defaultSupabasePublishableKey;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl as string, supabasePublishableKey as string)
  : null;
