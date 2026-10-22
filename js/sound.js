// 効果音・BGM（音声ファイル不要。Web Audio API で合成したオリジナル音源）
const Sound = (() => {
  let ctx = null;
  let master = null;   // 全体音量
  let bgmBus = null;   // BGM 用（効果音より小さめ）
  let bgmEnabled = true;

  // ブラウザの自動再生制限のため、最初のユーザー操作で呼ぶ
  function init() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.connect(ctx.destination);
      bgmBus = ctx.createGain();
      bgmBus.gain.value = 0.5;
      bgmBus.connect(master);
    }
    if (ctx.state === "suspended") ctx.resume();
  }

  function setVolume(v) {
    if (master) master.gain.value = v;
  }

  function tone(freq, duration, type = "sine", delay = 0, volume = 0.3, dest = master) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + duration);
  }

  // ノイズ（ハイハット・スネア用）
  function noise(time, duration, volume, highpass, dest) {
    const len = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = highpass;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    src.connect(filter).connect(gain).connect(dest);
    src.start(time);
  }

  function kick(time, dest) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    osc.connect(gain).connect(dest);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  // ---------- BGM（シーケンサー） ----------
  // 16分音符 × 16 ステップ × 2 小節のループ。残り時間が少なくなると速く・高くなる
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const BASS = [45, 45, 57, 45, 45, 57, 45, 55, 43, 43, 55, 43, 43, 55, 43, 53,
                41, 41, 53, 41, 41, 53, 41, 52, 40, 40, 52, 40, 52, 47, 44, 40]; // Am - G - F - E
  const LEAD = [69, 0, 72, 0, 76, 0, 72, 0, 67, 0, 71, 0, 74, 0, 71, 0,
                65, 0, 69, 0, 72, 0, 69, 0, 64, 0, 68, 0, 71, 0, 76, 0];

  const bgm = { timerId: null, step: 0, nextTime: 0, tempo: 150, intense: false };

  function scheduleStep(step, time) {
    const s = step % 32;
    const bus = bgmBus;
    if (s % 4 === 0) kick(time, bus);
    if (s % 8 === 4) noise(time, 0.12, 0.35, 1500, bus);          // スネア
    if (s % 2 === 1 || bgm.intense) noise(time, 0.03, 0.15, 7000, bus); // ハイハット
    const delay = Math.max(0, time - ctx.currentTime);
    tone(midi(BASS[s]), 0.12, "sawtooth", delay, 0.12, bus);
    if (LEAD[s]) tone(midi(LEAD[s] + (bgm.intense ? 12 : 0)), 0.1, "square", delay, 0.05, bus);
  }

  function scheduler() {
    const stepDur = 60 / bgm.tempo / 4;
    while (bgm.nextTime < ctx.currentTime + 0.12) {
      scheduleStep(bgm.step, bgm.nextTime);
      bgm.nextTime += stepDur;
      bgm.step++;
    }
  }

  function startBgm() {
    if (!ctx || !bgmEnabled || bgm.timerId) return;
    bgm.nextTime = ctx.currentTime + 0.05;
    bgm.timerId = setInterval(scheduler, 25);
  }

  function stopBgm() {
    clearInterval(bgm.timerId);
    bgm.timerId = null;
  }

  // 新しいラウンドでは頭から・通常テンポで
  function resetBgm() {
    stopBgm();
    bgm.step = 0;
    setIntense(false);
  }

  function setIntense(on) {
    bgm.intense = on;
    bgm.tempo = on ? 190 : 150;
  }

  function setBgmEnabled(on) {
    bgmEnabled = on;
    if (!on) stopBgm();
  }

  return {
    init,
    setVolume,
    setBgmEnabled,
    startBgm,
    stopBgm,
    resetBgm,
    setIntense,
    // ---------- 効果音 ----------
    open: () => [392, 523, 659, 784].forEach((f, i) => tone(f, 0.12, "square", i * 0.06, 0.15)),
    correct: () => { tone(988, 0.12, "square", 0, 0.2); tone(1319, 0.35, "square", 0.1, 0.2); },
    wrong: () => { tone(150, 0.25, "square", 0, 0.25); tone(150, 0.4, "square", 0.3, 0.25); }, // ブッブー
    tick: () => tone(1000, 0.05, "square", 0, 0.15),
    timeUp: () => { tone(220, 1.2, "sawtooth", 0, 0.25); tone(233, 1.2, "sawtooth", 0, 0.2); },
    fail: () => [523, 494, 466, 440].forEach((f, i) => tone(f, i === 3 ? 0.8 : 0.3, "triangle", 0.9 + i * 0.3, 0.25)),
    clear: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i === 5 ? 0.8 : 0.18, "square", i * 0.12, 0.18)),
  };
})();
