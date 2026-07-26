import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WelcomeForm from "./WelcomeForm";

export const metadata = {
  title: "Welcome — TCG Dexter",
};

/**
 * First-sign-in onboarding. Users land here from the auth callback when they
 * have no username yet (see app/auth/callback/route.ts). They pick a username
 * (required) and optionally a display name, then land on their profile — or,
 * if they came from the "save a deck" funnel, back on the home page to finish
 * that save (handled in WelcomeForm).
 *
 * Anyone who already has a username doesn't need onboarding and is sent to
 * their profile.
 */
export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.username) redirect(`/u/${profile.username}`);

  return (
    <main className="mx-auto max-w-md px-6 pt-[calc(env(safe-area-inset-top)_+_2rem)] md:pt-[calc(env(safe-area-inset-top)_+_4rem)] pb-24">
      <h1 className="text-3xl font-semibold tracking-tight text-text-primary">
        Welcome to TCG Dexter
      </h1>
      <p className="mt-2 text-text-secondary leading-relaxed">
        Pick a username to finish setting up your trainer profile. This is your
        public handle — you can share decks and show off badges once it&rsquo;s set.
      </p>
      <div className="mt-6">
        <WelcomeForm initialDisplayName={profile?.display_name ?? ""} />
      </div>
    </main>
  );
}
