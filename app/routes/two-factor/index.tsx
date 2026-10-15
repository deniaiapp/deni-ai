import { createFileRoute } from "@tanstack/react-router";
import { TwoFactorForm, type TwoFactorMethod } from "../../components/auth-form";

export const Route = createFileRoute("/two-factor/")({
  validateSearch: (search: Record<string, unknown>): { method?: TwoFactorMethod } => ({
    method: search.method === "email" || search.method === "passkey" ? search.method : undefined,
  }),
  component: TwoFactorPage,
});

function TwoFactorPage() {
  const { method } = Route.useSearch();
  return <TwoFactorForm method={method ?? "totp"} />;
}
