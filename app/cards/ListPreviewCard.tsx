"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ShareQRModal from "@/app/components/ShareQRModal";
import { cardImageSmall } from "@/lib/cardImages";
import type { ListSummary } from "@/lib/lists";

const CARD_CLS =
  "rounded-card border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-3";

/**
 * A 2x2 mosaic + name/count preview of a list. Shared by the Lists overview
 * panel (`ListsView`), the card page's Lists carousel, and the profile
 * page's Lists section — same card, same data shape (`ListSummary`),
 * different fetch source.
 *
 * `canManage` adds the actions menu, mirroring the one on the list detail
 * page (Share / Rename / visibility / Delete) so a list can be managed from
 * the grid without opening it. Callers pass it only where the lists are the
 * viewer's own: it's implicit on the Lists panel and the card page's
 * carousel, and gated on `isOwner` on a profile.
 */
export default function ListPreviewCard({
  list,
  canManage = false,
}: {
  list: ListSummary;
  canManage?: boolean;
}) {
  const router = useRouter();
  // Name and visibility are held locally so the menu's own edits show up
  // immediately; router.refresh() reconciles the server copy behind them.
  const [name, setName] = useState(list.name);
  const [isPublic, setIsPublic] = useState(list.isPublic);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmingMakePublic, setConfirmingMakePublic] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(list.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setName(list.name);
    setIsPublic(list.isPublic);
  }, [list.name, list.isPublic]);

  // Portaled to <body> and fixed-positioned off the trigger's rect, same as
  // the detail page's: the card sits inside grids and an overflow-hidden
  // carousel that would otherwise clip a menu anchored within it.
  useEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const btn = menuButtonRef.current;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    function onDown(e: MouseEvent) {
      if (
        menuRef.current?.contains(e.target as Node) ||
        menuButtonRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const shareUrl =
    typeof window !== "undefined" && list.href
      ? `${window.location.origin}${list.href}`
      : (list.href ?? "");

  async function patchList(body: { name?: string; is_public?: boolean }) {
    const res = await fetch(`/api/lists/${list.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("patch failed");
  }

  async function toggleVisibility() {
    if (busy) return;
    const next = !isPublic;
    setBusy(true);
    setIsPublic(next);
    try {
      await patchList({ is_public: next });
      router.refresh();
    } catch {
      setIsPublic(!next);
    } finally {
      setBusy(false);
    }
  }

  function handleShareClick() {
    setMenuOpen(false);
    // A private list has no shareable URL, so sharing offers to publish it
    // first rather than handing over a link that 404s for the recipient —
    // the same trade the detail page's Share makes.
    if (isPublic) setShareOpen(true);
    else setConfirmingMakePublic(true);
  }

  async function makePublicAndShare() {
    if (busy) return;
    setBusy(true);
    try {
      await patchList({ is_public: true });
      setIsPublic(true);
      setConfirmingMakePublic(false);
      setShareOpen(true);
      router.refresh();
    } catch {
      /* leave the confirm open so the action can be retried */
    } finally {
      setBusy(false);
    }
  }

  async function saveRename() {
    const next = nameDraft.trim();
    if (!next || busy) return;
    const prev = name;
    setBusy(true);
    setName(next);
    try {
      await patchList({ name: next });
      setRenaming(false);
      router.refresh();
    } catch {
      setName(prev);
    } finally {
      setBusy(false);
    }
  }

  async function performDelete() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lists/${list.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setConfirmingDelete(false);
      router.refresh();
    } catch {
      /* leave the confirm open so the action can be retried */
    } finally {
      setBusy(false);
    }
  }

  const menu = canManage && (
    <>
      <button
        ref={menuButtonRef}
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="List actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-black/5 hover:text-text-primary transition-colors dark:hover:bg-white/10"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>
      {menuOpen &&
        menuPos !== null &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
            className="w-48 rounded-xl bg-white dark:bg-surface-elevated border border-black/8 dark:border-white/10 shadow-lg p-1 z-50"
          >
            <button
              type="button"
              role="menuitem"
              onClick={handleShareClick}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors"
            >
              Share
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setNameDraft(name);
                setRenaming(true);
                setMenuOpen(false);
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors"
            >
              Rename list
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                toggleVisibility();
                setMenuOpen(false);
              }}
              disabled={busy}
              aria-pressed={isPublic}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              {isPublic ? "Make private" : "Make public"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setConfirmingDelete(true);
                setMenuOpen(false);
              }}
              disabled={busy}
              className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              Delete list
            </button>
          </div>,
          document.body,
        )}
    </>
  );

  const body = (
    <>
      {/* rounded-[26px], not rounded-lg: the card around this is rounded-card
          (38px) with p-3, so the mosaic sits 12px in and 38-12=26 makes its
          corners concentric with the card's rather than a tighter arc inside
          a much rounder one. */}
      <div className="grid grid-cols-2 gap-0.5 rounded-[26px] overflow-hidden bg-surface aspect-square">
        {list.previewCards.length === 0 ? (
          <div className="col-span-2 row-span-2 flex items-center justify-center text-text-muted">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="w-8 h-8 opacity-40"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h12M4 10h12M4 15h8" />
            </svg>
          </div>
        ) : (
          Array.from({ length: 4 }).map((_, i) => {
            const card = list.previewCards[i];
            return card ? (
              <MosaicThumb key={`${card.setId}-${card.number}`} setId={card.setId} number={card.number} />
            ) : (
              <div key={i} className="bg-surface" />
            );
          })
        )}
      </div>
      <div className="mt-2 flex items-start justify-between gap-2">
        {/* Private reads as an eye with a slash ahead of the name — "not
            visible to anyone else" — rather than a padlock trailing it,
            which sat where the actions menu now lives. */}
        <span className="flex min-w-0 items-center gap-1.5">
          {!isPublic && <PrivateIcon />}
          <span className="truncate text-sm font-semibold text-text-primary">{name}</span>
        </span>
        {/* Sits where the padlock used to, and above the card's stretched
            link overlay so the trigger takes its own clicks. */}
        {canManage && <span className="relative z-20">{menu}</span>}
      </div>
      {/* -mt-0.5 halves the gap the two line boxes leave between the name and
          the count, which read as a looser pair than they are. */}
      <span className="-mt-0.5 block text-xs text-text-secondary">
        {list.itemCount} {list.itemCount === 1 ? "card" : "cards"}
      </span>
    </>
  );

  const dialogs = canManage && (
    <>
      <ShareQRModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        url={shareUrl}
        title="Share List"
      />
      {confirmingMakePublic && (
        <ConfirmDialog
          heading="Make this list public?"
          detail="Anyone with the link will be able to view it."
          confirmLabel="Make public & share"
          busy={busy}
          onCancel={() => setConfirmingMakePublic(false)}
          onConfirm={makePublicAndShare}
        />
      )}
      {confirmingDelete && (
        <ConfirmDialog
          heading={`Delete "${name}"?`}
          detail="This cannot be undone."
          confirmLabel="Delete"
          destructive
          busy={busy}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={performDelete}
        />
      )}
      {renaming && (
        <RenameDialog
          value={nameDraft}
          busy={busy}
          onChange={setNameDraft}
          onCancel={() => setRenaming(false)}
          onSave={saveRename}
        />
      )}
    </>
  );

  if (!list.href) {
    return (
      <div className={`${CARD_CLS} opacity-60`}>
        {body}
        {dialogs}
      </div>
    );
  }

  // With a menu, the card can't *be* the link — a button nested in an <a> is
  // invalid markup and the browser resolves clicks on it as navigation — so
  // the link stretches across the card as an overlay beneath the menu, the
  // same shape BattleCardShell uses.
  if (canManage) {
    return (
      <div className={`relative ${CARD_CLS} hover:bg-surface/70 transition-colors`}>
        {body}
        <Link
          href={list.href}
          aria-label={name}
          className="absolute inset-0 z-[1] rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {dialogs}
      </div>
    );
  }

  return (
    <Link href={list.href} className={`block ${CARD_CLS} hover:bg-surface/70 transition-colors`}>
      {body}
    </Link>
  );
}

/** Eye with a slash — "only you can see this". */
function PrivateIcon() {
  return (
    <svg
      aria-label="Private"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5 shrink-0 text-text-muted"
    >
      <path d="M8.2 5.2a6.6 6.6 0 0 1 1.8-.24c3.5 0 6.2 2.6 7.3 5.04a11 11 0 0 1-2 2.7M5.3 6.5A11.3 11.3 0 0 0 2.7 10c1.1 2.44 3.8 5.04 7.3 5.04 1.3 0 2.5-.36 3.5-.92" />
      <path d="M8.6 8.6a2 2 0 0 0 2.8 2.8" />
      <path d="m3.5 3.5 13 13" />
    </svg>
  );
}

function ConfirmDialog({
  heading,
  detail,
  confirmLabel,
  destructive = false,
  busy,
  onCancel,
  onConfirm,
}: {
  heading: string;
  detail: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogShell onClose={onCancel}>
      <h2 className="text-base font-semibold text-text-primary">{heading}</h2>
      <p className="mt-2 text-sm text-text-secondary">{detail}</p>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white dark:bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`inline-flex items-center justify-center rounded-full px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition ${
            destructive
              ? "bg-accent hover:bg-accent-light"
              : "bg-black dark:bg-white dark:text-black hover:opacity-80"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </DialogShell>
  );
}

function RenameDialog({
  value,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <DialogShell onClose={onCancel}>
      <h2 className="text-base font-semibold text-text-primary">Rename list</h2>
      <input
        type="text"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
        }}
        className="mt-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-[16px] sm:text-sm text-text-primary focus:outline-none focus-gradient-border transition-colors"
      />
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white dark:bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !value.trim()}
          className="inline-flex items-center justify-center rounded-full bg-black dark:bg-white px-4 py-1.5 text-xs font-semibold text-white dark:text-black hover:opacity-80 transition-opacity disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </DialogShell>
  );
}

/** The standard dialog recipe: portaled overlay, rounded-card panel whose
 *  p-6 gutter already sits concentric with the footer pills inside it. */
function DialogShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-card bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function MosaicThumb({ setId, number }: { setId: string; number: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="bg-surface" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cardImageSmall(setId, number)}
      alt=""
      className="w-full h-full object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
