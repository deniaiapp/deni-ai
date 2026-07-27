# Task: Flixa VS Code extension に client signal ヘッダを実装する

## Context

Flixa backend (Deni AI API) に abuse 対策が入った。

認証付き agent エンドポイントへのリクエストで、次のいずれかの **client signal** が無いと:

1. そのユーザーを Flixa から ban する（`flixa_ban` に記録）
2. 全 API キーを revoke する
3. `403` を返す（`code: missing_client_signal`）

許可クライアント: **Codex / Claude Code / OpenCode / Flixa**

Flixa VS Code 拡張は first-party なので、**Deni AI / Flixa backend に送るすべての HTTP リクエスト**に Flixa signal を必ず付けること。
付け忘れると正規ユーザーが ban される。

## Backend が Flixa と判定する条件（いずれか1つで OK）

backend: `utils/deni/clientSignal.ts`

- `User-Agent` に `flixa` が含まれる（case-insensitive）
- `x-flixa-client` ヘッダが存在する（値は非空なら何でも可）
- `x-client` に `flixa` が含まれる
- `Referer` / `HTTP-Referer` が `flixa.deniai.app` または `flixa.` を含む
- （任意）backend に `FLIXA_CLIENT_SIGNAL_SECRET` がある場合: `x-flixa-signal: <secret>` が一致

## 実装してほしいこと

### 1. 共通ヘッダヘルパーを1箇所に作る

すべての Flixa/Deni API 呼び出しがここを通るようにする。散在させない。

```ts
// 例: src/api/flixaClientHeaders.ts など
import * as vscode from "vscode";

export function getFlixaClientHeaders(): Record<string, string> {
  const version =
    vscode.extensions.getExtension("YOUR_PUBLISHER.flixa")?.packageJSON
      ?.version ?? "0.0.0";

  // VS Code / Electron では User-Agent を上書きできない環境があるため、
  // x-flixa-client を必須 signal にする（backend はこれだけで Flixa と判定する）
  return {
    "User-Agent": `flixa-vscode/${version}`,
    "x-flixa-client": `vscode/${version}`,
    "x-client": "flixa-vscode",
    // 任意: 環境変数や設定で secret がある場合のみ
    // "x-flixa-signal": getFlixaSignalSecret(),
  };
}
```

### 2. 適用するリクエスト（漏れ禁止）

Flixa backend / Deni AI API に向かう **すべて**:

- `POST /v1/agent/chat/completions`
- `POST /v1/agent/responses`（あれば）
- `POST /v1/messages`（Anthropic 互換を使っている場合）
- `GET /v1/models`
- その他 auth 付きの agent / model 系

**対象外でよいもの:**

- ログイン / OAuth / Deni Web の通常ページ
- テレメトリや無関係な外部 API

※ `/v1/deni/usage` などは backend 側では signal 強制していないが、
  将来の統一のため **同じヘッダを付けてよい**（推奨）。

### 3. fetch / axios / openai SDK など、HTTP クライアントすべての入口を直す

- raw `fetch` → headers に merge
- OpenAI SDK → `defaultHeaders` / `fetch` wrapper
- Anthropic SDK → `defaultHeaders`
- ストリーム・非ストリーム両方
- リトライ時も同じヘッダ

既存の `Authorization` / `x-api-key` / `Content-Type` は消さない。
**追加 merge** すること。

```ts
headers: {
  ...getFlixaClientHeaders(),
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  // existing headers...
}
```

### 4. User-Agent が上書きできない場合のフォールバック

VS Code 拡張の Node/Electron fetch では `User-Agent` が無視・固定されることがある。

そのため **必ず `x-flixa-client` を付ける**こと。
backend は `x-flixa-client` が非空なら Flixa と判定する。

`User-Agent` は付けられるなら付ける（best-effort）。

### 5. エラーハンドリング

backend が以下を返したら、ユーザーに分かりやすく表示する:

| HTTP | code | 意味 | UI 案 |
|------|------|------|--------|
| 403 | `missing_client_signal` | signal 不足で ban された | 「拡張を最新版に更新してください。不正クライアントとしてアカウントが制限された可能性があります。サポートに連絡してください。」 |
| 403 | `banned` | 既に ban 済み | 「Flixa の利用が制限されています。サポートに連絡してください。」 |
| 401 | `invalid_key` / `expired_key` | キー無効（ban で revoke された場合も含む） | 再ログインを促す |

`missing_client_signal` は実装バグの可能性が高いので、ログに request path と付与ヘッダ名を残す（API キーはログに出さない）。

### 6. バージョン文字列

`x-flixa-client` の値は次の形式を推奨:

```
vscode/<extensionVersion>
```

例: `vscode/1.4.2`

可能なら platform も:

```
vscode/1.4.2 (win32)
```

### 7. テスト

- [ ] chat/completions リクエストに `x-flixa-client` が付く
- [ ] models 一覧リクエストに `x-flixa-client` が付く
- [ ] streaming リクエストにも付く
- [ ] `x-flixa-client` を意図的に外すと 403 `missing_client_signal` になることを確認（staging / ローカル backend）
- [ ] 正規ヘッダ付きでは 403 ban にならない
- [ ] API キーや secret がログに出ていない

### 8. 実装方針

- ヘッダ生成は **単一モジュール** に集約
- HTTP の出口が複数あるなら、共通 `flixaFetch` / `createFlixaHttpClient` に寄せる
- マジックストリング `"flixa"` をバラバラに書かない
- 既存のコーディングスタイルに合わせる
- 関係ないリファクタはしない

## 参考: backend SDK が送っているもの

```http
User-Agent: flixa-sdk/1.0
x-flixa-client: sdk
```

拡張では例えば:

```http
User-Agent: flixa-vscode/1.4.2
x-flixa-client: vscode/1.4.2
x-client: flixa-vscode
```

## 完了条件

1. Flixa backend への全認証付き API 呼び出しに `x-flixa-client` が付く
2. ローカル / staging で ban されずに chat と models が動く
3. signal 欠落時の 403 をユーザー向けメッセージで扱える
4. 変更箇所がレビューしやすい（共通ヘッダ + 各 client の配線のみ）
```

---

## 使い方メモ

- 拡張リポジトリでこのプロンプトをそのままエージェント / 実装者に渡せる
- `YOUR_PUBLISHER.flixa` は実際の extension id に差し替え
- **必須は `x-flixa-client`**。`User-Agent` だけに頼らない（VS Code では落ちやすい）
- 本番で `FLIXA_CLIENT_SIGNAL_SECRET` を使うなら、secret は拡張にハードコードせず、ビルド時埋め込みや remote config を検討
