import { isChordOnlyLine, normalizeChord, parseChord, transposeChord } from "./chords.js";

const databaseName = "chord-dai";
const databaseVersion = 1;
const maximumSongs = 200;
const maximumBodyLength = 50000;
const maximumNoteLength = 2000;
const maximumProjectBytes = 6_000_000;
const sessionKey = "chord-dai-session";
const seenKey = "chord-dai-last-seen";
const qaMode = new URLSearchParams(location.search).get("qa") === "1";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const allowedMeters = new Set(["4/4", "3/4", "6/8", "2/4"]);
const exactSongKeys = [
  "artist",
  "body",
  "bpm",
  "capo",
  "createdAt",
  "id",
  "meter",
  "note",
  "order",
  "scrollSpeed",
  "title",
  "transpose",
  "updatedAt",
];
const chordShapes = new Map([
  ["C", "x32010"],
  ["Cm", "x35543"],
  ["D", "xx0232"],
  ["Dm", "xx0231"],
  ["E", "022100"],
  ["Em", "022000"],
  ["F", "133211"],
  ["Fm", "133111"],
  ["G", "320003"],
  ["Gm", "355333"],
  ["A", "x02220"],
  ["Am", "x02210"],
  ["B", "x24442"],
  ["Bm", "x24432"],
]);

let dbPromise;
let songs = [];
let activeSongId = "";
let metronomeTimer = 0;
let audioContext;
let performanceFrame = 0;
let scrollRunning = false;
let performanceStartedAt = 0;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const openDatabase = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("songs")) {
        const store = database.createObjectStore("songs", { keyPath: "id" });
        store.createIndex("order", "order");
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!database.objectStoreNames.contains("config")) {
        database.createObjectStore("config", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
};

const requestPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readAllSongs = async () => {
  const database = await openDatabase();
  const transaction = database.transaction("songs", "readonly");
  const result = await requestPromise(transaction.objectStore("songs").getAll());
  return result.sort(
    (left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt),
  );
};

const putSong = async (song) => {
  const database = await openDatabase();
  const transaction = database.transaction("songs", "readwrite");
  transaction.objectStore("songs").put(song);
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
};

const replaceSongs = async (nextSongs) => {
  const database = await openDatabase();
  const transaction = database.transaction("songs", "readwrite");
  const store = transaction.objectStore("songs");
  store.clear();
  nextSongs.forEach((song) => store.put(song));
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
};

const removeSong = async (id) => {
  const database = await openDatabase();
  const transaction = database.transaction("songs", "readwrite");
  transaction.objectStore("songs").delete(id);
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
};

const getSession = () => {
  const current = localStorage.getItem(sessionKey);
  if (current && uuidPattern.test(current)) return current;
  const next = crypto.randomUUID();
  localStorage.setItem(sessionKey, next);
  return next;
};

const track = (name) => {
  void fetch("/api/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chord-dai-qa": qaMode ? "1" : "0",
      "x-chord-dai-session": getSession(),
    },
    body: JSON.stringify({ name }),
    keepalive: true,
  }).catch(() => undefined);
};

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const collectChordTokens = (body) => {
  const tokens = [];
  const seen = new Set();
  const add = (candidate) => {
    const normalized = normalizeChord(candidate);
    if (!parseChord(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    tokens.push(normalized);
  };
  for (const match of body.matchAll(/\[([^\]\r\n]{1,32})\]/g)) add(match[1]);
  for (const line of body.split(/\r?\n/)) {
    if (!line.includes("[") && isChordOnlyLine(line)) {
      line.replaceAll("|", " ").trim().split(/\s+/).forEach(add);
    }
  }
  return tokens.slice(0, 24);
};

const renderMixedLine = (line, shift) => {
  const lineNode = element("div", "score-line");
  const directive = /^\{(?:comment|c):\s*(.+)\}$/i.exec(line.trim());
  if (directive) {
    lineNode.className = "score-section";
    lineNode.textContent = directive[1].slice(0, 160);
    return lineNode;
  }
  if (/^\{(?:title|t|subtitle|st|key):/i.test(line.trim())) {
    lineNode.className = "score-directive";
    lineNode.textContent = line.replace(/^\{[^:]+:\s*|\}$/g, "");
    return lineNode;
  }
  if (!line) {
    lineNode.className = "score-line score-space";
    lineNode.append(document.createTextNode("\u00a0"));
    return lineNode;
  }
  if (isChordOnlyLine(line)) {
    lineNode.className = "score-line chord-only-line";
    const segments = line.split(/(\||\s+)/);
    segments.forEach((segment) => {
      const parsed = parseChord(segment);
      if (parsed) lineNode.append(element("span", "chord-token", transposeChord(segment, shift)));
      else lineNode.append(document.createTextNode(segment));
    });
    return lineNode;
  }
  const segments = line.split(/(\[[^\]\r\n]{1,32}\])/);
  segments.forEach((segment) => {
    if (segment.startsWith("[") && segment.endsWith("]")) {
      const candidate = segment.slice(1, -1);
      if (parseChord(candidate)) {
        lineNode.append(element("span", "chord-token", transposeChord(candidate, shift)));
        return;
      }
    }
    lineNode.append(document.createTextNode(segment));
  });
  return lineNode;
};

const renderPaper = (target, song) => {
  target.replaceChildren();
  const shift = song.transpose - song.capo;
  song.body.split(/\r?\n/).forEach((line) => target.append(renderMixedLine(line, shift)));
};

const baseChordName = (token, shift) => {
  const shifted = transposeChord(token, shift);
  const parsed = parseChord(shifted);
  if (!parsed || parsed.literal || parsed.bass) return "";
  const simpleSuffix = parsed.suffix === "m" ? "m" : parsed.suffix === "" ? "" : null;
  if (simpleSuffix === null) return "";
  return `${parsed.root}${simpleSuffix}`;
};

const diagramNode = (token, shift) => {
  const shifted = transposeChord(token, shift);
  const card = element("div", "chord-card");
  card.append(element("strong", "", shifted));
  const shape = chordShapes.get(baseChordName(token, shift));
  const grid = element("span", "mini-fret");
  if (shape) {
    [...shape].forEach((position, index) => {
      const string = element("i", `fret-string s${index + 1}`);
      string.dataset.position = position;
      const dot = element("b", position === "x" ? "muted" : position === "0" ? "open" : "finger");
      dot.style.setProperty(
        "--fret",
        position === "x" || position === "0" ? "0" : String(Math.min(Number(position), 4)),
      );
      string.append(dot);
      grid.append(string);
    });
  } else {
    grid.classList.add("text-only");
    grid.textContent = "shape";
  }
  card.append(grid);
  return card;
};

const activeSong = () => songs.find((song) => song.id === activeSongId) ?? null;

const estimateMinutes = (song) => {
  const meaningful = song.body.split(/\r?\n/).filter((line) => line.trim()).length;
  return Math.max(1, Math.round((meaningful * 4 * 60) / clamp(song.bpm, 30, 300)));
};

const renderSetlist = () => {
  const list = $("[data-setlist]");
  if (!list) return;
  list.replaceChildren();
  songs.forEach((song, index) => {
    const item = element("li", song.id === activeSongId ? "active" : "");
    item.dataset.songId = song.id;
    const open = element("button", "song-open");
    open.type = "button";
    open.dataset.action = "open-song";
    open.dataset.songId = song.id;
    open.append(element("span", "song-number", String(index + 1).padStart(2, "0")));
    const words = element("span", "song-words");
    words.append(
      element("strong", "", song.title),
      element("small", "", song.artist || "作者名なし"),
    );
    open.append(words);
    const tempo = element("span", "song-tempo", `${song.bpm}`);
    tempo.append(element("small", "", "BPM"));
    open.append(tempo);
    const order = element("span", "order-buttons");
    const up = element("button", "", "↑");
    up.type = "button";
    up.dataset.action = "move-up";
    up.dataset.songId = song.id;
    up.disabled = index === 0;
    up.setAttribute("aria-label", `${song.title}を上へ`);
    const down = element("button", "", "↓");
    down.type = "button";
    down.dataset.action = "move-down";
    down.dataset.songId = song.id;
    down.disabled = index === songs.length - 1;
    down.setAttribute("aria-label", `${song.title}を下へ`);
    order.append(up, down);
    item.append(open, order);
    list.append(item);
  });
  $("[data-song-count]").textContent = String(songs.length);
  $("[data-total-minutes]").textContent = String(
    songs.reduce((sum, song) => sum + estimateMinutes(song), 0),
  );
  $("[data-empty-setlist]").hidden = songs.length > 0;
};

const renderActiveSong = () => {
  const song = activeSong();
  const empty = $("[data-score-empty]");
  const view = $("[data-score-view]");
  if (!empty || !view) return;
  empty.hidden = Boolean(song);
  view.hidden = !song;
  if (!song) {
    renderSetlist();
    return;
  }
  $("[data-score-title]").textContent = song.title;
  $("[data-score-artist]").textContent = song.artist || "作者名なし";
  $("[data-transpose]").textContent =
    song.transpose === 0
      ? "原調"
      : song.transpose > 0
        ? `+${song.transpose}`
        : String(song.transpose);
  $("[data-capo]").textContent = String(song.capo);
  $("input[name='capo']").value = String(song.capo);
  $("[data-bpm]").textContent = String(song.bpm);
  const note = $("[data-private-note]");
  note.hidden = !song.note;
  note.textContent = song.note ? `自分用メモ　${song.note}` : "";
  const rack = $("[data-chord-rack]");
  rack.replaceChildren();
  const shift = song.transpose - song.capo;
  collectChordTokens(song.body)
    .slice(0, 8)
    .forEach((token) => rack.append(diagramNode(token, shift)));
  renderPaper($("[data-score-paper]"), song);
  renderSetlist();
};

const refresh = async (preferredId = activeSongId) => {
  songs = await readAllSongs();
  activeSongId = songs.some((song) => song.id === preferredId) ? preferredId : (songs[0]?.id ?? "");
  renderActiveSong();
};

const closeDialogs = () => {
  $$("dialog[open]").forEach((dialog) => dialog.close());
};

const openEditor = (song = null) => {
  const form = $("[data-song-form]");
  form.reset();
  form.elements.id.value = song?.id ?? "";
  form.elements.title.value = song?.title ?? "";
  form.elements.artist.value = song?.artist ?? "";
  form.elements.bpm.value = String(song?.bpm ?? 96);
  form.elements.meter.value = song?.meter ?? "4/4";
  form.elements.body.value = song?.body ?? "";
  form.elements.note.value = song?.note ?? "";
  $("[data-form-state]").textContent = "";
  $("[data-editor-title]").textContent = song ? "譜面を整える" : "一曲置く";
  $("[data-editor-dialog]").showModal();
  requestAnimationFrame(() => form.elements.title.focus());
};

const sampleSong = () => ({
  artist: "コード台の見本",
  body: `{comment: はじまり}\n| C | G | Am | F |\n\n[C]窓辺の灯りを [G]合図にして\n[Am]小さな音から [F]歩き出す\n[C]一つのコードが [G]次へつながり\n[Am]今日の景色を [F]歌にする\n\n{comment: くり返し}\n| F | G | Em | Am |\n| F | G | C | C |`,
  bpm: 92,
  capo: 0,
  createdAt: new Date().toISOString(),
  id: crypto.randomUUID(),
  meter: "4/4",
  note: "移調やカポを動かして、演奏画面を試せます。",
  order: songs.length,
  scrollSpeed: 5,
  title: "窓辺の四拍子",
  transpose: 0,
  updatedAt: new Date().toISOString(),
});

const saveForm = async (form) => {
  const title = form.elements.title.value.trim();
  const artist = form.elements.artist.value.trim();
  const body = form.elements.body.value.replaceAll("\r\n", "\n").trim();
  const note = form.elements.note.value.trim();
  const bpm = Number(form.elements.bpm.value);
  const meter = form.elements.meter.value;
  if (
    !title ||
    title.length > 120 ||
    artist.length > 120 ||
    !body ||
    body.length > maximumBodyLength ||
    note.length > maximumNoteLength ||
    !Number.isInteger(bpm) ||
    bpm < 30 ||
    bpm > 300 ||
    !allowedMeters.has(meter)
  ) {
    $("[data-form-state]").textContent =
      "入力内容を確認してください。BPMは30〜300、譜面は5万文字までです。";
    return;
  }
  const id = form.elements.id.value;
  const existing = songs.find((song) => song.id === id);
  if (!existing && songs.length >= maximumSongs) {
    $("[data-form-state]").textContent = `保存できる曲は${maximumSongs}曲までです。`;
    return;
  }
  const now = new Date().toISOString();
  const song = {
    artist,
    body,
    bpm,
    capo: existing?.capo ?? 0,
    createdAt: existing?.createdAt ?? now,
    id: existing?.id ?? crypto.randomUUID(),
    meter,
    note,
    order: existing?.order ?? songs.length,
    scrollSpeed: existing?.scrollSpeed ?? 5,
    title,
    transpose: existing?.transpose ?? 0,
    updatedAt: now,
  };
  await putSong(song);
  activeSongId = song.id;
  await refresh(song.id);
  closeDialogs();
  track(existing ? "song_updated" : "song_created");
};

const saveActiveSettings = async (changes, eventName = "") => {
  const song = activeSong();
  if (!song) return;
  Object.assign(song, changes, { updatedAt: new Date().toISOString() });
  await putSong(song);
  renderActiveSong();
  if (eventName) track(eventName);
};

const moveSong = async (id, direction) => {
  const index = songs.findIndex((song) => song.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= songs.length) return;
  [songs[index], songs[target]] = [songs[target], songs[index]];
  const now = new Date().toISOString();
  await Promise.all(songs.map((song, order) => putSong({ ...song, order, updatedAt: now })));
  await refresh(id);
};

const download = (name, type, content) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const exportProject = () => {
  const project = {
    exportedAt: new Date().toISOString(),
    format: "chord-dai",
    songs,
    version: 1,
  };
  download(
    `chord-dai-${new Date().toISOString().slice(0, 10)}.kododai`,
    "application/json",
    JSON.stringify(project, null, 2),
  );
  $("[data-data-state]").textContent = `${songs.length}曲を保存しました。`;
  track("project_exported");
};

const hasOnlyKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));

const validDate = (value) =>
  typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));

const validImportedSong = (song, index) => {
  if (!hasOnlyKeys(song, exactSongKeys)) return false;
  return (
    uuidPattern.test(song.id) &&
    typeof song.title === "string" &&
    song.title.trim().length > 0 &&
    song.title.length <= 120 &&
    typeof song.artist === "string" &&
    song.artist.length <= 120 &&
    typeof song.body === "string" &&
    song.body.trim().length > 0 &&
    song.body.length <= maximumBodyLength &&
    typeof song.note === "string" &&
    song.note.length <= maximumNoteLength &&
    Number.isInteger(song.bpm) &&
    song.bpm >= 30 &&
    song.bpm <= 300 &&
    allowedMeters.has(song.meter) &&
    Number.isInteger(song.capo) &&
    song.capo >= 0 &&
    song.capo <= 11 &&
    Number.isInteger(song.transpose) &&
    song.transpose >= -6 &&
    song.transpose <= 6 &&
    Number.isInteger(song.scrollSpeed) &&
    song.scrollSpeed >= 1 &&
    song.scrollSpeed <= 10 &&
    song.order === index &&
    validDate(song.createdAt) &&
    validDate(song.updatedAt)
  );
};

const importProject = async (file) => {
  const state = $("[data-data-state]");
  if (!file || file.size <= 0 || file.size > maximumProjectBytes) {
    state.textContent = "6MB以下の.kododaiファイルを選んでください。";
    return;
  }
  try {
    const project = JSON.parse(await file.text());
    if (
      !hasOnlyKeys(project, ["exportedAt", "format", "songs", "version"]) ||
      project.format !== "chord-dai" ||
      project.version !== 1 ||
      !validDate(project.exportedAt) ||
      !Array.isArray(project.songs) ||
      project.songs.length > maximumSongs ||
      !project.songs.every(validImportedSong)
    ) {
      throw new Error("invalid_project");
    }
    const ids = new Set(project.songs.map((song) => song.id));
    if (ids.size !== project.songs.length) throw new Error("duplicate_ids");
    if (!confirm(`現在の曲順を、選んだ${project.songs.length}曲と入れ替えますか？`)) return;
    await replaceSongs(project.songs);
    await refresh(project.songs[0]?.id ?? "");
    state.textContent = `${project.songs.length}曲を読み込みました。`;
    track("project_imported");
  } catch {
    state.textContent = "コード台で保存した正しいファイルではありません。内容は変更していません。";
  }
};

const playClick = (accent = false) => {
  audioContext ??= new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.frequency.value = accent ? 1180 : 820;
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.13, audioContext.currentTime + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.055);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.06);
};

const stopMetronome = () => {
  if (metronomeTimer) window.clearInterval(metronomeTimer);
  metronomeTimer = 0;
  const button = $("[data-action='toggle-metronome']");
  if (button) button.setAttribute("aria-pressed", "false");
};

const startMetronome = () => {
  const song = activeSong();
  if (!song) return;
  let beat = 0;
  const beats = song.meter.startsWith("3")
    ? 3
    : song.meter.startsWith("6")
      ? 6
      : song.meter.startsWith("2")
        ? 2
        : 4;
  playClick(true);
  metronomeTimer = window.setInterval(() => {
    beat = (beat + 1) % beats;
    playClick(beat === 0);
  }, 60000 / song.bpm);
  $("[data-action='toggle-metronome']").setAttribute("aria-pressed", "true");
  track("metronome_started");
};

const setPerformanceSong = (song) => {
  activeSongId = song.id;
  $("[data-performance-title]").textContent = song.title;
  $("[data-performance-artist]").textContent = song.artist || "作者名なし";
  $("[data-performance-capo]").textContent = String(song.capo);
  $("[data-performance-bpm]").textContent = String(song.bpm);
  $("input[name='scrollSpeed']").value = String(song.scrollSpeed);
  const paper = $("[data-performance-paper]");
  renderPaper(paper, song);
  paper.scrollTop = 0;
  scrollRunning = false;
  $("[data-action='toggle-scroll']").textContent = "▶ 流す";
  $("[data-action='toggle-scroll']").setAttribute("aria-pressed", "false");
  renderActiveSong();
};

const scrollFrame = (timestamp) => {
  if (!scrollRunning) return;
  const paper = $("[data-performance-paper]");
  if (!paper.dataset.lastFrame) paper.dataset.lastFrame = String(timestamp);
  const delta = Math.min(40, timestamp - Number(paper.dataset.lastFrame));
  paper.dataset.lastFrame = String(timestamp);
  const speed = Number($("input[name='scrollSpeed']").value);
  paper.scrollTop += (delta / 1000) * (8 + speed * 9);
  if (paper.scrollTop + paper.clientHeight >= paper.scrollHeight - 4) {
    scrollRunning = false;
    $("[data-action='toggle-scroll']").textContent = "↺ 先頭へ";
    $("[data-action='toggle-scroll']").setAttribute("aria-pressed", "false");
    if (performanceStartedAt) track("performance_completed");
    return;
  }
  performanceFrame = requestAnimationFrame(scrollFrame);
};

const toggleScroll = () => {
  const paper = $("[data-performance-paper]");
  if (paper.scrollTop + paper.clientHeight >= paper.scrollHeight - 4) paper.scrollTop = 0;
  scrollRunning = !scrollRunning;
  const button = $("[data-action='toggle-scroll']");
  button.textContent = scrollRunning ? "Ⅱ 止める" : "▶ 流す";
  button.setAttribute("aria-pressed", scrollRunning ? "true" : "false");
  delete paper.dataset.lastFrame;
  if (scrollRunning) performanceFrame = requestAnimationFrame(scrollFrame);
  else cancelAnimationFrame(performanceFrame);
};

const startPerformance = async () => {
  const song = activeSong();
  if (!song) return;
  stopMetronome();
  setPerformanceSong(song);
  const layer = $("[data-performance-layer]");
  layer.hidden = false;
  document.body.classList.add("performing");
  const count = $("[data-count-in]");
  count.hidden = false;
  for (const value of ["3", "2", "1"]) {
    count.textContent = value;
    playClick(value === "1");
    await new Promise((resolve) => setTimeout(resolve, 520));
  }
  count.hidden = true;
  performanceStartedAt = Date.now();
  track("performance_started");
  toggleScroll();
};

const stopPerformance = () => {
  scrollRunning = false;
  cancelAnimationFrame(performanceFrame);
  performanceStartedAt = 0;
  $("[data-performance-layer]").hidden = true;
  document.body.classList.remove("performing");
};

const adjacentPerformanceSong = (direction) => {
  const index = songs.findIndex((song) => song.id === activeSongId);
  if (index < 0 || songs.length === 0) return;
  const next = songs[(index + direction + songs.length) % songs.length];
  setPerformanceSong(next);
};

const runAction = async (action, button) => {
  if (action === "new-song") openEditor();
  if (action === "try-sample") {
    const existing = songs.find((song) => song.artist === "コード台の見本");
    if (existing) {
      activeSongId = existing.id;
      renderActiveSong();
      return;
    }
    if (songs.length >= maximumSongs) return;
    const sample = sampleSong();
    await putSong(sample);
    await refresh(sample.id);
    track("song_created");
  }
  if (action === "open-song") {
    activeSongId = button.dataset.songId;
    const song = activeSong();
    if (song) {
      renderActiveSong();
      track("song_opened");
    }
  }
  if (action === "move-up") await moveSong(button.dataset.songId, -1);
  if (action === "move-down") await moveSong(button.dataset.songId, 1);
  if (action === "edit-song") openEditor(activeSong());
  if (action === "delete-song") {
    const song = activeSong();
    if (song && confirm(`「${song.title}」をこの端末から削除しますか？`)) {
      await removeSong(song.id);
      activeSongId = "";
      await refresh();
    }
  }
  if (action === "print-song") window.print();
  if (action === "transpose-down")
    await saveActiveSettings(
      { transpose: clamp(activeSong().transpose - 1, -6, 6) },
      "transpose_used",
    );
  if (action === "transpose-up")
    await saveActiveSettings(
      { transpose: clamp(activeSong().transpose + 1, -6, 6) },
      "transpose_used",
    );
  if (action === "tempo-down") {
    stopMetronome();
    await saveActiveSettings({ bpm: clamp(activeSong().bpm - 2, 30, 300) });
  }
  if (action === "tempo-up") {
    stopMetronome();
    await saveActiveSettings({ bpm: clamp(activeSong().bpm + 2, 30, 300) });
  }
  if (action === "toggle-metronome") {
    if (metronomeTimer) stopMetronome();
    else startMetronome();
  }
  if (action === "start-performance") await startPerformance();
  if (action === "stop-performance") stopPerformance();
  if (action === "toggle-scroll") toggleScroll();
  if (action === "performance-prev") adjacentPerformanceSong(-1);
  if (action === "performance-next") adjacentPerformanceSong(1);
  if (action === "open-data") {
    $("[data-data-state]").textContent = "";
    $("[data-data-dialog]").showModal();
  }
  if (action === "export-project") exportProject();
  if (action === "clear-all" && songs.length && confirm("この端末の曲と曲順をすべて消しますか？")) {
    await replaceSongs([]);
    activeSongId = "";
    await refresh();
    $("[data-data-state]").textContent = "この端末の譜面をすべて消しました。";
  }
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) void runAction(button.dataset.action, button);
  if (event.target.closest("[data-close-dialog]")) closeDialogs();
});

$("[data-song-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveForm(event.currentTarget);
});

$("input[name='capo']")?.addEventListener("input", (event) => {
  $("[data-capo]").textContent = event.currentTarget.value;
});

$("input[name='capo']")?.addEventListener("change", (event) => {
  stopMetronome();
  void saveActiveSettings({ capo: Number(event.currentTarget.value) }, "transpose_used");
});

$("input[name='scrollSpeed']")?.addEventListener("change", (event) => {
  void saveActiveSettings({ scrollSpeed: Number(event.currentTarget.value) });
});

$("[data-project-file]")?.addEventListener("change", (event) => {
  const file = event.currentTarget.files?.[0];
  void importProject(file);
  event.currentTarget.value = "";
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$(".performance-layer")?.hidden) stopPerformance();
  if (
    event.code === "Space" &&
    !$(".performance-layer")?.hidden &&
    !event.target.matches("input, textarea, button")
  ) {
    event.preventDefault();
    toggleScroll();
  }
});

const boot = async () => {
  if (!("indexedDB" in window)) {
    const empty = $("[data-score-empty] p");
    if (empty)
      empty.textContent =
        "このブラウザーでは端末内保存を使えません。別の新しいブラウザーで開いてください。";
    return;
  }
  await refresh();
  track("visited");
  const today = new Date().toISOString().slice(0, 10);
  const previous = localStorage.getItem(seenKey);
  if (previous && previous !== today) track("returned");
  localStorage.setItem(seenKey, today);
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
};

void boot();
