import { render } from "@react-email/render";
import { appUrl } from "../site";
import { SignInCodeEmail, type SignInCodeEmailProps } from "./sign-in-code";

// Loaded through src/lib/emails/index.ts so it runs in the SSR environment, where react-dom/server works.

export function renderSignInCodeEmail(props: SignInCodeEmailProps) {
  // Mail clients need an absolute image URL.
  const origin = appUrl();
  return render(<SignInCodeEmail iconUrl={origin ? `${origin}/icon.png` : undefined} {...props} />);
}
