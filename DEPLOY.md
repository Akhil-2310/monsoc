# Deploying Monsoc (Railway + Vercel)

Two services: the **relay** on Railway (long-running Node + SQLite on a volume) and the **web app** on Vercel. Contracts are already on Monad testnet (`contracts/deployments/10143.json`) and media is on ImageKit.

> **Passkeys are bound to one domain.** Set `NEXT_PUBLIC_PASSKEY_RP_ID` to the production domain (e.g. `monsoc.vercel.app`) before anyone signs up, and never change it. Accounts created on `localhost` or per-deploy preview URLs won't carry over.

## 1. Relay on Railway

1. **New Project → Deploy from GitHub repo →** `Akhil-2310/monsoc`. `railway.json` makes Railway build `apps/relay/Dockerfile` and health-check `/health`.
2. **Add a volume** to the service with mount path **`/data`** (the database lives at `/data/relay.db`).
3. **Variables** (service → Variables). Copy values from your local `apps/relay/.env.testnet`; never commit them:

   | Variable | Value |
   |---|---|
   | `CHAIN_ID` | `10143` |
   | `RPC_URL` | `https://testnet-rpc.monad.xyz` (or a dedicated Monad RPC) |
   | `RELAY_PRIVATE_KEY` | relay wallet key (pays sponsored gas) |
   | `LABELER_PRIVATE_KEY` | labeler/operator app key |
   | `IMAGEKIT_URL_ENDPOINT`, `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY` | from ImageKit |
   | `PUBLIC_URL` | the relay's public URL, e.g. `https://relay.yourdomain.xyz` |
   | `LOG_RANGE` | `100` |
   | `INDEX_INTERVAL_MS` | `1500` |
   | `ANCHOR_INTERVAL_MS` | `180000` |
   | `JOBS_INTERVAL_MS` | `15000` |
   | `REPUTATION_WARMUP_HOURS` | `1` for demos, `168` for real use |
   | `SCOUT_ROOT_INTERVAL_MS` | `60000` |

   Don't set `PORT` (Railway provides it) or `DB_PATH` (the Dockerfile sets `/data/relay.db`).
4. **Networking → Generate Domain** (or add a custom domain like `relay.yourdomain.xyz` with the CNAME Railway shows). Make sure `PUBLIC_URL` matches it, then redeploy.
5. Check `https://<relay-domain>/health` returns `{"ok":true,...}`. On first boot the relay re-indexes everything onchain from the deployment block (accounts, follows, feeds, communities, markets); this takes a minute or two.

**Existing data.** Onchain state is re-indexed automatically. Offchain data (posts, likes, chat) from your local relay isn't; start fresh (recommended once you have a real domain) or copy `apps/relay/relay-testnet.db` into the volume.

## 2. Web app on Vercel

1. **Add New → Project →** import `Akhil-2310/monsoc`.
2. **Root Directory:** `apps/web` (framework auto-detects as Next.js; pnpm workspace is detected from the root lockfile).
3. **Environment variables** (they're baked in at build time, so redeploy after changing them):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_RELAY_URL` | `https://<relay-domain>` |
   | `NEXT_PUBLIC_CHAIN_ID` | `10143` |
   | `NEXT_PUBLIC_RPC_URL` | `https://testnet-rpc.monad.xyz` |
   | `NEXT_PUBLIC_PASSKEY_RP_ID` | your production domain without `https://`, e.g. `monsoc.vercel.app` |

4. **Deploy**, then **Settings → Domains →** add your domain and set the DNS records Vercel shows.

## 3. After both are live

1. Point the onchain "High signal" feed at the public relay (it was registered with `localhost`). Run locally:
   ```bash
   cd apps/relay && PUBLIC_URL=https://<relay-domain> pnpm bootstrap:testnet
   ```
2. Open the site on the final domain and test: passkey sign-up (Safari / Chrome with iCloud Keychain or 1Password), post with a photo, follow, open a market, back it, community chat.
3. Keep an eye on the relay wallet balance (it pays everyone's gas): `0x2d90F06B039F3Fd1653EC69173FefBc3C3dd7ecC`.
4. Optional: snapshot the Railway volume regularly (it holds posts, likes, chat).

## Moving to a new domain later

Accounts and data aren't tied to the domain (they're onchain and on the relay), but passkeys are. To move from `monsoc.vercel.app` to `monsoc.xyz` without breaking existing logins:

1. Keep `NEXT_PUBLIC_PASSKEY_RP_ID=monsoc.vercel.app` on the new deployment too.
2. On the **original** deployment (`monsoc.vercel.app`, keep it running) set `PASSKEY_RELATED_ORIGINS=https://monsoc.xyz` and redeploy. It then serves `/.well-known/webauthn` listing the new origin, and Chrome/Safari let the new site use the old passkeys (WebAuthn Related Origin Requests).

Users can also protect themselves with a **backup passkey** (Wallet & keys → Account recovery), which can take over the account if the main passkey is lost.
