# Monsoc: submission text

## One-line description

Open social protocol on Monad: own your identity, audience and feed with a passkey, test posts on strangers first, and back creators early in markets settled by the onchain follow graph.

## Detailed description

### The problem

Social platforms lock up the three things that matter most to the people who create value on them. Your identity and reputation can't leave the platform. Your audience is trapped: followers built on one app can't move to another, so creators start from zero every time they switch. And the feed is a black box: one company decides who gets seen, a few accounts circulate endlessly, and new creators struggle to be discovered at all. There's no way to test a post with people who don't follow you yet, and the fans who discover a creator before anyone else get nothing for spotting them early, even though their attention is exactly what made that creator grow.

Onchain social has tried to fix ownership, but it usually feels like crypto: seed phrases, wallet popups, gas fees, and empty feeds on day one.

### The solution

Monsoc is an open social protocol on Monad where people, not platforms, own their identity, their audience and their feed, plus a default client anyone can fork.

- **Passkey identity, no crypto friction.** Sign up with Touch ID or Face ID. There's no seed phrase, no wallet popup and no gas: a relay sponsors every transaction through an ERC-2771 forwarder, and the client signs in the background with a scoped, revocable app key.
- **An onchain social graph.** Accounts, handles and follows live in contracts on Monad. Any client built on the protocol reads the same graph, so a creator's audience moves with them, and contracts can check "does A follow B" directly.
- **A feed marketplace.** Ranking becomes open. Feeds are public JSON recipes that run in the browser, or hosted servers for AI ranking, all registered and versioned onchain. Users switch feeds in one tap (topic feeds like AI, Sports or Crypto, or styles like "Real conversations" and "No engagement bait"), communities choose how their own feed is ranked, and every feed must reserve discovery slots for creators the viewer doesn't follow.
- **Trial posts.** Creators test a post or reel with non-followers first, A/B two hooks, watch reach and engagement, and release the winner to followers, or let it auto-release if it beats their average.
- **Scouts and milestone markets.** Viewers "Back" creators they discover early and earn a provable scout score as those creators grow, computed from public data with the root posted onchain. Where markets are allowed, fans can stake YES or NO on milestones like "Will @nova hit 1,000 followers by Friday?". Markets are settled by the contract reading the onchain follow graph, with no oracle and no admin. Early stakes earn up to 2x weight, winners share the losing pool, creators opt in, can't bet on themselves, and earn 1% of every losing pool. Only accounts that existed when a market opened count, so new sybil accounts can't swing it.
- **Communities and money.** Communities can be open, token-gated, invite-only or paid, with live chat rooms and onchain membership. Everything is priced in dollars and paid in a stablecoin or MON: paid feeds share subscription revenue with the creators they actually surfaced (attributed from views signed by subscribers' own keys, so a feed can't lie), plus tips and creator payouts claimed with Merkle proofs.
- **Verifiable by default.** Posts are signed messages, and the relay anchors a Merkle root of every batch on Monad, so anyone can prove a post existed unaltered, and uploaded media is pinned to its hash.

**Why it's useful:** creators get an audience they own, a fair way to get discovered, and new ways to earn. Fans get feeds they choose and a real stake in spotting talent early. Developers can fork the open client and launch a niche app on a network that already has users. It's live on Monad testnet today: 13 contracts, 35 passing contract tests including fuzzing, and the full flow from passkey sign-up to a market settling onchain.

### Go-to-market and user acquisition

**First users: Monad builders and the crypto-native creators around them.** They're already active on X and in Monad community channels, they understand why owning their audience matters, and they're the most likely to try markets on creators. We'll go deep in one tight niche before going broad, because a busy niche beats a thin global network. The second niche is college crypto communities in India.

**How we'll reach them:**

1. **Hand-onboard the first 100 creators.** DM and invite builders who already post about Monad, and help them set up profiles, communities and their first trial posts. Creators bring their audiences.
2. **Creator pull built into the product.** Trial posts let new creators reach strangers, discovery slots guarantee they get seen, and milestone markets and creator fees give them reasons to post here first and share the link.
3. **Sharing loops.** Opening a market or backing one prompts a post ("Calling it: @nova hits 1k by Friday"), with the live market card embedded, so every bet becomes content that pulls in followers.
4. **Scouts as a game.** Topic leaderboards and badges reward people who find good creators early, even with no money involved.
5. **No empty feeds.** Onboarding suggests communities and people from the tokens and apps in a user's wallet, plus starter packs by topic, so day one feels alive.
6. **Ecosystem partners and forks.** Monad apps can plug into social (plugins, token-gated communities), and anyone can fork the client for their community. Every new client adds users to the same shared graph.
7. **Build in public.** X threads, demos and hackathons. Early traction: 20 people on the waitlist and 10 followers on X.

### Mera as the entire account layer

Monsoc doesn't use a wallet, a custody backend, MPC or smart-account contracts. Mera is the whole account system: every account is derived from a passkey.

- **Sign-up.** Mera creates a passkey and reads 32 secret bytes from it through the WebAuthn PRF extension. Monsoc maps those bytes through BIP-39/BIP-32 into two keys: the **custody key** (`m/44'/60'/0'/0/0`), which owns the account, and an **app key** (`m/44'/60'/0'/0/1`), which signs everyday actions. The custody key lives only inside a Mera signing session, exposed to viem through Mera's `toViemAccount` adapter, signs one EIP-712 "Signup" message (create the account, set the handle, authorize the app key), and the session is ended immediately. The relay submits it and pays the gas. One Touch ID prompt gives you an onchain identity.
- **Everyday use, no prompts.** Posts, likes, follows, stakes and chat are signed by the app key in the background. It's scoped and revocable onchain, so a compromised client can be cut off without touching the identity.
- **Cross-device by design.** Because both keys are derived from the passkey, any device the passkey syncs to restores the same account, with no extra approval or key transfer.
- **Owner-only actions.** Changing your handle or setting a recovery address re-derives the custody key through Mera for a moment, signs a sponsored request, and wipes it again.
- **Recovery.** A second Mera passkey (for example in another password manager) derives a backup address that's set as the account's onchain recovery address. If the main passkey is lost, "Recover with backup passkey" moves the account to the backup, keeping all followers, posts and money.
- **Plain addresses, verifiable onchain.** Custody is a normal EOA, so contracts verify signatures with standard ECDSA through OpenZeppelin's SignatureChecker, with no account deployment and no ERC-1271 edge cases.
- **Portable across domains.** The passkey domain (rpId) is configurable, and the client serves `/.well-known/webauthn` for WebAuthn Related Origin Requests, so the app can move to a new domain without breaking existing logins.

On the rare browser whose passkey manager lacks PRF, Monsoc offers a clearly labeled fallback key stored in that browser, so nobody gets stuck. Mera stays the default and the path we recommend.
