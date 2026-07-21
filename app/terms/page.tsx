import Link from "next/link";
import LegalDoc, { LegalSection } from "@/app/components/ui/LegalDoc";

export const metadata = {
  title: "Terms of Service — TCG Dexter",
  description: "The terms that govern your use of TCG Dexter.",
};

const LAST_UPDATED = "July 21, 2026";

export default function TermsOfServicePage() {
  return (
    <LegalDoc title="Terms of Service" lastUpdated={LAST_UPDATED}>
      <LegalSection heading="1. Acceptance of Terms">
        <p>
          By accessing or using tcgdexter.com (the &ldquo;Service&rdquo;),
          you agree to these Terms of Service and our{" "}
          <Link href="/privacy">Privacy Policy</Link>. If you don&rsquo;t
          agree, please don&rsquo;t use the Service.
        </p>
      </LegalSection>

      <LegalSection heading="2. Eligibility">
        <p>
          You must be at least 13 years old to create an account or use the
          Service. By creating an account, you confirm that you meet this
          requirement.
        </p>
      </LegalSection>

      <LegalSection heading="3. Your Account">
        <p>
          You&rsquo;re responsible for the activity that happens under your
          account and for keeping access to your sign-in email or connected
          Discord/Google account secure. Let us know right away at{" "}
          <a href="mailto:feedback@tcgdexter.com">feedback@tcgdexter.com</a>{" "}
          if you believe your account has been compromised.
        </p>
      </LegalSection>

      <LegalSection heading="4. Your Content">
        <p>
          You keep ownership of the deck lists, notes, match logs, avatar
          images, and other content you submit to the Service (&ldquo;Your
          Content&rdquo;). By submitting it, you grant TCG Dexter a
          worldwide, non-exclusive, royalty-free license to host, store,
          display, and reproduce Your Content solely to operate and
          improve the Service — for example, to render your saved decks
          back to you or to display a deck you&rsquo;ve marked public.
        </p>
        <p>
          You&rsquo;re responsible for Your Content and for making sure you
          have the right to submit it. Don&rsquo;t submit anything
          unlawful, infringing, harassing, or that you don&rsquo;t have
          permission to share.
        </p>
      </LegalSection>

      <LegalSection heading="5. Public Content & Visibility">
        <p>
          Some features are public by design or by your choice — for
          example, a saved deck or profile you mark &ldquo;public,&rdquo;
          or achievement badges, which are visible to anyone who visits
          that page, signed in or not. Review your privacy settings in{" "}
          <Link href="/settings">Settings</Link> before sharing anything
          you&rsquo;d prefer to keep private.
        </p>
      </LegalSection>

      <LegalSection heading="6. Acceptable Use">
        <p>Please don&rsquo;t use the Service to:</p>
        <ul>
          <li>Impersonate another person, or misrepresent match results, evidence, or affiliation with TCG Dexter.</li>
          <li>Upload malicious code, scrape the Service at abusive scale, or attempt to disrupt or gain unauthorized access to it.</li>
          <li>Harass, threaten, or post content that&rsquo;s hateful, obscene, or unlawful.</li>
          <li>Use the Service for any purpose that violates applicable law.</li>
        </ul>
        <p>
          We may suspend or terminate accounts that violate these terms.
        </p>
      </LegalSection>

      <LegalSection heading="7. Pokémon & Trademark Disclaimer">
        <p>
          TCG Dexter is an independent, fan-made tool for the Pokémon
          Trading Card Game. It is not produced, endorsed, sponsored, or
          affiliated with Nintendo, Creatures Inc., GAME FREAK inc., or The
          Pokémon Company. Pokémon and all associated names, card images,
          and trademarks are the property of their respective owners.
          Card data and images are used for identification and reference
          purposes only.
        </p>
      </LegalSection>

      <LegalSection heading="8. Third-Party Services">
        <p>
          The Service is built on third-party infrastructure, including
          Supabase (authentication, database, and storage) and Vercel
          (hosting), and offers optional sign-in through Discord and
          Google. Your use of those sign-in options is also subject to
          their own terms and privacy policies.
        </p>
      </LegalSection>

      <LegalSection heading="9. Disclaimers">
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as
          available,&rdquo; without warranties of any kind, express or
          implied. We don&rsquo;t guarantee the Service will be
          uninterrupted, error-free, or secure, and we don&rsquo;t
          guarantee the accuracy of card data, market prices, deck
          legality determinations, or any other information provided by
          the Service. Always verify tournament legality and pricing
          against official sources before relying on them.
        </p>
      </LegalSection>

      <LegalSection heading="10. Limitation of Liability">
        <p>
          To the fullest extent permitted by law, TCG Dexter and its
          operator will not be liable for any indirect, incidental,
          special, consequential, or punitive damages, or any loss of
          data, arising from your use of the Service. Our total liability
          for any claim relating to the Service is limited to the amount
          you&rsquo;ve paid us in the past 12 months, which — since the
          Service is currently free — is zero.
        </p>
      </LegalSection>

      <LegalSection heading="11. Termination">
        <p>
          You can stop using the Service and delete your account at any
          time by contacting us. We may suspend or terminate your access
          if you violate these terms, or discontinue the Service (or parts
          of it) at our discretion, with notice where reasonably
          practical.
        </p>
      </LegalSection>

      <LegalSection heading="12. Changes to the Service or Terms">
        <p>
          We may update the Service and these Terms as TCG Dexter
          develops. If we make a material change to these Terms,
          we&rsquo;ll update the &ldquo;Last updated&rdquo; date above.
          Continuing to use the Service after a change means you accept
          the updated Terms.
        </p>
      </LegalSection>

      <LegalSection heading="13. Governing Law">
        <p>
          These Terms are governed by the laws of{" "}
          <strong className="text-text-primary">[State/Country]</strong>,
          without regard to its conflict-of-law principles.
        </p>
      </LegalSection>

      <LegalSection heading="14. Contact Us">
        <p>
          Questions about these Terms? Email{" "}
          <a href="mailto:feedback@tcgdexter.com">feedback@tcgdexter.com</a>.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
