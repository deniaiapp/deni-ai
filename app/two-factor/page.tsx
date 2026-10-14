import { TwoFactorForm, type TwoFactorMethod } from "../components/auth-form";

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ method?: string }>;
}) {
  const { method } = await searchParams;
  const current: TwoFactorMethod = method === "email" || method === "passkey" ? method : "totp";
  return <TwoFactorForm method={current} />;
}
