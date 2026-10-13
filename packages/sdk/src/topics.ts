import type { FeedDefinition } from "./feed";

/**
 * Shared topic list. A post belongs to a topic when the author tags it with the topic or one of its
 * related tags (#cricket counts for Sports). The composer offers these as chips; topic feeds match them.
 * A labeler (e.g. an AI one) can later add topics to untagged posts.
 */
export const TOPICS = [
  { id: "politics", label: "Politics", tags: ["politics", "elections", "policy", "government", "geopolitics"] },
  { id: "sports", label: "Sports", tags: ["sports", "cricket", "football", "ipl", "f1", "nba", "tennis", "olympics"] },
  { id: "tech", label: "Tech", tags: ["tech", "startups", "programming", "software", "hardware", "product"] },
  { id: "ai", label: "AI", tags: ["ai", "ml", "llm", "agents", "genai"] },
  { id: "crypto", label: "Crypto", tags: ["crypto", "web3", "monad", "defi", "ethereum", "bitcoin", "nft"] },
  { id: "finance", label: "Finance", tags: ["finance", "markets", "stocks", "investing", "economy"] },
  { id: "science", label: "Science", tags: ["science", "space", "physics", "biology", "climate"] },
  { id: "gaming", label: "Gaming", tags: ["gaming", "esports", "games"] },
  { id: "music", label: "Music", tags: ["music", "hiphop", "bollywood", "concerts"] },
  { id: "movies", label: "Movies & TV", tags: ["movies", "tv", "film", "series", "anime"] },
  { id: "design", label: "Design", tags: ["design", "ux", "ui", "art"] },
  { id: "health", label: "Health", tags: ["health", "fitness", "nutrition", "mentalhealth"] },
] as const;

export type TopicId = (typeof TOPICS)[number]["id"];

/** Topic ids a post belongs to, from its tags. */
export function topicsOf(tags: string[]): TopicId[] {
  const set = new Set(tags.map((t) => t.toLowerCase()));
  return TOPICS.filter((t) => t.tags.some((x) => set.has(x))).map((t) => t.id);
}

/** A single-topic feed: everyone's posts in the topic, replies 2x, no bait, 20% discovery. */
export function topicFeed(id: TopicId): FeedDefinition {
  const t = TOPICS.find((x) => x.id === id)!;
  return {
    version: 1,
    name: t.label,
    description: `Posts tagged ${t.tags.slice(0, 4).map((x) => `#${x}`).join(" ")}…, conversations first, no engagement bait.`,
    sources: { topics: [...t.tags] },
    filters: { includeTags: [...t.tags], excludeLabels: ["spam", "scam", "engagement-bait", "giveaway"] },
    weights: { likes: 1, replies: 2, reposts: 1, conversationDepth: 1, recencyHalfLifeHours: 12, reputation: 0.3 },
    discovery: 0.2,
  };
}
