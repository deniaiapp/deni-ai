import { useExtracted } from "use-intl";
import { HomeFeaturedBadgeLink } from "./home-featured-badge-link";

export type HomeFeaturedPost = { href: string; title: string };

export function HomeFeaturedBadge({ post }: { post: HomeFeaturedPost | null }) {
  const t = useExtracted();
  if (!post) {
    return null;
  }

  return <HomeFeaturedBadgeLink href={post.href} label={t("Featured")} title={post.title} />;
}
