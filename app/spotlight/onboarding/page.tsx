import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { normalizeSubmission, type TrainerSpotlightRow } from "../types";
import OnboardingForm from "./OnboardingForm";

export const metadata = {
  title: "Trainer Spotlight — Your submission",
  robots: { index: false, follow: false },
};

interface DeckOption {
  id: string;
  name: string;
}

interface ListOption {
  short_id: string;
  name: string;
}

/**
 * /spotlight/onboarding — the featured trainer's own page.
 *
 * Replaces the Trainer Spotlight prep PDF that used to go out over DM: the
 * same questions, collected straight into the spotlight draft so the admin
 * and the trainer are working from one record instead of a DM thread.
 *
 * Reachable only by a trainer with an open invitation — an admin flips their
 * draft to "invited" in Spotlight Admin. Anyone else gets a 404.
 */
export default async function SpotlightOnboarding() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/spotlight/onboarding");

  // Readable under trainer_spotlights_subject_read even while a draft.
  const { data: spotlight } = await supabase
    .from("trainer_spotlights")
    .select("*")
    .eq("profile_id", user.id)
    .maybeSingle<TrainerSpotlightRow>();

  if (!spotlight || spotlight.submission_status === "not_invited") notFound();

  const [{ data: decks }, { data: lists }] = await Promise.all([
    supabase
      .from("saved_decks")
      .select("id, name")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("lists")
      .select("short_id, name")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
  ]);

  const status = spotlight.submission_status;
  const submission = normalizeSubmission(spotlight.submission);

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">
            Trainer Spotlight
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Thank you for being a part of the TCG Dexter community, and thank
            you for letting me feature you in a Trainer Spotlight. This will
            highlight you as a player, and give you a chance to showcase your
            approach to the game.
          </p>
          <p className="mt-2 text-sm text-text-secondary">
            Use Save draft as you go — you don&rsquo;t have to finish in one
            sitting. The final version posted to tcgdexter.com goes through
            an editing cycle before publishing, and you&rsquo;ll get the chance
            to approve any edits made.
          </p>
        </header>

        {(status === "in_review" || status === "approved") && (
          <section className="mb-6 rounded-2xl border border-black/8 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-surface-elevated">
            <h2 className="text-sm font-semibold text-text-primary">
              {status === "in_review"
                ? "Your spotlight is ready for you to review"
                : "You've approved your spotlight"}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {status === "in_review"
                ? "The edited version is ready. Read it through and approve it — or leave a note if something needs another pass."
                : "Nothing else is needed from you. It'll appear publicly once it goes live."}
            </p>
            <Link
              href={`/spotlight/${spotlight.slug}`}
              className="mt-3 inline-block text-xs font-semibold px-3 py-1.5 rounded-full gradient-brand shadow-sm hover:opacity-95"
            >
              {status === "in_review" ? "Review your spotlight" : "View it"}
            </Link>
          </section>
        )}

        <OnboardingForm
          initialSubmission={submission}
          status={status}
          deckOptions={(decks ?? []) as DeckOption[]}
          listOptions={(lists ?? []) as ListOption[]}
        />
      </div>
    </main>
  );
}
