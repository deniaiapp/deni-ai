"use client";

import { useState } from "react";
import { BellIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { AppNotification } from "@/lib/types";

export function NotificationInbox({
  notifications,
  onRead,
}: {
  notifications: AppNotification[];
  onRead: (id?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((item) => !item.readAt).length;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        icon={BellIcon}
        onClick={() => setOpen(true)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
      >
        {unread > 0 ? <span className="rounded-full bg-blue-500/20 px-1.5 text-[0.7rem] text-blue-200">{unread}</span> : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] overflow-auto">
          <DialogTitle>Notifications</DialogTitle>
          <DialogDescription>Task completions, failures, approvals, and takeover requests stay here until you read them.</DialogDescription>
          <div className="flex justify-end"><Button type="button" variant="ghost" size="xs" icon={CheckIcon} disabled={unread === 0} onClick={() => void onRead()}>Mark all read</Button></div>
          <div className="space-y-2">
            {notifications.length === 0 ? <p className="text-sm text-[#8f8f8f]">No notifications.</p> : notifications.map((item) => (
              <button key={item.id} type="button" className="block w-full rounded-lg bg-white/5 p-3 text-left ring-1 ring-white/10 hover:bg-white/10" onClick={() => !item.readAt && void onRead(item.id)}>
                <div className="flex items-center gap-2"><span className="text-sm font-medium">{item.title}</span>{item.readAt ? null : <span className="size-1.5 rounded-full bg-blue-400" />}</div>
                <p className="mt-1 text-sm text-[#c8c8c8]">{item.body}</p>
                <p className="mt-1 text-xs text-[#777777]">{item.createdAt.replace("T", " ").slice(0, 19)}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
