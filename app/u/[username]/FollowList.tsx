"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FollowListUser } from "@/app/api/follows/[userId]/route";
import type { FollowPanelKind } from "./FollowPanel";

interface Props {
  kind: FollowPanelKind;
  targetUserId: string;
  /** Whose profile this is — for the panel's subtitle. */
  username: string;
  displayName: string;
  onClose: () => void;
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; users: FollowListUser[] };

/**
 * In-place followers / following list. Rendered by FollowPanelBody in place
 * of the profile's main body when a count is clicked; the close button
 * restores the profile. Clicking a row navigates to that trainer's profile.
 */
export default function FollowList({
  kind,
  targetUserId,
  username,
  displayName,
  onClose,
}: Props) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/follows/${targetUserId}?type=${kind}`)
      .then(async (res) => {
        const body = (await res.json()) as {
          users?: FollowListUser[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setState({
            status: "error",
            message: body.error ?? "Couldn't load this list.",
          });
          return;
        }
        setState({ status: "ready", users: body.users ?? [] });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "error", message: "Couldn't load this list." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind, targetUserId]);

  const title = kind === "followers" ? "Followers" : "Following";
  const emptyCopy =
    kind === "followers"
      ? `${displayName} doesn't have any followers yet.`
      : `${displayName} isn't following anyone yet.`;

  return (
    <div>
      {/* Header — title + @handle context, with an inline close button that
          restores the profile body. No card container: just a header row
          over a plain list. */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-black/8 dark:border-white/10">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text-primary leading-tight">
            {title}
          </h2>
          <p className="text-xs text-text-muted truncate">@{username}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()} list`}
          className="flex items-center justify-center w-8 h-8 rounded-full text-text-muted hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {state.status === "loading" && (
        <div className="py-10 text-center text-sm text-text-muted">Loading…</div>
      )}

      {state.status === "error" && (
        <div className="py-10 text-center">
          <p className="text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.status === "ready" && state.users.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-sm text-text-secondary">{emptyCopy}</p>
        </div>
      )}

      {state.status === "ready" && state.users.length > 0 && (
        <ul className="divide-y divide-black/6 dark:divide-white/8">
          {state.users.map((u) => (
            <li key={u.id}>
              <Link
                href={`/u/${u.username}`}
                onClick={onClose}
                className="flex items-center gap-3 -mx-2 px-2 py-3 rounded-lg hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors"
              >
                <Avatar url={u.avatar_url} name={u.display_name} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">
                    {u.display_name}
                  </p>
                  <p className="text-xs text-text-muted truncate">
                    @{u.username}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Small round avatar — sprite image when present, first initial otherwise. */
function Avatar({ url, name }: { url: string | null; name: string }) {
  return (
    <span className="relative flex items-center justify-center w-10 h-10 rounded-full overflow-hidden bg-surface dark:bg-surface-2 shrink-0">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="w-8 h-8 object-contain" />
      ) : (
        <span className="text-sm font-semibold text-text-secondary">
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
    </span>
  );
}
