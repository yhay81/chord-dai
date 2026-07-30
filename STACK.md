# Stack

- Cloudflare Workers: HTML、セキュリティヘッダー、匿名イベントAPI、45日削除cron
- Hono + Hono JSX: サーバー描画された日本語ページ
- Vite+ / Vite: 開発、型検査、テスト、ビルド
- IndexedDB: 最大200曲の譜面、曲順、移調・カポ・テンポ設定
- Web Audio API: 操作時だけ端末内で生成するメトロノーム音
- Service Worker: APIを除外した静的製品面のnetwork-first cache
- Cloudflare D1: 許可済みイベント名、匿名session UUID、日、時刻、QA区分だけ

認証は使いません。個人の譜面を端末外へ同期する要件がなく、Better Authを導入すると個人データとアカウント運用の負担だけが増えるためです。

外部の楽曲・歌詞・コード譜APIや解析SDKも使いません。
