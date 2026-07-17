import { PendingBuffer } from "../aggregate/pending";
import { createReducerContext, reduceEvent } from "../aggregate/reducers";
import { isContentStorable } from "../capture/content-rule";
import type { CapturedEvent, ChannelRef, ContentTypeFlags, MessageCreatedEvent } from "../capture/types";
import { flushPending } from "../db/flush";
import type { RetracedDatabase } from "../db/schema";
import { analyzeContent } from "../capture/normalize";

/**
 * Dev-only synthetic data: fabricates a plausible slice of Discord life and
 * pushes it through the REAL reducer + flush pipeline, so charts can be built
 * against two years of data and the write path gets a volume test. Seeded and
 * deterministic. Never runs unless explicitly invoked from the dev tools.
 */

export const SYNTHETIC_OWN_ID = "1000";

export interface SyntheticOptions {
  days?: number;
  seed?: number;
  endTs?: number;
}

interface PeerProfile {
  id: string;
  chattiness: number;
  replyMeanMs: number;
  hesitancy: number;
}

const PEER_NAMES: Record<string, string> = {
  "2001": "alex",
  "2002": "sam",
  "2003": "jo",
  "2004": "max",
  "2005": "kit",
  "2006": "ren",
  "2007": "ash",
  "2008": "lee",
};

const PEERS: PeerProfile[] = [
  { id: "2001", chattiness: 1.0, replyMeanMs: 40_000, hesitancy: 0.10 },
  { id: "2002", chattiness: 0.8, replyMeanMs: 90_000, hesitancy: 0.22 },
  { id: "2003", chattiness: 0.6, replyMeanMs: 300_000, hesitancy: 0.05 },
  { id: "2004", chattiness: 0.5, replyMeanMs: 25_000, hesitancy: 0.15 },
  { id: "2005", chattiness: 0.4, replyMeanMs: 600_000, hesitancy: 0.30 },
  { id: "2006", chattiness: 0.3, replyMeanMs: 120_000, hesitancy: 0.08 },
  { id: "2007", chattiness: 0.25, replyMeanMs: 1_500_000, hesitancy: 0.12 },
  { id: "2008", chattiness: 0.2, replyMeanMs: 200_000, hesitancy: 0.18 },
];

const GUILD_CHANNELS: ChannelRef[] = [
  { channelId: "g1-general", guildId: "g1", kind: "guild" },
  { channelId: "g1-memes", guildId: "g1", kind: "guild" },
  { channelId: "g1-dev", guildId: "g1", kind: "guild" },
  { channelId: "g2-general", guildId: "g2", kind: "guild" },
  { channelId: "g2-offtopic", guildId: "g2", kind: "guild" },
  { channelId: "g3-lounge", guildId: "g3", kind: "guild" },
];

const VOICE_CHANNEL: ChannelRef = { channelId: "g1-vc", guildId: "g1", kind: "guild" };
const GROUP_DM: ChannelRef = { channelId: "group-1", guildId: null, kind: "group-dm" };
const GROUP_MEMBERS = ["2001", "2002", "2003"];

const dmChannel = (peerId: string): ChannelRef => ({ channelId: `dm-${peerId}`, guildId: null, kind: "dm" });

const WORDS = (
  "the a and but so anyway yeah no maybe lol haha nice cool wild okay sure right thanks sorry wait what when where " +
  "how why game play match stream video song album track code build bug test ship deploy server channel message " +
  "tomorrow tonight later soon week weekend morning coffee lunch dinner movie episode season book idea plan thing " +
  "work school class project deadline meeting call drive walk run gym sleep tired awake busy free home out back"
).split(" ");

const EMOJI_BANK = [
  { id: "900001", name: "pog" },
  { id: "900002", name: "kekw" },
  { id: "900003", name: "sadge" },
  { id: "900004", name: "hmm" },
  { id: "900005", name: "fire" },
  { id: "900006", name: "clown" },
  { id: "900007", name: "salute" },
  { id: "900008", name: "peepoLove" },
  { id: "900009", name: "monkaS" },
  { id: "900010", name: "gigachad" },
  { id: "900011", name: "catjam" },
  { id: "900012", name: "pepehands" },
];

const DOMAINS = ["youtube.com", "twitter.com", "github.com", "reddit.com", "twitch.tv", "spotify.com", "imgur.com", "wikipedia.org"];

const HOUR_WEIGHTS = [2, 1, 1, 1, 1, 1, 2, 3, 4, 5, 5, 5, 6, 6, 6, 7, 8, 9, 10, 12, 14, 13, 10, 5];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  (): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  zipf<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

function makeRng(seed: number): Rng {
  const base = mulberry32(seed) as Rng;
  base.int = (min, max) => min + Math.floor(base() * (max - min + 1));
  base.pick = (items) => items[Math.floor(base() * items.length)]!;
  base.zipf = (items) => items[Math.min(items.length - 1, Math.floor(items.length * Math.pow(base(), 2)))]!;
  base.chance = (p) => base() < p;
  return base;
}

const NO_FLAGS: ContentTypeFlags = { text: true, image: false, link: false, gif: false, sticker: false, attachment: false };

function makeContent(rng: Rng): string {
  const count = rng.int(2, 22);
  const words: string[] = [];
  for (let i = 0; i < count; i++) words.push(rng.pick(WORDS));
  return words.join(" ");
}

function makeMessage(
  rng: Rng,
  seq: { n: number },
  ts: number,
  channel: ChannelRef,
  authorId: string,
  extras: Partial<MessageCreatedEvent> = {}
): MessageCreatedEvent {
  const isOwn = authorId === SYNTHETIC_OWN_ID;
  let content = makeContent(rng);
  const customEmoji: MessageCreatedEvent["customEmoji"] = [];
  const domains: string[] = [];
  const flags = { ...NO_FLAGS };

  if (isOwn && rng.chance(0.07)) {
    const emoji = rng.zipf(EMOJI_BANK);
    content += ` <:${emoji.name}:${emoji.id}>`;
    customEmoji.push({ ...emoji });
  }
  if (rng.chance(0.05)) {
    const domain = rng.zipf(DOMAINS);
    content += ` https://${domain}/x${seq.n}`;
    domains.push(domain);
    flags.link = true;
  }
  if (rng.chance(0.04)) {
    flags.attachment = true;
    flags.image = true;
  }

  const analysis = analyzeContent(content);
  return {
    kind: "message-created",
    ts,
    channel,
    messageId: `syn-${seq.n++}`,
    authorId,
    isOwn,
    content: isContentStorable({ isOwn, channelKind: channel.kind }) ? content : null,
    chars: analysis.chars,
    words: analysis.words,
    contentTypes: flags,
    replyToId: null,
    replyToAuthorId: null,
    replyToTs: null,
    customEmoji,
    domains,
    ...extras,
  };
}

export function* generateSyntheticEvents(opts: SyntheticOptions = {}): Generator<CapturedEvent> {
  const days = opts.days ?? 730;
  const endTs = opts.endTs ?? Date.now();
  const rng = makeRng(opts.seed ?? 1);
  const seq = { n: 1 };

  for (let d = days - 1; d >= 0; d--) {
    const dayStart = new Date(endTs - d * 86_400_000);
    dayStart.setHours(0, 0, 0, 0);
    const weekday = dayStart.getDay();
    const dayFactor = (weekday === 0 || weekday === 5 || weekday === 6 ? 1.35 : 1) * (0.55 + rng() * 0.9);
    const conversationBudget = Math.round(9 * dayFactor);

    const dayEvents: CapturedEvent[] = [];

    for (let c = 0; c < conversationBudget; c++) {
      const hour = pickHour(rng);
      let ts = dayStart.getTime() + hour * 3_600_000 + rng.int(0, 3_599_000);

      const roll = rng();
      const channel = roll < 0.5 ? rng.pick(GUILD_CHANNELS) : roll < 0.85 ? dmChannel(rng.zipf(PEERS).id) : GROUP_DM;
      const isDm = channel.kind === "dm";
      const peer = isDm ? PEERS.find((p) => channel.channelId === `dm-${p.id}`)! : rng.zipf(PEERS);

      const length = rng.int(2, isDm ? 14 : 9);
      let lastAuthor: string | null = null;
      let lastOwnMessageId: string | null = null;

      for (let m = 0; m < length; m++) {
        const mine: boolean = isDm ? (lastAuthor === SYNTHETIC_OWN_ID ? rng.chance(0.35) : rng.chance(0.75)) : rng.chance(0.4);
        const authorId: string = mine
          ? SYNTHETIC_OWN_ID
          : isDm
            ? peer.id
            : rng.pick(channel.kind === "group-dm" ? GROUP_MEMBERS : PEERS.map((p) => p.id));
        const gap = mine ? rng.int(4_000, 120_000) : Math.round(peer.replyMeanMs * (0.3 + rng() * 1.6));
        ts += gap;

        if (mine) {
          const typingMs = rng.int(2_000, 45_000);
          dayEvents.push({
            kind: "typing-resolved",
            ts,
            channel,
            startedAt: ts - typingMs,
            durationMs: typingMs,
            committed: true,
            peerId: isDm ? peer.id : null,
          });
        }

        const extras: Partial<MessageCreatedEvent> = {};
        if (!isDm && mine && lastOwnMessageId === null && rng.chance(0.25) && lastAuthor) {
          // occasional explicit reply in guilds
          extras.replyToId = `syn-${seq.n - 1}`;
          extras.replyToAuthorId = lastAuthor;
          extras.replyToTs = ts - gap;
        }
        const message = makeMessage(rng, seq, ts, channel, authorId, extras);
        dayEvents.push(message);
        lastAuthor = authorId;
        if (mine) lastOwnMessageId = message.messageId;

        if (rng.chance(0.1)) {
          const reactorIsMe = !mine && rng.chance(0.5);
          dayEvents.push({
            kind: "reaction",
            ts: ts + rng.int(2_000, 60_000),
            channel,
            direction: 1,
            actorId: reactorIsMe ? SYNTHETIC_OWN_ID : peer.id,
            actorIsOwn: reactorIsMe,
            messageId: message.messageId,
            messageAuthorId: authorId,
            messageAuthorIsOwn: message.isOwn,
            emoji: rng.chance(0.5) ? { id: rng.zipf(EMOJI_BANK).id, name: "syn" } : { id: null, name: "👍" },
          });
        }

        if (mine && rng.chance(0.035)) {
          dayEvents.push({
            kind: "message-edited",
            ts: ts + rng.int(8_000, 300_000),
            channel,
            messageId: message.messageId,
            authorId,
            isOwn: true,
            content: message.content !== null ? `${message.content} (edited)` : null,
            editLatencyMs: rng.int(8_000, 300_000),
          });
        }
        if (mine && rng.chance(0.012)) {
          dayEvents.push({
            kind: "message-deleted",
            ts: ts + rng.int(20_000, 7_200_000),
            channelId: channel.channelId,
            guildId: channel.guildId,
            messageId: message.messageId,
          });
        }
      }

      // hesitation: typed at someone and never sent
      if (isDm && rng.chance(peer.hesitancy * 2)) {
        const abortMs = rng.int(3_000, 60_000);
        const abortTs = ts + rng.int(60_000, 1_800_000);
        dayEvents.push({
          kind: "typing-resolved",
          ts: abortTs,
          channel,
          startedAt: abortTs - abortMs,
          durationMs: abortMs,
          committed: false,
          peerId: peer.id,
        });
      }

      // reading time around guild conversations
      if (!isDm && rng.chance(0.8)) {
        dayEvents.push({
          kind: "dwell",
          ts: ts + 1_000,
          channel,
          durationMs: rng.int(60_000, 20 * 60_000),
        });
      }
    }

    if (rng.chance(0.3)) {
      const start = dayStart.getTime() + rng.int(18, 22) * 3_600_000;
      const seconds = rng.int(15 * 60, 90 * 60);
      const coPresent: Record<string, number> = {};
      for (let i = 0, n = rng.int(1, 3); i < n; i++) {
        coPresent[rng.zipf(PEERS).id] = rng.int(Math.round(seconds / 2), seconds);
      }
      dayEvents.push({ kind: "voice-segment", ts: start, channel: VOICE_CHANNEL, seconds, coPresent });
    }

    dayEvents.sort((a, b) => a.ts - b.ts);
    yield* dayEvents;
  }
}

function pickHour(rng: Rng): number {
  const total = HOUR_WEIGHTS.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let h = 0; h < 24; h++) {
    roll -= HOUR_WEIGHTS[h]!;
    if (roll <= 0) return h;
  }
  return 23;
}

export interface SyntheticStats {
  events: number;
  days: number;
}

export async function runSynthetic(
  db: RetracedDatabase,
  opts: SyntheticOptions & { onProgress?: (events: number) => void } = {}
): Promise<SyntheticStats> {
  const ctx = createReducerContext({
    ownUserId: SYNTHETIC_OWN_ID,
    settings: () => ({ conversationGapMinutes: 30 }),
    resolvePeerLabel: (id) => ({ label: PEER_NAMES[id] ?? `synth-${id}`, avatarHash: null }),
    dmRecipients: (channelId) =>
      channelId.startsWith("dm-") ? [channelId.slice(3)] : channelId === GROUP_DM.channelId ? [...GROUP_MEMBERS] : null,
  });

  let pending = new PendingBuffer();
  let events = 0;
  let lastTs = 0;

  for (const ev of generateSyntheticEvents(opts)) {
    reduceEvent(ev, pending, ctx);
    events++;
    lastTs = ev.ts;
    if (pending.events.length >= 2_000) {
      await flushPending(db, pending, { now: lastTs, heads: ctx.heads });
      pending = new PendingBuffer();
      opts.onProgress?.(events);
    }
  }
  await flushPending(db, pending, { now: lastTs || Date.now(), heads: ctx.heads });
  opts.onProgress?.(events);
  return { events, days: opts.days ?? 730 };
}
