import { useExtracted } from "use-intl";

export function useFreshSessionLocalization() {
  const t = useExtracted();

  return {
    title: t("Confirm it's you"),
    description: t("For your security, please verify your identity again before continuing."),
    submit: t("Confirm and continue"),
    signIn: t("Please sign out and sign in again to continue."),
    success: t("Your identity was confirmed."),
  };
}
