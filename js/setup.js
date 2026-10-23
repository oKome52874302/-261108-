// 設定画面: チーム・プレイヤー・お題・ルールの編集と保存
// 入力内容は localStorage に自動保存し、JSON ファイルで書き出し／読み込みできる

const Setup = (() => {
  const STORAGE_KEY = "five-bomber-setup";
  const $ = (id) => document.getElementById(id);

  function defaultData() {
    return {
      teams: [
        { name: "Aチーム", players: [] },
        { name: "Bチーム", players: [] },
      ],
      questions: (window.QUESTIONS || []).map((q) => ({ theme: q.theme, examples: q.examples || [] })),
      settings: { time: 30, target: 5, point: 10, bonus: 0, shuffle: true, bgm: true, volume: 0.8 },
    };
  }

  // ---------- お題テキスト ⇄ データ ----------
  // 1行 = 「お題 | 回答例、回答例」。区切りは半角・全角の | どちらでも可
  function parseQuestions(text) {
    return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const [theme, rest = ""] = line.split(/\s*[|｜]\s*/, 2);
      const examples = rest.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
      return { theme, examples };
    });
  }

  function formatQuestions(questions) {
    return questions
      .map((q) => (q.examples.length ? `${q.theme} | ${q.examples.join("、")}` : q.theme))
      .join("\n");
  }

  const splitLines = (text) => text.split("\n").map((s) => s.trim()).filter(Boolean);

  // ---------- 画面 ⇄ データ ----------
  function addTeamCard(team) {
    const card = document.createElement("div");
    card.className = "team-card";
    card.innerHTML = `
      <div class="team-card-head">
        <input class="team-name-input" type="text" placeholder="チーム名">
        <button class="remove-btn" title="このチームを削除">×</button>
      </div>
      <textarea class="team-players-input" rows="9" placeholder="プレイヤー名（1行に1人）"></textarea>`;
    card.querySelector(".team-name-input").value = team.name;
    card.querySelector(".team-players-input").value = team.players.join("\n");
    card.querySelector(".remove-btn").addEventListener("click", () => {
      card.remove();
      save();
    });
    $("team-list").appendChild(card);
  }

  function fill(data) {
    $("team-list").innerHTML = "";
    data.teams.forEach(addTeamCard);
    $("input-questions").value = formatQuestions(data.questions);
    $("input-time").value = data.settings.time;
    $("input-target").value = data.settings.target;
    $("input-point").value = data.settings.point;
    $("input-bonus").value = data.settings.bonus;
    $("input-shuffle").checked = data.settings.shuffle;
    $("input-bgm").checked = data.settings.bgm;
    $("input-volume").value = data.settings.volume;
    updateCount();
  }

  function read() {
    const teams = [...document.querySelectorAll(".team-card")].map((card, i) => ({
      name: card.querySelector(".team-name-input").value.trim() || `チーム${i + 1}`,
      players: splitLines(card.querySelector(".team-players-input").value),
    }));
    return {
      teams,
      questions: parseQuestions($("input-questions").value),
      settings: {
        time: Number($("input-time").value) || 30,
        target: Number($("input-target").value) || 5,
        point: Number($("input-point").value) || 0,
        bonus: Number($("input-bonus").value) || 0,
        shuffle: $("input-shuffle").checked,
        bgm: $("input-bgm").checked,
        volume: Number($("input-volume").value),
      },
    };
  }

  function updateCount() {
    $("q-count").textContent = parseQuestions($("input-questions").value).length;
  }

  // ---------- 保存・読み込み ----------
  // localStorage はプライベートモード等で使えないことがあるので失敗しても動くようにする
  function save() {
    updateCount();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(read()));
    } catch (e) { /* 保存できなくてもゲームは続行 */ }
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) return normalize(saved);
    } catch (e) { /* 壊れたデータは無視して初期値へ */ }
    return defaultData();
  }

  // 読み込んだ JSON の欠けている項目を初期値で補う
  function normalize(raw) {
    const base = defaultData();
    return {
      teams: Array.isArray(raw.teams)
        ? raw.teams.map((t) => ({ name: String(t.name || ""), players: (t.players || []).map(String) }))
        : base.teams,
      questions: Array.isArray(raw.questions)
        ? raw.questions.filter((q) => q && q.theme).map((q) => ({ theme: String(q.theme), examples: (q.examples || []).map(String) }))
        : base.questions,
      settings: { ...base.settings, ...(raw.settings || {}) },
    };
  }

  function exportFile() {
    const blob = new Blob([JSON.stringify(read(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "five-bomber-setup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        fill(normalize(JSON.parse(reader.result)));
        save();
      } catch (e) {
        alert("ファイルを読み込めませんでした（JSON 形式か確認してください）");
      }
    };
    reader.readAsText(file);
  }

  function init() {
    fill(load());
    $("screen-setup").addEventListener("input", save);
    $("btn-add-team").addEventListener("click", () => {
      addTeamCard({ name: `チーム${document.querySelectorAll(".team-card").length + 1}`, players: [] });
      save();
    });
    $("btn-export").addEventListener("click", exportFile);
    $("input-import").addEventListener("change", (e) => {
      if (e.target.files[0]) importFile(e.target.files[0]);
      e.target.value = "";
    });
    $("btn-reset").addEventListener("click", () => {
      if (!confirm("チーム・お題・ルールを初期データに戻します。よろしいですか？")) return;
      fill(defaultData());
      save();
    });
  }

  return { init, read };
})();
