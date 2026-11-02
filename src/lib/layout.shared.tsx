import { uiTranslations } from 'fumadocs-ui/i18n';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { i18n } from './i18n';
import { appName } from './shared';

// There is no official Japanese language pack, so the UI strings are translated here.
export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    en: {
      displayName: 'English',
    },
    ja: {
      displayName: '日本語',
      'Back to Home(404 not found page)': 'ホームに戻る',
      'Choose a language(language switcher)': '言語を選択',
      'Choose a language(language switcher)(aria-label)': '言語を選択',
      'Close Search(search dialog)(aria-label)': '検索を閉じる',
      'Close Sidebar(aria-label)': 'サイドバーを閉じる',
      'Close Sidebar(sidebar)(aria-label)': 'サイドバーを閉じる',
      'Collapse Sidebar(sidebar)(aria-label)': 'サイドバーを折りたたむ',
      'Copied Anchor Link(heading anchor)(aria-label)': 'リンクをコピーしました',
      'Copied Markdown(page actions)': 'Markdown をコピーしました',
      'Copied Text(code block)(aria-label)': 'コピーしました',
      'Copy Anchor Link(heading anchor)(aria-label)': 'リンクをコピー',
      'Copy Markdown(page actions)': 'Markdown をコピー',
      'Copy Text(code block)(aria-label)': 'コピー',
      'Dark(theme switcher)(aria-label)': 'ダーク',
      'Hide Sidebar(sidebar)': 'サイドバーを隠す',
      'Language(language switcher)': '言語',
      'Last updated on(page footer)': '最終更新日',
      'Light(theme switcher)(aria-label)': 'ライト',
      'Next Page(pagination)': '次のページ',
      'No Headings(table of contents)': '見出しがありません',
      'No results found(search dialog)': '見つかりませんでした',
      'On this page(table of contents)': 'このページの内容',
      'Open Search(search trigger)(aria-label)': '検索を開く',
      'Open Sidebar(aria-label)': 'サイドバーを開く',
      'Open Sidebar(sidebar)(aria-label)': 'サイドバーを開く',
      'Options(aria-label)': 'オプション',
      'Page Not Found(404 not found page)': 'ページが見つかりません',
      'Previous Page(pagination)': '前のページ',
      'Search failed(search dialog)': '検索に失敗しました',
      'Search failed, showing results for {query}(search dialog)':
        '検索に失敗したため、{query} の結果を表示しています',
      'Search(search dialog)': '検索',
      'Search(search trigger)': '検索',
      'Show Sidebar(sidebar)': 'サイドバーを表示',
      'System(theme switcher)(aria-label)': 'システム',
      'Table of Contents(inline table of contents)': '目次',
      'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 not found page)':
        'お探しのページは削除されたか、名前が変わったか、一時的に利用できない可能性があります。',
      'Theme(site menu)': 'テーマ',
      'Toggle Menu(home layout header)(aria-label)': 'メニューを切り替える',
      'Toggle Theme(theme switcher)(aria-label)': 'テーマを切り替える',
    },
  });

export function baseOptions(locale: string): BaseLayoutProps {
  const isJapanese = locale === 'ja';

  return {
    nav: {
      title: appName,
      url: `/${locale}`,
    },
    links: [
      {
        text: 'Deni AI',
        url: isJapanese ? 'https://deniai.app/ja' : 'https://deniai.app',
        external: true,
      },
      {
        text: isJapanese ? 'お問い合わせ' : 'Contact',
        url: isJapanese ? 'https://deniai.app/ja/contact' : 'https://deniai.app/contact',
        external: true,
      },
    ],
  };
}
