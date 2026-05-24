import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import BackButton from "@/app/components/ui/BackButton";
import JudgeRulingForm from "./JudgeRulingForm";

export const metadata: Metadata = {
  title: "Rule Match — Admin",
};

interface EvidenceRow {
  id: string;
  image_path: string;
  note: string | null;
  submitted_by_user_id: string;
  created_at: string;
  signed_url: string | null;
}

export default async function AdminMatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/admin/matches/${id}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) redirect("/");

  const { data: match } = await supabase
    .from("shared_matches")
    .select(
      `id, creator_user_id, creator_decklist_id, creator_result,
       opponent_user_id, opponent_decklist_id, opponent_result,
       status, final_outcome, judge_ruled, finalized_at, created_at`
    )
    .eq("id", id)
    .maybeSingle();

  if (!match) notFound();

  const userIds = [match.creator_user_id, match.opponent_user_id].filter(
    Boolean
  ) as string[];
  const deckIds = [match.creator_decklist_id, match.opponent_decklist_id].filter(
    Boolean
  ) as string[];

  const [{ data: profiles }, { data: decks }, { data: evidence }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, username")
        .in("id", userIds),
      supabase.from("saved_decks").select("id, name, deck_list").in("id", deckIds),
      supabase
        .from("match_evidence")
        .select("id, image_path, note, submitted_by_user_id, created_at")
        .eq("match_id", id)
        .order("created_at", { ascending: true }),
    ]);

  const profileById = new Map(
    (profiles ?? []).map((p) => [p.id, p] as const)
  );
  const deckById = new Map((decks ?? []).map((d) => [d.id, d] as const));

  // Sign URLs for evidence images so the admin can view them.
  const evidenceWithUrls: EvidenceRow[] = await Promise.all(
    (evidence ?? []).map(async (e) => {
      const { data: signed } = await supabase.storage
        .from("match-evidence")
        .createSignedUrl(e.image_path, 60 * 10);
      return {
        id: e.id,
        image_path: e.image_path,
        note: e.note,
        submitted_by_user_id: e.submitted_by_user_id,
        created_at: e.created_at,
        signed_url: signed?.signedUrl ?? null,
      };
    })
  );

  const creator = profileById.get(match.creator_user_id);
  const opponent = match.opponent_user_id
    ? profileById.get(match.opponent_user_id)
    : null;
  const creatorDeck = deckById.get(match.creator_decklist_id);
  const opponentDeck = match.opponent_decklist_id
    ? deckById.get(match.opponent_decklist_id)
    : null;

  return (
    <main className="mx-auto max-w-2xl px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      {/* Desktop-only spacing wrapper — on mobile the BackButton portals
          into the sticky toolbar; collapsing here avoids a phantom 12px
          gap above the heading. */}
      <div className="hidden xl:block mb-3">
        <BackButton href="/admin/matches/disputes" ariaLabel="Back to queue" />
      </div>

      <h1 className="text-xl font-semibold text-text-primary mb-4">
        Match dispute
      </h1>

      <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-text-primary mb-3">
          Players
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-muted">Creator</p>
            <p className="text-sm font-semibold text-text-primary">
              {creator?.display_name ?? "Unknown"}{" "}
              <span className="text-text-muted font-normal">
                @{creator?.username}
              </span>
            </p>
            <p className="text-xs text-text-secondary mt-1">
              Deck: {creatorDeck?.name ?? "Unknown"}
            </p>
            <p className="text-xs text-text-muted mt-1">
              Submitted: {match.creator_result ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-text-muted">Opponent</p>
            <p className="text-sm font-semibold text-text-primary">
              {opponent?.display_name ?? "Unknown"}{" "}
              <span className="text-text-muted font-normal">
                @{opponent?.username}
              </span>
            </p>
            <p className="text-xs text-text-secondary mt-1">
              Deck: {opponentDeck?.name ?? "Unknown"}
            </p>
            <p className="text-xs text-text-muted mt-1">
              Submitted: {match.opponent_result ?? "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-text-primary mb-3">
          Evidence ({evidenceWithUrls.length})
        </h2>
        {evidenceWithUrls.length === 0 ? (
          <p className="text-xs text-text-muted">No evidence attached.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {evidenceWithUrls.map((e) => {
              const submitter = profileById.get(e.submitted_by_user_id);
              return (
                <div key={e.id} className="flex flex-col gap-2">
                  <p className="text-xs text-text-muted">
                    From {submitter?.display_name ?? "Unknown"} ·{" "}
                    {new Date(e.created_at).toLocaleString()}
                  </p>
                  {e.signed_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={e.signed_url}
                      alt="Evidence"
                      className="rounded-lg border border-black/10 max-h-96 object-contain bg-bg"
                    />
                  ) : (
                    <p className="text-xs text-accent">Could not load image.</p>
                  )}
                  {e.note && (
                    <p className="text-xs text-text-secondary whitespace-pre-wrap">
                      {e.note}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {match.status === "finalized" ? (
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5">
          <p className="text-sm text-text-secondary">
            Already finalized: <strong>{match.final_outcome}</strong>
            {match.judge_ruled && " (judge-ruled)"}
          </p>
        </div>
      ) : (
        <JudgeRulingForm
          matchId={id}
          creatorLabel={creator?.display_name ?? "Creator"}
          opponentLabel={opponent?.display_name ?? "Opponent"}
        />
      )}
    </main>
  );
}
