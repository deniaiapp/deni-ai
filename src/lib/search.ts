import { createFromSource } from 'fumadocs-core/search/server';
import { source } from './source';

// The default multilingual tokenizer handles both English and Japanese.
export const searchServer = createFromSource(source);
