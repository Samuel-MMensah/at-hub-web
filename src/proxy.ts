import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const LOGIN_PATH = "/login";
const DEFAULT_AUTHENTICATED_PATH = "/command-center";
// A Supabase recovery-link landing has no session yet on its very
// first request (the code exchange happens client-side, in the
// browser — see src/app/reset-password/page.tsx) — must be reachable
// unauthenticated, same as /login, or this redirect would strip the
// `?code=` param before that page's JS ever runs.
const RESET_PASSWORD_PATH = "/reset-password";

/**
 * Runs on every request to refresh the Supabase session cookie and gate
 * routes. Named `proxy` (not `middleware`) per this Next.js version's
 * renamed convention — see node_modules/next/dist/docs's Proxy guide.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginRoute = request.nextUrl.pathname === LOGIN_PATH;
  const isResetPasswordRoute = request.nextUrl.pathname === RESET_PASSWORD_PATH;

  if (!user && !isLoginRoute && !isResetPasswordRoute) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    return NextResponse.redirect(url);
  }

  if (user && isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = DEFAULT_AUTHENTICATED_PATH;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // manifest.webmanifest/sw.js must be reachable unauthenticated too --
  // both are fetched by the browser/OS itself (installability check,
  // SW registration), not necessarily carrying a live session cookie
  // (e.g. a visitor still on /login). Gating them behind auth would
  // silently break installability: the browser would get the /login
  // HTML back instead of the JSON manifest / worker script it expects.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
