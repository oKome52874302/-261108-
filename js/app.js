// ファイブボンバー 本体
// 画面の流れ: setup → [ready → playing ⇄ paused → result] × ラウンド数
// 正誤判定は人が行い、キーボードで入力する

const $ = (id) => document.getElementById(id);

const state = {
  teams: [],          // { name, players, score, offset }  offset: 次に答えるプレイヤーの位置
  settings: { time: 30, target: 5, bonus: 3 },
  questions: [],
  round: 0,           // 何ラウンド目か（0始まり）
  phase: "setup",     // setup | ready | playing | paused | result
  answers: [],        // 正解した回答テキスト
  misses: 0,
  remainingMs: 0,
  endAt: 0,
  timerId: null,
  lastTickSec: null,
  justFilled: false,  // 直前に正解した枠だけアニメーションさせる
};

const currentTeam = () => state.teams[state.round % state.teams.length];
const currentQuestion = () => state.questions[state.round % state.questions.length];

// i 番目の枠を担当するプレイヤー名（プレイヤー未登録なら空文字）
function playerFor(team, i) {
  if (team.players.length === 0) return "";
  return team.players[(team.offset + i) % team.players.length];
}

// ---------- 画面切り替え ----------
function showScreen(name) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  $(`screen-${name}`).classList.add("active");
}

// ---------- セットアップ ----------
function startGame() {
  Sound.init();
  const data = Setup.read();
  if (data.teams.length === 0) return alert("チームを1つ以上追加してください");
  if (data.questions.length === 0) return alert("お題を1問以上入力してください");

  state.teams = data.teams.map((t) => ({ ...t, score: 0, offset: 0 }));
  state.settings = data.settings;
  state.questions = data.questions;
  if (data.settings.shuffle) shuffle(state.questions);
  state.round = 0;

  showScreen("game");
  prepareRound();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------- ラウンド制御 ----------
function prepareRound() {
  state.phase = "ready";
  state.answers = [];
  state.misses = 0;
  state.remainingMs = state.settings.time * 1000;
  state.lastTickSec = null;
  render();
}

function startTimer() {
  state.phase = "playing";
  state.endAt = performance.now() + state.remainingMs;
  state.timerId = setInterval(updateTimer, 50);
  $("input-answer").focus();
  render();
}

function pauseTimer() {
  clearInterval(state.timerId);
  state.remainingMs = Math.max(0, state.endAt - performance.now());
  state.phase = "paused";
  render();
}

function updateTimer() {
  state.remainingMs = Math.max(0, state.endAt - performance.now());
  const sec = Math.ceil(state.remainingMs / 1000);
  if (sec <= 5 && sec > 0 && sec !== state.lastTickSec) Sound.tick();
  state.lastTickSec = sec;
  if (state.remainingMs <= 0) {
    Sound.timeUp();
    finishRound();
  } else {
    renderTimer();
  }
}

function finishRound() {
  clearInterval(state.timerId);
  state.phase = "result";
  render();
}

function isCleared() {
  return state.answers.length >= state.settings.target;
}

// 得点 = 正解数 + (クリア時ボーナス)。「次へ」で確定させるので、結果画面でも取り消しが効く
function roundPoints() {
  return state.answers.length + (isCleared() ? state.settings.bonus : 0);
}

function nextRound() {
  const team = currentTeam();
  team.score += roundPoints();
  // 次回は今回答えた人の続きから。時間切れなら詰まった人も「答えた」扱いで次の人へ
  const answered = Math.min(state.settings.target, state.answers.length + (isCleared() ? 0 : 1));
  team.offset += answered;
  state.round++;
  prepareRound();
}

// ---------- 判定 ----------
function markCorrect() {
  if (state.phase !== "playing") return;
  const input = $("input-answer");
  state.answers.push(input.value.trim() || "○");
  state.justFilled = true;
  input.value = "";
  if (isCleared()) {
    Sound.clear();
    finishRound();
  } else {
    Sound.correct();
    render();
  }
}

function markWrong() {
  if (state.phase !== "playing") return;
  state.misses++;
  Sound.wrong();
  document.body.classList.remove("flash-ng");
  void document.body.offsetWidth; // アニメーション再始動のため
  document.body.classList.add("flash-ng");
  render();
}

// 判定ミスの取り消し（直前の正解を1つ戻す）
function undo() {
  if (state.answers.length === 0) return;
  const wasCleared = isCleared();
  state.answers.pop();
  // クリアで終了していた場合は、時間が残っていれば一時停止状態に戻す
  if (state.phase === "result" && wasCleared && state.remainingMs > 0) state.phase = "paused";
  render();
}

// ---------- 描画 ----------
function renderTimer() {
  const sec = Math.ceil(state.remainingMs / 1000);
  const timer = $("timer");
  timer.textContent = sec;
  timer.classList.toggle("danger", state.phase === "playing" && sec <= 5);
  timer.classList.toggle("paused", state.phase === "paused" || state.phase === "ready");
}

function render() {
  const team = currentTeam();
  const q = currentQuestion();
  const { target } = state.settings;

  $("team-name").textContent = team.name;
  const current = state.phase === "playing" || state.phase === "paused" ? playerFor(team, state.answers.length) : "";
  $("round-info").textContent = `第${state.round + 1}問　不正解 ${state.misses}`;
  $("current-player").textContent = current && !isCleared() ? `回答者：${current}` : "";

  const theme = $("theme");
  const hidden = state.phase === "ready";
  theme.textContent = hidden ? "Space でお題オープン＆スタート" : q.theme;
  theme.classList.toggle("hidden", hidden);

  const slots = $("slots");
  slots.innerHTML = "";
  for (let i = 0; i < target; i++) {
    const el = document.createElement("div");
    el.className = "slot";
    const ans = state.answers[i];
    if (ans) el.classList.add("filled");
    if (ans && i === state.answers.length - 1 && state.justFilled) el.classList.add("pop");
    else if (i === state.answers.length && state.phase === "playing") el.classList.add("current");
    el.innerHTML = `<span class="num">${i + 1}</span><span class="player"></span><span class="text"></span>`;
    el.querySelector(".player").textContent = playerFor(team, i);
    el.querySelector(".text").textContent = ans || "";
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
    info.textContent = `+${roundPoints()}点　｜　回答例: ${q.examples.join("、")}　｜　N で次へ`;
    banner.appendChild(info);
  } else if (state.phase === "paused") {
    banner.textContent = "一時停止中";
  }

  renderTimer();
}

function renderScore() {
  const list = $("score-list");
  list.innerHTML = "";
  [...state.teams]
    .sort((a, b) => b.score - a.score)
    .forEach((t) => {
      const li = document.createElement("li");
      li.innerHTML = `<span></span><span>${t.score}点</span>`;
      li.firstChild.textContent = t.name;
      list.appendChild(li);
    });
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

// ---------- キー操作 ----------
// 回答入力欄に文字があるときは文字入力を優先し、空のときだけショートカットとして扱う
document.addEventListener("keydown", (e) => {
  if (state.phase === "setup") return;
  const input = $("input-answer");
  const typing = document.activeElement === input && input.value !== "";
  if (e.isComposing) return; // 日本語変換中の Enter は無視

  if ($("screen-score").classList.contains("active")) {
    if (e.key === "s" || e.key === "S" || e.key === "Escape") toggleScore();
    return;
  }

  if (e.key === "Enter") {
    e.preventDefault();
    markCorrect();
    return;
  }
  if (typing) return;

  switch (e.key) {
    case " ":
      e.preventDefault();
      if (state.phase === "ready" || state.phase === "paused") startTimer();
      else if (state.phase === "playing") pauseTimer();
      break;
    case "x": case "X":
      e.preventDefault();
      markWrong();
      break;
    case "Backspace":
      e.preventDefault();
      undo();
      break;
    case "n": case "N":
      e.preventDefault();
      if (state.phase === "result") nextRound();
      break;
    case "s": case "S":
      e.preventDefault();
      toggleScore();
      break;
  }
});

$("btn-start").addEventListener("click", startGame);
Setup.init();
