type TitleDocument = { title: string; head: Node };
type ObserverConstructor = new (callback: () => void) => {
  observe(target: Node, options: MutationObserverInit): void;
  disconnect(): void;
};

export type TitleEntry = { title: string };

/**
 * Titles requested by mounted DocumentTitle components; the most recently
 * mounted one wins. One shared observer reapplies it when a route head
 * re-renders <title>. Each component used to observe on its own, so two
 * mounted at once (the settings page still shown while a chat route loads)
 * rewrote each other's title forever and froze the browser.
 */
export function createTitleStack(doc: TitleDocument, Observer: ObserverConstructor) {
  const entries: TitleEntry[] = [];
  let observer: InstanceType<ObserverConstructor> | null = null;
  let baseTitle = doc.title;

  const apply = () => {
    const top = entries.at(-1);
    if (top && doc.title !== top.title) {
      doc.title = top.title;
    }
  };

  return {
    push(title: string): TitleEntry {
      if (entries.length === 0) {
        baseTitle = doc.title;
        observer = new Observer(apply);
        observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
      }
      const entry = { title };
      entries.push(entry);
      apply();
      return entry;
    },
    update(entry: TitleEntry, title: string) {
      entry.title = title;
      apply();
    },
    remove(entry: TitleEntry) {
      const index = entries.indexOf(entry);
      if (index === -1) return;
      entries.splice(index, 1);
      if (entries.length > 0) {
        apply();
        return;
      }
      observer?.disconnect();
      observer = null;
      if (doc.title === entry.title) {
        doc.title = baseTitle;
      }
    },
  };
}
