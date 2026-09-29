import { createBrowserClient } from "@supabase/ssr";

function requireBrowserEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    requireBrowserEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireBrowserEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}
