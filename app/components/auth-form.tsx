"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
      <path d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.3 6.9 9.6.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.4-3.4-1.4-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1 .8-.2 1.6-.3 2.4-.3s1.6.1 2.4.3c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7 1 .7 2v2.9c0 .3.2.6.7.5 4-1.3 6.9-5.1 6.9-9.6C22 6.6 17.5 2 12 2z" />
    </svg>
  );
}

export function SocialAuth({
  title,
  error,
}: {
  title: string;
  error?: string;
}) {
  const [busy, setBusy] = useState<"google" | "github" | null>(null);
  const [localError, setLocalError] = useState("");

  async function signIn(provider: "google" | "github") {
    setBusy(provider);
    setLocalError("");
    const { error: nextError } = await authClient.signIn.social({
      provider,
      callbackURL: "/",
      errorCallbackURL: "/sign-in?error=auth",
    });
    if (nextError) {
      setLocalError(nextError.message || "Could not start sign-in");
      setBusy(null);
    }
  }

  const message =
    localError ||
    (error === "auth" ? "Sign-in was cancelled or failed. Try again." : error);

  return (
    <main className="flex min-h-full items-center justify-center bg-[#050505] p-6">
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#111111] p-6">
        <Link href="/" className="text-xs text-[#8f8f8f] hover:text-[#f0f0f0]">
          Deni Run
        </Link>
        <h1 className="mt-4 text-xl font-semibold text-[#f0f0f0]">{title}</h1>
        <p className="mt-2 text-sm text-[#8f8f8f]">Continue with Google or GitHub.</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            loading={busy === "google"}
            disabled={busy !== null}
            onClick={() => void signIn("google")}
          >
            {busy === "google" ? null : <GoogleIcon />}
            Continue with Google
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            loading={busy === "github"}
            disabled={busy !== null}
            onClick={() => void signIn("github")}
          >
            {busy === "github" ? null : <GitHubIcon />}
            Continue with GitHub
          </Button>
        </div>
        {message ? <p className="mt-4 text-sm text-red-300">{message}</p> : null}
        <p className="mt-4 text-xs text-[#8f8f8f]">
          By continuing you agree to the{" "}
          <Link href="/terms" className="text-[#c8c8c8] hover:text-[#f0f0f0]">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-[#c8c8c8] hover:text-[#f0f0f0]">
            Privacy
          </Link>{" "}
          pages.
        </p>
      </div>
    </main>
  );
}
