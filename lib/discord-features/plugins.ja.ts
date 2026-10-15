/** Japanese strings for lib/discord-features/plugins.ts. Keys must match the English text exactly. */
export const ja: Record<string, string> = {
  "Send email": "メールの送信",
  "Create files": "ファイルの作成",
  "Update files": "ファイルの更新",
  "Create issues": "Issue の作成",
  "Open pull requests": "プルリクエストの作成",
  "Comment on issues and pull requests": "Issue とプルリクエストへのコメント",
  "Edit, close, and reopen issues and pull requests": "Issue とプルリクエストの編集・クローズ・再オープン",
  "Review pull requests": "プルリクエストのレビュー",
  "Merge pull requests": "プルリクエストのマージ",
  "Re-run failed workflow jobs": "失敗したワークフロージョブの再実行",
  "Connected · search and read": "接続済み · 検索と閲覧",
  "Not connected": "未接続",
  "Write access: on": "書き込みアクセス: オン",
  "Write access: off": "書き込みアクセス: オフ",
  "Always allowed: {actions}": "常に許可: {actions}",
  "none": "なし",
  "That plugin is not available. Choose one of: {plugins}": "そのプラグインは利用できません。次から選んでください: {plugins}",
  "No plugins are available right now.": "現在利用できるプラグインはありません。",
  "Write actions wait for your approval unless they are always allowed. Change that with /plugins allow.":
    "書き込み操作は、常に許可していない限りあなたの承認を待ちます。/plugins allow で変更できます。",
  "Connecting {plugin} needs a {provider} sign-in in your browser, so it is done in the app: open Plugins and choose Connect.":
    "{plugin} の接続にはブラウザでの {provider} へのサインインが必要なため、アプリで行います。プラグインを開いて「接続」を選んでください。",
  "{plugin} is connected for search and read. To let teammates write too, open Plugins in the app and choose Enable write access.":
    "{plugin} は検索と閲覧用に接続済みです。チームメイトに書き込みも任せるには、アプリでプラグインを開いて「書き込みを有効にする」を選んでください。",
  "{plugin} is already connected. To reconnect, open Plugins in the app and choose Reconnect.":
    "{plugin} はすでに接続済みです。再接続するには、アプリでプラグインを開いて「再接続」を選んでください。",
  "{plugin} is not connected.": "{plugin} は接続されていません。",
  "Disconnect {plugin}? Teammates will lose access to it right away. You can connect it again later.":
    "{plugin} の接続を解除しますか?チームメイトは直ちに使えなくなります。あとで再び接続できます。",
  "Disconnect": "接続を解除",
  "Choose one of the write actions for {plugin}: {actions}": "{plugin} の書き込み操作から選んでください: {actions}",
  "Turn on write access for {plugin} in the app first.": "先にアプリで {plugin} の書き込みアクセスを有効にしてください。",
  "Connect {plugin} in the app first.": "先にアプリで {plugin} を接続してください。",
  "{action} in {plugin} is now always allowed: teammates do it without asking you first.":
    "{plugin} の「{action}」を常に許可しました。チームメイトはあなたに確認せずに実行します。",
  "{action} in {plugin} now waits for your approval each time.": "{plugin} の「{action}」は毎回あなたの承認を待つようになりました。",
  "connected": "接続済み",
  "not connected": "未接続",
  "always allowed": "常に許可",
  "That plugin is not available.": "そのプラグインは利用できません。",
  "Could not disconnect plugin.": "プラグインの接続を解除できませんでした。",
  "Disconnected {plugin}. Teammates can no longer use it.": "{plugin} の接続を解除しました。チームメイトは使用できなくなりました。",
  // Thrown by lib/builtin-plugins.ts and shown through translateError.
  "Could not revoke access at Google. Try again.": "Google 側のアクセス権を取り消せませんでした。もう一度お試しください。",
  "Could not revoke access at GitHub. Try again.": "GitHub 側のアクセス権を取り消せませんでした。もう一度お試しください。",
};
