import Link from "next/link";
import { FadeIn } from "@/components/motion";
import { supportEmail, supportMailto } from "@/lib/site";

export default function PrivacyPage() {
  const email = supportEmail();
  const mail = supportMailto();
  return (
    <main className="h-full overflow-y-auto bg-background px-6 py-12 text-foreground">
      <FadeIn>
      <article className="mx-auto max-w-2xl space-y-4 text-sm leading-relaxed text-secondary-foreground">
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
          Back
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">Privacy</h1>
        <p>
          Account authentication is handled on this service with Better Auth. You sign in with
          Google or GitHub, then an authenticator app. Sessions and two-factor secrets are stored
          in Postgres. Conversation
          history, teammates, routines, skills, and computer state are stored in Postgres keyed by
          your user ID. Workspace files and screenshots are stored in your tenant namespace on
          object storage (S3-compatible, typically Cloudflare R2).
        </p>
        <p>
          Browser sessions run through Steel. Terminal commands run in an isolated E2B sandbox.
          Model requests go through OpenRouter. Billing, if enabled, is processed by Stripe.
          Session cookies keep you signed in.
        </p>
        <p>
          We do not sell your workspace contents. You can export a copy of stored account data, or
          delete your account, from{" "}
          <Link href="/account" className="text-foreground hover:underline">
            Account
          </Link>
          . Deleting the account removes the login and stored workspace data.
        </p>
        <p>
          Processors that may receive data needed to run the product: Google and GitHub (sign-in),
          Stripe (billing), OpenRouter (model inference), Steel (browser), E2B (sandbox), and the
          configured object-storage provider.
        </p>
        <p>
          Contact:{" "}
          {mail ? (
            <a href={mail} className="text-foreground hover:underline">
              {email}
            </a>
          ) : (
            "the operator of this deployment"
          )}
          .
        </p>
      </article>
      </FadeIn>
    </main>
  );
}
