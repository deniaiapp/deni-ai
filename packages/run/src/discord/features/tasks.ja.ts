/** Japanese strings for src/lib/discord/features/tasks.ts. Keys must match the English text exactly. */
export const ja: Record<string, string> = {
  Queued: "待機中",
  Running: "実行中",
  Finishing: "仕上げ中",
  "Waiting for approval": "承認待ち",
  "Needs you": "対応待ち",
  Paused: "一時停止中",
  "Needs review": "要確認",
  Completed: "完了",
  Failed: "失敗",
  Cancelled: "キャンセル済み",
  Chat: "チャット",
  Routine: "ルーティン",
  Handoff: "引き継ぎ",
  Retry: "再試行",
  "Removed teammate": "削除されたチームメイト",
  "Deleted conversation": "削除された会話",
  "the group {name}": "グループ「{name}」",
  "your chat with {name}": "{name} さんとのチャット",
  "{teammate} in {conversation}": "{conversation} の {teammate}",
  "In progress": "進行中",
  Recent: "最近",
  "Stop {number}": "{number} を停止",
  "Retry {number}": "{number} を再試行",
  "No tasks yet. They appear here when a teammate works on a message or a routine runs.":
    "タスクはまだありません。チームメイトがメッセージに取り組んだり、ルーティンが実行されたりすると、ここに表示されます。",
  "Nothing is running in {conversation}.": "{conversation}で実行中のタスクはありません。",
  "Nothing is running in {conversation} anymore.":
    "{conversation}で実行中のタスクはもうありません。",
  Stop: "停止",
  "Stop task": "タスクを停止",
  "Stop the task in {conversation}? It ends now and cannot be resumed.":
    "{conversation}のタスクを停止しますか? すぐに終了し、再開はできません。",
  "Stop {count} tasks in {conversation}? They end now and cannot be resumed.":
    "{conversation}の {count} 件のタスクを停止しますか? すぐに終了し、再開はできません。",
  "Stop this task? It ends now and cannot be resumed.":
    "このタスクを停止しますか? すぐに終了し、再開はできません。",
  "Stopped the task in {conversation}.": "{conversation}のタスクを停止しました。",
  "Stopped {count} tasks in {conversation}.": "{conversation}の {count} 件のタスクを停止しました。",
  "Stopped the task for {name}.": "{name} さんのタスクを停止しました。",
  "That conversation no longer exists.": "その会話はもう存在しません。",
  "That task is no longer running, so there is nothing to stop.":
    "そのタスクはもう実行されていないため、停止するものはありません。",
  "That task was not found.": "そのタスクは見つかりませんでした。",
  "This task cannot be retried. Only failed tasks with attempts left can run again.":
    "このタスクは再試行できません。再試行できるのは、試行回数が残っている失敗したタスクだけです。",
  "This task stopped unexpectedly and may have already done part of its work, such as sending a message or changing files. Check the conversation in the app before running it again.":
    "このタスクは予期せず止まったため、メッセージの送信やファイルの変更など、作業の一部がすでに行われている可能性があります。もう一度実行する前に、アプリで会話を確認してください。",
  "Retry anyway": "それでも再試行",
  "Retrying the task for {name}. You will hear here when it ends.":
    "{name} さんのタスクを再試行しています。終わったらここでお知らせします。",
  "{name} finished the retried task.": "{name} さんが再試行したタスクを終えました。",
  "The retried task failed: {error}": "再試行したタスクが失敗しました: {error}",
  "The retried task is waiting for your approval.":
    "再試行したタスクがあなたの承認を待っています。",
  "The retried task needs your help on the computer.":
    "再試行したタスクで、コンピューター操作の手助けが必要です。",
  "The retried task stopped unexpectedly. Check it with /tasks list.":
    "再試行したタスクが予期せず止まりました。/tasks list で確認してください。",
  "The retried task was cancelled.": "再試行したタスクはキャンセルされました。",
};
