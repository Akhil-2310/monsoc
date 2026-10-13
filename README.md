# Monsoc: an open social protocol on Monad

People, not platforms, own their identity, their audience and their feed. One identity, one shared graph, a thousand competing clients and algorithms.

```
apps/web        Next.js default client (fork it: edit monsoc.config.ts, deploy)
apps/relay      relay + indexer + gas sponsor + jobs (one Node process, SQLite)
packages/sdk    TypeScript SDK: messages, feed engine, merkle, meta-tx, scouts, payouts
contracts       Foundry: the 8 onchain pieces + Signup bundler
```

## Quick start (local chain)

Requires Node 22+, pnpm, Foundry.

```bash
pnpm install
cd contracts && forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 foundry-rs/forge-std --no-git && cd ..
```

Then, in separate terminals:

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
pnpm seed
```

```bash
pnpm web
```

Open http://localhost:3000. On the sign-up page you can create a fresh account, or click a seeded demo account (`@sam`, `@ira`, …).

`pnpm seed` builds a living network through the real protocol paths: 16 creators, an onchain follow graph, 7 feeds (6 rule-based, 1 paid hosted), 6 communities covering every join type, posts and conversations, an A/B trial reel, Backs, views and chat.

Tests:

```bash
pnpm contracts:test
```

```bash
pnpm --filter @monsoc/sdk test
```

## Monad testnet

```bash
export MONAD_RPC_URL=https://testnet-rpc.monad.xyz
export DEPLOYER_KEY=0x...   # funded with testnet MON
export RELAY_ADDRESS=0x...  # the relay wallet (pays sponsored gas, posts roots)
pnpm deploy:testnet
```

Run the relay with `CHAIN_ID=10143 RPC_URL=$MONAD_RPC_URL RELAY_PRIVATE_KEY=0x... PUBLIC_URL=https://your-relay pnpm relay`. Run the web app with `NEXT_PUBLIC_CHAIN_ID=10143 NEXT_PUBLIC_RPC_URL=... NEXT_PUBLIC_RELAY_URL=... NEXT_PUBLIC_DEMO_LOGINS=false`.

## What's built

| Spec area | Where |
|---|---|
| Identity registry: fid, custody, recovery, handles | `contracts/src/IdentityRegistry.sol` |
| App keys: scoped, expiring, revocable, multi key-type | `contracts/src/AppKeyRegistry.sol` |
| One-signature signup (ID + handle + app key) | `contracts/src/Signup.sol` |
| Follow graph: timestamps, batching, daily rate limits | `contracts/src/FollowGraph.sol` |
| Feed registry: versioned definitions, pricing, discovery range | `contracts/src/FeedRegistry.sol` |
| Payments: USD pricing, MON via oracle or stablecoin, splits, Merkle payouts, tips, memberships | `contracts/src/Payments.sol` |
| Anchor: Merkle roots of content, `verify()`, escape hatch | `contracts/src/Anchor.sol` |
| Communities: open, token-gated, invite-only, paid; roles, bans | `contracts/src/CommunityRegistry.sol` |
| Scout score roots | `contracts/src/ScoutRegistry.sol` |
| Sponsored gas (no MON needed) | OZ `ERC2771Forwarder` + `apps/relay/src/sponsor.ts` |
| Signed message format | `packages/sdk/src/message.ts` |
| Rule-based feed engine + discovery slots + trials + A/B split | `packages/sdk/src/feed.ts` |
| Relay validation, sync between relays, anchoring | `apps/relay/src/messages.ts`, `anchor.ts` |
| Indexer + read API | `apps/relay/src/indexer.ts`, `api.ts` |
| Labeler (spam, scams, bait, giveaways) | `apps/relay/src/jobs.ts` (`classify`) |
| Reputation, scout scores, trial auto-release, epoch payouts | `apps/relay/src/jobs.ts`, `packages/sdk/src/scout.ts`, `payout.ts` |
| Wallet-seeded onboarding + starter packs | `GET /v1/onboarding/:address` |
| Example hosted feed | `GET /hosted/high-signal` |

### How a request flows

* **Sign up.** The custody (passkey account) signs one EIP-712 `Signup`. The relay submits it and pays gas. The fid, handle and app key are created in one transaction.
* **Follow, join, subscribe, create a feed.** The app key signs an ERC-2771 `ForwardRequest`. The relay checks the target, the fid's daily budget and dry-runs the call, then submits through the forwarder. Contracts see the app key, check its scope for the fid, and the UI flips optimistically.
* **Post, like, reply, Back, view, chat.** These are signed messages to the relay. It checks the signature, that the key is active, the clock, the sequence number, rate limits and membership. Every few minutes it Merkle-roots new messages (not chat) onto `Anchor`. Any post page has a "Verify onchain" button.
* **Paid feeds.** Each subscriber's creator share is split across the creators *they* viewed, using views signed by their own app key, so a hosted feed can't misreport. One root is posted per epoch, and creators claim with a proof.

## Design decisions to review

* **Custody provider.** `apps/web/lib/custody.ts` ships a burner key (dev) and seeded demo logins. A passkey wallet (Privy, Mera, …) plugs in by implementing `connect()` → `{ address, signTypedData }`. Contracts verify custody signatures with ERC-1271, so smart accounts work, but the account **must be deployed** before signing (OZ `SignatureChecker` doesn't do ERC-6492).
* **Feed and community metadata** go onchain as `data:` URIs for zero-dependency demos. Use `ipfs://` in production: the indexer already resolves it.
* **The test stablecoin trusts the forwarder** so app keys can approve gaslessly. With real USDC, use EIP-2612 / EIP-3009 permits instead.
* **MON price** comes from `AdminPriceOracle`, an operator-set testnet stand-in for a real oracle or DEX TWAP (open question in the spec).
* **Sponsored requests can't carry value.** MON payments must come from the user's own wallet; stablecoin payments are fully gasless.
* **Payout reputation gate.** Paid subscribers count fully, since it's their own money. Reputation weighting applies to free signals (discovery, scouts, labeler trust).
* **Not built (per the roadmap):** creator shares, milestone markets, and encrypted DMs/group chats (v2: MLS/OpenMLS or XMTP). `KeyTypes.X25519` is reserved in the key registry for chat keys.
