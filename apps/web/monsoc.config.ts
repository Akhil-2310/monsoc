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
    accent: "#8b5cf6", // violet
    accentSoft: "rgba(139, 92, 246, 0.14)",
  },

  /** feed ids from the FeedRegistry shown in the switcher, in order; empty = every active feed */
  defaultFeeds: [] as number[],
  /** pin the client to a few communities (e.g. an alumni network); empty = all */
  communityScope: [] as number[],

  plugins: {
    tipping: true,
    trials: true,
    scouts: true,
    markets: false, // creator markets are v2 and gated by country
  },

  /** dev chains only: one-click "try as @handle" logins for the seeded demo accounts */
  demoLogins: process.env.NEXT_PUBLIC_DEMO_LOGINS !== "false",
  demoHandles: ["arjun", "meera", "ira", "sam", "rohan", "zoya"],
};

export default config;
export type ClientConfig = typeof config;
