/*
 * Supabase client — server-side ONLY.
 *
 * Imports the `server-only` module so any accidental client-side import
 * fails at build time. Don't relax this: the anon key is intentionally
 * read-only-scoped, but routing it through the client surface bypasses
 * Next's data security model and leaks the URL/key into the browser
 * bundle. All callers should be server components or route handlers.
 *
 * Read-only contract: this codebase MUST NOT call .insert/.update/.delete
 * on any Supabase table. The DB is shared with other projects; mutating
 * it from here would be a real incident. We use the anon key (not the
 * service-role key) as a second layer of enforcement on top of code
 * discipline. Any RLS view in the Supabase dashboard is the third layer.
 */

import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
    throw new Error(
        "Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY in dashboard/.env.local and restart the dev server."
    );
}

export const supabase = createClient(url, key, {
    auth: { persistSession: false },
});
