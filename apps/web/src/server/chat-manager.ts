import { db } from "@/db/drizzle";
import { chats } from "@/db/schema";
import { auth } from "@/lib/auth";

type HeadersType = Headers;

/**
 * Get the current user ID from request headers
 * @throws Error if user is not authenticated
 */
export async function getUserId(headers: HeadersType): Promise<string> {
  const session = await auth.api.getSession({ headers });
  if (!session?.session?.userId) {
    throw new Error("Unauthorized");
  }
  return session.session.userId;
}

/**
 * Create a new chat for the authenticated user
 * @param userId - The user ID
 * @param title - Optional title for the chat (defaults to "New Chat")
 * @returns The created chat ID
 */
export async function createChat(userId: string, title: string = "New Chat"): Promise<string> {
  const newChat = await db
    .insert(chats)
    .values({
      uid: userId,
      title,
    })
    .returning();

  if (!newChat[0]?.id) {
    throw new Error("Failed to create chat");
  }

  return newChat[0].id;
}

/**
 * Create a new chat for the authenticated user from request headers
 * @param headers - Request headers containing authentication
 * @param title - Optional title for the chat (defaults to "New Chat")
 * @returns The created chat ID
 * @throws Error if user is not authenticated
 */
export async function createChatFromRequest(
  headers: HeadersType,
  title: string = "New Chat",
): Promise<string> {
  const userId = await getUserId(headers);
  return createChat(userId, title);
}
