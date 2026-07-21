import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth?.user;
  const { pathname } = req.nextUrl;

  // Auth.js API routes, login page, Slack webhook, the inbound charges API, and
  // the cron drain are always public. Those endpoints authenticate requests
  // themselves (Slack via HMAC; /api/charges via a bearer secret; /api/cron via
  // CRON_SECRET). Only the exact /api/charges collection route is public — the
  // cookie-gated /api/charges/[id]/decide is not.
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/slack/interact" ||
    pathname === "/api/charges" ||
    pathname.startsWith("/api/cron/")
  ) {
    if (isLoggedIn && pathname === "/login") {
      return NextResponse.redirect(new URL("/", req.nextUrl.origin));
    }
    return NextResponse.next();
  }

  if (!isLoggedIn) {
    // API routes: return JSON 401 so fetch callers handle it gracefully.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
