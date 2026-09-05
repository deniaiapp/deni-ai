import { getAuthSession } from "@/lib/auth";
import { Landing } from "../components/landing";

export default async function HomePage() {
  const session = await getAuthSession();
  return <Landing signedIn={Boolean(session?.user.id)} />;
}
