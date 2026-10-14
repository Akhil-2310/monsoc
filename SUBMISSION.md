# Monsoc: submission text

## One-line description (max 200)

Open social protocol on Monad: own your identity, audience and feed with a passkey, test posts on strangers first, and back creators early in markets settled by the onchain follow graph.

## Problem, solution and why it's useful (max 8000)

THE PROBLEM

Social platforms lock up the three things that matter most to the people who create value on them.

Your identity is locked. Your account, handle and reputation belong to the platform and can't leave it.

Your audience is trapped. Followers you build on one app can't move to another, so every time a creator switches platforms, or a platform changes its rules, they start from zero.

The feed is a black box. One company decides who gets seen. On some apps a handful of accounts circulate endlessly; on others anything pops up. New creators struggle to be discovered at all, and there's no way to test a post with people who don't follow you yet. Meanwhile, the fans who discover a creator before anyone else, whose attention is exactly what makes that creator grow, get nothing for spotting them early.

Onchain social has tried to fix ownership, but it usually feels like crypto: seed phrases, wallet popups, gas fees on every like, and an empty feed on day one. People don't switch networks for ideology. They switch when the product feels better.

THE SOLUTION

Monsoc is an open social protocol on Monad where people, not platforms, own their identity, their audience and their feed, plus an open-source default client that anyone can fork into their own app.

1. Passkey identity with zero crypto friction. You sign up with Touch ID or Face ID. There's no seed phrase, no wallet popup and no gas: every onchain action is sponsored by a relay through an ERC-2771 forwarder, and the client signs in the background with a scoped, revocable app key. One signature creates your account, your handle and your app key.

2. An onchain social graph. Accounts, handles and follows live in contracts on Monad, with Monad's fast finality making follows feel instant. Any client built on the protocol reads the same graph, so a creator's audience moves with them, and other contracts can check "does A follow B" directly. Follows are rate-limited onchain so sponsored gas can't be abused.

3. A feed marketplace. Ranking becomes an open market instead of a secret. A feed is either a small public JSON recipe (which posts to include, what to filter out, how to weight replies versus likes, recency and reputation) that runs in the user's browser, or a hosted server where AI ranking can live. Every feed is registered and versioned onchain, so changes are visible. Users switch with one tap: topic feeds like AI, Sports, Crypto or Politics, and ranking styles like "Real conversations" or "No engagement bait". Communities choose how their own feed is ranked. And every feed must reserve 5-30% of positions for creators the viewer doesn't follow, so new creators always get a fair shot.

4. Trial posts. A creator marks a post or reel as a trial and it's shown only in discovery slots, to people who don't follow them. They can A/B test two hooks: each viewer consistently sees one version, and a dashboard compares reach, engagement, backs and follows gained. They release the winner to followers with one tap, or let it auto-release if it beats their usual engagement.

5. Scouts. Viewers tap "Back" on creators they discover early. Their scout score rises the more those creators grow after they backed them, measured only in verified followers (weighted by reputation, so fake followers don't count), with a daily cap and a hit-rate multiplier so spraying backs everywhere doesn't pay. Scores are computed from public data and their Merkle root is posted onchain, so anyone can recompute them. Badges, tiers and topic leaderboards make spotting talent a game.

6. Milestone markets. Where allowed, fans can back a creator with money: "Will @nova hit 1,000 followers by Friday?" Creators must opt in and can't bet on themselves. Stakes placed early earn up to 2x weight, falling to 1x at the deadline, so conviction before the crowd pays most. Winners get their stake back plus a share of the losing pool; creators earn 1% of it. Settlement needs no oracle and no admin: the contract reads the onchain follow graph itself, verifying every counted follower, settling YES the moment the target is hit and NO at the deadline. Only accounts that existed when the market opened count, so creating fake accounts can't swing it. A fuzz test proves the contract can never pay out more than it holds.

7. Communities and real money. Communities can be open, token-gated, invite-only or paid, with onchain membership, roles and bans, live chat rooms, and their own ranking. Everything is priced in dollars and paid in a stablecoin or MON. Paid feeds share subscription revenue with the creators they actually surfaced, attributed from views signed by each subscriber's own key, so a feed can't lie about whom it showed. Tips, memberships and creator payouts are claimed with Merkle proofs, keeping gas flat however many creators earn.

8. Verifiable by default. Posts, likes and profiles are signed messages, so they're free and instant. The relay anchors a Merkle root of every batch on Monad, so anyone can prove a post existed unaltered, with a "Verify onchain" button on every post. Uploaded images and videos carry the SHA-256 of the original file in the signed post, so a swapped file is detectable. Users can also publish directly to the anchor contract, so no relay can silence them.

The architecture follows the WordPress model: a small, neutral core (identity, graph, feed and community registries, payments, anchoring, markets) that's cheap to run and hard to capture, with everything that differentiates (feeds, clients, moderation labelers, plugins) competing at the edges.

WHY IT'S USEFUL

For creators: an audience they own and take anywhere, a fair way to get discovered through discovery slots and trials, and new ways to earn from paid feeds, tips, communities and market fees.

For fans: feeds they choose instead of feeds chosen for them, and a provable, sometimes financial, stake in spotting talent before the crowd. Attention finally translates into ownership for the people giving it.

For communities: their own space, rules, membership and ranking, enforced onchain, not by a platform's policy team.

For developers: fork the open client and launch a niche app that starts with a real network on day one, because every client shares the same graph and posts.

It's built and running on Monad testnet today: 13 contracts, 35 passing contract tests including fuzzing, passkey sign-up, sponsored gas, the feed marketplace, trials, communities with live chat, scouts, notifications and search, and milestone markets that settle themselves from the follow graph.

## Go-to-market and user acquisition

FIRST USERS

Our first users are Monad builders and the crypto-native creators around them. They're already active on X and in Monad community channels, they understand why owning their audience matters, they're used to new apps, and they're the most likely to try markets on creators. We'll go deep in this one niche before going broad, because a busy niche beats a thin global network. Our second niche is college crypto communities in India: tight, social, and growing.

HOW WE'LL REACH THEM

1. Hand-onboard the first 100 creators. We'll personally invite builders who already post about Monad and help them set up profiles, communities and their first trial posts. Every creator brings part of their audience.

2. Creator pull built into the product. Trial posts let new creators reach strangers, discovery slots guarantee they get seen, and milestone markets and creator fees give them reasons to post on Monsoc first and share the link.

3. Built-in sharing loops. Opening or backing a market prompts a post ("Calling it: @nova hits 1k by Friday") with the live market embedded, so every bet becomes content that pulls in new followers and new backers.

4. Scouts as a free game. Topic leaderboards and badges reward people who discover creators early, with no money needed, so it works everywhere.

5. No empty feeds. Onboarding suggests communities and people from the tokens and apps in a new user's wallet, plus starter packs by topic, so day one feels alive.

6. Ecosystem partners and forks. Monad apps can plug into social through plugins and token-gated communities, and any community can fork the client for its own members. Every new client adds users to the same shared graph.

7. Build in public. X threads, demos, hackathons and community calls. Early traction so far: 20 people on the waitlist and 10 followers on X.

## How Monsoc integrates Mera as the entire account layer

Monsoc doesn't use a wallet extension, a custody backend, MPC or smart-account contracts. Mera is the whole account system: every Monsoc account is derived from a passkey.

Sign-up. Mera creates a passkey and reads 32 secret bytes from it through the WebAuthn PRF extension. Monsoc maps those bytes through BIP-39 and BIP-32 into two keys: the custody key (m/44'/60'/0'/0/0), which owns the account, and an app key (m/44'/60'/0'/0/1), which signs everyday actions. The custody key lives only inside a Mera signing session, exposed to viem through Mera's toViemAccount adapter. It signs one EIP-712 "Signup" message (create the account, set the handle, authorize the app key), and the session is ended immediately. The relay submits that message and pays the gas. One Touch ID prompt gives you an onchain identity.

Everyday use, no prompts. Posts, likes, follows, stakes and chat are signed by the app key in the background. It's scoped and revocable onchain, so a compromised client can be cut off without touching the identity.

Cross-device by design. Because both keys are derived from the passkey, any device the passkey syncs to restores the same account, with no extra approval and no key transfer.

Owner-only actions. Changing your handle or setting a recovery address re-derives the custody key through Mera for a moment, signs a sponsored request, and wipes it again.

Recovery. A second Mera passkey (for example in another password manager) derives a backup address that's set as the account's onchain recovery address. If the main passkey is lost, "Recover with backup passkey" moves the account to the backup, keeping all followers, posts and money.

Plain addresses, verified onchain. The custody is a normal EOA, so our contracts verify signatures with standard ECDSA through OpenZeppelin's SignatureChecker, with no account deployment and no ERC-1271 edge cases.

Portable across domains. The passkey domain (rpId) is configurable, and the client serves /.well-known/webauthn for WebAuthn Related Origin Requests, so the app can move to a new domain without breaking existing logins.

On the rare browser whose passkey manager lacks PRF support, Monsoc offers a clearly labeled fallback key stored in that browser, so nobody gets stuck. Mera stays the default and the recommended path.
