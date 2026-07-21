import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EditDisplayName from "@/app/profile/EditDisplayName";
import EditUsername from "@/app/profile/EditUsername";
import EditBio from "@/app/profile/EditBio";
import EditPublicToggle from "@/app/profile/EditPublicToggle";
import SignOutButton from "@/app/profile/SignOutButton";
import DeleteAccountButton from "@/app/settings/DeleteAccountButton";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, username, bio, is_public, created_at")
    .eq("id", user.id)
    .single();

  const joinedDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  return (
    <main className="mx-auto max-w-2xl px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      {profile?.username && (
        <Link
          href={`/u/${profile.username}`}
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-6"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          @{profile.username}
        </Link>
      )}

      <h1 className="text-3xl font-semibold tracking-tight text-text-primary mb-8">Settings</h1>

      <div className="mb-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-muted px-1 mb-2">
          Account
        </p>
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden">
          <EditDisplayName
            initialName={profile?.display_name ?? "—"}
            joinedDate={joinedDate}
          />
          <EditUsername
            initialUsername={profile?.username ?? null}
            displayNameForSuggestion={profile?.display_name ?? ""}
          />
        </div>
      </div>

      <div className="mt-6 mb-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-muted px-1 mb-2">
          Profile
        </p>
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden">
          <EditBio initialBio={profile?.bio ?? null} />
          <EditPublicToggle
            initialIsPublic={profile?.is_public ?? false}
            hasDisplayName={Boolean(profile?.display_name)}
          />
        </div>
      </div>

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-muted px-1 mb-2">
          Session
        </p>
        <SignOutButton />
      </div>

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-muted px-1 mb-2">
          Danger Zone
        </p>
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden">
          <DeleteAccountButton />
        </div>
      </div>
    </main>
  );
}
