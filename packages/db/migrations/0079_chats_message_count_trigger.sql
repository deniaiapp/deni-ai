-- Keeps v8's per-message rows honest while v7 shares the database (v8 beta).
-- See docs/v8-beta-rollout.md and apps/web/src/lib/chat-message-rows.ts.
CREATE OR REPLACE FUNCTION "chats_reset_message_count_for_unsynced_writes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Writers that keep chat_messages in sync (v8) set deni.chat_rows_writer for
  -- their transaction. Any other write to chats.messages (v7 sharing the
  -- database during the v8 beta, manual fixes) leaves the rows stale, so mark
  -- them incomplete and let reads fall back to the jsonb array. A statement
  -- that sets message_count itself is trusted.
  IF NEW.messages IS DISTINCT FROM OLD.messages
     AND NEW.message_count IS NOT DISTINCT FROM OLD.message_count
     AND COALESCE(current_setting('deni.chat_rows_writer', true), '') <> 'v8' THEN
    NEW.message_count := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "chats_reset_message_count"
  BEFORE UPDATE OF "messages" ON "chats"
  FOR EACH ROW EXECUTE FUNCTION "chats_reset_message_count_for_unsynced_writes"();
