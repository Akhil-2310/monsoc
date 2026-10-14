# Monsoc

An open social protocol on Monad where people, not platforms, own their identity, their audience and their feed. Sign up with a passkey, test posts on strangers first, and back creators early in markets settled by the onchain follow graph.

- **Live app:** [monsoc.vercel.app](https://monsoc.vercel.app/) (Monad testnet)
- **Video demo:** [youtu.be/7leHc36fePE](https://youtu.be/7leHc36fePE)
- **Pitch:** [youtu.be/64625gqwAcU](https://youtu.be/64625gqwAcU)
- **Contracts:** 13, all verified on [MonadVision](#deployed-contracts-monad-testnet)

## The problem

Social platforms lock up the three things that matter most to the people who create value on them.

- **Your identity is locked.** Your account, handle and reputation belong to the platform and can't leave it.
- **Your audience is trapped.** Followers you build on one app can't move to another, so every time a creator switches platforms, or a platform changes its rules, they start from zero.
- **The feed is a black box.** One company decides who gets seen. New creators struggle to be discovered, there's no way to test a post with people who don't follow you yet, and the fans who spot a creator early, whose attention is what makes that creator grow, get nothing for it.

Onchain social has tried to fix ownership, but it usually feels like crypto: seed phrases, wallet popups, gas on every like, and an empty feed on day one. People don't switch networks for ideology. They switch when the product feels better.

## The solution

Monsoc is a small, neutral protocol on Monad plus an open-source default client that anyone can fork into their own app.

1. **Passkey identity, zero crypto friction.** Sign up with Touch ID or Face ID through [Mera](https://mera.category.xyz/). No seed phrase, no wallet popup, no gas: a relay sponsors every onchain action through an ERC-2771 forwarder, and the client signs in the background with a scoped, revocable app key.
2. **An onchain social graph.** Accounts, handles and follows live in contracts on Monad. Every client reads the same graph, so a creator's audience moves with them, and other contracts can check "does A follow B" directly.
3. **A feed marketplace.** A feed is a public JSON recipe that runs in the browser, or a hosted server where AI ranking can live. Feeds are registered and versioned onchain. Users switch in one tap between topic feeds (AI, Sports, Crypto…) and ranking styles ("Real conversations", "No engagement bait"), and communities choose their own ranking. Every feed must reserve 5–30% of positions for creators the viewer doesn't follow.
4. **Trial posts.** Show a post only to people who don't follow you yet, A/B test two hooks, compare reach and follows gained, then release the winner to your followers.
5. **Scouts.** Tap **Back** on creators you discover early. Your scout score grows as they do, counted only in reputable, verified followers, with caps so spraying backs doesn't pay. Score roots are posted onchain so anyone can recompute them.
6. **Milestone markets.** "Will @nova hit 1,000 followers by Friday?" Creators opt in and earn 1% of the losing pool. Early stakes count up to 2x. The contract settles itself by reading the follow graph, with no oracle and no admin, and only accounts that existed when the market opened count, so new fake accounts can't swing it.
7. **Communities and real money.** Open, token-gated, invite-only or paid communities with onchain roles and bans, live chat and their own ranking. Prices are in dollars, paid in a stablecoin or MON. Paid feeds share revenue with the creators they actually surfaced, attributed from views signed by each subscriber's own key.
8. **Verifiable by default.** Posts, likes and profiles are free signed messages. The relay anchors a Merkle root of every batch on Monad, every post has a "Verify onchain" button, and media carries the SHA-256 of the original file.

**Why it's useful.** Creators get an audience they own and a fair shot at discovery. Fans choose their own feeds and get a provable stake in spotting talent early. Communities set their own rules, enforced onchain. Developers can fork the client and launch a niche app with a real network on day one.

## How it works

```
apps/web        Next.js default client (fork it: edit monsoc.config.ts, deploy)
apps/relay      relay + indexer + gas sponsor + market keeper + jobs (one Node process, SQLite)
packages/sdk    TypeScript SDK: messages, feed engine, merkle, meta-tx, scouts, payouts
contracts       Foundry: identity, app keys, signup, follows, feeds, payments, anchor,
                communities, scouts, markets
```

### Request flow

* **Sign up.** The custody key signs one EIP-712 `Signup`. The relay submits it and pays gas. The fid, handle and app key are created in one transaction.
* **Follow, join, subscribe, stake, create a feed.** The app key signs an ERC-2771 `ForwardRequest`. The relay checks the target, the fid's daily budget and dry-runs the call, then submits through the forwarder. Contracts see the app key and check its scope for the fid.
* **Post, like, reply, Back, view, chat.** Signed messages to the relay, which checks the signature, key, clock, sequence number, rate limits and membership. Every few minutes it Merkle-roots new messages (not chat) onto `Anchor`.
* **Paid feeds.** Each subscriber's creator share is split across the creators *they* viewed, using views signed by their own app key, so a hosted feed can't misreport. One root is posted per epoch, and creators claim with a proof.

### Mera as the account layer

`apps/web/lib/custody.ts`: a Mera passkey's PRF output is mapped through BIP-39/BIP-32 into two keys. The **custody** key (`m/44'/60'/0'/0/0`) owns the identity, lives only inside a Mera signing session (via `toViemAccount`) and is never stored. The **app key** (`m/44'/60'/0'/0/1`) is scoped, revocable, cached by the client and re-derived on any device the passkey syncs to. A second Mera passkey can be set as the onchain recovery address. Custody is a plain EOA, so there's no smart-account deployment and no ERC-1271 caveats. The passkey domain is configurable (`NEXT_PUBLIC_PASSKEY_RP_ID`), and the client serves `/.well-known/webauthn` for Related Origin Requests, so the app can move domains without breaking logins. Browsers without PRF get a clearly labeled fallback key.

### What's built

| Area | Where |
|---|---|
| Identity: fid, custody, recovery, handles | `contracts/src/IdentityRegistry.sol` |
| App keys: scoped, expiring, revocable, multi key-type | `contracts/src/AppKeyRegistry.sol` |
| One-signature signup (ID + handle + app key) | `contracts/src/Signup.sol` |
| Follow graph: timestamps, batching, daily rate limits | `contracts/src/FollowGraph.sol` |
| Feed registry: versioned definitions, pricing, discovery range | `contracts/src/FeedRegistry.sol` |
| Payments: USD pricing, MON via oracle or stablecoin, splits, Merkle payouts, tips, memberships | `contracts/src/Payments.sol` |
| Anchor: Merkle roots of content, `verify()`, escape hatch | `contracts/src/Anchor.sol` |
| Communities: open, token-gated, invite-only, paid; roles, bans | `contracts/src/CommunityRegistry.sol` |
| Scout score roots | `contracts/src/ScoutRegistry.sol` |
| Milestone markets, settled from the follow graph | `contracts/src/CreatorMarkets.sol`, keeper in `apps/relay/src/markets.ts` |
| Sponsored gas | OZ `ERC2771Forwarder` + `apps/relay/src/sponsor.ts` |
| Signed message format | `packages/sdk/src/message.ts` |
| Feed engine, discovery slots, trials, A/B split | `packages/sdk/src/feed.ts` |
| Relay validation, relay-to-relay sync, anchoring | `apps/relay/src/messages.ts`, `anchor.ts` |
| Indexer and read API | `apps/relay/src/indexer.ts`, `api.ts` |
| Labeler (spam, scams, bait, giveaways) | `apps/relay/src/jobs.ts` (`classify`) |
| Reputation, scout scores, trial auto-release, epoch payouts | `apps/relay/src/jobs.ts`, `packages/sdk/src/scout.ts`, `payout.ts` |
| Wallet-seeded onboarding and starter packs | `GET /v1/onboarding/:address` |
| Example hosted feed | `GET /hosted/high-signal` |

## Deployed contracts (Monad testnet)

Chain 10143, deployed from block 70755753. All 13 contracts are **verified** (Sourcify exact match), so the source is readable on [MonadVision](https://testnet.monadvision.com).

| Key | Contract | Address |
|---|---|---|
| identity | IdentityRegistry | [`0x4174F8D9876899195a6628C011002D99371B3355`](https://testnet.monadvision.com/address/0x4174F8D9876899195a6628C011002D99371B3355) |
| appKeys | AppKeyRegistry | [`0x7510BE2dAB2C04f62699F49eD1c3f6f10d503Cb5`](https://testnet.monadvision.com/address/0x7510BE2dAB2C04f62699F49eD1c3f6f10d503Cb5) |
| signup | Signup | [`0x8eBCC90671b7081915fB00D9450edbEf8b2953b6`](https://testnet.monadvision.com/address/0x8eBCC90671b7081915fB00D9450edbEf8b2953b6) |
| follows | FollowGraph | [`0x20957Bc80a020DA6050D61AEAfC1Ffcd99a26E4E`](https://testnet.monadvision.com/address/0x20957Bc80a020DA6050D61AEAfC1Ffcd99a26E4E) |
| feeds | FeedRegistry | [`0x30b934F8fef8c8A1B1B091BeCbc93AEa5f57f5B0`](https://testnet.monadvision.com/address/0x30b934F8fef8c8A1B1B091BeCbc93AEa5f57f5B0) |
| payments | Payments | [`0xCb3495cB6975b13e43e218a85c54426115A2CD5B`](https://testnet.monadvision.com/address/0xCb3495cB6975b13e43e218a85c54426115A2CD5B) |
| anchor | Anchor | [`0x9e23BfDF68d205A9d45Bc24cE8acb0faE63485fe`](https://testnet.monadvision.com/address/0x9e23BfDF68d205A9d45Bc24cE8acb0faE63485fe) |
| communities | CommunityRegistry | [`0x745E4474D8393a9596E5c0297cDF9ecf6D329e8b`](https://testnet.monadvision.com/address/0x745E4474D8393a9596E5c0297cDF9ecf6D329e8b) |
| scouts | ScoutRegistry | [`0xf27EF7D19DcABea9EE4C29d7D178bB194cFCfD2e`](https://testnet.monadvision.com/address/0xf27EF7D19DcABea9EE4C29d7D178bB194cFCfD2e) |
| markets | CreatorMarkets | [`0x0a22cf5A7301DDa6a3A235690F07b0bfF96Ea6B3`](https://testnet.monadvision.com/address/0x0a22cf5A7301DDa6a3A235690F07b0bfF96Ea6B3) |
| forwarder | ERC2771Forwarder (OpenZeppelin) | [`0xdf41D66aF04532A26e082978c01b4ea9c4955Eb3`](https://testnet.monadvision.com/address/0xdf41D66aF04532A26e082978c01b4ea9c4955Eb3) |
| oracle | AdminPriceOracle | [`0xE83B22b69d62e61170aC5b2B60ADdF91B5EA4B2d`](https://testnet.monadvision.com/address/0xE83B22b69d62e61170aC5b2B60ADdF91B5EA4B2d) |
| tusd | TestStable (testnet dollar) | [`0x3258CB92edc5AF449B865dc091b7f770f52a2f2C`](https://testnet.monadvision.com/address/0x3258CB92edc5AF449B865dc091b7f770f52a2f2C) |

## Run locally

Requires Node 22+, pnpm and Foundry.

```bash
pnpm install
cd contracts && forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 foundry-rs/forge-std --no-git && cd ..
```

### Against a local chain

Run each in its own terminal:

```bash
pnpm chain
```

```bash
pnpm deploy:local
```

```bash
pnpm relay
```

```bash
pnpm bootstrap
```

```bash
pnpm web
```

Open http://localhost:3000 and create an account with a passkey.

`pnpm bootstrap` creates only what the protocol needs: the operator account (@monsoc, which runs the default labeler) and the default feeds. For sample accounts and posts, run `pnpm seed:demo` (local only; don't run it on a real deployment).

### Against Monad testnet

Uses the deployed contracts above. Keys live in gitignored `contracts/.env.testnet` and `apps/relay/.env.testnet` (templates: `.env.example`).

```bash
pnpm relay:testnet
```

```bash
pnpm web:testnet
```

### Tests

```bash
pnpm contracts:test
```

```bash
pnpm --filter @monsoc/sdk test
```

### Deploy your own

```bash
export MONAD_RPC_URL=https://testnet-rpc.monad.xyz
export DEPLOYER_KEY=0x...   # funded with testnet MON
export RELAY_ADDRESS=0x...  # the relay wallet (pays sponsored gas, posts roots)
pnpm deploy:testnet
```

Verify each contract (no API key needed) from `contracts/`:

```bash
forge verify-contract <address> src/CreatorMarkets.sol:CreatorMarkets --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

Hosting the relay on Railway and the web app on Vercel is covered step by step in [DEPLOY.md](DEPLOY.md).

### Live scouting demo (testnet)

Scout scores need reputable followers, and reputation needs account age. On testnet, `REPUTATION_WARMUP_HOURS=1` (in `apps/relay/.env.testnet`) shortens the warm-up from a week to an hour; scoring rules are unchanged.

1. **An hour before:** run `pnpm demo:scouts setup`. It creates @newcreator (profile, posts, a trial post in #ai, markets enabled) and four fans who each post, so they earn reputation. Keys go to `apps/relay/.demo-keys.json` (gitignored).
2. **Before going live:** post a few times as yourself (your reputation needs 50% to score) and check that `pnpm demo:scouts status` shows the fans as verified.
3. **Live:** find @newcreator's trial post in the AI feed and tap **Back** (optionally back YES on a milestone market too), then run `pnpm demo:scouts grow`. The fans follow one by one, **Scouts → Your picks** updates live, the leaderboard shows your score within about 15 seconds, and the score root is re-posted onchain within a minute.
