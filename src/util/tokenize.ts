/**
 * The one tokenizer behind the words rollup, the search index, and search
 * queries — all three MUST agree, or indexed terms become unfindable.
 */

const CUSTOM_EMOJI_RE = /<a?:\w+:\d+>/g;
const MENTION_RE = /<[@#][!&]?\d+>/g;
const URL_RE = /https?:\/\/\S+/gi;
const EDGE_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const MAX_TOKEN_LENGTH = 32;

export function tokenize(content: string): string[] {
  const cleaned = content.replace(CUSTOM_EMOJI_RE, " ").replace(MENTION_RE, " ").replace(URL_RE, " ");
  const out: string[] = [];
  for (const raw of cleaned.toLowerCase().split(/\s+/)) {
    const word = raw.replace(EDGE_RE, "");
    if (word.length === 0 || word.length > MAX_TOKEN_LENGTH) continue;
    out.push(word);
  }
  return out;
}

/** Consecutive token pairs, space-joined — "phrases" in the words store. */
export function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}
