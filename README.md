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
pnpm bootstrap
```

```bash
pnpm web
```

Open http://localhost:3000 and create an account with a passkey.

`pnpm bootstrap` creates only what the protocol needs: the operator account (@monsoc, which runs the default labeler) and the default feeds. There's no sample data. For a local demo with sample accounts and posts, `pnpm seed:demo` is still available; don't run it on a real deployment.

Tests:

```bash
pnpm contracts:test
```

```bash
pnpm --filter @monsoc/sdk test
```

## Deployed: Monad testnet (chain 10143)

Deployed from block 70755753. Explorer: https://testnet.monadexplorer.com

| Contract | Address |
|---|---|
| identity | `0x4174F8D9876899195a6628C011002D99371B3355` |
| appKeys | `0x7510BE2dAB2C04f62699F49eD1c3f6f10d503Cb5` |
| signup | `0x8eBCC90671b7081915fB00D9450edbEf8b2953b6` |
| follows | `0x20957Bc80a020DA6050D61AEAfC1Ffcd99a26E4E` |
| feeds | `0x30b934F8fef8c8A1B1B091BeCbc93AEa5f57f5B0` |
| payments | `0xCb3495cB6975b13e43e218a85c54426115A2CD5B` |
| anchor | `0x9e23BfDF68d205A9d45Bc24cE8acb0faE63485fe` |
| communities | `0x745E4474D8393a9596E5c0297cDF9ecf6D329e8b` |
| scouts | `0xf27EF7D19DcABea9EE4C29d7D178bB194cFCfD2e` |
| forwarder | `0xdf41D66aF04532A26e082978c01b4ea9c4955Eb3` |
| oracle | `0xE83B22b69d62e61170aC5b2B60ADdF91B5EA4B2d` |
| tusd | `0x3258CB92edc5AF449B865dc091b7f770f52a2f2C` |

Run against it locally:

```bash
pnpm relay:testnet
```

```bash
pnpm web:testnet
```

Keys live in gitignored `contracts/.env.testnet` and `apps/relay/.env.testnet` (templates: `.env.example`).

## Deploying to Monad testnet yourself

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
| **Milestone markets on creators** ("will @x reach N followers by date?"), settled from the follow graph with no oracle | `contracts/src/CreatorMarkets.sol`, keeper in `apps/relay/src/markets.ts`, UI at `/markets` |
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

* **Passkeys via [Mera](https://mera.category.xyz/).** `apps/web/lib/custody.ts`: a passkey's PRF output derives two keys. The **custody** key (`m/44'/60'/0'/0/0`) controls the identity, lives only inside a Mera signing session during sign-up and sign-in, and is never stored. The **app key** (`m/44'/60'/0'/0/1`) is scoped and revocable, cached by the client, and re-derived on any device the passkey syncs to, so a new device needs no extra signature. Custody is a plain EOA, so no smart-account deployment and no ERC-1271 caveats. Needs HTTPS (or localhost) and a PRF-capable authenticator (iCloud Keychain, 1Password, Google Password Manager). `NEXT_PUBLIC_DEV_KEY_LOGIN=true` adds a browser-key fallback for testing.
* **Passkeys are domain-bound.** A forked client on another domain gets a different passkey, so it would see a different identity. Before other clients launch, add WebAuthn Related Origin Requests (`/.well-known/webauthn` listing allowed origins), or a "sign in with your home client" flow where the home client's custody signs `AddKey` for the new client.
* **Media via ImageKit.** Browsers upload directly to ImageKit with a 10-minute token the relay signs (`POST /v1/media/auth`) after checking the request is signed by an active app key; the private key never leaves the relay, and uploads are limited to 30 per account per hour. Posts store the URL **plus the file's SHA-256**, so any client can detect a swapped file, and media can later be mirrored to IPFS without changing posts. Set `IMAGEKIT_URL_ENDPOINT`, `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY` in the relay env; without them, uploads are hidden and link-pasting still works.
* **Feed and community metadata** go onchain as `data:` URIs for zero-dependency demos. Use `ipfs://` in production: the indexer already resolves it.
* **The test stablecoin trusts the forwarder** so app keys can approve gaslessly. With real USDC, use EIP-2612 / EIP-3009 permits instead.
* **MON price** comes from `AdminPriceOracle`, an operator-set testnet stand-in for a real oracle or DEX TWAP (open question in the spec).
* **Sponsored requests can't carry value.** MON payments must come from the user's own wallet; stablecoin payments are fully gasless.
* **Payout reputation gate.** Paid subscribers count fully, since it's their own money. Reputation weighting applies to free signals (discovery, scouts, labeler trust).
* **Milestone markets.** Creators opt in (and can't bet on themselves). Stakes are time-weighted, 2x at open falling to 1x at the deadline, so backing a creator early earns more. Winners get their stake back plus the losing pool split by weight; 1% of the losing pool goes to the creator, 1% to the protocol. Settlement reads `FollowGraph` directly: anyone submits follower fids, the contract verifies each follow and counts it once; YES settles the moment the target is hit, NO at the deadline. Only accounts with `fid <= maxFid` (accounts that existed when the market opened) count, so new sybil accounts can't swing a market. The relay's keeper automates counting and settlement but holds no special power. Known limits: a creator could pre-create follower accounts before opening a market, and an attacker could follow with pre-existing accounts they control; reputation weighting (as in scout scores) is the next step. Testnet uses play money (tUSD); real money needs per-country legal review.
* **Not built (per the roadmap):** creator shares, and encrypted DMs/group chats (v2: MLS/OpenMLS or XMTP). `KeyTypes.X25519` is reserved in the key registry for chat keys.
