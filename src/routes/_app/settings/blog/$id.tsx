import { createFileRoute } from "@tanstack/react-router";
import { BlogEditorPage } from "@/components/blog/blog-editor-page";

export const Route = createFileRoute("/_app/settings/blog/$id")({
  component: EditBlogPostRoute,
});

function EditBlogPostRoute() {
  const { id } = Route.useParams();
  return <BlogEditorPage key={id} postId={id} />;
}
