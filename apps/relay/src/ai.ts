/**
 * AI features (optional; off unless ANTHROPIC_API_KEY is set):
 *  - topic labeler: reads new posts and publishes `topic:<id>` labels (plus spam/bait/scam flags)
 *    as the default labeler, so topic feeds catch posts that have no hashtags.
 *  - feed builder: turns "I want to see posts about sports" into a FeedDefinition the client runs
 *    with the normal feed engine. Claude only writes the rules; it never picks or invents posts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Hex } from "viem";
import { TOPICS, DISCOVERY_MAX, DISCOVERY_MIN, type FeedDefinition, type TopicId } from "@monsoc/sdk";
import { config } from "./config";
import { all, run } from "./db";
import { publishLabels } from "./jobs";
import { RejectError } from "./messages";

const client = config.ai.apiKey ? new Anthropic({ apiKey: config.ai.apiKey }) : null;
export const aiEnabled = () => client !== null;

const TOPIC_IDS = TOPICS.map((t) => t.id) as [TopicId, ...TopicId[]];
const FLAGS = ["spam", "scam", "engagement-bait", "giveaway"] as const;
const TOPIC_GUIDE = TOPICS.map((t) => `- ${t.id} (${t.label}): e.g. ${t.tags.join(", ")}`).join("\n");

/** Shared request options: Claude Opus 5.5, low effort (these are short classification-style jobs), refusal fallback on. */
function base() {
  return {
    model: config.ai.model,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    output_config: { effort: "low" as const },
  };
}

// ------------------------------------------------------------------ topic labeler

const LABELER_SYSTEM = `You label posts on a social network so they show up in the right topic feeds.

Topics (use only these ids):
${TOPIC_GUIDE}

For each post, return:
- topics: 0-3 topic ids the post is clearly about. Judge by meaning, not just keywords ("what a finish to the match last night" is sports). Leave empty for small talk or anything that fits no topic.
- subjects: 0-3 specific subjects narrower than a topic, as single lowercase words (cricket, f1, football, ethereum, monad, llm). Only subjects the post is clearly about.
- flags: any of spam, scam (phishing, "connect wallet to claim", asks for seed phrases or keys), engagement-bait ("like if…", "follow for follow", "comment YES"), giveaway. Leave empty for normal posts.

Be conservative with flags: only flag what clearly matches.`;

const LabelResults = z.object({
  results: z.array(
    z.object({
      id: z.number().int(),
      topics: z.array(z.enum(TOPIC_IDS)),
      subjects: z.array(z.string()),
      flags: z.array(z.enum(FLAGS)),
    }),
  ),
});

let labeling = false;

/** Label one batch of not-yet-labeled posts (newest first). Returns how many posts were processed. */
export async function labelBatch(): Promise<number> {
  if (!client || labeling) return 0;
  labeling = true;
  try {
    const since = Date.now() - config.ai.backfillDays * 86_400_000;
    const rows = all<{ hash: Hex; text: string }>(
      `SELECT p.hash, p.text FROM posts p
       WHERE p.deleted = 0 AND p.ts >= ? AND length(trim(p.text)) > 0
         AND p.hash NOT IN (SELECT hash FROM ai_labeled)
       ORDER BY p.ts DESC LIMIT ?`,
      since,
      config.ai.batchSize,
    );
    if (!rows.length) return 0;

    const posts = rows.map((r, i) => ({ id: i, text: r.text.slice(0, 1000) }));
    const res = await client.beta.messages.parse({
      ...base(),
      max_tokens: 8000,
      system: LABELER_SYSTEM,
      messages: [{ role: "user", content: `Label these posts:\n${JSON.stringify(posts)}` }],
      output_config: { ...base().output_config, format: betaZodOutputFormat(LabelResults) },
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) {
      // don't retry the same batch forever: mark it done and move on
      console.warn(`[ai] labeler skipped a batch (${res.stop_reason})`);
    } else {
      for (const r of res.parsed_output.results) {
        const row = rows[r.id];
        if (!row) continue;
        const subjects = [...new Set(r.subjects.map((x) => x.toLowerCase().replace(/[^a-z0-9_]/g, "")).filter((x) => x && x.length <= 24))];
        const labels = [
          ...[...new Set(r.topics)].slice(0, 3).map((t) => `topic:${t}`),
          ...subjects.slice(0, 3).map((t) => `tag:${t}`),
          ...new Set(r.flags),
        ];
        if (labels.length) await publishLabels(row.hash, labels);
      }
    }
    const now = Date.now();
    for (const r of rows) run("INSERT OR IGNORE INTO ai_labeled(hash, ts) VALUES(?, ?)", r.hash, now);
    return rows.length;
  } finally {
    labeling = false;
  }
}

export function startAiLabeler() {
  if (!client) return console.log("[ai] ANTHROPIC_API_KEY not set; AI labeler and feed builder are off");
  console.log(`[ai] labeler on (${config.ai.model})`);
  const loop = async () => {
    let n = 0;
    let failed = false;
    try {
      n = await labelBatch();
      if (n) console.log(`[ai] labeled ${n} posts`);
    } catch (e) {
      failed = true;
      console.error("[ai] labeler:", (e as Error).message);
    }
    // keep going quickly while backfilling, poll otherwise, back off after an error
    setTimeout(loop, failed ? 60_000 : n === config.ai.batchSize ? 1_000 : config.ai.intervalMs);
  };
  setTimeout(loop, 5_000);
}

// ------------------------------------------------------------------ feed builder

const FeedSpec = z.object({
  name: z.string().describe("Short feed name, 1-4 words, e.g. 'Cricket & F1'"),
  summary: z.string().describe("One line shown to the user, e.g. 'Sports · this week · conversations first'"),
  topics: z.array(z.enum(TOPIC_IDS)).describe("Topic ids to include; empty means all topics"),
  tags: z.array(z.string()).describe("Specific subjects narrower than a topic, lowercase without #, e.g. cricket, f1. When set, only these subjects are shown"),
  excludeTags: z.array(z.string()).describe("Lowercase hashtags without # to hide, e.g. memes"),
  audience: z.enum(["everyone", "following"]).describe("'following' only when they ask for people they follow"),
  moreNewCreators: z.boolean().describe("True if they want new creators or people they don't follow yet"),
  ranking: z.enum(["balanced", "conversations", "popular", "latest"]),
  freshness: z.enum(["today", "this_week", "any"]),
  hideBait: z.boolean().describe("Hide engagement bait, spam and scams; true unless they ask otherwise"),
  includeReplies: z.boolean(),
  notes: z.string().describe("Anything in the request this feed can't do (e.g. a specific date range, languages), or empty"),
});
export type FeedSpec = z.infer<typeof FeedSpec>;

const BUILDER_SYSTEM = `You turn a person's request into settings for their social feed. The feed engine can only filter and rank posts by these settings; you never choose posts yourself.

Topics (use only these ids):
${TOPIC_GUIDE}

Guidance:
- Map subjects to topic ids. If they name something narrower (cricket, F1, a team, "monad"), put those in tags as single lowercase words (and still set the parent topic): the feed then shows only those subjects. Leave tags empty for a whole topic ("sports").
- "From people I follow" means audience=following. "New people", "people I don't follow", "discover" means moreNewCreators=true.
- "Real conversations", "discussions" means ranking=conversations. "Trending", "popular" means popular. "Latest", "newest" means latest.
- "Today" means freshness=today, "this week" or "recent" means this_week.
- If they refine an existing feed ("more cricket, less football"), start from the current settings and change only what they asked.
- Put anything you can't express into notes, briefly. Keep the summary short and plain.`;

/** Turn a feed spec into the protocol's FeedDefinition (deterministic, always valid). */
export function specToDefinition(s: FeedSpec): FeedDefinition {
  const clean = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase().replace(/^#/, "").replace(/[^a-z0-9_]/g, "")).filter(Boolean))].slice(0, 20);
  // named subjects narrow the feed to just those; otherwise include every tag of the chosen topics
  const topicTags = s.topics.flatMap((id) => [id, ...(TOPICS.find((t) => t.id === id)?.tags ?? [])]);
  const include = s.tags.length ? clean(s.tags) : clean(topicTags);
  const weights = {
    balanced: { likes: 1, replies: 2, reposts: 1, conversationDepth: 1, reputation: 0.3 },
    conversations: { likes: 0.5, replies: 4, reposts: 0.5, conversationDepth: 3, reputation: 0.3 },
    popular: { likes: 2, replies: 1, reposts: 2, conversationDepth: 0, reputation: 0.2 },
    latest: { likes: 0, replies: 0, reposts: 0, conversationDepth: 0, reputation: 0 },
  }[s.ranking];
  const halfLife = { today: 6, this_week: 48, any: 24 * 14 }[s.freshness];
  return {
    version: 1,
    name: s.name.slice(0, 40) || "My feed",
    description: s.summary.slice(0, 140),
    sources:
      s.audience === "following"
        ? { following: true }
        : include.length
          ? { topics: include }
          : { everyone: true },
    filters: {
      ...(include.length ? { includeTags: include } : {}),
      ...(s.excludeTags.length ? { excludeTags: clean(s.excludeTags) } : {}),
      ...(s.hideBait ? { excludeLabels: ["spam", "scam", "engagement-bait", "giveaway"] } : {}),
      includeReplies: s.includeReplies,
    },
    weights: { ...weights, recencyHalfLifeHours: halfLife },
    sort: s.ranking === "latest" ? "recent" : "score",
    discovery: Math.min(DISCOVERY_MAX, Math.max(DISCOVERY_MIN, s.moreNewCreators ? DISCOVERY_MAX : 0.2)),
  };
}

export async function buildFeed(prompt: string, previous?: FeedSpec): Promise<{ spec: FeedSpec; definition: FeedDefinition }> {
  if (!client) throw new RejectError("AI features are off on this relay");
  const content = previous
    ? `Current feed settings:\n${JSON.stringify(previous)}\n\nChange request: ${prompt}`
    : `Request: ${prompt}`;
  const res = await client.beta.messages
    .parse({
      ...base(),
      max_tokens: 4000,
      system: BUILDER_SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { ...base().output_config, format: betaZodOutputFormat(FeedSpec) },
    })
    .catch((e: unknown) => {
      // log the real error; show people something they can act on
      console.error("[ai] feed builder:", (e as Error).message);
      if (e instanceof Anthropic.RateLimitError) throw new RejectError("The AI is busy right now; try again in a moment");
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
        throw new RejectError("AI isn't set up correctly on this relay");
      throw new RejectError("The AI is unavailable right now; try again shortly");
    });
  if (res.stop_reason === "refusal") throw new RejectError("Couldn't build a feed for that request");
  if (!res.parsed_output) throw new RejectError("Couldn't understand that; try rephrasing");
  return { spec: res.parsed_output, definition: specToDefinition(res.parsed_output) };
}
