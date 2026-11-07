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
  remainingMs: 0,
  endAt: 0,
  timerId: null,
  lastTickSec: null,
  spaceHold: false,   // Space を押している間の一時停止中か
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
  // 押したボタンにフォーカスが残ると、Space でそのボタンまで反応してしまうので外す
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
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
  state.overtime = false;

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
  state.overtime = false; // 設定を変えたら、新しい条件で勝敗判定をやり直す
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
  state.spaceHold = false;
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
  state.timerId = setInterval(updateTimer, 50);
  render();
}

const remainingNow = () => Math.max(0, state.endAt - performance.now());

function pauseTimer() {
  clearInterval(state.timerId);
  state.remainingMs = remainingNow();
  state.phase = "paused";
  Sound.stopBgm();
  render();
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
  $("explosion").classList.remove("show"); // 時間切れ直後に次へ進んでも、爆発演出が次のチームの画面に残らないように
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
  if (state.overtime) return null; // 「このまま続ける」を選んだ延長戦では終わらない
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
// 正誤は判定役が ↑ / ↓ で決める。一時停止中（Space を押している間など）でも判定できる
const judging = () => state.phase === "playing" || state.phase === "paused";

function markCorrect() {
  if (!judging()) return;
  state.answers.push("○");
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
  if (!judging()) return;
  state.wrongs.push({ slot: state.answers.length });
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
  spark.classList.toggle("lit", state.phase === "playing");
  spark.style.display = ratio > 0 ? "" : "none";
}

function render() {
  const team = currentTeam();
  const q = currentQuestion();
  const { target, roundTrip } = state.settings;
  const total = totalSlots();

  $("team-name").textContent = team.name;
  $("mode-name").textContent = Setup.modeName(target, roundTrip).en;
  const current = judging() ? playerFor(team, state.answers.length) : "";
  const retries = wrongsFor(state.answers.length).length;
  const { maxTurns, goalPoints } = state.settings;
  const turnLabel = state.overtime ? "（延長戦）" : maxTurns ? ` / ${maxTurns}` : "";
  $("round-info").textContent = `第${currentTurn()}ターン${turnLabel}　不正解 ${state.wrongs.length}`;
  renderMiniScore(team, goalPoints);
  const label = current || `${seatFor(state.answers.length) + 1}人目`;
  $("current-player").textContent = judging() && !isCleared()
    ? `回答者：${label}${retries ? `（考え直し ${retries}回目）` : ""}`
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
    else if (i === state.answers.length && judging()) el.classList.add("current");
    el.innerHTML = `<span class="num">${i + 1}</span><span class="player"></span><span class="text"></span><span class="wrongs"></span>`;
    el.querySelector(".player").textContent = playerFor(team, i);
    el.querySelector(".text").textContent = ans ? "〇" : "";
    // 不正解の回数だけ ✕ を表示
    const wrongs = wrongsFor(i);
    if (wrongs.length && !ans) el.classList.add("retry");
    el.querySelector(".wrongs").textContent = "✕".repeat(wrongs.length);
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
    info.textContent = `+${roundPoints()}点　｜　答えの例: ${q.examples.join("、") || "なし"}　｜　→ で次へ`;
    banner.appendChild(info);
  } else if (state.phase === "paused") {
    banner.textContent = state.spaceHold ? "一時停止中（Space を離すと再開）" : "一時停止中";
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
  correct: markCorrect,
  wrong: markWrong,
  undo,
  next() { if (state.phase === "result") nextRound(); },
  score: toggleScore,
  settings: backToSetup,
  // 勝敗が決まったあとも遊び続ける。設定を変えるまで勝敗判定はしない
  continue() {
    state.overtime = true;
    showScreen("game");
    render();
  },
};


// キー操作。Space は押している間だけ一時停止し、離すと再開する
document.addEventListener("keydown", (e) => {
  // 設定画面・試合終了画面では文字入力やボタン操作を優先
  if ($("screen-setup").classList.contains("active") || $("screen-final").classList.contains("active")) return;

  if ($("screen-score").classList.contains("active")) {
    if (e.code === "Tab" || e.code === "Escape") {
      e.preventDefault();
      toggleScore();
    }
    return;
  }

  const run = (fn) => {
    e.preventDefault();
    if (!e.repeat) fn();
  };
  switch (e.code) {
    case "Space":
      return run(spaceDown);
    case "ArrowUp":
      return run(actions.correct);
    case "ArrowDown":
      return run(actions.wrong);
    case "Backspace":
      return run(actions.undo);
    case "ArrowRight":
      return run(actions.next);
    case "Tab":
      return run(actions.score);
    case "Escape":
      return run(actions.settings);
  }
});

document.addEventListener("keyup", (e) => {
  if (e.code !== "Space" || !gameActive()) return;
  e.preventDefault();
  spaceUp();
});
// Space を押したまま別の画面に移ると keyup が届かないので、押しっぱなし扱いを解く（一時停止のまま）
window.addEventListener("blur", () => {
  state.spaceHold = false;
});

// お題が隠れているときは開始、回答中なら押している間だけ一時停止、一時停止中なら再開
function spaceDown() {
  if (state.phase === "ready" || state.phase === "paused") {
    startTimer();
  } else if (state.phase === "playing") {
    state.spaceHold = true;
    pauseTimer();
  }
}

function spaceUp() {
  if (!state.spaceHold) return;
  state.spaceHold = false;
  if (state.phase === "paused" && gameActive()) startTimer();
}

const gameActive = () => $("screen-game").classList.contains("active");

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
