/**
 * Fork this client: edit this one file, deploy, and you have your own app on the shared graph.
 * Users sign in with their existing identity and see their existing follows on day one.
 */
const config = {
  name: "Monsoc",
  tagline: "Your identity, your audience, your feed.",
  relayUrl: process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:8787",
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8546",

  theme: {
    // brand color, tuned separately for light and dark
    accent: { light: "#7c3aed", dark: "#a78bfa" },
  },

  /** feed ids from the FeedRegistry shown in the switcher, in order; empty = every active feed */
  defaultFeeds: [] as number[],
  /** pin the client to a few communities (e.g. an alumni network); empty = all */
  communityScope: [] as number[],

  plugins: {
    tipping: true,
    trials: true,
    scouts: true,
    markets: true, // milestone markets on creators (testnet play money; gate by country before real money)
  },

  /**
   * Domain passkeys are registered to (WebAuthn rpId). Set it to your production domain and never change
   * it: passkeys only work for this exact name. If you later move the app to a new domain, keep this value
   * and list the new origin in PASSKEY_RELATED_ORIGINS on the old domain (Related Origin Requests).
   * Empty = the current hostname (fine for localhost).
   */
  passkeyRpId: process.env.NEXT_PUBLIC_PASSKEY_RP_ID ?? "",

  /** also offer a browser-stored key, for testing on authenticators without passkey PRF support */
  devKeyLogin: process.env.NEXT_PUBLIC_DEV_KEY_LOGIN === "true",
};

export default config;
export type ClientConfig = typeof config;
