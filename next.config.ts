import type { NextConfig } from "next";

// Next.js dev mode's Fast Refresh runtime uses eval() to preserve component
// state and stack traces across hot reloads — blocking it under CSP doesn't
// just disable HMR, it throws on every module re-evaluation and destabilizes
// the whole client runtime (observed: it broke the login form's submit
// entirely in dev, even though the identical CSP is harmless in production,
// which ships an optimized bundle with no eval-based HMR).
const scriptSrc = process.env.NODE_ENV === "development"
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Restrict browser feature access. Geolocation / camera / mic / payment
  // are not used — deny them to reduce the attack surface.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      // Server actions submit forms to self; block all other form targets.
      "form-action 'self'",
      // Next.js App Router injects inline scripts for RSC streaming and server
      // actions — 'unsafe-inline' is required until nonce-based CSP is wired
      // through middleware (TODO for v2, see docs/superpowers/specs).
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.googleusercontent.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://jfdqlnpidynxwqqiblcd.supabase.co",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
