import { useExtracted } from "@/i18n/react";
import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { ImagePlus, Smile, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import ReactionPicker from "./reaction-picker";

export function AvatarField({ name, accent = "#555555", value, onChange, disabled, onBusyChange }: { name: string; accent?: string; value: string | null; onChange: (value: string | null) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const t = useExtracted();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function chooseImage(file?: File) {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 5 * 1024 * 1024) { setError(t("Choose a PNG, JPG, WebP, or GIF image under 5 MB.")); return; }
    setBusy(true);
    onBusyChange?.(true);
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("Image processing is unavailable."));
      const size = Math.min(bitmap.width, bitmap.height);
      context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 128, 128);
      const icon = canvas.toDataURL("image/webp", 0.8);
      if (icon.length > 50000) throw new Error(t("This image is too large. Choose a simpler image."));
      onChange(icon);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not read this image.")); }
    finally { bitmap?.close(); setBusy(false); onBusyChange?.(false); }
  }
  return <div className="space-y-2">
    <span className="text-sm font-medium">{t("Icon")}</span>
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 [&>span]:size-12"><Avatar name={name || "?"} accent={accent} icon={value} /></span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger disabled={disabled || busy} render={<Button type="button" variant="outline" size="xs" icon={Smile} />}>{t("Emoji")}</Popover.Trigger>
        <Popover.Portal><Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-[70]"><Popover.Popup className="overflow-hidden rounded-2xl border border-foreground/10 bg-surface-32 shadow-xl outline-none"><ReactionPicker onBack={() => setOpen(false)} onSelect={(emoji) => { onChange(emoji); setOpen(false); }} /></Popover.Popup></Popover.Positioner></Popover.Portal>
      </Popover.Root>
      <Button type="button" variant="outline" size="xs" icon={ImagePlus} disabled={disabled} loading={busy} onClick={() => fileInput.current?.click()}>{t("Upload")}</Button>
      {value ? <Button type="button" variant="ghost" size="xs" icon={X} disabled={disabled || busy} onClick={() => onChange(null)}>{t("Reset")}</Button> : null}
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" aria-label={t("Upload icon")} onChange={(event) => { void chooseImage(event.target.files?.[0]); event.target.value = ""; }} />
    </div>
    {error ? <p role="alert" className="text-xs text-destructive-300">{error}</p> : null}
  </div>;
}
