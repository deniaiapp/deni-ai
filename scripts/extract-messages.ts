// Syncs src/i18n/messages/*.po with the messages in the source. `vite dev` and `vite build` do this too;
// this is for updating the catalogs without starting either.
import { extractMessages } from "../src/i18n/extract";

const written = await extractMessages(process.cwd());
console.info(written.length > 0 ? `Updated ${written.map((locale) => `src/i18n/messages/${locale}.po`).join(", ")}` : "Catalogs are up to date");
