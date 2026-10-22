// 効果音（音声ファイル不要。Web Audio API で合成）
const Sound = (() => {
  let ctx = null;

  // ブラウザの自動再生制限のため、最初のユーザー操作で呼ぶ
  function init() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  }

  function tone(freq, duration, type = "sine", delay = 0, volume = 0.3) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  return {
    init,
    correct: () => { tone(880, 0.15); tone(1320, 0.3, "sine", 0.12); },
    wrong: () => tone(140, 0.5, "square", 0, 0.2),
    tick: () => tone(1000, 0.05, "square", 0, 0.15),
    timeUp: () => { tone(440, 0.8, "sawtooth", 0, 0.25); tone(330, 0.8, "sawtooth", 0, 0.25); },
    clear: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, "triangle", i * 0.12)),
  };
})();
