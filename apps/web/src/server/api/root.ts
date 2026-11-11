import { accountRouter } from "./routers/account";
import { apiKeysRouter } from "./routers/api-keys";
import { attachmentsRouter } from "./routers/attachments";
import { betaAccessRouter } from "./routers/beta-access";
import { billingRouter } from "./routers/billing";
import { chatRouter } from "./routers/chat";
import { memoryRouter } from "./routers/memory";
import { migrationRouter } from "./routers/migration";
import { organizationRouter } from "./routers/organization";
import { preferencesRouter } from "./routers/preferences";
import { projectsRouter } from "./routers/projects";
import { resetCreditsRouter } from "./routers/reset-credits";
import { teamDomainsRouter } from "./routers/team-domains";
import { router } from "./trpc";

export const appRouter = router({
  account: accountRouter,
  apiKeys: apiKeysRouter,
  attachments: attachmentsRouter,
  betaAccess: betaAccessRouter,
  chat: chatRouter,
  memory: memoryRouter,
  billing: billingRouter,
  migration: migrationRouter,
  organization: organizationRouter,
  preferences: preferencesRouter,
  projects: projectsRouter,
  resetCredits: resetCreditsRouter,
  teamDomains: teamDomainsRouter,
});

export type AppRouter = typeof appRouter;
