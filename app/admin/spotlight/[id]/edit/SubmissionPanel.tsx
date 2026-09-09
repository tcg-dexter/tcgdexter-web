"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SUBMISSION_STATUS_META } from "@/app/spotlight/statusMeta";
import type {
  SpotlightCardRef,
  SpotlightPokemonRef,
  SpotlightQA,
  SpotlightSubmission,
  SpotlightSubmissionStatus,
} from "@/app/spotlight/types";

/** What the panel can push into the editor's form state. Each handler is the
 *  setter for the matching published field, so "copy" is a plain assignment —
 *  no transform, because the submission reuses the published shapes. */
export interface CopyTargets {
  setHeadline: (v: string) => void;
  setBio: (v: string) => void;
  setFavoritePokemon: (v: SpotlightPokemonRef | null) => void;
  setCollectionCards: (v: SpotlightCardRef[]) => void;
  setPlayCards: (v: SpotlightCardRef[]) => void;
  setQa: (v: SpotlightQA[]) => void;
  setDeckIds: (v: string[]) => void;
}

interface Props {
  spotlightId: string;
  username: string | null;
  status: SpotlightSubmissionStatus;
  submission: SpotlightSubmission;
  submittedAt: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  copy: CopyTargets;
  /** Deck ids → names, so submitted decks read as titles, not uuids. */
  deckNames: Record<string, string>;
  /** Called after a status change, so the editor can drop its unsaved-state
   *  warning and re-read the row. */
  onStatusChange: () => void;
}

/**
 * Admin view of what the featured trainer submitted through
 * /spotlight/onboarding, plus the controls that drive the lifecycle.
 *
 * The submission is deliberately read-only here and copied field by field
 * into the editor rather than bulk-applied on arrival: a trainer can still
 * revise and resubmit after a reopen, and a silent overwrite would throw away
 * editing already done. Copying only touches form state — nothing persists
 * until Save.
 */
export default function SubmissionPanel({
  spotlightId,
  username,
  status,
  submission,
  submittedAt,
  approvedAt,
  approvalNote,
  copy,
  deckNames,
  onStatusChange,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const meta = SUBMISSION_STATUS_META[status];

  async function setStatus(next: SpotlightSubmissionStatus, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/spotlight/${spotlightId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission_status: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Update failed");
      onStatusChange();
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  function markCopied(key: string) {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }

  function copyAll() {
    if (submission.headline) copy.setHeadline(submission.headline);
    if (submission.intro) copy.setBio(submission.intro);
    if (submission.favorite_pokemon) {
      copy.setFavoritePokemon(submission.favorite_pokemon);
    }
    if (submission.collection_cards.length) {
      copy.setCollectionCards(submission.collection_cards);
    }
    if (submission.play_cards.length) copy.setPlayCards(submission.play_cards);
    if (submission.answers.length) copy.setQa(submission.answers);
    if (submission.deck_ids.length) copy.setDeckIds(submission.deck_ids);
    markCopied("all");
  }

  const hasContent =
    !!submission.intro ||
    !!submission.headline ||
    submission.answers.length > 0 ||
    submission.collection_cards.length > 0 ||
    submission.play_cards.length > 0 ||
    !!submission.favorite_pokemon ||
    !!submission.avatar_upload_url;

  return (
    <section className="rounded-2xl border border-black/8 bg-white p-5 shadow-sm space-y-4 dark:border-white/10 dark:bg-surface-elevated">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary">
              Trainer submission
            </h3>
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.pill}`}
            >
              {meta.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted max-w-prose">{meta.blurb}</p>
          {submittedAt && (
            <p className="mt-1 text-xs text-text-muted">
              Submitted {new Date(submittedAt).toLocaleString()}
            </p>
          )}
          {approvedAt && (
            <p className="text-xs text-text-muted">
              Approved {new Date(approvedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {error && <span className="text-xs text-accent">{error}</span>}
          {status === "not_invited" && (
            <button
              type="button"
              onClick={() => setStatus("invited")}
              disabled={busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg gradient-brand shadow-sm hover:opacity-95 disabled:opacity-50"
            >
              Invite
            </button>
          )}
          {(status === "submitted" || status === "approved") && (
            <button
              type="button"
              onClick={() =>
                setStatus(
                  "in_review",
                  "Send the edited spotlight to the trainer for approval? Their answers lock while they review.",
                )
              }
              disabled={busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg gradient-brand shadow-sm hover:opacity-95 disabled:opacity-50"
            >
              Send for approval
            </button>
          )}
          {status !== "not_invited" && status !== "invited" && (
            <button
              type="button"
              onClick={() =>
                setStatus(
                  "invited",
                  "Reopen the form for the trainer? They'll be able to edit and resubmit.",
                )
              }
              disabled={busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-black/15 text-text-primary hover:bg-[var(--surface)] disabled:opacity-50 dark:border-white/10"
            >
              Reopen
            </button>
          )}
        </div>
      </div>

      {status === "not_invited" ? null : (
        <>
          {approvalNote && (
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Note from the trainer
              </p>
              <p className="mt-1 text-sm text-text-primary whitespace-pre-line">
                {approvalNote}
              </p>
            </div>
          )}

          {!hasContent ? (
            <p className="text-xs text-text-muted">
              Nothing submitted yet. They fill this out at{" "}
              <code>/spotlight/onboarding</code>
              {username ? ` — send @${username} the link.` : "."}
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={copyAll}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-black text-text-primary hover:bg-[var(--surface)] dark:border-white"
                >
                  {copied === "all" ? "Copied ✓" : "Copy all to spotlight"}
                </button>
              </div>

              {submission.avatar_upload_url && (
                <Block title="TCG Live screenshot">
                  {/* eslint-disable-next-line @next/next/no-img-element --
                      Supabase storage URL with a cache-busting query. */}
                  <img
                    src={submission.avatar_upload_url}
                    alt="Trainer's TCG Live avatar screenshot"
                    className="max-h-56 rounded-lg border border-black/10 dark:border-white/10"
                  />
                  <a
                    href={submission.avatar_upload_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-xs font-semibold text-accent hover:underline"
                  >
                    Open full size
                  </a>
                  <p className="mt-1 text-xs text-text-muted">
                    Raw upload — cut out the subject and use the Banner image
                    uploader below for the published version.
                  </p>
                </Block>
              )}

              {submission.headline && (
                <Block
                  title="Headline"
                  action={
                    <CopyButton
                      copied={copied === "headline"}
                      onClick={() => {
                        copy.setHeadline(submission.headline);
                        markCopied("headline");
                      }}
                    />
                  }
                >
                  <p className="text-sm text-text-primary">
                    {submission.headline}
                  </p>
                </Block>
              )}

              {submission.intro && (
                <Block
                  title="Introduction"
                  action={
                    <CopyButton
                      label="Copy to Bio"
                      copied={copied === "intro"}
                      onClick={() => {
                        copy.setBio(submission.intro);
                        markCopied("intro");
                      }}
                    />
                  }
                >
                  <p className="text-sm text-text-primary whitespace-pre-line">
                    {submission.intro}
                  </p>
                </Block>
              )}

              {submission.favorite_pokemon && (
                <Block
                  title="Favorite Pokémon"
                  action={
                    <CopyButton
                      copied={copied === "pokemon"}
                      onClick={() => {
                        copy.setFavoritePokemon(submission.favorite_pokemon);
                        markCopied("pokemon");
                      }}
                    />
                  }
                >
                  <p className="text-sm text-text-primary">
                    {submission.favorite_pokemon.name}
                  </p>
                </Block>
              )}

              {submission.collection_cards.length > 0 && (
                <Block
                  title="Favorite cards — Collection"
                  action={
                    <CopyButton
                      copied={copied === "collection"}
                      onClick={() => {
                        copy.setCollectionCards(submission.collection_cards);
                        markCopied("collection");
                      }}
                    />
                  }
                >
                  <CardList cards={submission.collection_cards} />
                </Block>
              )}

              {submission.play_cards.length > 0 && (
                <Block
                  title="Favorite cards — Play"
                  action={
                    <CopyButton
                      copied={copied === "play"}
                      onClick={() => {
                        copy.setPlayCards(submission.play_cards);
                        markCopied("play");
                      }}
                    />
                  }
                >
                  <CardList cards={submission.play_cards} />
                </Block>
              )}

              {submission.answers.length > 0 && (
                <Block
                  title={`Interview answers (${submission.answers.length})`}
                  action={
                    <CopyButton
                      label="Copy to Q&A"
                      copied={copied === "answers"}
                      onClick={() => {
                        copy.setQa(submission.answers);
                        markCopied("answers");
                      }}
                    />
                  }
                >
                  <div className="space-y-3">
                    {submission.answers.map((item, i) => (
                      <div key={i}>
                        <p className="text-xs font-semibold text-text-secondary">
                          {item.q}
                        </p>
                        <p className="mt-0.5 text-sm text-text-primary whitespace-pre-line">
                          {item.a}
                        </p>
                      </div>
                    ))}
                  </div>
                </Block>
              )}

              {submission.deck_ids.length > 0 && (
                <Block
                  title="Featured decks"
                  action={
                    <CopyButton
                      copied={copied === "decks"}
                      onClick={() => {
                        copy.setDeckIds(submission.deck_ids);
                        markCopied("decks");
                      }}
                    />
                  }
                >
                  <ul className="text-sm text-text-primary list-disc pl-4">
                    {submission.deck_ids.map((id) => (
                      <li key={id}>{deckNames[id] ?? id}</li>
                    ))}
                  </ul>
                </Block>
              )}

              {submission.list_short_ids.length > 0 && (
                <Block title="Card lists">
                  {/* No published slot for lists — surfaced here for reference
                      so they can be worked into the copy by hand. */}
                  <ul className="text-sm text-text-primary space-y-0.5">
                    {submission.list_short_ids.map((shortId) => (
                      <li key={shortId}>
                        {username ? (
                          <a
                            href={`/u/${username}/lists/${shortId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline"
                          >
                            /u/{username}/lists/{shortId}
                          </a>
                        ) : (
                          shortId
                        )}
                      </li>
                    ))}
                  </ul>
                </Block>
              )}

              {submission.notes && (
                <Block title="Anything else">
                  <p className="text-sm text-text-primary whitespace-pre-line">
                    {submission.notes}
                  </p>
                </Block>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Block({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-black/8 p-3 dark:border-white/10">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {title}
        </h4>
        {action}
      </div>
      {children}
    </div>
  );
}

function CopyButton({
  onClick,
  copied,
  label = "Copy to spotlight",
}: {
  onClick: () => void;
  copied: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 text-xs font-semibold text-accent hover:underline"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

function CardList({ cards }: { cards: SpotlightCardRef[] }) {
  return (
    <ul className="space-y-2">
      {cards.map((card, i) => (
        <li key={`${card.set_id}-${card.number}-${i}`}>
          <p className="text-sm text-text-primary">
            {card.name}{" "}
            <span className="text-text-muted">
              {card.set_id} {card.number}
            </span>
          </p>
          {card.caption && (
            <p className="text-xs text-text-secondary whitespace-pre-line">
              {card.caption}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
