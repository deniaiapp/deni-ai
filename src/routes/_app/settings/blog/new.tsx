import { createFileRoute } from "@tanstack/react-router";
import { BlogEditorPage } from "@/components/blog/blog-editor-page";

export const Route = createFileRoute("/_app/settings/blog/new")({
  component: NewBlogPostRoute,
});

function NewBlogPostRoute() {
  return <BlogEditorPage />;
}
