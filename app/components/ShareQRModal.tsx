"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Publicly-shareable URL to encode. */
  url: string;
  title?: string;
}

/**
 * The QR-code-plus-copy-link modal shared by every "share this deck" entry
 * point (QRCodeButton's own trigger, and the ellipsis menu's Share item).
 * Pure presentation — callers own when `open` flips true and what `url`
 * resolves to.
 */
export default function ShareQRModal({ open, onClose, url, title = "Share Deck" }: Props) {
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* silent — clipboard may be blocked */
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      style={{
        top: "calc(-1 * env(safe-area-inset-top))",
        right: "calc(-1 * env(safe-area-inset-right))",
        bottom: "calc(-1 * env(safe-area-inset-bottom))",
        left: "calc(-1 * env(safe-area-inset-left))",
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white/90 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 p-6 shadow-brand-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* QR Code */}
        <div className="flex justify-center mb-5">
          <div className="relative">
            {/* Gradient glow */}
            <div className="absolute -inset-px rounded-xl bg-gradient-brand opacity-60 blur-xl pointer-events-none" />
            <div className="relative rounded-xl border border-black/5 bg-white p-3">
              <QRCodeSVG
                value={url}
                size={180}
                bgColor="#ffffff"
                fgColor="#1a1a1a"
                marginSize={1}
                className="rounded-md block"
              />
            </div>
          </div>
        </div>

        {/* URL + Copy button */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            className="flex-1 min-w-0 rounded-lg border border-black/5 bg-white dark:bg-surface-2 px-3 py-2 text-xs text-text-secondary focus:outline-none"
          />
          <button
            onClick={handleCopy}
            className="flex-shrink-0 rounded-full bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-light transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
