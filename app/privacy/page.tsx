import Link from "next/link";
import LegalDoc, { LegalSection } from "@/app/components/ui/LegalDoc";

export const metadata = {
  title: "Privacy Policy — TCG Dexter",
  description: "How TCG Dexter collects, uses, and protects your information.",
};

const LAST_UPDATED = "July 21, 2026";

export default function PrivacyPolicyPage() {
  return (
    <LegalDoc title="Privacy Policy" lastUpdated={LAST_UPDATED}>
      <LegalSection heading="Overview">
        <p>
          TCG Dexter (&ldquo;TCG Dexter,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is a deck-building
          and collection-tracking tool for the Pokémon Trading Card Game. This
          policy explains what information we collect when you use
          tcgdexter.com, how we use it, and the choices you have. It applies
          whenever you visit the site, whether or not you create an account.
        </p>
      </LegalSection>

      <LegalSection heading="Information We Collect">
        <p>
          <strong className="text-text-primary">Account information.</strong>{" "}
          When you sign in, we receive your email address (for email
          sign-in) or your name and email as provided by Discord or Google
          (if you sign in that way). We don&rsquo;t collect or store
          passwords — sign-in is passwordless (email link or third-party
          OAuth).
        </p>
        <p>
          <strong className="text-text-primary">
            Profile and content you provide.
          </strong>{" "}
          Anything you choose to add or create: display name, username,
          bio, avatar image, banner color, showcased cards, your TCG Live
          handle, saved deck lists and notes, match results and logs
          (including any opponent name, handle, or archetype you type or
          paste in — see &ldquo;Content You Share May Include Other
          Players&rsquo; Information&rdquo; below), your tracked card
          collection, and any images you upload as evidence for a verified
          match.
        </p>
        <p>
          <strong className="text-text-primary">Usage and cookie data.</strong>{" "}
          We use a small number of first-party cookies to keep you signed
          in and to understand how the site is used. See &ldquo;Cookies
          &amp; Similar Technologies&rdquo; below for the specifics.
        </p>
      </LegalSection>

      <LegalSection heading="How We Use Information">
        <p>We use the information above to:</p>
        <ul>
          <li>Provide the core features — deck profiling, saved decks, match logging, collection tracking, and public profile pages.</li>
          <li>Keep your account secure and let you sign back in.</li>
          <li>Understand overall usage patterns so we can improve the site.</li>
          <li>Respond to support requests sent to feedback@tcgdexter.com.</li>
        </ul>
        <p>We do not sell your personal information, and we do not use it for third-party advertising.</p>
      </LegalSection>

      <LegalSection heading="How We Share Information">
        <p>
          We don&rsquo;t share your personal information with third parties
          except:
        </p>
        <ul>
          <li>
            <strong className="text-text-primary">Service providers</strong>{" "}
            that host and run the site on our behalf — currently{" "}
            <a href="https://supabase.com/privacy" target="_blank" rel="noreferrer">
              Supabase
            </a>{" "}
            (authentication, database, and file storage) and{" "}
            <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noreferrer">
              Vercel
            </a>{" "}
            (hosting). They process data only to provide their service to
            us, not for their own purposes.
          </li>
          <li>What you make public. Content and profile fields you mark as public (e.g. a public deck, a public profile) are visible to anyone who visits that page.</li>
          <li>If required by law, or to protect the rights, safety, or property of TCG Dexter or our users.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Cookies & Similar Technologies">
        <p>We use a small set of first-party cookies — no third-party ad or tracking cookies:</p>
        <ul>
          <li>
            <strong className="text-text-primary">Session cookies</strong> from
            Supabase that keep you signed in.
          </li>
          <li>
            <strong className="text-text-primary">dx_aid</strong> — an
            anonymous device identifier (no personal data), used to make
            usage analytics more accurate. Lasts up to 2 years.
          </li>
          <li>
            <strong className="text-text-primary">dx_sid</strong> — a
            short-lived session identifier for the same purpose, expiring
            after about 30 minutes of inactivity.
          </li>
        </ul>
        <p>
          Page views and feature usage are logged internally along with a
          one-way hash of your IP address (never the raw address) so we can
          see aggregate trends without tracking individuals across the web.
          This data isn&rsquo;t shared with or sold to anyone outside TCG
          Dexter.
        </p>
      </LegalSection>

      <LegalSection heading="Data Retention">
        <p>
          We keep your account and content for as long as your account is
          active. If you ask us to delete your account (see &ldquo;Your
          Rights &amp; Choices&rdquo;), we&rsquo;ll remove your personal
          information within a reasonable time, except where we need to
          keep limited records to comply with law or resolve disputes.
        </p>
      </LegalSection>

      <LegalSection heading="Your Rights & Choices">
        <p>
          You can review and update most of your profile information
          directly in{" "}
          <Link href="/settings">Settings</Link>, including permanently
          deleting your account and all associated data yourself under the
          &ldquo;Danger Zone&rdquo; section. You&rsquo;re also entitled to
          request a copy of your data — email{" "}
          <a href="mailto:feedback@tcgdexter.com">feedback@tcgdexter.com</a>{" "}
          and we&rsquo;ll handle that for you.
        </p>
      </LegalSection>

      <LegalSection heading="Children's Privacy">
        <p>
          TCG Dexter is not directed at children, and you must be at least
          13 years old to use it. We don&rsquo;t knowingly collect
          information from anyone under 13. If you believe a child under 13
          has created an account, contact us and we&rsquo;ll remove it.
        </p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>
          We rely on our infrastructure providers&rsquo; industry-standard
          security practices (encryption in transit, access controls) to
          protect your information. No online service can guarantee
          perfect security, so please use a unique, secure email account
          and let us know right away if you suspect unauthorized access to
          your account.
        </p>
      </LegalSection>

      <LegalSection heading="Content You Share May Include Other Players' Information">
        <p>
          Match logging and battle-log import let you record details about
          your opponents — a name, handle, or deck archetype you type in,
          or text pasted from a Pokémon TCG Live battle log. That
          information is provided by you, not verified by us, and is
          visible according to the same public/private settings as the
          rest of your match history. Please be considerate about what you
          share regarding other players.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to This Policy">
        <p>
          We may update this policy as the product changes. If we make a
          material change, we&rsquo;ll update the &ldquo;Last updated&rdquo;
          date above; significant changes may also be announced on the
          site.
        </p>
      </LegalSection>

      <LegalSection heading="Contact Us">
        <p>
          Questions about this policy or your data? Email{" "}
          <a href="mailto:feedback@tcgdexter.com">feedback@tcgdexter.com</a>.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
