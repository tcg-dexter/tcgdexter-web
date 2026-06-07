import { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TrainerSpotlightRow } from "@/app/spotlight/types";
import NewSpotlightForm from "./NewSpotlightForm";

export const metadata: Metadata = {
  title: "Admin · Trainer Spotlight",
};

interface Row extends TrainerSpotlightRow {
  profiles: {
    display_name: string;
    username: string;
  } | null;
}

export default async function AdminSpotlightList() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) redirect("/");

  const { data } = await supabase
    .from("trainer_spotlights")
    .select(
      "*, profiles!trainer_spotlights_profile_id_fkey(display_name, username)"
    )
    .order("updated_at", { ascending: false });

  const rows = (data ?? []) as Row[];

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">
            Trainer Spotlight — Admin
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Curate featured community players.
          </p>
        </header>

        <section className="rounded-2xl bg-white border border-black/8 shadow-sm p-5 mb-6">
          <h2 className="text-sm font-semibold text-text-primary mb-3">
            New spotlight
          </h2>
          <NewSpotlightForm />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-text-primary mb-3 px-1">
            All spotlights ({rows.length})
          </h2>
          {rows.length === 0 ? (
            <div className="rounded-2xl bg-white border border-black/8 p-6 text-sm text-text-secondary text-center">
              No spotlights yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="rounded-2xl bg-white border border-black/8 shadow-sm p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-text-primary truncate">
                      {r.profiles?.display_name ?? "(no profile)"}{" "}
                      <span className="font-normal text-text-muted">
                        @{r.profiles?.username ?? "—"}
                      </span>
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">
                      slug: <code>{r.slug}</code> ·{" "}
                      {r.is_published ? (
                        <span className="text-emerald-600 font-semibold">
                          Published
                        </span>
                      ) : (
                        <span className="text-text-muted">Draft</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.is_published && (
                      <Link
                        href={`/spotlight/${r.slug}`}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-black/15 hover:bg-[var(--surface)]"
                      >
                        View
                      </Link>
                    )}
                    <Link
                      href={`/admin/spotlight/${r.id}/edit`}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-black text-white border border-transparent hover:opacity-90"
                    >
                      Edit
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
