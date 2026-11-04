import { createServerFn } from '@tanstack/react-start';
import { source } from './source';

/** Sidebar tree for pages outside the docs source, such as the contact form. */
export const loadPageTree = createServerFn({ method: 'GET' })
  .validator((data: { lang: string }) => data)
  .handler(async ({ data: { lang } }) => ({
    pageTree: await source.serializePageTree(source.getPageTree(lang)),
  }));
