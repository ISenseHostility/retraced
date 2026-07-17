import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CaptureEngine } from "../../capture/engine";
import { searchMessages } from "../../db/queries";
import type { MessageRow } from "../../db/schema";
import { tokenize } from "../../util/tokenize";
import { formatCount } from "../theme";

/**
 * Full-text search over the inverted index. Coverage IS the content rule:
 * your messages everywhere, both sides of DMs — other people's server
 * messages were never stored, so they cannot be searched.
 */

export interface ChannelOption {
  id: string;
  label: string;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Highlighted({ content, terms }: { content: string; terms: string[] }): ReactNode {
  const usable = terms.filter((t) => t.length >= 2);
  if (usable.length === 0) return content;
  const re = new RegExp(`(${usable.map(escapeRegExp).join("|")})`, "gi");
  const parts = content.split(re);
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

export function SearchCard({
  engine,
  fromTs,
  channels,
  channelLabel,
  authorLabel,
}: {
  engine?: CaptureEngine;
  fromTs: number | null;
  channels: ChannelOption[];
  channelLabel: (channelId: string) => string;
  authorLabel: (row: MessageRow) => string;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("");
  const [results, setResults] = useState<MessageRow[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const db = engine?.getDb();
    if (!db || tokenize(query).length === 0) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let alive = true;
    const timer = setTimeout(() => {
      searchMessages(db, {
        query,
        channelId: scope === "" ? undefined : scope,
        fromTs: fromTs ?? undefined,
      })
        .then((rows) => {
          if (alive) {
            setResults(rows);
            setSearching(false);
          }
        })
        .catch(() => {
          if (alive) setSearching(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [engine, query, scope, fromTs]);

  const terms = useMemo(() => tokenize(query), [query]);

  return (
    <section className="retraced-chart-card">
      <header className="retraced-chart-head">
        <div>
          <h3 className="retraced-chart-title">Search your history</h3>
          <p className="retraced-note">
            covers your messages everywhere and both sides of DMs — other people's server messages are never stored, so they can't be
            searched
          </p>
        </div>
      </header>
      <div className="retraced-search-controls">
        <input
          type="search"
          className="retraced-input"
          placeholder="type to search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search stored messages"
        />
        <select className="retraced-select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Limit to a channel">
          <option value="">everywhere</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {results === null ? (
        <p className="retraced-note retraced-search-hint">
          {searching ? "searching…" : "Results appear as you type — the current time range applies."}
        </p>
      ) : results.length === 0 ? (
        <div className="retraced-empty">
          <span className="retraced-empty-title">No matches</span>
          <span className="retraced-note">
            Nothing stored matches that. Remember: other people's server messages are never kept, so they never match.
          </span>
        </div>
      ) : (
        <ul className="retraced-search-results">
          {results.map((row) => (
            <li key={row.messageId} className="retraced-search-hit">
              <div className="retraced-search-meta">
                <span>{new Date(row.ts).toLocaleString()}</span>
                <span>·</span>
                <span>{channelLabel(row.channelId)}</span>
                <span>·</span>
                <span>{authorLabel(row)}</span>
                {row.deletedAt !== null ? <span className="retraced-chip">deleted</span> : null}
                {row.editCount > 0 ? <span className="retraced-chip">edited</span> : null}
              </div>
              <div className="retraced-search-content">
                <Highlighted content={row.content ?? ""} terms={terms} />
              </div>
            </li>
          ))}
          {results.length >= 50 ? <li className="retraced-note">first {formatCount(50)} matches shown — narrow the search for more</li> : null}
        </ul>
      )}
    </section>
  );
}
