# Metrics

## Events

許可するイベントは次の11個だけです。

- `visited`
- `song_created`
- `song_updated`
- `song_opened`
- `transpose_used`
- `performance_started`
- `performance_completed`
- `metronome_started`
- `project_exported`
- `project_imported`
- `returned`

イベント本文は正確な`{"name":"..."}`だけです。曲名、作者名、コード、歌詞、メモ、BPM、カポ、ファイル名などを付加しません。

## Funnel

- 訪問 → 曲作成
- 曲作成 → 演奏開始
- 演奏開始 → 最後まで到達
- 3曲作成
- 3回演奏開始
- 3日演奏
- 7日以上にまたがる演奏
- 再訪、編集用ファイル保存

`ops/product-metrics.sql`は`is_qa = 0`だけを集計します。自動QAは実利用に数えません。

## Retention

D1行は45日で削除します。集計値だけで投資判断せず、クローラーや偶発アクセスの可能性を保守的に扱います。
