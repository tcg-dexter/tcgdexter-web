import { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import DeckProfileView, {
  type AnalysisResult,
  type DeckCreator,
} from "@/app/components/DeckProfileView";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { repriceDeck } from "@/lib/reprice-deck";
import QRCodeButton from "@/app/components/QRCodeButton";
import CopyDeckListButton from "@/app/components/CopyDeckListButton";

/**
 * Experiment mirror of /d/[shortId]. Reuses the real DeckProfileView.
 * Note: DeckProfileView supplies its own internal chrome; our experiment
 * shell (nav + aurora + footer) wraps around it.
 */

interface DeckRecord {
  deckList: string;
  profiledAt: string;
  analysis: AnalysisResult;
  userId: string | null;
}

async function fetchDeck(shortId: string): Promise<DeckRecord | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("deck_shares")
      .select("deck_list, analysis, created_at, user_id")
      .eq("id", shortId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      deckList: data.deck_list,
      analysis: data.analysis as AnalysisResult,
      profiledAt: data.created_at,
      userId: data.user_id,
    };
  } catch {
    return null;
  }
}

async function fetchCreator(userId: string | null): Promise<DeckCreator | null> {
  if (!userId) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    if (!data) return null;
    return {
      displayName: data.display_name ?? "Trainer",
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shortId: string }>;
}): Promise<Metadata> {
  const { shortId } = await params;
  const deck = await fetchDeck(shortId);
  if (!deck) return { title: "Deck Not Found — TCG Dexter" };

  const { analysis: frozenAnalysis, profiledAt } = deck;
  const live = repriceDeck(deck.deckList);

  const title = frozenAnalysis.metaMatch.archetypeName
    ? `${frozenAnalysis.metaMatch.archetypeName} — TCG Dexter`
    : "Deck Analysis — TCG Dexter";

  const rotationStatus = live.rotation.ready ? "Standard Legal" : "Not Standard Legal";
  const pricePart = live.deckPrice > 0 ? `$${live.deckPrice.toFixed(2)} deck` : "";
  const archPart = frozenAnalysis.metaMatch.archetypeName ?? "";
  const datePart = `Profiled ${new Date(profiledAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })}`;
  const descParts = [rotationStatus, pricePart, archPart, datePart].filter(Boolean);

  return {
    title,
    description: descParts.join(" · "),
    openGraph: { title, description: descParts.join(" · ") },
    twitter: { card: "summary_large_image", title, description: descParts.join(" · ") },
  };
}

export default async function SharedDeckPage({
  params,
}: {
  params: Promise<{ shortId: string }>;
}) {
  const { shortId } = await params;
  const deck = await fetchDeck(shortId);

  const headersList = await headers();
  const host =
    headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "tcgdexter.com";
  const proto = headersList.get("x-forwarded-proto") ?? "https";
  const shareUrl = `${proto}://${host}/d/${shortId}`;

  if (!deck) {
    return (
      <main className="mx-auto max-w-2xl px-6 pt-24 pb-32 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Deck Not Found</h1>
        <p className="mt-3 text-sm text-text-secondary max-w-md mx-auto leading-relaxed">
          This shared deck link is invalid or has expired.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 mt-6 rounded-full bg-gradient-brand px-6 py-3 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition"
        >
          Profile your own deck
        </Link>
      </main>
    );
  }

  const creator = await fetchCreator(deck.userId);

  const live = repriceDeck(deck.deckList);
  const analysis: AnalysisResult = {
    ...deck.analysis,
    deckPrice: live.deckPrice,
    rotation: live.rotation,
  };

  return (
    <DeckProfileView
      variant="shared"
      deckList={deck.deckList}
      analysis={analysis}
      profiledAt={deck.profiledAt}
      creator={creator ?? undefined}
      subtitle={
        <div className="flex items-center gap-2">
          <CopyDeckListButton deckList={deck.deckList} />
          <QRCodeButton shareUrl={shareUrl} />
        </div>
      }
    />
  );
}
