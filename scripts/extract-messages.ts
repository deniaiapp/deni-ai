// Syncs messages/*.po with the messages in the source. `vite dev` and `vite build` do this too;
// this is for updating the catalogs without starting either.
import { extractMessages } from "../i18n/extract";

const written = await extractMessages(process.cwd());
console.info(written.length > 0 ? `Updated ${written.map((locale) => `messages/${locale}.po`).join(", ")}` : "Catalogs are up to date");
