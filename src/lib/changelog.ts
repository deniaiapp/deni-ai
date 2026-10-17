export type ChangelogHighlight = {
  title: string;
  body: string;
};

export type ChangelogEntry = {
  version: string;
  codename?: string;
  date: string;
  summary: string;
  highlights: ChangelogHighlight[];
};

export const changelogEntries: ChangelogEntry[] = [
  {
    version: "7.10",
    codename: "Silver Compass",
    date: "2026-10-17",
    summary:
      "Side-by-side model comparisons, a refreshed model lineup and picker, private attachments, and many reliability fixes.",
    highlights: [
      {
        title: "Model comparisons",
        body: "Pro and Max users can send one prompt to several models side by side, with separate settings for each and saved comparisons. Open it from the sidebar.",
      },
      {
        title: "Refreshed model lineup",
        body: "Added Claude Haiku 5.5 and Gemini 3.5 Flash Lite, and retired older generations including GPT-5.5 and earlier, Claude 4.x, older Gemini models, DeepSeek, and MiniMax. GPT-5.6 models now require Pro or Max. The Free plan includes GPT-6 Luna, Claude Haiku 5.5, and Gemini 3.8 Flash.",
      },
      {
        title: "Model picker updates",
        body: "The model picker opens beside the composer on desktop and as a sheet on mobile, shows whether each model is currently available, and remembers the last model you chose.",
      },
      {
        title: "Private attachments",
        body: "Text files you attach are now read into your prompt. Attachments are stored privately, are deleted along with their chat, and count toward a per-plan storage limit.",
      },
      {
        title: "Billing and data export",
        body: "Free trials have been replaced by limited-time offers on yearly and lifetime plans, and Pro and Max usage limits have been adjusted. Data exports are now prepared in the background and can be downloaded from Settings for seven days.",
      },
      {
        title: "Ads",
        body: "Advertisers can now target campaigns by language, and ads can appear on the homepage.",
      },
      {
        title: "Retired features",
        body: "Image and video generation, the affiliate program, and signing in to other apps with Deni AI (added in 7.9) have been removed.",
      },
      {
        title: "Fixes and polish",
        body: "Clearer translated error messages, a wider sidebar, a composer that stays at the bottom of long chats, a working Regenerate menu, and a fix for the first message from the chat home being lost. Also includes security and billing fixes.",
      },
    ],
  },
  {
    version: "7.9",
    codename: "Neon Shield",
    date: "2026-09-30",
    summary: "We made a major UI redesign, added ads, and fixed bugs.",
    highlights: [
      {
        title: "Model Addition",
        body: "Added GPT-6, Claude 5.5, and other models.",
      },
      {
        title: "UI Update",
        body: "We updated the design to feature rounded corners and redesigned the Composer.",
      },
      {
        title: "Addition of Ads",
        body: "You can now run ads at a low cost with Deni AI Ads.",
      },
      {
        title: "Integration with OAuth applications",
        body: "You can now log in to Deni AI from other apps.",
      },
      {
        title: "Minor bug fixes",
        body: "Includes bug fixes for minor issues",
      },
    ],
  },
  {
    version: "7.8.1",
    codename: "Golden Arrow",
    date: "2026-09-11",
    summary: "Faster code highlighting in chat and quicker loading of long conversations.",
    highlights: [
      {
        title: "Faster code highlighting",
        body: "Chat code blocks now highlight as they stream, without waiting on a heavy syntax engine.",
      },
      {
        title: "Faster long chats",
        body: "Opening a chat loads the latest messages first. Older messages load when you scroll up.",
      },
    ],
  },
  {
    version: "7.8.0",
    codename: "Golden Arrow",
    date: "2026-08-27",
    summary:
      "Team controls, safer chats, and a tighter security loop around how you sign in and manage memory.",
    highlights: [
      {
        title: "Chat & Memory Enhancements",
        body: "You can now have assistant messages read aloud and search through memory.",
      },
      {
        title: "Security Enhancements",
        body: "You can now view your sign-in and account action history, as well as log out of sessions even for accounts that have been logged in for several days.",
      },
      {
        title: "Project Enhancements",
        body: "You can now archive projects, configure default models, and share them with your team.",
      },
      {
        title: "Data Exporting",
        body: "You can now export your Deni AI data (e.g., chats, memory, projects, profile).",
      },
      {
        title: "Chat Importing",
        body: "You can migrate data from external sources and export data.",
      },
      {
        title: "Team Management",
        body: "Administrators and owners can now manage billing, share projects with their teams, review audit logs, and change user roles.",
      },
      {
        title: "Other changes",
        body: "PWA feature expansion, Max Mode bug fixes, and other bug fixes and UI updates.",
      },
    ],
  },
  {
    version: "7.7.0",
    codename: "Stellar Shield",
    date: "2026-08-16",
    summary:
      "The Stellar Shield release: a calmer home, featured writing, and a more durable chat shell.",
    highlights: [
      {
        title: "Featured blog",
        body: "Editorial posts can be highlighted on the public blog so product notes are easier to find.",
      },
      {
        title: "Chat reliability",
        body: "Generation recovery, usage refresh, and composer flow were tightened so long replies fail less often.",
      },
    ],
  },
  {
    version: "7.5.0",
    codename: "Crystal Tiger",
    date: "2026-06-20",
    summary: "Teams, Max Mode policy, and a clearer free-tier boost for people who verify a card.",
    highlights: [
      {
        title: "Team Max Mode policies",
        body: "Organizations can set default Max Mode limits per member instead of sharing one global cap.",
      },
      {
        title: "Card verification boost",
        body: "Free accounts can verify a card for extra capacity. Disposable email signups are blocked.",
      },
      {
        title: "Deep dark themes",
        body: "Appearance presets gained deeper dark options without changing the rest of the workspace.",
      },
    ],
  },
];
