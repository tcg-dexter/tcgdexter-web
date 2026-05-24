// Tokenizer: turn raw battle-log text into a tree of sections → blocks.
//
// A "block" is one primary action line plus any indented children that
// belong to it. Children are lines that begin with "- " (sub-actions)
// or "• " (listed items, usually card names from a draw / discard).
//
// A "section" is a contiguous run of blocks under one header. Headers
// we recognize:
//   • "Setup"
//   • "<handle>'s Turn"
//   • "Pokémon Checkup"
//
// Unrecognized header-style lines (anything that doesn't end in a verb
// phrase and isn't blank) start a new section anyway — keeps the parser
// honest if TCG Live adds new headers later.

export interface BlockChild {
  /** Original child text, with the leading marker stripped. */
  text: string;
  /** Original raw line for traceability. */
  raw: string;
  /** "dash" = "- ..." line, "bullet" = "• ..." line. */
  kind: "dash" | "bullet";
}

export interface Block {
  /** Primary action line, trimmed. */
  text: string;
  raw: string;
  children: BlockChild[];
}

export type SectionKind = "setup" | "turn" | "checkup" | "other";

export interface Section {
  kind: SectionKind;
  /** For "turn", the handle whose turn it is. */
  handle: string | null;
  /** Header line as it appeared (or null for an implicit pre-Setup section). */
  header: string | null;
  blocks: Block[];
}

const TURN_HEADER_RE = /^(.+?)'s Turn\s*$/;
const SETUP_HEADER_RE = /^Setup\s*$/;
const CHECKUP_HEADER_RE = /^Pok[eé]mon Checkup\s*$/;

/** True if the line looks like a section header. */
function detectHeader(line: string): { kind: SectionKind; handle: string | null } | null {
  if (SETUP_HEADER_RE.test(line)) return { kind: "setup", handle: null };
  if (CHECKUP_HEADER_RE.test(line)) return { kind: "checkup", handle: null };
  const m = line.match(TURN_HEADER_RE);
  if (m) return { kind: "turn", handle: m[1].trim() };
  return null;
}

/** Bullet line: "   • <text>" with various whitespace. */
const BULLET_RE = /^\s*•\s+(.+)$/;
/** Dash line: "- <text>" optionally indented. */
const DASH_RE = /^\s*-\s+(.+)$/;

export function tokenize(raw: string): Section[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const sections: Section[] = [];

  // Implicit pre-header section catches anything before the first header
  // (shouldn't happen in practice but keeps the parser robust).
  let current: Section = {
    kind: "other",
    handle: null,
    header: null,
    blocks: [],
  };
  sections.push(current);

  let currentBlock: Block | null = null;

  function flushBlock() {
    if (currentBlock) {
      current.blocks.push(currentBlock);
      currentBlock = null;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/​/g, ""); // strip zero-width spaces just in case
    const trimmed = line.trim();

    if (trimmed === "") {
      // Blank lines don't end a block on their own. TCG Live sometimes
      // inserts a blank line between a damage breakdown and a follow-up
      // "<handle> chose <option>" sub-action; both still belong to the
      // same attack. A block only ends when a new primary line or
      // section header appears.
      continue;
    }

    const header = detectHeader(trimmed);
    if (header) {
      flushBlock();
      current = {
        kind: header.kind,
        handle: header.handle,
        header: trimmed,
        blocks: [],
      };
      sections.push(current);
      continue;
    }

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      if (currentBlock) {
        currentBlock.children.push({
          text: bullet[1].trim(),
          raw: line,
          kind: "bullet",
        });
      }
      // Stray bullet without a parent — drop it. Shouldn't happen in well-
      // formed logs and it's not worth synthesizing a block.
      continue;
    }

    const dash = line.match(DASH_RE);
    if (dash) {
      if (currentBlock) {
        currentBlock.children.push({
          text: dash[1].trim(),
          raw: line,
          kind: "dash",
        });
      }
      continue;
    }

    // Primary action line: starts a new block.
    flushBlock();
    currentBlock = { text: trimmed, raw: line, children: [] };
  }

  flushBlock();

  // Drop the implicit pre-header section if it ended up empty.
  return sections.filter((s) => s.blocks.length > 0 || s.header !== null);
}
