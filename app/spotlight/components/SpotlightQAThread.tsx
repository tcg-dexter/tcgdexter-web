import type { SpotlightQA } from "../types";

interface Props {
  qa: SpotlightQA[];
  /** The featured trainer's display name + @handle. Drives the second
   *  post in each Q/A thread (the answer). */
  trainer: {
    displayName: string;
    username: string;
  };
}

/**
 * Q&A rendered as a series of two-post conversation threads — Dexter
 * asks, the featured trainer answers — mirroring the visual language of
 * the battle log detail page: small round avatar, name + @handle row,
 * a thin connector between the question and its answer, and breathing
 * room between Q/A pairs.
 *
 * Avatars: Dexter is a flat black circle with a white "D" monogram (the
 * interviewer voice). The featured trainer is a site-gradient circle
 * with the first letter of their display name. The contrast tells the
 * reader at a glance who's speaking.
 */
export default function SpotlightQAThread({ qa, trainer }: Props) {
  if (qa.length === 0) return null;
  const trainerInitial = trainer.displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="rounded-2xl border border-black/8 bg-white shadow-sm overflow-hidden">
      <ul>
        {qa.map((item, i) => (
          <li
            key={i}
            className={i < qa.length - 1 ? "border-b border-black/8" : ""}
          >
            {/* Question — Dexter, the interviewer voice. */}
            <Post
              avatar={
                <div className="h-9 w-9 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold">
                  D
                </div>
              }
              displayName="Dexter"
              handle="dexter"
              body={item.q}
              showConnector
            />
            {/* Answer — the featured trainer. */}
            <Post
              avatar={
                <div className="h-9 w-9 rounded-full gradient-brand flex items-center justify-center text-sm font-bold">
                  {trainerInitial}
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
