/** @type {import('next').NextConfig} */

// Applied to every response. These close the gaps the security audit found:
// the app shipped with only HSTS, so it could be framed (clickjacking) and had
// no MIME-sniffing or referrer protection.
const securityHeaders = [
  // Block the app from being embedded in an <iframe> on another site.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Stop browsers from MIME-sniffing a response into a different type.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Never leak the full URL (which can carry ids) to third-party sites.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Deny powerful browser features the app never uses.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Belt-and-suspenders framing block for browsers that honour CSP over XFO.
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
]

const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

module.exports = nextConfig
