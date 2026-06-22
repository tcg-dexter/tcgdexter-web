import Link from "next/link";
import type { ActivationData, BehaviorData } from "../lib/analytics";
import { ErrorBox } from "./Card";

type Maybe<T> = T | { error: string };

// Compact preview block that surfaces the headline numbers from the in-house
// activation funnel and behavior analytics on the mission control page.
// Each side links to its full dashboard tab.
//
// The Vercel Web Analytics block this replaces showed visitor counts and top
// pages from a third party; this surfaces signed-up activation drop-off and
// active-user engagement from analytics_events — data we own.
export default function AnalyticsPreview({
  activation,
  behavior,
}: {
  activation: Maybe<ActivationData>;
  behavior: Maybe<BehaviorData>;
}) {
  return (
    <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
      <ActivationBlock data={activation} />
      <BehaviorBlock data={behavior} />
    </div>
  );
}

function ActivationBlock({ data }: { data: Maybe<ActivationData> }) {
  if ("error" in data) {
    return (
      <div>
        <Eyebrow label="Activation · 7d" href="/dashboard/activation" />
        <ErrorBox error={data.error} />
      </div>
    );
  }

  const steps = data.steps;
  const signup = steps.find((s) => s.step === "signup");
  // The funnel orders steps by step_order; the last non-signup step in the
  // ordered list is the most "advanced" funnel state we have data for.
  const tail = steps[steps.length - 1];
  const showTail = tail && tail.step !== "signup";

  return (
    <div>
      <Eyebrow label={`Activation · ${data.cohortLabel.toLowerCase()}`} href="/dashboard/activation" />
      {steps.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">
          No funnel data yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <div className="text-3xl font-semibold tracking-tight tabular-nums text-[var(--text-primary)] sm:text-4xl">
              {signup?.userCount ?? 0}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              new signups
            </div>
          </div>
          {showTail ? (
            <div className="text-xs text-[var(--text-secondary)]">
              <span className="tabular-nums font-semibold text-[var(--text-primary)]">
                {tail.userCount}
              </span>{" "}
              reached <code className="font-mono text-[11px]">{tail.step}</code>
              {tail.pctOfCohort != null ? (
                <span className="text-[var(--text-muted)]">
                  {" · "}
                  {tail.pctOfCohort}% of signups
                </span>
              ) : null}
            </div>
          ) : null}
          <Link
            href="/dashboard/activation"
            className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline underline-offset-4"
          >
            View funnel ↗
          </Link>
        </div>
      )}
    </div>
  );
}

function BehaviorBlock({ data }: { data: Maybe<BehaviorData> }) {
  if ("error" in data) {
    return (
      <div>
        <Eyebrow label="Behavior · 7d" href="/dashboard/behavior" />
        <ErrorBox error={data.error} />
      </div>
    );
  }

  const { activeUsers, firstVsReturning, features, windowDays } = data;
  const returning = firstVsReturning.returningSessionUsers;
  const firstSession = firstVsReturning.firstSessionUsers;
  const topFeatures = features.slice(0, 3);

  return (
    <div>
      <Eyebrow
        label={`Behavior · last ${windowDays}d`}
        href="/dashboard/behavior"
      />
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
          <div className="text-3xl font-semibold tracking-tight tabular-nums text-[var(--text-primary)] sm:text-4xl">
            {activeUsers}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">active users</div>
        </div>
        <div className="text-xs text-[var(--text-secondary)]">
          <span className="tabular-nums font-semibold text-[var(--text-primary)]">
            {returning}
          </span>{" "}
          returning
          <span className="text-[var(--text-muted)]"> · </span>
          <span className="tabular-nums font-semibold text-[var(--text-primary)]">
            {firstSession}
          </span>{" "}
          first session
        </div>
        {topFeatures.length > 0 ? (
          <ul className="text-[11px] divide-y divide-black/5">
            {topFeatures.map((f) => (
              <li key={f.eventName} className="flex items-center justify-between py-1">
                <code className="font-mono text-[var(--text-secondary)] truncate pr-2">
                  {f.eventName}
                </code>
                <span className="tabular-nums text-[var(--text-primary)]">
                  {f.userCount}
                  <span className="ml-1 text-[var(--text-muted)]">
                    ({Math.round(f.pctOfActive)}%)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <Link
          href="/dashboard/behavior"
          className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline underline-offset-4"
        >
          View behavior ↗
        </Link>
      </div>
    </div>
  );
}

function Eyebrow({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="mb-2 inline-block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
    >
      {label}
    </Link>
  );
}
