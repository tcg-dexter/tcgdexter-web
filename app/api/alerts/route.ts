import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const REPO = "tcg-dexter/tcgdexter-web";
const FILE_PATH = "data/deck-alerts.json";

interface AlertEntry {
  id: string;
  email: string;
  threshold: number;
  deckList: string;
  deckPriceAtSubscription: number;
  lastCheckedPrice: number;
  lastNotified: string | null;
  createdAt: string;
  status: "active" | "paused" | "triggered";
}

export async function POST(req: NextRequest) {
  /* ── Parse & validate ──────────────────────────────────────── */
  let body: { email?: string; threshold?: number; deckList?: string; deckPrice?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { email, threshold, deckList, deckPrice } = body;

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (typeof threshold !== "number" || threshold <= 0) {
    return NextResponse.json({ error: "Threshold must be a positive number." }, { status: 400 });
  }
  if (!deckList || typeof deckList !== "string" || !deckList.trim()) {
    return NextResponse.json({ error: "Deck list is required." }, { status: 400 });
  }
  if (typeof deckPrice !== "number" || deckPrice <= 0) {
    return NextResponse.json({ error: "Deck price is required." }, { status: 400 });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }

  /* ── Read current file from GitHub ─────────────────────────── */
  const apiBase = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  let alerts: AlertEntry[] = [];
  let sha: string | undefined;

  try {
    const getRes = await fetch(apiBase, { headers });

    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
      const decoded = Buffer.from(data.content, "base64").toString("utf-8");
      alerts = JSON.parse(decoded);
    } else if (getRes.status !== 404) {
      return NextResponse.json({ error: "Failed to read alerts file." }, { status: 500 });
    }
    // 404 → treat as empty array, no sha needed
  } catch {
    return NextResponse.json({ error: "GitHub API error." }, { status: 500 });
  }

  /* ── Append new alert ──────────────────────────────────────── */
  const newAlert: AlertEntry = {
    id: randomUUID(),
    email: email.trim().toLowerCase(),
    threshold,
    deckList: deckList.trim(),
    deckPriceAtSubscription: deckPrice,
    lastCheckedPrice: deckPrice,
    lastNotified: null,
    createdAt: new Date().toISOString(),
    status: "active",
  };

  alerts.push(newAlert);

  /* ── Write updated file back to GitHub ─────────────────────── */
  try {
    const putBody: Record<string, string> = {
      message: `alert: add price alert for ${newAlert.email}`,
      content: Buffer.from(JSON.stringify(alerts, null, 2) + "\n").toString("base64"),
    };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(apiBase, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(putBody),
    });

    if (!putRes.ok) {
      const err = await putRes.text();
      console.error("GitHub PUT failed:", err);
      return NextResponse.json({ error: "Failed to save alert." }, { status: 500 });
    }
  } catch {
    return NextResponse.json({ error: "GitHub API error." }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: newAlert.id });
}
