/**
 * Supabase client — service-side.
 *
 * Read-only contract: this codebase MUST NOT call .insert/.update/.delete
 * on any Supabase table. The DB is shared with other projects; mutating
 * it from here would be a real incident. We use the anon key (not the
 * service-role key) as a second layer of enforcement on top of code
 * discipline.
 */

import { createClient } from "@supabase/supabase-js";
import config from "../config.js";

export const supabase = createClient(
    config.supabase.url,
    config.supabase.anonKey,
    { auth: { persistSession: false } }
);
