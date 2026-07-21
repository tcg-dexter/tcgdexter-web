"use client";

import { useState } from "react";

export default function CopyDeckListButton({
  deckList,
  iconOnly = false,
}: {
  deckList: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(deckList);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent
    }
  }

  const clipboardIcon = (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
    </svg>
  );

  const checkIcon = (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );

  if (iconOnly) {
    return (
      <button
        onClick={handleCopy}
        title="Copy deck list"
        className="inline-flex items-center justify-center pl-3 pr-0 py-[7px] text-text-primary opacity-50 hover:opacity-100 transition-opacity"
      >
        {copied ? checkIcon : clipboardIcon}
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-full bg-black dark:bg-white border border-transparent px-3 py-1.5 text-xs font-semibold text-white dark:text-black transition-colors"
    >
      {copied ? (
        <>{checkIcon} Copied!</>
      ) : (
        <>{clipboardIcon} Copy List</>
      )}
    </button>
  );
}
