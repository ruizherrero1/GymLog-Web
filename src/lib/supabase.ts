import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const defaultSupabaseUrl = "https://qserywqzvluqfrnyeggz.supabase.co";
const defaultSupabasePublishableKey = "sb_publishable_l25PyMak_ttZ9ElV_FilPw_1J8lFZma";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? defaultSupabaseUrl;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  defaultSupabasePublishableKey;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl as string, supabasePublishableKey as string)
  : null;
