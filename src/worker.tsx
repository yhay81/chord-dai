/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import { html } from "hono/html";
import { jsxRenderer } from "hono/jsx-renderer";
import type { Child } from "hono/jsx";
import { secureHeaders } from "hono/secure-headers";

export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
};

type Variables = {
  requestId: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const canonicalOrigin = "https://chord-dai.yhay81.com";
const eventLifetime = 45 * 86400;
const eventNames = new Set([
  "visited",
  "song_created",
  "song_updated",
  "song_opened",
  "transpose_used",
  "performance_started",
  "performance_completed",
  "metronome_started",
  "project_exported",
  "project_imported",
  "returned",
]);
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestIdPattern = /^[0-9a-f-]{36}$/i;
const allowedOrigins = new Set([canonicalOrigin]);

const nowSeconds = () => Math.floor(Date.now() / 1000);

const containsControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });

const singleLine = (value: unknown, maximum: number) =>
  typeof value === "string" && !containsControlCharacter(value) && value.length <= maximum;

const parseSmallJson = async (request: Request, maximum = 1024): Promise<unknown> => {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maximum) throw new Error("body_too_large");
  return JSON.parse(raw);
};

const Logo = () => (
  <span class="logo-mark" aria-hidden="true">
    <span class="logo-neck"></span>
    <span class="logo-sheet"></span>
  </span>
);

const StandScene = () => (
  <div class="stand-scene" aria-label="譜面台にコード譜、ギター、カポ、メトロノームが並ぶ">
    <div class="lamp-glow"></div>
    <div class="guitar">
      <span class="guitar-neck"></span>
      <span class="guitar-body"></span>
      <span class="guitar-hole"></span>
      <span class="guitar-bridge"></span>
      <i class="string s1"></i>
      <i class="string s2"></i>
      <i class="string s3"></i>
    </div>
    <div class="music-stand">
      <span class="stand-board"></span>
      <span class="stand-page left">
        <i class="chord c1">C</i>
        <b></b>
        <i class="chord c2">Am</i>
        <b></b>
        <b></b>
      </span>
      <span class="stand-page right">
        <i class="chord c3">F</i>
        <b></b>
        <i class="chord c4">G</i>
        <b></b>
        <b></b>
      </span>
      <span class="stand-lip"></span>
      <span class="stand-pole"></span>
      <span class="stand-feet"></span>
    </div>
    <div class="capo">
      <span></span>
    </div>
    <div class="metronome">
      <span class="metro-arm"></span>
      <i></i>
    </div>
  </div>
);

const Layout = (props: { children: Child; title: string; description: string; path?: string }) => {
  const url = `${canonicalOrigin}${props.path ?? "/"}`;
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <meta content="#161b22" name="theme-color" />
        <meta content={props.description} name="description" />
        <meta content="website" property="og:type" />
        <meta content={props.title} property="og:title" />
        <meta content={props.description} property="og:description" />
        <meta content={`${canonicalOrigin}/og.svg`} property="og:image" />
        <meta
          content="照明のついた譜面台にコード譜が開き、ギター、カポ、メトロノームが並ぶコード台"
          property="og:image:alt"
        />
        <meta content={url} property="og:url" />
        <meta content="コード台" property="og:site_name" />
        <meta content="summary_large_image" name="twitter:card" />
        <link href={url} rel="canonical" />
        <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
        <link href="/manifest.webmanifest" rel="manifest" />
        <link href="/styles.css" rel="stylesheet" />
        <title>{props.title}</title>
      </head>
      <body>
        <a class="skip-link" href="#main">
          本文へ移動
        </a>
        <header class="site-header">
          <a class="brand" href="/" aria-label="コード台 ホーム">
            <Logo />
            <span>コード台</span>
          </a>
          <nav aria-label="ページ">
            <a href="/guide">使い方</a>
            <a href="/privacy">保存先</a>
          </nav>
        </header>
        {props.children}
        <footer>
          <a class="footer-brand" href="/">
            <Logo />
            <span>コード台</span>
          </a>
          <p>手元の一曲を、弾ける譜面へ。</p>
          <nav aria-label="フッター">
            <a href="/guide">使い方</a>
            <a href="/privacy">保存先と権利について</a>
            <a href="https://github.com/yhay81/chord-dai">GitHub</a>
          </nav>
        </footer>
        <script src="/app.js" type="module"></script>
      </body>
    </html>
  );
};

const EditorForm = () => (
  <form class="song-form" data-song-form>
    <input name="id" type="hidden" />
    <div class="form-grid">
      <label>
        <span>曲名</span>
        <input maxLength={120} name="title" required />
      </label>
      <label>
        <span>アーティスト・作曲者</span>
        <input maxLength={120} name="artist" />
      </label>
      <label>
        <span>BPM</span>
        <input inputmode="numeric" max="300" min="30" name="bpm" type="number" value="96" />
      </label>
      <label>
        <span>拍子</span>
        <select name="meter">
          <option value="4/4">4 / 4</option>
          <option value="3/4">3 / 4</option>
          <option value="6/8">6 / 8</option>
          <option value="2/4">2 / 4</option>
        </select>
      </label>
      <label class="span-two">
        <span>コード譜</span>
        <textarea
          maxLength={50000}
          name="body"
          placeholder={
            "[C]コードを角かっこで囲みます\n[Am]歌詞や自分用のメモ [F]そのままで大丈夫です\n\n{comment: 間奏}\n| C | G | Am | F |"
          }
          required
          rows={16}
        ></textarea>
      </label>
      <label class="span-two">
        <span>自分用メモ</span>
        <textarea
          maxLength={2000}
          name="note"
          placeholder="チューニング、弾き方、入りの合図など"
          rows={3}
        ></textarea>
      </label>
    </div>
    <div class="format-hints" aria-label="入力例">
      <code>[Am]</code>
      <span>コード</span>
      <code>{"{comment: サビ}"}</code>
      <span>区切り</span>
      <code>| C | G |</code>
      <span>コードだけの行</span>
    </div>
    <p class="form-state" data-form-state aria-live="polite"></p>
    <div class="dialog-actions">
      <button class="quiet-button" data-close-dialog type="button">
        閉じる
      </button>
      <button class="primary-button" type="submit">
        譜面台に置く
      </button>
    </div>
  </form>
);

const Home = () => (
  <Layout
    description="手元のコード譜を端末内で整え、移調、カポ、自動スクロール、メトロノーム、セットリストで演奏できる登録不要の譜面台。"
    title="コード台｜手元の一曲を、弾ける譜面へ"
  >
    <main id="main">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">端末の中の演奏譜</p>
          <h1>譜面を置けば、すぐ弾ける。</h1>
          <p>角かっこのコードを読み取り、移調もカポも指一本。演奏中は譜面だけが静かに流れます。</p>
          <div class="hero-actions">
            <button class="primary-button" data-action="new-song" type="button">
              一曲置く
            </button>
            <button class="quiet-button" data-action="try-sample" type="button">
              見本で試す
            </button>
          </div>
          <ul class="trust-row" aria-label="特徴">
            <li>
              <span></span>登録なし
            </li>
            <li>
              <span></span>譜面は端末の外へ出しません
            </li>
            <li>
              <span></span>広告なし
            </li>
          </ul>
        </div>
        <StandScene />
      </section>

      <section class="workbench" data-workbench>
        <aside class="setlist-panel" aria-label="曲の一覧">
          <div class="panel-heading">
            <div>
              <p class="section-kicker">SET LIST</p>
              <h2>曲順</h2>
            </div>
            <button aria-label="曲を追加" class="round-button" data-action="new-song" type="button">
              ＋
            </button>
          </div>
          <div class="setlist-summary">
            <span>
              <strong data-song-count>0</strong> 曲
            </span>
            <span>
              <strong data-total-minutes>0</strong> 分
            </span>
          </div>
          <ol class="setlist" data-setlist></ol>
          <div class="empty-setlist" data-empty-setlist>
            <span class="empty-note" aria-hidden="true">
              ♪
            </span>
            <p>最初の譜面を置くと、ここが曲順になります。</p>
          </div>
          <button class="data-button" data-action="open-data" type="button">
            <span aria-hidden="true">⇩</span> 保存・読込
          </button>
        </aside>

        <section class="score-desk" aria-label="譜面">
          <div class="score-empty" data-score-empty>
            <div class="empty-stand" aria-hidden="true">
              <span></span>
              <i></i>
            </div>
            <h2>譜面台は空いています</h2>
            <p>手元のコード譜を貼ると、コードを色分けして演奏用に整えます。</p>
            <button class="primary-button small" data-action="new-song" type="button">
              一曲置く
            </button>
          </div>

          <div class="score-view" data-score-view hidden>
            <header class="score-header">
              <div>
                <p data-score-artist></p>
                <h2 data-score-title></h2>
              </div>
              <div class="score-actions">
                <button class="icon-button" data-action="edit-song" type="button">
                  <span>✎</span>編集
                </button>
                <button class="icon-button" data-action="print-song" type="button">
                  <span>▤</span>印刷
                </button>
                <button class="icon-button danger" data-action="delete-song" type="button">
                  <span>×</span>削除
                </button>
              </div>
            </header>

            <div class="control-deck">
              <div class="control-block transpose-control">
                <span class="control-label">移調</span>
                <div>
                  <button aria-label="半音下げる" data-action="transpose-down" type="button">
                    −
                  </button>
                  <output data-transpose>原調</output>
                  <button aria-label="半音上げる" data-action="transpose-up" type="button">
                    ＋
                  </button>
                </div>
              </div>
              <label class="control-block capo-control">
                <span class="control-label">カポ</span>
                <div class="capo-track">
                  <input
                    aria-label="カポ位置"
                    max="11"
                    min="0"
                    name="capo"
                    type="range"
                    value="0"
                  />
                  <output data-capo>0</output>
                </div>
              </label>
              <div class="control-block tempo-control">
                <span class="control-label">テンポ</span>
                <div>
                  <button aria-label="BPMを下げる" data-action="tempo-down" type="button">
                    −
                  </button>
                  <output>
                    <strong data-bpm>96</strong>
                    <small>BPM</small>
                  </output>
                  <button aria-label="BPMを上げる" data-action="tempo-up" type="button">
                    ＋
                  </button>
                </div>
              </div>
              <button
                class="metro-button"
                data-action="toggle-metronome"
                aria-pressed="false"
                type="button"
              >
                <span class="metro-icon">
                  <i></i>
                </span>
                <span>メトロノーム</span>
              </button>
              <button class="play-button" data-action="start-performance" type="button">
                <span aria-hidden="true">▶</span>
                演奏
              </button>
            </div>

            <div class="chord-rack" data-chord-rack aria-label="この曲のコード"></div>
            <article class="score-paper" data-score-paper aria-live="polite"></article>
            <p class="private-note" data-private-note hidden></p>
          </div>
        </section>
      </section>
    </main>

    <dialog class="editor-dialog" data-editor-dialog>
      <div class="dialog-heading">
        <div>
          <p class="section-kicker">PLACE A SCORE</p>
          <h2 data-editor-title>一曲置く</h2>
        </div>
        <button aria-label="閉じる" class="dialog-close" data-close-dialog type="button">
          ×
        </button>
      </div>
      <EditorForm />
    </dialog>

    <dialog class="data-dialog" data-data-dialog>
      <div class="dialog-heading">
        <div>
          <p class="section-kicker">YOUR FILES</p>
          <h2>保存と持ち出し</h2>
        </div>
        <button aria-label="閉じる" class="dialog-close" data-close-dialog type="button">
          ×
        </button>
      </div>
      <div class="data-grid">
        <section>
          <span class="data-illustration export" aria-hidden="true">
            ⇩
          </span>
          <h3>編集用ファイルを保存</h3>
          <p>
            曲順、コード譜、設定をひとまとめにします。内容を含むため、自分で安全に保管してください。
          </p>
          <button class="primary-button small" data-action="export-project" type="button">
            .kododai を保存
          </button>
        </section>
        <section>
          <span class="data-illustration import" aria-hidden="true">
            ⇧
          </span>
          <h3>別の端末で続ける</h3>
          <p>
            コード台で保存したファイルだけを、確認してから読み込みます。現在の曲順と入れ替わります。
          </p>
          <label class="file-button">
            ファイルを選ぶ
            <input accept=".kododai,application/json" data-project-file type="file" />
          </label>
        </section>
      </div>
      <p class="form-state" data-data-state aria-live="polite"></p>
      <div class="data-danger">
        <div>
          <strong>この端末の譜面を消す</strong>
          <span>元に戻せません。先に保存できます。</span>
        </div>
        <button class="danger-button" data-action="clear-all" type="button">
          すべて消す
        </button>
      </div>
    </dialog>

    <div class="performance-layer" data-performance-layer hidden>
      <header>
        <div>
          <p data-performance-artist></p>
          <h2 data-performance-title></h2>
        </div>
        <div class="performance-status">
          <span>
            CAPO <strong data-performance-capo>0</strong>
          </span>
          <span>
            <strong data-performance-bpm>96</strong> BPM
          </span>
        </div>
        <button aria-label="演奏画面を閉じる" data-action="stop-performance" type="button">
          ×
        </button>
      </header>
      <div class="count-in" data-count-in hidden></div>
      <article class="performance-paper" data-performance-paper></article>
      <footer class="performance-controls">
        <button data-action="performance-prev" type="button">
          ← 前の曲
        </button>
        <button
          class="performance-pause"
          data-action="toggle-scroll"
          aria-pressed="false"
          type="button"
        >
          ▶ 流す
        </button>
        <label>
          速さ
          <input max="10" min="1" name="scrollSpeed" type="range" value="5" />
        </label>
        <button data-action="performance-next" type="button">
          次の曲 →
        </button>
      </footer>
    </div>
  </Layout>
);

const Guide = () => (
  <Layout
    description="コード台でコード譜を貼り、移調、カポ、自動スクロール、メトロノームを使う手順。"
    path="/guide"
    title="使い方｜コード台"
  >
    <main class="simple-page" id="main">
      <header class="page-intro">
        <div class="mini-stand" aria-hidden="true">
          <span></span>
          <i></i>
        </div>
        <div>
          <p class="eyebrow">使い方</p>
          <h1>一曲を、演奏できる形へ。</h1>
        </div>
      </header>
      <div class="guide-steps">
        <article>
          <span>1</span>
          <div>
            <h2>コードを角かっこへ</h2>
            <p>
              <code>[Am]</code>
              のようにコードを囲み、歌詞や自分のメモと一緒に貼ります。コードだけの行も読み取ります。
            </p>
          </div>
        </article>
        <article>
          <span>2</span>
          <div>
            <h2>手に合う形へ動かす</h2>
            <p>
              移調は鳴る高さを半音ずつ変更します。カポを動かすと、同じ高さを保ったまま押さえる形を簡単にできます。
            </p>
          </div>
        </article>
        <article>
          <span>3</span>
          <div>
            <h2>演奏画面へ</h2>
            <p>
              3カウント後に譜面を自動で流せます。速度は演奏中も調整でき、メトロノームは操作したときだけ音が鳴ります。
            </p>
          </div>
        </article>
        <article>
          <span>4</span>
          <div>
            <h2>自分で持ち出す</h2>
            <p>
              .kododaiファイルに曲順と譜面を保存できます。印刷すると操作部を除いた譜面だけが紙に収まります。
            </p>
          </div>
        </article>
      </div>
      <section class="format-card">
        <div>
          <span class="format-chord">C</span>
          <span class="format-chord">Am</span>
          <span class="format-chord">F</span>
          <span class="format-chord">G</span>
        </div>
        <pre>{`{title: 自作曲}\n{comment: Aメロ}\n[C]ここに歌詞や自分用の言葉\n[Am]コードは[F]角かっこで[G]囲む\n\n| C | G | Am | F |`}</pre>
      </section>
      <section class="notice-card">
        <h2>曲名検索や楽曲配信はしません</h2>
        <p>
          コード台は、あなたが作った譜面や、利用する権利のある手元の譜面を整える道具です。他者の歌詞・楽譜を公開したり配布したりする機能はありません。
        </p>
      </section>
    </main>
  </Layout>
);

const Privacy = () => (
  <Layout
    description="コード台が保存するコード譜、匿名計測、著作権上の境界について。"
    path="/privacy"
    title="保存先と権利について｜コード台"
  >
    <main class="simple-page" id="main">
      <header class="page-intro">
        <div class="privacy-lock" aria-hidden="true">
          <span>♪</span>
        </div>
        <div>
          <p class="eyebrow">保存先と権利</p>
          <h1>譜面は、端末の外へ出しません。</h1>
        </div>
      </header>
      <div class="privacy-grid">
        <article>
          <span class="privacy-icon device" aria-hidden="true"></span>
          <h2>この端末だけ</h2>
          <p>
            曲名、作曲者名、コード譜、メモ、曲順、移調・カポ設定はブラウザーのIndexedDBに保存します。サーバーへ送信しません。
          </p>
        </article>
        <article>
          <span class="privacy-icon pulse" aria-hidden="true"></span>
          <h2>内容なしの利用計測</h2>
          <p>
            改善のため、訪問、曲の作成、移調、演奏開始など許可した操作名だけを45日保存します。曲名、コード、歌詞、メモ、ファイル名、IPアドレスは保存しません。
          </p>
        </article>
        <article>
          <span class="privacy-icon rights" aria-hidden="true">
            ©
          </span>
          <h2>公開・共有しない</h2>
          <p>
            他者の歌詞や楽譜をサーバーへ掲載する機能はありません。自作物、パブリックドメイン、許諾を得た内容など、利用できる譜面だけを入力してください。
          </p>
        </article>
      </div>
      <section class="privacy-details">
        <h2>知っておいてほしいこと</h2>
        <ul>
          <li>Cookie、広告SDK、外部アクセス解析、会員アカウントは使いません。</li>
          <li>
            別の端末へ自動同期されません。ブラウザーのサイトデータを消す前に編集用ファイルを保存してください。
          </li>
          <li>
            音声、マイク、カメラ、位置情報、通知の権限は求めません。メトロノーム音は端末内で生成します。
          </li>
          <li>
            編集用ファイルには譜面本文が含まれます。第三者へ渡す前に内容と権利を確認してください。
          </li>
        </ul>
      </section>
    </main>
  </Layout>
);

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: "same-origin",
    crossOriginResourcePolicy: "same-origin",
    referrerPolicy: "no-referrer",
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
  }),
);

app.use("*", async (c, next) => {
  const incoming = c.req.header("cf-ray")?.split("-")[0] ?? "";
  c.set("requestId", requestIdPattern.test(incoming) ? incoming : crypto.randomUUID());
  await next();
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()");
  c.header("X-Request-Id", c.get("requestId"));
  if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
});

app.use(
  "*",
  jsxRenderer(({ children }) => html`${children}`),
);

app.get("/", (c) => c.render(<Home />));
app.get("/guide", (c) => c.render(<Guide />));
app.get("/privacy", (c) => c.render(<Privacy />));
app.get("/health", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ ok: true });
});

app.post("/api/events", async (c) => {
  const origin = c.req.header("origin");
  const contentType = c.req.header("content-type") ?? "";
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (
    (origin && !allowedOrigins.has(origin)) ||
    !contentType.toLowerCase().startsWith("application/json") ||
    !Number.isFinite(contentLength) ||
    contentLength > 1024
  ) {
    return c.json({ error: "invalid_event" }, 400);
  }

  let body: unknown;
  try {
    body = await parseSmallJson(c.req.raw);
  } catch {
    return c.json({ error: "invalid_event" }, 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("name" in body)
  ) {
    return c.json({ error: "invalid_event" }, 400);
  }

  const name = (body as { name?: unknown }).name;
  const sessionId = c.req.header("x-chord-dai-session") ?? "";
  if (
    typeof name !== "string" ||
    !eventNames.has(name) ||
    !sessionPattern.test(sessionId) ||
    !singleLine(name, 64)
  ) {
    return c.json({ error: "invalid_event" }, 400);
  }

  const timestamp = nowSeconds();
  await c.env.DB.prepare(
    `INSERT INTO product_events (name, session_id, day, created_at, is_qa)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      name,
      sessionId.toLowerCase(),
      new Date(timestamp * 1000).toISOString().slice(0, 10),
      timestamp,
      c.req.header("x-chord-dai-qa") === "1" ? 1 : 0,
    )
    .run();
  return c.json({ ok: true }, 202);
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
  c.status(404);
  return c.render(
    <Layout
      description="お探しのページはコード台にありません。"
      path={c.req.path}
      title="見つかりません｜コード台"
    >
      <main class="not-found" id="main">
        <StandScene />
        <div>
          <p class="eyebrow">404</p>
          <h1>その譜面は、台にありません。</h1>
          <p>コード台へ戻って、次の一曲を開きましょう。</p>
          <a class="primary-button small" href="/">
            コード台へ戻る
          </a>
        </div>
      </main>
    </Layout>,
  );
});

const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (_event, env) => {
  await env.DB.prepare("DELETE FROM product_events WHERE created_at <= ?")
    .bind(nowSeconds() - eventLifetime)
    .run();
};

export { app, eventNames, scheduled };

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Bindings>;
