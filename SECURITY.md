# Security policy

脆弱性を見つけた場合は、公開issueへ詳細を書かず、GitHubのprivate vulnerability reportingから報告してください。

対象:

- <https://github.com/yhay81/chord-dai/security/advisories/new>

## 設計上の境界

- アプリの永続コンテンツはIndexedDBだけ
- DOMは`textContent`と`createTextNode`で構築し、譜面をHTMLとして解釈しない
- APIは同一origin、JSON、1KB以下、正確な`{name}`、許可イベント、UUIDを検査
- CSP、frame禁止、権限禁止、HSTS、no-referrer
- 読込は6MB・200曲・5万文字/曲・UUID・exact schema・値域・参照重複を検査
- D1にはコンテンツ・識別情報を持たず、QAを分離し、45日で削除

サポート対象は最新の主要ブラウザーです。
