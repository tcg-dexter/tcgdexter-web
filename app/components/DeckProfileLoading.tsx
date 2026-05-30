export default function DeckProfileLoading() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg">
      <svg
        role="status"
        aria-label="Loading deck"
        className="w-8 h-8 animate-spin text-accent"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-20"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          className="opacity-90"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
        />
      </svg>
    </div>
  );
}
