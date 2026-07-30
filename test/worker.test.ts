import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isChordOnlyLine, parseChord, transposeChord } from "../public/chords.js";
import { app, scheduled, type Bindings } from "../src/worker";

const migrationPath = fileURLToPath(new URL("../migrations/0001_events.sql", import.meta.url));
const workerPath = fileURLToPath(new URL("../src/worker.tsx", import.meta.url));
const appPath = fileURLToPath(new URL("../public/app.js", import.meta.url));
const chordPath = fileURLToPath(new URL("../public/chords.js", import.meta.url));
const serviceWorkerPath = fileURLToPath(new URL("../public/sw.js", import.meta.url));
const stylesPath = fileURLToPath(new URL("../public/styles.css", import.meta.url));
const manifestPath = fileURLToPath(new URL("../public/manifest.webmanifest", import.meta.url));
const sitemapPath = fileURLToPath(new URL("../public/sitemap.xml", import.meta.url));
const robotsPath = fileURLToPath(new URL("../public/robots.txt", import.meta.url));
const ogPath = fileURLToPath(new URL("../public/og.svg", import.meta.url));
const metricsPath = fileURLToPath(new URL("../ops/product-metrics.sql", import.meta.url));
const origin = "https://chord-dai.yhay81.com";
const session = "a2d0e2f2-66fd-4fd4-8e87-b0ef67ad194a";

let miniflare: Miniflare;
let bindings: Bindings;

const eventRequest = (
  name: string,
  options: {
    body?: string;
    contentLength?: number;
    contentType?: string;
    origin?: string;
    qa?: boolean;
    session?: string;
  } = {},
) => {
  const body = options.body ?? JSON.stringify({ name });
  return {
    body,
    headers: {
      "content-length": String(options.contentLength ?? new TextEncoder().encode(body).byteLength),
      "content-type": options.contentType ?? "application/json",
      origin: options.origin ?? origin,
      "x-chord-dai-qa": options.qa ? "1" : "0",
      "x-chord-dai-session": options.session ?? session,
    },
    method: "POST",
  };
};

beforeEach(async () => {
  miniflare = new Miniflare({
    d1Databases: { DB: "chord-dai-test" },
    modules: true,
    script: "export default { fetch() { return new Response('test') } }",
  });
  const database = await miniflare.getD1Database("DB");
  const migration = await readFile(migrationPath, "utf8");
  for (const statement of migration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await database.prepare(statement).run();
  }
  bindings = {
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) } as unknown as Fetcher,
    DB: database as unknown as D1Database,
  };
});

afterEach(async () => {
  await miniflare.dispose();
});

describe("public pages", () => {
  it.each([
    ["/", 'class="stand-scene"', "https://chord-dai.yhay81.com/"],
    ["/guide", 'class="guide-steps"', "https://chord-dai.yhay81.com/guide"],
    ["/privacy", 'class="privacy-grid"', "https://chord-dai.yhay81.com/privacy"],
  ])("%s は製品固有の画面を返す", async (path, marker, canonical) => {
    const response = await app.request(path, undefined, bindings);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain(marker);
    expect(body).toContain(`href="${canonical}" rel="canonical"`);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("permissions-policy")).toContain("geolocation=()");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body).not.toMatch(/成功条件|市場スコア|公開実験|収益性|技術選定/);
  });

  it("譜面台、ギター、カポ、メトロノーム、曲順を画面で示す", async () => {
    const response = await app.request("/", undefined, bindings);
    const body = await response.text();
    expect(body).toContain('class="music-stand"');
    expect(body).toContain('class="guitar"');
    expect(body).toContain('class="capo"');
    expect(body).toContain('class="metronome"');
    expect(body).toContain('class="setlist-panel"');
    expect(body).toContain('class="control-deck"');
    expect(body).toContain('class="performance-layer"');
    expect(body).toContain("譜面は端末の外へ出しません");
    expect(body).toMatch(/<script src="\/app\.js" type="module"><\/script>/);
  });

  it("権利と保存先の境界を製品内で明記する", async () => {
    const guide = await app.request("/guide", undefined, bindings);
    const guideBody = await guide.text();
    expect(guideBody).toContain("曲名検索や楽曲配信はしません");
    expect(guideBody).toContain("他者の歌詞・楽譜を公開したり配布したりする機能はありません");
    const privacy = await app.request("/privacy", undefined, bindings);
    const privacyBody = await privacy.text();
    expect(privacyBody).toContain("ブラウザーのIndexedDB");
    expect(privacyBody).toContain("曲名、コード、歌詞、メモ、ファイル名、IPアドレスは保存しません");
  });

  it("未知のページは製品固有の404を返す", async () => {
    const page = await app.request("/missing", undefined, bindings);
    expect(page.status).toBe(404);
    expect(await page.text()).toContain("その譜面は、台にありません");
  });

  it("未知のAPIはJSON 404、healthは最小状態を返す", async () => {
    const missing = await app.request("/api/missing", undefined, bindings);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
    const health = await app.request("/health", undefined, bindings);
    expect(health.status).toBe(200);
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(await health.json()).toEqual({ ok: true });
  });
});

describe("chord parser", () => {
  it("拡張コードとオンコードを分解する", () => {
    expect(parseChord("F#m7(b5)/A")).toEqual({
      bass: "A",
      preferFlat: false,
      root: "F#",
      suffix: "m7(b5)",
    });
    expect(parseChord("N.C.")).toEqual({ literal: "N.C." });
    expect(parseChord("歌詞")).toBeNull();
  });

  it("シャープ、フラット、オンコードを半音単位で移調する", () => {
    expect(transposeChord("C", 2)).toBe("D");
    expect(transposeChord("F#m7/B", -2)).toBe("Em7/A");
    expect(transposeChord("Bbmaj7/F", 2)).toBe("Cmaj7/G");
    expect(transposeChord("N.C.", 5)).toBe("N.C.");
  });

  it("コードだけの行と普通の文章を区別する", () => {
    expect(isChordOnlyLine("| C | G/B | Am7 | F |")).toBe(true);
    expect(isChordOnlyLine("C G Am F")).toBe(true);
    expect(isChordOnlyLine("Cから歩き出す")).toBe(false);
  });
});

describe("anonymous telemetry", () => {
  it.each([
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
  ])("%s を許可する", async (name) => {
    const response = await app.request("/api/events", eventRequest(name), bindings);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("イベント名、追加field、セッションIDを許可リストで制限する", async () => {
    expect((await app.request("/api/events", eventRequest("song_title"), bindings)).status).toBe(
      400,
    );
    const content = eventRequest("song_created", {
      body: JSON.stringify({ name: "song_created", title: "秘密の曲" }),
    });
    expect((await app.request("/api/events", content, bindings)).status).toBe(400);
    expect(
      (
        await app.request(
          "/api/events",
          eventRequest("visited", { session: "not-a-session" }),
          bindings,
        )
      ).status,
    ).toBe(400);
  });

  it("JSON以外、不正JSON、宣言または実体が1KB超の本文を拒否する", async () => {
    expect(
      (
        await app.request(
          "/api/events",
          eventRequest("visited", { contentType: "text/plain" }),
          bindings,
        )
      ).status,
    ).toBe(400);
    expect(
      (await app.request("/api/events", eventRequest("visited", { body: "{" }), bindings)).status,
    ).toBe(400);
    const oversized = JSON.stringify({ name: "x".repeat(1100) });
    expect(
      (
        await app.request(
          "/api/events",
          eventRequest("visited", { body: oversized, contentLength: 0 }),
          bindings,
        )
      ).status,
    ).toBe(400);
    expect(
      (await app.request("/api/events", eventRequest("visited", { contentLength: 2000 }), bindings))
        .status,
    ).toBe(400);
  });

  it("別originからの記録を拒否する", async () => {
    const response = await app.request(
      "/api/events",
      eventRequest("visited", { origin: "https://example.com" }),
      bindings,
    );
    expect(response.status).toBe(400);
  });

  it("自動QAイベントを実利用から分離する", async () => {
    await app.request("/api/events", eventRequest("song_created", { qa: true }), bindings);
    await app.request("/api/events", eventRequest("song_created"), bindings);
    const rows = await bindings.DB.prepare(
      "SELECT is_qa, COUNT(*) AS count FROM product_events GROUP BY is_qa ORDER BY is_qa",
    ).all<{ count: number; is_qa: number }>();
    expect(rows.results).toEqual([
      { count: 1, is_qa: 0 },
      { count: 1, is_qa: 1 },
    ]);
  });

  it("45日を過ぎた計測だけを削除する", async () => {
    const now = Math.floor(Date.now() / 1000);
    await bindings.DB.prepare(
      `INSERT INTO product_events (name, session_id, day, created_at, is_qa)
       VALUES ('visited', ?, '2026-01-01', ?, 0), ('visited', ?, '2026-07-30', ?, 0)`,
    )
      .bind(session, now - 46 * 86400, session, now)
      .run();
    await scheduled({} as ScheduledController, bindings, {} as ExecutionContext);
    const row = await bindings.DB.prepare("SELECT COUNT(*) AS count FROM product_events").first<{
      count: number;
    }>();
    expect(row?.count).toBe(1);
  });
});

describe("local score contract", () => {
  it("譜面内容はIndexedDBだけに置き、外向き通信を匿名計測だけにする", async () => {
    const source = await readFile(appPath, "utf8");
    expect(source.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(source).toContain('fetch("/api/events"');
    expect(source).toContain("indexedDB.open");
    expect(source).toContain('createObjectStore("songs"');
    expect(source).toContain('createObjectStore("config"');
    expect(source).toContain("const maximumSongs = 200");
    expect(source).toContain("const maximumBodyLength = 50000");
    expect(source).not.toMatch(/innerHTML|eval\(|new Function/);
  });

  it("移調、カポ、メトロノーム、演奏スクロールを扱える", async () => {
    const [source, chords] = await Promise.all([
      readFile(appPath, "utf8"),
      readFile(chordPath, "utf8"),
    ]);
    expect(source).toContain("song.transpose - song.capo");
    expect(source).toContain("startMetronome");
    expect(source).toContain("new AudioContext");
    expect(source).toContain("startPerformance");
    expect(source).toContain("requestAnimationFrame(scrollFrame)");
    expect(chords).toContain("transposeChord");
  });

  it("読み込み前に形式、上限、UUID、重複、値域を検証する", async () => {
    const source = await readFile(appPath, "utf8");
    expect(source).toContain('project.format !== "chord-dai"');
    expect(source).toContain("project.songs.length > maximumSongs");
    expect(source).toContain("validImportedSong");
    expect(source).toContain("ids.size !== project.songs.length");
    expect(source).toContain("hasOnlyKeys");
    expect(source).toContain(".kododai");
  });

  it("静的製品面をネットワーク優先でキャッシュし、APIを除外する", async () => {
    const source = await readFile(serviceWorkerPath, "utf8");
    expect(source).toContain('const cacheName = "chord-dai-v1"');
    expect(source).toContain('"/chords.js"');
    expect(source).toContain("caches.open");
    expect(source).toContain("fetch(event.request)");
    expect(source).toContain('!event.request.url.includes("/api/")');
  });

  it("巨大文字に頼らず、譜面台の視覚要素をレスポンシブにする", async () => {
    const source = await readFile(stylesPath, "utf8");
    expect(source).toContain("clamp(1.75rem, 3.2vw, 2rem)");
    expect(source).toContain(".stand-scene");
    expect(source).toContain(".music-stand");
    expect(source).toContain(".guitar");
    expect(source).toContain(".score-paper");
    expect(source).toContain(".performance-layer");
    expect(source).toContain("@media (max-width: 760px)");
    expect(source).not.toMatch(/h1\s*\{[^}]*font-size:\s*(?:[4-9]\d|[1-9]\d{2})px/s);
  });
});

describe("metrics contract", () => {
  it("曲数、演奏回数、利用日数、利用期間を測り、QAを除く", async () => {
    const source = await readFile(metricsPath, "utf8");
    expect(source).toContain("WHERE is_qa = 0");
    expect(source).toContain("songs_created >= 3");
    expect(source).toContain("starts >= 3");
    expect(source).toContain("performance_days >= 3");
    expect(source).toContain("span_days >= 7");
    expect(source).toContain("name = 'performance_started'");
  });
});

describe("discovery assets", () => {
  it("manifestはコード台のPWA情報を持つ", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest.name).toBe("コード台");
    expect(manifest.description).toContain("自動スクロール");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#161b22");
    expect(manifest.icons).toHaveLength(1);
  });

  it("sitemapとrobotsはchord-dai.yhay81.comを指す", async () => {
    const [sitemap, robots] = await Promise.all([
      readFile(sitemapPath, "utf8"),
      readFile(robotsPath, "utf8"),
    ]);
    expect(sitemap.match(/<loc>/g)).toHaveLength(3);
    expect(sitemap).toContain("https://chord-dai.yhay81.com/guide");
    expect(robots).toContain("https://chord-dai.yhay81.com/sitemap.xml");
  });

  it("OG画像は譜面台、ギター、カポ、メトロノームで製品を示す", async () => {
    const source = await readFile(ogPath, "utf8");
    expect(source.length).toBeGreaterThan(2500);
    expect(source).toContain("手元の一曲を、弾ける譜面へ");
    expect(source).toContain("移調・カポ・自動スクロール");
    expect(source).toContain("chord-dai.yhay81.com");
    expect(source).not.toContain("PRIVATE STUDY DESK");
  });

  it("Workerは一つの計測APIだけを持つ", async () => {
    const source = await readFile(workerPath, "utf8");
    expect(source.match(/app\.post\("\/api\//g)).toHaveLength(1);
    expect(source).toContain('app.post("/api/events"');
    expect(source).not.toContain("/api/books/search");
  });
});
