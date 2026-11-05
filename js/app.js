// ファイブボンバー 本体
// 画面の流れ: setup → [ready → playing ⇄ paused → result] × ラウンド数 → final（勝敗決定）
// ゲーム中はいつでも設定画面に戻り、設定を変えて続きから再開できる
// 正誤判定は人が行い、キーボードで入力する

const $ = (id) => document.getElementById(id);

const state = {
  teams: [],          // { name, players, score, offset }  offset: 次に答えるプレイヤーの位置
  settings: { time: 30, target: 5, point: 10, bonus: 0 },
  questions: [],       // 全お題
  queue: [],           // これから出すお題
  used: new Set(),     // 出題済みのお題（設定変更後も重複させないため）
  question: null,      // 現在のお題
  started: false,      // ゲーム中かどうか（スコアを持っている）
  round: 0,           // 何ラウンド目か（0始まり）。全チームが1回ずつ答えると1ターン
  phase: "setup",     // setup | ready | playing | paused | result
  answers: [],        // 正解した回答テキスト
  wrongs: [],         // 不正解 { slot, text }。同じ枠の人が考え直す
  history: [],        // 判定の履歴（"correct" | "wrong"）。取り消し用
  pending: null,      // 入力済みで判定待ちの回答（null = なし）
  remainingMs: 0,
  endAt: 0,
  timerId: null,
  lastTickSec: null,
  holdStart: null,    // 入力・判定中でタイマーを止めた時刻（止めていなければ null）
  justFilled: false,  // 直前に正解した枠だけアニメーションさせる
};

const currentTeam = () => state.teams[state.round % state.teams.length];
const currentQuestion = () => state.question;
const currentTurn = () => Math.floor(state.round / state.teams.length) + 1;

// 枠の総数。往復（ハイパーボンバー）なら人数の2倍
const totalSlots = () => state.settings.target * (state.settings.roundTrip ? 2 : 1);

// i 番目の枠を答える人が、その問題の何人目か（0始まり）。
// 往復なら 1→N のあと N→1 と折り返すので、N人目は折り返しで2回続けて答える
function seatFor(i) {
  const n = state.settings.target;
  return i < n ? i : 2 * n - 1 - i;
}

// i 番目の枠を担当するプレイヤー名（プレイヤー未登録なら空文字）
function playerFor(team, i) {
  if (team.players.length === 0) return "";
  return team.players[(team.offset + seatFor(i)) % team.players.length];
}

// ---------- 画面切り替え ----------
function showScreen(name) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  $(`screen-${name}`).classList.add("active");
  if (name === "game") $("input-answer").focus();
}

// ---------- セットアップ ----------
function startGame() {
  Sound.init();
  const data = Setup.read();
  if (data.teams.length === 0) return alert("チームを1つ以上追加してください");
  if (data.questions.length === 0) return alert("お題を1問以上入力してください");
  if (state.started && !confirm("スコアをリセットして新しいゲームを始めます。よろしいですか？\n（続きから遊ぶときは「ゲームに戻る」）")) return;

  state.teams = data.teams.map((t) => ({ ...t, score: 0, offset: 0 }));
  applySettings(data.settings);
  state.questions = data.questions;
  state.used = new Set();
  state.queue = [];
  state.round = 0;
  state.started = true;

  document.body.classList.add("in-game");
  showScreen("game");
  prepareRound();
}

function applySettings(settings) {
  state.settings = settings;
  Sound.setVolume(settings.volume);
  Sound.setBgmEnabled(settings.bgm);
}

// 未出題のお題から次の1問を選ぶ。すべて出し終えたら最初から
function pickQuestion() {
  if (state.queue.length === 0) {
    state.queue = state.questions.filter((q) => !state.used.has(q.theme));
    if (state.queue.length === 0) {
      state.used.clear();
      state.queue = [...state.questions];
    }
    if (state.settings.shuffle) shuffle(state.queue);
  }
  state.question = state.queue.shift();
  state.used.add(state.question.theme);
}

// ---------- ゲーム中の設定変更 ----------
function backToSetup() {
  if (!state.started) return;
  if (state.phase === "playing") pauseTimer();
  showScreen("setup");
  window.scrollTo(0, 0);
}

// 設定画面で変えた内容を反映して、続きから再開する（スコア・回答順はそのまま）
function resumeGame() {
  const data = Setup.read();
  if (data.questions.length === 0) return alert("お題を1問以上入力してください");
  applySettings(data.settings);

  // チームは名前とプレイヤーだけ反映（増減は新しいゲームで）
  if (data.teams.length !== state.teams.length) {
    alert("チーム数の変更は「ゲーム開始」で新しいゲームを始めたときに反映されます。名前とプレイヤーだけ反映します。");
  }
  state.teams.forEach((t, i) => {
    if (data.teams[i]) Object.assign(t, { name: data.teams[i].name, players: data.teams[i].players });
  });

  // お題は未出題のものを出し直す。まだお題を開いていなければ、今のお題も選び直す
  state.questions = data.questions;
  state.queue = [];
  if (state.phase === "ready") {
    state.used.delete(state.question.theme);
    pickQuestion();
    state.remainingMs = state.settings.time * 1000;
  }

  showScreen("game");
  render();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------- ラウンド制御 ----------
function prepareRound() {
  pickQuestion();
  state.phase = "ready";
  state.answers = [];
  state.wrongs = [];
  state.history = [];
  state.pending = null;
  state.remainingMs = state.settings.time * 1000;
  state.lastTickSec = null;
  Sound.resetBgm();
  render();
}

function startTimer() {
  if (state.phase === "ready") Sound.open();
  state.phase = "playing";
  Sound.startBgm();
  state.endAt = performance.now() + state.remainingMs;
  state.holdStart = null;
  state.timerId = setInterval(updateTimer, 50);
  render();
}

// 残り時間。入力・判定中で止めている間は減らない
const remainingNow = () => Math.max(0, state.endAt - (state.holdStart ?? performance.now()));

function pauseTimer() {
  clearInterval(state.timerId);
  state.remainingMs = remainingNow();
  state.holdStart = null;
  state.phase = "paused";
  Sound.stopBgm();
  render();
}

// 回答欄に文字がある間と判定待ちの間はタイマーを止める（設定でオフにできる）。
// 操作役が打ち込む時間でチームが損をしないようにするため
function syncHold() {
  const hold = state.phase === "playing" && state.settings.holdWhileJudging
    && ($("input-answer").value !== "" || state.pending !== null);
  if (hold && state.holdStart === null) {
    state.holdStart = performance.now();
  } else if (!hold && state.holdStart !== null) {
    state.endAt += performance.now() - state.holdStart;
    state.holdStart = null;
  }
  $("timer").classList.toggle("hold", state.holdStart !== null);
}

function updateTimer() {
  state.remainingMs = remainingNow();
  const sec = Math.ceil(state.remainingMs / 1000);
  if (sec <= 5 && sec > 0 && sec !== state.lastTickSec) Sound.tick();
  Sound.setIntense(sec <= 5);
  state.lastTickSec = sec;
  if (state.remainingMs <= 0) {
    Sound.timeUp();
    Sound.fail();
    explode();
    finishRound();
  } else {
    renderTimer();
  }
}

function finishRound() {
  clearInterval(state.timerId);
  Sound.stopBgm();
  state.phase = "result";
  render();
}

function isCleared() {
  return state.answers.length >= totalSlots();
}

// 得点 = 正解数 × 1人の点数 + (クリア時ボーナス)。「次へ」で確定させるので、結果画面でも取り消しが効く
function roundPoints() {
  return state.answers.length * state.settings.point + (isCleared() ? state.settings.bonus : 0);
}

// 時間切れの爆発演出
function explode() {
  const el = $("explosion");
  el.classList.remove("show");
  void el.offsetWidth; // アニメーション再始動のため
  el.classList.add("show");
  document.body.classList.add("quake");
  setTimeout(() => document.body.classList.remove("quake"), 600);
}

function nextRound() {
  const team = currentTeam();
  team.score += roundPoints();
  // 次回は今回答えた人の続きから。時間切れなら詰まった人も「答えた」扱いで次の人へ
  const reached = Math.min(totalSlots(), state.answers.length + (isCleared() ? 0 : 1));
  const answered = Math.min(state.settings.target, reached); // 往復で2回答えた人も1人と数える
  team.offset += answered;
  const result = checkEnd();
  state.round++;
  prepareRound();
  if (result) showFinal(result);
}

// 勝敗の判定。ラウンドの得点を確定した直後に呼ぶ
function checkEnd() {
  const { maxTurns, goalPoints, finishTurn } = state.settings;
  const completed = state.round + 1;
  const turnDone = completed % state.teams.length === 0;
  const turns = Math.floor(completed / state.teams.length);
  if (goalPoints > 0 && state.teams.some((t) => t.score >= goalPoints) && (!finishTurn || turnDone)) {
    return `${goalPoints}点に到達`;
  }
  if (maxTurns > 0 && turnDone && turns >= maxTurns) return `${turns}ターン終了`;
  return null;
}

function showFinal(reason) {
  const ranking = [...state.teams].sort((a, b) => b.score - a.score);
  const top = ranking[0].score;
  const winners = ranking.filter((t) => t.score === top);
  $("final-reason").textContent = reason;
  $("final-title").textContent = winners.length > 1 ? "引き分け！" : "優勝";
  $("final-winner").textContent = winners.map((t) => t.name).join("・");
  fillScoreList($("final-list"), ranking);
  $("explosion").classList.remove("show"); // 直前の時間切れ演出が勝者発表に重ならないように
  Sound.clear();
  showScreen("final");
}

// ---------- 判定 ----------
// 表記ゆれを吸収して比較する
// 全角半角・大文字小文字・カタカナ→ひらがな・長音や記号・小さい字・ヴ・づ/ぢ の違いを無視する
const KANA_MAP = {
  "ゔぁ": "ば", "ゔぃ": "び", "ゔぇ": "べ", "ゔぉ": "ぼ", "ゔ": "ぶ",
  "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お", "っ": "つ", "ゃ": "や", "ゅ": "ゆ", "ょ": "よ", "ゎ": "わ",
  "づ": "ず", "ぢ": "じ", "ゐ": "い", "ゑ": "え", "を": "お",
};
const KANA_RE = new RegExp(Object.keys(KANA_MAP).join("|"), "g");

function normalize(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(KANA_RE, (m) => KANA_MAP[m])
    .replace(/[\s・･ー〜~\-－—.,、。!！?？'"「」『』]/g, "");
}

// 2つの文字列の編集距離（打ち間違いの許容に使う）
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// ゆるめ判定で許す打ち間違いの文字数。短い答えは別の言葉になりやすいので許さない
const allowedTypos = (len) => (len >= 7 ? 2 : len >= 4 ? 1 : 0);

// 正解リストの1項目は「H 水素」（空白区切り）や「栃木（とちぎ）」（読み）のように別表記を含められる
function alternatives(example) {
  const parts = example.split(/[()（）\s]+/).filter(Boolean);
  return [example, ...parts];
}

// 「栃木県」「渋谷駅」のように、よくある接尾語が付いていても正解扱いにする
const SUFFIXES = ["県", "都", "府", "道", "市", "区", "町", "村", "駅", "線", "座", "山", "川", "島", "語", "剤", "けん", "えき", "ざ"];

// 一致する正解リストの番号（なければ -1）。loose なら打ち間違いも許す。
// 打ち間違い扱いで別の項目に当たらないよう、表記ゆれまでで一致する項目を先に探す
function exampleIndex(text, loose = state.settings.autoJudge === "loose") {
  const n = normalize(text);
  if (!n) return -1;
  const find = (fuzzy) => currentQuestion().examples.findIndex((ex) =>
    alternatives(ex).some((alt) => {
      const a = normalize(alt);
      if (!a) return false;
      if (!fuzzy) return [a, ...SUFFIXES.map((suf) => a + suf)].includes(n);
      return editDistance(n, a) <= allowedTypos(a.length);
    }));
  const exact = find(false);
  return exact >= 0 || !loose ? exact : find(true);
}

const matchesExample = (text) => exampleIndex(text) >= 0;

// 既出判定：同じ表記か、正解リストの同じ項目に当たる答え（「栃木」と「栃木県」など）
function isDuplicate(text) {
  const idx = exampleIndex(text);
  return state.answers.some((a) => normalize(a) === normalize(text) || (idx >= 0 && exampleIndex(a) === idx));
}

// 入力欄の回答を確定する。既出なら自動で×、正解リストにあれば自動で○、それ以外は判定待ち
function submitAnswer() {
  const input = $("input-answer");
  const text = input.value.trim();
  input.value = "";
  if (state.phase !== "playing" || !text) return;
  state.pending = text;
  if (isDuplicate(text)) markWrong();
  else if (state.settings.autoJudge !== "off" && matchesExample(text)) markCorrect();
  else {
    Sound.tick();
    render();
  }
}

function takePending() {
  const text = state.pending || "";
  state.pending = null;
  return text;
}

function markCorrect() {
  if (state.phase !== "playing") return;
  state.answers.push(takePending() || "○");
  state.history.push("correct");
  state.justFilled = true;
  if (isCleared()) {
    Sound.clear();
    finishRound();
  } else {
    Sound.correct();
    render();
  }
}

// 不正解でも枠は進まず、同じ人が考え直す
function markWrong() {
  if (state.phase !== "playing") return;
  state.wrongs.push({ slot: state.answers.length, text: takePending() });
  state.history.push("wrong");
  Sound.wrong();
  document.body.classList.remove("flash-ng");
  void document.body.offsetWidth; // アニメーション再始動のため
  document.body.classList.add("flash-ng");
  render();
  const slot = document.querySelector(".slot.current");
  if (slot) slot.classList.add("shake");
}

const wrongsFor = (slot) => state.wrongs.filter((w) => w.slot === slot);

// 判定ミスの取り消し（直前の判定を1つ戻す）
function undo() {
  // 判定待ちがあれば、まずそれを取り消す
  if (state.pending !== null) {
    state.pending = null;
    render();
    return;
  }
  const last = state.history.pop();
  if (!last) return;
  if (last === "wrong") {
    state.wrongs.pop();
  } else {
    const wasCleared = isCleared();
    state.answers.pop();
    // クリアで終了していた場合は、時間が残っていれば一時停止状態に戻す
    if (state.phase === "result" && wasCleared && state.remainingMs > 0) state.phase = "paused";
  }
  render();
}

// ---------- 描画 ----------
function renderTimer() {
  const sec = Math.ceil(state.remainingMs / 1000);
  const timer = $("timer");
  timer.textContent = sec;
  timer.classList.toggle("danger", state.phase === "playing" && sec <= 5);
  timer.classList.toggle("paused", state.phase === "paused" || state.phase === "ready");

  // 導火線を残り時間の割合だけ残し、火花を先端に置く
  const fuse = $("fuse");
  const len = fuse.getTotalLength();
  const ratio = Math.max(0, state.remainingMs / (state.settings.time * 1000));
  fuse.style.strokeDasharray = len;
  fuse.style.strokeDashoffset = len * (1 - ratio);
  const tip = fuse.getPointAtLength(len * ratio);
  const spark = $("spark");
  spark.setAttribute("transform", `translate(${tip.x} ${tip.y})`);
  spark.classList.toggle("lit", state.phase === "playing" && state.holdStart === null);
  spark.style.display = ratio > 0 ? "" : "none";
}

function render() {
  syncHold();
  const team = currentTeam();
  const q = currentQuestion();
  const { target, roundTrip } = state.settings;
  const total = totalSlots();

  $("team-name").textContent = team.name;
  $("mode-name").textContent = Setup.modeName(target, roundTrip).en;
  const current = state.phase === "playing" || state.phase === "paused" ? playerFor(team, state.answers.length) : "";
  const retries = wrongsFor(state.answers.length).length;
  const { maxTurns, goalPoints } = state.settings;
  $("round-info").textContent = `第${currentTurn()}ターン${maxTurns ? ` / ${maxTurns}` : ""}　不正解 ${state.wrongs.length}`;
  renderMiniScore(team, goalPoints);
  const label = current || `${seatFor(state.answers.length) + 1}人目`;
  $("current-player").textContent = (state.phase === "playing" || state.phase === "paused") && !isCleared()
    ? state.pending !== null
      ? `判定中…（↑：正解　↓：不正解）`
      : `回答者：${label}${retries ? `（考え直し ${retries}回目）` : ""}`
    : "";
  $("current-player").classList.toggle("retry", retries > 0);

  const theme = $("theme");
  const hidden = state.phase === "ready";
  theme.textContent = hidden ? "Space でお題オープン＆スタート" : q.theme;
  theme.classList.toggle("hidden", hidden);

  const slots = $("slots");
  slots.innerHTML = "";
  // 往復は2段にし、下の段を右から左に並べて、同じ人の枠を縦にそろえる。往復なしで7枠以上も2段
  const cols = roundTrip || target <= 6 ? target : Math.ceil(target / 2);
  slots.style.setProperty("--cols", cols);
  slots.classList.toggle("two-rows", total > cols);
  const order = [...Array(total).keys()];
  if (roundTrip) order.splice(target, target, ...order.slice(target).reverse());
  for (const i of order) {
    const el = document.createElement("div");
    el.className = "slot";
    const ans = state.answers[i];
    if (ans) el.classList.add("filled");
    if (ans && i === state.answers.length - 1 && state.justFilled) el.classList.add("pop");
    else if (i === state.answers.length && state.phase === "playing") el.classList.add("current");
    el.innerHTML = `<span class="num">${i + 1}</span><span class="player"></span><span class="text"></span><span class="wrongs"></span>`;
    el.querySelector(".player").textContent = playerFor(team, i);
    el.querySelector(".text").textContent = ans || "";
    if (!ans && i === state.answers.length && state.pending !== null) {
      el.classList.add("pending");
      el.querySelector(".text").textContent = `${state.pending}？`;
      el.querySelector(".text").classList.add("pending-text");
    }
    // 不正解だった回答を打ち消し線で表示（文字なしなら ✕ のみ）
    const wrongs = wrongsFor(i);
    if (wrongs.length && !ans) el.classList.add("retry");
    wrongs.forEach((w) => {
      const span = document.createElement("s");
      span.textContent = w.text ? `✕${w.text}` : "✕";
      el.querySelector(".wrongs").appendChild(span);
    });
    slots.appendChild(el);
  }

  const banner = $("banner");
  banner.className = "banner";
  banner.innerHTML = "";
  if (state.phase === "result") {
    const cleared = isCleared();
    banner.classList.add(cleared ? "clear" : "fail");
    banner.textContent = cleared ? "CLEAR!!" : "TIME UP";
    const info = document.createElement("div");
    info.className = "examples";
    info.textContent = `+${roundPoints()}点　｜　正解リスト: ${q.examples.join("、") || "なし"}　｜　→ で次へ`;
    banner.appendChild(info);
  } else if (state.phase === "paused") {
    banner.textContent = "一時停止中";
  }

  renderTimer();
}

function fillScoreList(list, teams) {
  list.innerHTML = "";
  teams.forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><span>${t.score}点</span>`;
    li.firstChild.textContent = t.name;
    list.appendChild(li);
  });
}

function renderScore() {
  fillScoreList($("score-list"), [...state.teams].sort((a, b) => b.score - a.score));
}

// ゲーム画面右上の小さなスコア表
function renderMiniScore(current, goalPoints) {
  const box = $("mini-score");
  box.innerHTML = "";
  state.teams.forEach((t) => {
    const row = document.createElement("div");
    row.textContent = `${t.name} ${t.score}点`;
    if (t === current) row.className = "now";
    box.appendChild(row);
  });
  if (goalPoints) {
    const goal = document.createElement("div");
    goal.className = "goal";
    goal.textContent = `目標 ${goalPoints}点`;
    box.appendChild(goal);
  }
}

function toggleScore() {
  if ($("screen-score").classList.contains("active")) {
    showScreen("game");
  } else {
    if (state.phase === "playing") pauseTimer();
    renderScore();
    showScreen("score");
  }
}

// ---------- 操作 ----------
// キーボードとボタンの両方から呼ぶ
const actions = {
  toggle() {
    if (state.phase === "ready" || state.phase === "paused") startTimer();
    else if (state.phase === "playing") pauseTimer();
  },
  answer: submitAnswer,
  correct: markCorrect,
  wrong: markWrong,
  undo,
  next() { if (state.phase === "result") nextRound(); },
  score: toggleScore,
  settings: backToSetup,
  continue() { showScreen("game"); render(); },
};


// 入力欄から直接判定する（打った答えをそのまま○／×にする）
function judgeFromInput(correct) {
  const input = $("input-answer");
  const text = input.value.trim();
  input.value = "";
  if (state.phase !== "playing") return;
  if (text) state.pending = text;
  if (correct) markCorrect();
  else markWrong();
}

// ゲーム画面では回答欄に常にカーソルを置く。
// 入力欄の外で打ち始めると、最初の1文字だけ日本語入力を通らず半角で入ってしまうため
const gameActive = () => $("screen-game").classList.contains("active");
function focusInput() {
  if (gameActive()) $("input-answer").focus();
}
$("input-answer").addEventListener("blur", () => setTimeout(() => {
  if (document.activeElement === document.body) focusInput();
}));

// キー操作。入力欄が空のときは Space・Backspace・→・Esc をショートカットとして使い、
// 文字が入っているときは文字入力を優先する（↑↓・Enter・Tab はいつでも使える）
document.addEventListener("keydown", (e) => {
  // 設定画面・試合終了画面では文字入力やボタン操作を優先
  if ($("screen-setup").classList.contains("active") || $("screen-final").classList.contains("active")) return;
  const input = $("input-answer");

  if ($("screen-score").classList.contains("active")) {
    if (e.code === "Tab" || e.code === "Escape") {
      e.preventDefault();
      toggleScore();
      focusInput();
    }
    return;
  }

  // 日本語変換中（確定の Enter や候補選択の ↑↓）は触らない。Safari は isComposing が false になるため keyCode も見る
  if (e.isComposing || e.keyCode === 229) return;
  if (document.activeElement !== input) focusInput();
  const empty = input.value === "";

  const run = (fn) => {
    e.preventDefault();
    fn();
  };
  switch (e.code) {
    case "Enter": case "NumpadEnter":
      return run(() => !empty && submitAnswer());
    case "ArrowUp": case "ArrowDown":
      return run(() => (empty ? actions[e.code === "ArrowUp" ? "correct" : "wrong"]() : judgeFromInput(e.code === "ArrowUp")));
    case "Tab":
      return run(actions.score);
    case "Escape":
      return run(() => {
        if (empty) return actions.settings();
        input.value = "";
        syncHold();
      });
    case "Space":
      if (empty) run(actions.toggle);
      return;
    case "Backspace":
      if (empty) run(actions.undo);
      return;
    case "ArrowRight":
      if (empty) run(actions.next);
      return;
  }
});

// 日本語入力オンで空欄のまま Space を押すと全角スペースが入る（keydown では判別できない）ので、ここで開始/一時停止として扱う
$("input-answer").addEventListener("input", (e) => {
  const input = e.target;
  if (!e.isComposing && input.value !== "" && input.value.trim() === "") {
    input.value = "";
    actions.toggle();
  }
  syncHold();
});

// 画面下の操作ボタン（マウス・タッチ用）。フォーカスを奪わないようにして、Space の二重反応を防ぐ
document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => actions[btn.dataset.action]());
});

$("btn-start").addEventListener("click", startGame);
$("btn-resume").addEventListener("click", resumeGame);
// 会場のスピーカーで音が出るかを事前に確かめる
$("btn-sound-test").addEventListener("click", () => {
  Sound.init();
  Sound.setVolume(Number($("input-volume").value));
  Sound.correct();
});
Setup.init();
