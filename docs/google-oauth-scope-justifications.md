# Google OAuth scope justifications

Text to paste into the "How will the scopes be used?" field of the OAuth consent screen
(Google Cloud Console → Data Access). Each entry is 1000 characters or fewer.

Scopes requested by the app (see `lib/builtin-plugins.ts`):

| Scope | Class | API |
|---|---|---|
| `https://www.googleapis.com/auth/gmail.send` | Sensitive | Gmail API |
| `https://www.googleapis.com/auth/gmail.readonly` | Restricted | Gmail API |
| `https://www.googleapis.com/auth/drive.readonly` | Restricted | Google Drive API |
| `https://www.googleapis.com/auth/drive.file` | Non-sensitive | Google Drive API |

Sign-in itself uses only `openid`, `email`, and `profile`.

Remove `https://mail.google.com/` from Data Access if it is listed. The code never requests it.

## gmail.send (sensitive)

```
Deni Run is an AI-teammate app. Users can optionally connect Gmail from the in-app Plugins dialog and ask a teammate to send an email they requested (e.g. "email this summary to my manager"). gmail.send is used only to call users.messages.send for that message. Each message requires the user's explicit in-app approval unless the user turns on "always allow" for sending. The scope is requested separately from read access, so users can grant reading without sending. gmail.send is the narrowest scope that can send mail: it cannot read, list, modify or delete anything, and compose/modify/full-access scopes grant far more than needed. We do not send mail without a user request, and no bulk, marketing or automated messages are sent.
```

## gmail.readonly (restricted)

```
Deni Run is an AI-teammate app. After the user optionally connects Gmail from the in-app Plugins dialog, a teammate can search the user's mailbox and read specific messages (sender, recipient, date, subject and plain-text body) when the user asks for a task such as "summarize the unread emails from my client" or "find the invoice from March". We call users.messages.list with the user's search query and users.messages.get for individual messages, only on user request. We never scan, index or bulk-copy the mailbox. Retrieved text is used only to answer that task, and is not used for ads or to train AI models. gmail.metadata is insufficient because it excludes message bodies, which are required to summarize or answer questions. Users can revoke access at any time in their Google Account.
```

## drive.readonly (restricted)

```
Deni Run is an AI-teammate app. After the user optionally connects Google Drive from the in-app Plugins dialog, a teammate can search the user's Drive by file name and read the content of Google Docs (exported as plain text) and small text files when the user asks for a task such as "use my project brief in Drive to draft the report". We call files.list, files.get and files.export only on user request. We never scan, index or bulk-copy the Drive. Retrieved content is used only to complete that task, and is not used for ads or to train AI models. drive.file is insufficient for this purpose because it only exposes files created or opened by our app, and users' existing documents are by definition not visible to it. Users can revoke access at any time in their Google Account.
```

## drive.file (non-sensitive)

Google does not require a justification for non-sensitive scopes. If the field appears, use:

```
Deni Run is an AI-teammate app. When the user has connected Google Drive and asks a teammate to save its output (e.g. "save this report to my Drive"), the app creates a new text file and later updates only files it created itself. drive.file limits access to files created by the app, so it cannot touch any other file in the user's Drive. Each create or update requires the user's in-app approval unless the user turns on "always allow".
```

## Notes

- Choose app features close to "AI assistant: search and summarize email" and "search and read documents" in the "which feature uses this data" dropdown.
- Reviewers may suggest Google Picker with `drive.file` instead of `drive.readonly`. Explain that teammates search Drive on their own during a chat task, and show that flow in the demo video.
- Only send and create/update are approval-gated. Reads run without approval, so do not say reads need approval.
- Record the demo video in a staging environment or a separate test project, not production, so the unverified-user quota is not consumed. The unverified-app screen must appear in the video.
- Limited Use also requires that the model providers receiving retrieved content do not train on it. Confirm OpenRouter's data policy (no training / ZDR) before submitting.
