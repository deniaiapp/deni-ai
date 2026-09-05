"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Search, X } from "lucide-react";
import { EMOJI_CATALOG } from "@/lib/emoji-catalog";

const categories = [
  ["smileys_people", "☺", "Smileys & People"], ["animals_nature", "♧", "Animals & Nature"],
  ["food_drink", "☕", "Food & Drink"], ["travel_places", "✈", "Travel & Places"],
  ["activities", "⚽", "Activities"], ["objects", "♬", "Objects"],
  ["symbols", "♡", "Symbols"], ["flags", "⚑", "Flags"],
] as const;

export default function ReactionPicker({ onSelect, onBack }: { onSelect: (emoji: string) => void; onBack: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("smileys_people");
  const [tone, setTone] = useState(0);
  const [limit, setLimit] = useState(96);
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return EMOJI_CATALOG.filter((entry) => term ? entry[2].includes(term) || entry[0] === term : entry[3] === category);
  }, [query, category]);
  return <div className="w-[304px] max-w-[calc(100vw-32px)] p-2.5 text-[#e6e6e6]">
    <div className="mb-2 flex items-center gap-2">
      <button type="button" aria-label="Back to quick reactions" onClick={onBack} className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white"><ArrowLeft size={15} /></button>
      <span className="flex-1 text-xs font-medium">Emoji</span>
      <select aria-label="Skin tone" value={tone} onChange={(event) => setTone(Number(event.target.value))} className="max-w-20 rounded-lg bg-transparent px-1 py-1 text-sm outline-none focus:ring-1 focus:ring-white/30">
        {["👋", "👋🏻", "👋🏼", "👋🏽", "👋🏾", "👋🏿"].map((emoji, index) => <option key={index} value={index} className="bg-[#202020]">{emoji}</option>)}
      </select>
    </div>
    <label className="flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-2 ring-1 ring-white/5 focus-within:ring-white/20">
      <Search size={14} className="shrink-0 text-neutral-500" />
      <input autoFocus aria-label="Search emoji" placeholder="Search emoji…" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(96); }} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-neutral-500" />
      {query ? <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setLimit(96); }} className="text-neutral-500 hover:text-white"><X size={13} /></button> : null}
    </label>
    <div className="mt-2 flex justify-between gap-0.5" role="group" aria-label="Emoji categories">
      {categories.map(([id, icon, label]) => <button key={id} type="button" title={label} aria-label={label} aria-pressed={!query && category === id} onClick={() => { setCategory(id); setQuery(""); setLimit(96); }} className="flex size-8 items-center justify-center rounded-lg text-lg text-neutral-500 hover:bg-white/5 hover:text-white aria-pressed:bg-white/10 aria-pressed:text-white">{icon}</button>)}
    </div>
    <div className="scroll-thin mt-2 h-[240px] max-h-[45vh] overflow-y-auto overscroll-contain" onScroll={(event) => { const el = event.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 70) setLimit((value) => Math.min(value + 96, matches.length)); }}>
        <div className="grid grid-cols-8 gap-0.5" role="group" aria-label="Emoji results">
          {matches.slice(0, limit).map(([emoji, label, , , variants]) => {
            const value = tone && variants.length === 5 ? variants[tone - 1] ?? emoji : emoji;
            return <button key={emoji} type="button" title={label} aria-label={`${label} ${value}`} onClick={() => onSelect(value)} className="flex aspect-square items-center justify-center rounded-lg text-[22px] leading-none transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white/40">{value}</button>;
          })}
        </div>
        {!matches.length ? <p className="py-10 text-center text-xs text-neutral-500">No emoji found</p> : null}
        {matches.length > limit ? <button type="button" onClick={() => setLimit((value) => value + 96)} className="w-full py-3 text-xs text-neutral-400 hover:text-white">Show more</button> : null}
    </div>
  </div>;
}
