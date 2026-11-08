import { useLocation } from '@tanstack/react-router';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from 'fumadocs-ui/components/ui/popover';
import { ChevronDown, ExternalLinkIcon, TextIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Language } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { siteUrl } from '@/lib/shared';

const labels = {
  en: {
    open: 'Open',
    viewAsMarkdown: 'View as Markdown',
    openInDeniAi: 'Open in Deni AI',
    prompt: (url: string) => `Read ${url}, I want to ask questions about it.`,
  },
  ja: {
    open: '開く',
    viewAsMarkdown: 'Markdown で見る',
    openInDeniAi: 'Deni AI で開く',
    prompt: (url: string) => `${url} を読んで、内容について質問に答えてください。`,
  },
} satisfies Record<Language, unknown>;

/** Replaces Fumadocs' `ViewOptionsPopover`, whose third-party AI links can't be configured. */
export function ViewOptionsPopover({ lang, markdownUrl }: { lang: Language; markdownUrl: string }) {
  const { pathname } = useLocation();
  const t = labels[lang];
  const prompt = t.prompt(`${siteUrl}${pathname}`);

  const items: { title: string; href: string; icon: ReactNode }[] = [
    { title: t.viewAsMarkdown, href: markdownUrl, icon: <TextIcon /> },
    {
      title: t.openInDeniAi,
      // `/new/$message` creates a chat and sends the message; web search lets it read the page.
      href: `https://deniai.app/new/${encodeURIComponent(prompt)}?webSearch=true`,
      icon: <img src="/deni-ai.png" alt="" width={16} height={16} />,
    },
  ];

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: 'secondary', size: 'sm' }),
          'gap-2 data-[popup-open]:bg-fd-accent data-[popup-open]:text-fd-accent-foreground',
        )}
      >
        {t.open}
        <ChevronDown className="size-3.5 text-fd-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="flex flex-col">
        {items.map((item) => (
          <a
            key={item.href}
            href={item.href}
            rel="noreferrer noopener"
            target="_blank"
            className="text-sm p-2 rounded-lg inline-flex items-center gap-2 hover:text-fd-accent-foreground hover:bg-fd-accent [&_svg]:size-4"
          >
            {item.icon}
            {item.title}
            <ExternalLinkIcon className="text-fd-muted-foreground size-3.5 ms-auto" />
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}
