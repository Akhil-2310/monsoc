/**
 * Served at /.well-known/webauthn (see next.config.ts). Lists other origins allowed to use passkeys
 * registered to this domain, so the app can move to a new domain without breaking existing accounts.
 * Set PASSKEY_RELATED_ORIGINS on the *original* domain's deployment, e.g. "https://monsoc.xyz".
 */
export function GET() {
  const origins = (process.env.PASSKEY_RELATED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return Response.json({ origins }, { headers: { "cache-control": "public, max-age=300" } });
}
