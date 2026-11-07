import { render } from "@react-email/render";
import { SignInCodeEmail, type SignInCodeEmailProps } from "./sign-in-code";

// Loaded through src/lib/emails/index.ts so it runs in the SSR environment, where react-dom/server works.

export function renderSignInCodeEmail(props: SignInCodeEmailProps) {
  return render(<SignInCodeEmail {...props} />);
}
