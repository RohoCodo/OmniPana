import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function requireEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function createSupabaseServerClient() {
  const store = await cookies();

  return createServerClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(nextCookies) {
        try {
          for (const cookie of nextCookies) {
            store.set(cookie.name, cookie.value, cookie.options);
          }
        } catch {
          // Cookie writes can be blocked in some Server Component contexts.
        }
      },
    },
  });
}

export function createSupabaseServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

  return createServerClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), serviceRoleKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // Service-role operations should not rely on end-user cookies.
      },
    },
  });
}
