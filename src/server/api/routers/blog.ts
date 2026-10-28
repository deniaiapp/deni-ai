import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/drizzle";
import { blogPost } from "@/db/schema";
import { isBlogAdmin } from "@/lib/blog/admin";
import { RESERVED_BLOG_SLUGS } from "@/lib/blog/posts";
import { invalidateBlogCache } from "@/lib/blog/queries";
import { blogSlugSchema, slugifyBlogTitle } from "@/lib/blog/slug";
import { protectedProcedure, router } from "../trpc";
import { isVerifiedAdmin, type AdminUser } from "@/lib/verified-admin";

const postInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(blogSlugSchema, "Use lowercase letters, numbers, and hyphens."),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(300),
  body: z.string().max(100_000),
  titleJa: z.string().trim().max(160),
  descriptionJa: z.string().trim().max(300),
  bodyJa: z.string().max(100_000),
  author: z.string().trim().min(1).max(80),
});

function requireBlogAdmin(user: AdminUser) {
  if (!isVerifiedAdmin(user, isBlogAdmin)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Blog administration is not enabled for this account.",
    });
  }
}

function revalidateBlog() {
  invalidateBlogCache();
}

async function assertSlugAvailable(slug: string, currentId?: string) {
  if (RESERVED_BLOG_SLUGS.has(slug)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "That slug is reserved.",
    });
  }

  const [existing] = await db
    .select({ id: blogPost.id })
    .from(blogPost)
    .where(eq(blogPost.slug, slug))
    .limit(1);
  if (existing && existing.id !== currentId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Another post already uses that slug.",
    });
  }
}

export const blogRouter = router({
  canManage: protectedProcedure.query(({ ctx }) => {
    return isVerifiedAdmin(ctx.session?.user, isBlogAdmin);
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    requireBlogAdmin(ctx.session?.user);
    return ctx.db.select().from(blogPost).orderBy(desc(blogPost.updatedAt));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      requireBlogAdmin(ctx.session?.user);
      const [post] = await ctx.db.select().from(blogPost).where(eq(blogPost.id, input.id)).limit(1);
      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
      }
      return post;
    }),

  create: protectedProcedure.input(postInputSchema).mutation(async ({ ctx, input }) => {
    requireBlogAdmin(ctx.session?.user);
    const slug = slugifyBlogTitle(input.slug) || input.slug;
    await assertSlugAvailable(slug);

    const [created] = await ctx.db
      .insert(blogPost)
      .values({
        ...input,
        slug,
        createdBy: ctx.userId,
      })
      .returning();

    if (!created) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the post." });
    }

    return created;
  }),

  update: protectedProcedure
    .input(postInputSchema.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireBlogAdmin(ctx.session?.user);
      const slug = slugifyBlogTitle(input.slug) || input.slug;
      await assertSlugAvailable(slug, input.id);

      const [existing] = await ctx.db
        .select()
        .from(blogPost)
        .where(eq(blogPost.id, input.id))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
      }

      const [updated] = await ctx.db
        .update(blogPost)
        .set({
          slug,
          title: input.title,
          description: input.description,
          body: input.body,
          titleJa: input.titleJa,
          descriptionJa: input.descriptionJa,
          bodyJa: input.bodyJa,
          author: input.author,
        })
        .where(eq(blogPost.id, input.id))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not update the post.",
        });
      }

      revalidateBlog();
      return updated;
    }),

  publish: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireBlogAdmin(ctx.session?.user);
      const [existing] = await ctx.db
        .select()
        .from(blogPost)
        .where(eq(blogPost.id, input.id))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
      }
      if (!existing.title.trim() || !existing.description.trim() || !existing.body.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add an English title, description, and body before publishing.",
        });
      }

      const [updated] = await ctx.db
        .update(blogPost)
        .set({
          status: "published",
          publishedAt: existing.publishedAt ?? new Date(),
        })
        .where(eq(blogPost.id, input.id))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not publish the post.",
        });
      }

      revalidateBlog();
      return updated;
    }),

  unpublish: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireBlogAdmin(ctx.session?.user);
      const [existing] = await ctx.db
        .select()
        .from(blogPost)
        .where(eq(blogPost.id, input.id))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
      }

      const [updated] = await ctx.db
        .update(blogPost)
        .set({ status: "draft", featured: false })
        .where(eq(blogPost.id, input.id))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not unpublish the post.",
        });
      }

      revalidateBlog();
      return updated;
    }),

  setFeatured: protectedProcedure
    .input(z.object({ id: z.string().min(1), featured: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireBlogAdmin(ctx.session?.user);
      const [existing] = await ctx.db
        .select()
        .from(blogPost)
        .where(eq(blogPost.id, input.id))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
      }
      if (input.featured && existing.status !== "published") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Publish the post before featuring it on the homepage.",
        });
      }

      if (input.featured) {
        await ctx.db.update(blogPost).set({ featured: false }).where(eq(blogPost.featured, true));
      }

      const [updated] = await ctx.db
        .update(blogPost)
        .set({ featured: input.featured })
        .where(eq(blogPost.id, input.id))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not update featured state.",
        });
      }

      revalidateBlog();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireBlogAdmin(ctx.session?.user);
      const [existing] = await ctx.db
        .select()
        .from(blogPost)
        .where(eq(blogPost.id, input.id))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
      }

      await ctx.db.delete(blogPost).where(eq(blogPost.id, input.id));
      revalidateBlog();
      return { ok: true };
    }),
});
