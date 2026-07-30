# コード台

手元のコード譜を貼り、移調、カポ、自動スクロール、メトロノーム、曲順で演奏できるローカルファーストの日本語Webアプリです。

- 本番: <https://chord-dai.yhay81.com>
- 所有: yhay81 の個人プロジェクト
- ライセンス: MIT

## 境界

コード台は楽曲カタログ、歌詞検索、コード譜共有サービスではありません。利用者が自作した内容、パブリックドメイン、許諾を得た内容など、利用する権利のある手元の譜面だけを端末内で扱います。

曲名、作曲者名、コード譜、メモ、曲順、演奏設定はIndexedDBだけに保存され、サーバーへ送信されません。サーバーには許可した匿名イベント名だけを45日間保存します。

## 開発

Node.js 24 LTS と npm 11 を使います。

```powershell
npm install
npm run release:check
npm run check
npm test
npm run build
npm run dev
```

## 公開

Cloudflareの認証済み環境でD1を作成し、`wrangler.jsonc`のdatabase IDを設定してから実行します。

```powershell
npx wrangler d1 migrations apply chord-dai --remote
npm run deploy
npm run indexnow
```

公開後の匿名集計:

```powershell
npm run metrics
```
