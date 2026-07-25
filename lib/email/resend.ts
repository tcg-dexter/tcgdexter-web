import { Resend } from "resend";

/**
 * Lazy Resend client. Instantiated on first use so importing the email
 * layer never requires a key (preview / test / any env without
 * RESEND_API_KEY imports fine and simply never sends — see `send.ts`).
 */
let client: Resend | null = null;

export function getResend(): Resend {
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY);
  }
  return client;
}
