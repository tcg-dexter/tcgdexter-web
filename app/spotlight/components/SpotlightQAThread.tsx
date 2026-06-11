import { shade } from "@/lib/color";
import type { SpotlightQA } from "../types";

interface Props {
  qa: SpotlightQA[];
  /** The featured trainer powering the answer side of each thread. */
  trainer: {
    displayName: string;
    username: string;
    /** When set, rendered in place of the monogram in the answer
     *  avatar so the Q&A reads with the trainer's actual portrait. */
    avatarUrl: string | null;
    /** First accent color (typically favorite-Pokémon energy color).
     *  Drives the vertical-fade gradient used as the monogram
     *  background, matching the main header avatar. */
    accentColor: string;
  };
}

/**
 * Two-letter monogram from the first two whitespace-separated words
 * of `name`. "Eevee Echo" → "EE"; single-word → first letter; empty
 * → "?". Shared shape with the main header avatar so both renderings
 * agree.
 */
function monogramFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

/**
 * Q&A rendered as a series of two-post conversation threads — TCG
 * Dexter asks, the featured trainer answers — mirroring the visual
 * language of the battle log detail page: round avatar, name + @handle
 * row, a thin connector between the question and its answer.
 *
 * Avatars:
 *   - TCG Dexter (interviewer) — site brand gradient circle, "TD"
 *     monogram in white. The gradient ties the section back to the
 *     brand without leaning on the test profile that happens to share
 *     the @dexter handle.
 *   - Featured trainer — mirrors the main header avatar: either the
 *     uploaded avatar image, or a vertical-fade-of-first-accent
 *     gradient circle with the trainer's two-letter monogram.
 */
export default function SpotlightQAThread({ qa, trainer }: Props) {
  if (qa.length === 0) return null;

  const trainerMonogram = monogramFor(trainer.displayName);
  const trainerGradient = `linear-gradient(180deg, ${trainer.accentColor} 0%, ${shade(
    trainer.accentColor,
    -22,
  )} 100%)`;

  return (
    <div className="rounded-2xl border border-black/8 bg-white shadow-sm overflow-hidden">
      <ul>
        {qa.map((item, i) => (
          <li
            key={i}
            className={i < qa.length - 1 ? "border-b border-black/8" : ""}
          >
            {/* Question — TCG Dexter, the interviewer voice. */}
            <Post
              avatar={
                <div className="h-9 w-9 rounded-full gradient-brand flex items-center justify-center text-[11px] font-black tracking-tight">
                  TD
                </div>
              }
              displayName="TCG Dexter"
              handle="tcgdexter"
              body={item.q}
              showConnector
            />
            {/* Answer — the featured trainer, mirroring the main
                header avatar's identity treatment. */}
            <Post
              avatar={
                <div
                  className="h-9 w-9 rounded-full overflow-hidden flex items-center justify-center text-sm font-black text-white"
                  style={trainer.avatarUrl ? undefined : { background: trainerGradient }}
                >
                  {trainer.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={trainer.avatarUrl}
                      alt={trainer.displayName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    trainerMonogram
                  )}
                </div>
              }
              displayName={trainer.displayName}
              handle={trainer.username}
              body={item.a}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface PostProps {
  avatar: React.ReactNode;
  displayName: string;
  handle: string;
  body: string;
  /** When true, draws a thin vertical line under the avatar that runs
   *  into the next post. Used on the question so it visually threads
   *  into the answer. */
  showConnector?: boolean;
}

function Post({ avatar, displayName, handle, body, showConnector }: PostProps) {
  return (
    <div className="flex gap-3 px-4 pt-3">
      <div className="flex flex-col items-center self-stretch shrink-0">
        {avatar}
        {showConnector && (
          <div className="w-0.5 flex-1 min-h-[16px] bg-black/15 mt-1.5" />
        )}
      </div>
      <div className={`flex-1 min-w-0 ${showConnector ? "pb-2" : "pb-4"}`}>
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-sm font-bold text-text-primary truncate">
            {displayName}
          </span>
          <span className="text-xs text-text-muted truncate">@{handle}</span>
        </div>
        <p className="mt-1 text-sm text-text-primary whitespace-pre-line leading-relaxed">
          {body}
        </p>
      </div>
    </div>
  );
}
