import Link from "next/link";
import { FadeIn } from "@/components/motion";
import { supportEmail, supportMailto } from "@/lib/site";

export default function TermsPage() {
  const email = supportEmail();
  const mail = supportMailto();
  return (
    <main className="h-full overflow-y-auto bg-[#050505] px-6 py-12 text-[#f0f0f0]">
      <FadeIn>
      <article className="mx-auto max-w-2xl space-y-4 text-sm leading-relaxed text-[#c8c8c8]">
        <Link href="/" className="text-xs text-[#8f8f8f] hover:text-[#f0f0f0]">
          Back
        </Link>
        <h1 className="text-2xl font-semibold text-[#f0f0f0]">Terms of Service</h1>
        <p>
          Deni Run is an AI teammate service that can operate a private computer (browser, files,
          and terminal) on your behalf. By creating an account you agree to these terms.
        </p>
        <p>
          You are responsible for the tasks you assign, including browsing, file changes, and shell
          commands. Do not use Deni Run to break the law, attack systems, send spam, or process
          data you are not allowed to handle. Destructive actions may require your approval, but
          you remain responsible for the outcome.
        </p>
        <p>
          Usage limits apply by plan. Paid subscriptions renew monthly until canceled through the
          billing portal. Fees are charged by Stripe. We may suspend accounts that abuse
          infrastructure, exceed fair use, or violate these terms.
        </p>
        <p>
          Computer sessions, files, and memory stay scoped to your account. You can export or
          delete that data from{" "}
          <Link href="/account" className="text-[#f0f0f0] hover:underline">
            Account
          </Link>
          . Deleting your account also removes the login stored for this service.
        </p>
        <p>
          The service is provided as-is. We do not warrant uninterrupted availability. These terms
          may be updated as the product changes.
        </p>
        <p>
          Contact:{" "}
          {mail ? (
            <a href={mail} className="text-[#f0f0f0] hover:underline">
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
