(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const grid = $("timerGrid");
  const timers = [];
  let audioContext = null;
  let toastId = null;
  let globalVolume = 1;

  // Semua pengumuman diputar satu per satu, bukan bersamaan.
  const speechQueue = [];
  let speechBusy = false;
  let currentSpeech = null;
  const queuedTimerIds = new Set();

  const formatTime = (ms) => {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
      : `${String(Math.floor(sec / 60)).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  };

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastId);
    toastId = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function createCard(number) {
    const card = document.createElement("article");
    card.className = "timer-card";
    card.dataset.timer = String(number);
    card.innerHTML = `
      <div class="card-head">
        <div class="table-title">
          <span class="table-number">${number}</span>
          <div><h3>Meja ${number}</h3><p>PS RENTAL TIMER</p></div>
        </div>
        <span class="mode-badge" data-role="badge">SIAP</span>
      </div>
      <div class="timer-main">
        <div class="clock-ring" data-role="ring">
          <div class="clock-inner">
            <span class="clock-label" data-role="label">SISA WAKTU</span>
            <output class="timer-number" data-role="display">30:00</output>
            <span class="timer-sub" data-role="sub">Siap memulai</span>
          </div>
        </div>
        <div class="field-stack">
          <label class="field">Jenis konsol
            <select data-role="console">
              <option value="PS 3">PlayStation 3</option>
              <option value="PS 4">PlayStation 4</option>
            </select>
          </label>
          <label class="field">Nama pelanggan (opsional)
            <input data-role="name" type="text" maxlength="50" placeholder="Nama pelanggan">
          </label>
          <label class="field">Preset durasi
            <select data-role="preset">
              <option value="15">15 menit</option>
              <option value="30" selected>30 menit</option>
              <option value="45">45 menit</option>
              <option value="60">60 menit</option>
              <option value="90">90 menit</option>
              <option value="120">120 menit</option>
              <option value="custom">Durasi kustom</option>
            </select>
          </label>
        </div>
      </div>
      <div class="duration-row" data-role="custom" hidden>
        <label class="field">Jam<input data-role="hours" type="number" min="0" max="999" value="0"></label>
        <label class="field">Menit<input data-role="minutes" type="number" min="0" max="59" value="30"></label>
        <label class="field">Detik<input data-role="seconds" type="number" min="0" max="59" value="0"></label>
      </div>
      <div class="timer-controls">
        <button class="btn btn-primary start-btn" data-role="start" type="button">▶ Mulai timer</button>
        <button class="btn btn-secondary" data-role="pause" type="button" disabled>Ⅱ Jeda</button>
        <button class="btn btn-ghost" data-role="reset" type="button">↺ Reset</button>
      </div>
      <p class="card-status" data-role="status">Pilih durasi, lalu mulai timer.</p>
    `;
    grid.appendChild(card);
    const q = (role) => card.querySelector(`[data-role="${role}"]`);
    const timer = {
      number, card, q, mode: "idle", durationMs: 1_800_000, remainingMs: 1_800_000,
      endAt: 0, overtimeAt: 0, interval: null, alarmInterval: null, alarmOn: false,
      lateMinute: 0, lastSpokenAt: 0
    };
    timers.push(timer);

    q("preset").addEventListener("change", () => {
      q("custom").hidden = q("preset").value !== "custom";
      if (timer.mode === "idle" || timer.mode === "finished") {
        const ms = readDuration(timer);
        if (ms) { timer.durationMs = ms; timer.remainingMs = ms; render(timer); }
      }
    });
    ["hours", "minutes", "seconds"].forEach((role) => q(role).addEventListener("change", () => {
      if (q("preset").value === "custom" && (timer.mode === "idle" || timer.mode === "finished")) {
        const ms = readDuration(timer);
        if (ms) { timer.durationMs = ms; timer.remainingMs = ms; render(timer); }
      }
    }));
    q("start").addEventListener("click", () => startTimer(timer));
    q("pause").addEventListener("click", () => pauseTimer(timer));
    q("reset").addEventListener("click", () => resetTimer(timer));
    render(timer);
  }

  function readDuration(t) {
    if (t.q("preset").value !== "custom") return Number(t.q("preset").value) * 60_000;
    const h = Number(t.q("hours").value), m = Number(t.q("minutes").value), s = Number(t.q("seconds").value);
    if (![h,m,s].every(Number.isInteger) || h < 0 || h > 999 || m < 0 || m > 59 || s < 0 || s > 59 || h*3600+m*60+s < 1) {
      toast(`Meja ${t.number}: durasi kustom tidak valid.`);
      return null;
    }
    return (h * 3600 + m * 60 + s) * 1000;
  }

  function setMode(t, mode) {
    t.mode = mode;
    const labels = {idle:"SIAP", running:"BERJALAN", paused:"DIJEDA", overtime:"WAKTU HABIS", finished:"SELESAI"};
    const badge = t.q("badge");
    badge.textContent = labels[mode];
    badge.className = `mode-badge ${mode}`;
    t.card.classList.toggle("is-running", mode === "running");
    t.card.classList.toggle("is-paused", mode === "paused");
    t.card.classList.toggle("is-overtime", mode === "overtime");
    const locked = ["running","paused","overtime"].includes(mode);
    ["console","name","preset","hours","minutes","seconds"].forEach(role => { if (t.q(role)) t.q(role).disabled = locked; });
    t.q("custom").style.opacity = locked ? ".6" : "1";
    t.q("start").textContent = mode === "paused" ? "▶ Lanjutkan" : mode === "finished" ? "▶ Mulai lagi" : "▶ Mulai timer";
    t.q("pause").disabled = !["running","overtime"].includes(mode);
  }

  function render(t) {
    const label = t.q("label"), display = t.q("display"), sub = t.q("sub"), ring = t.q("ring");
    if (t.mode === "overtime") {
      const elapsed = Date.now() - t.overtimeAt;
      label.textContent = "WAKTU TAMBAHAN";
      display.textContent = `+${formatTime(elapsed)}`;
      sub.textContent = t.q("name").value.trim() || `PS ${t.q("console").value.endsWith("3") ? "3" : "4"} • Meja ${t.number}`;
      const frac = (elapsed % 60_000) / 60_000;
      ring.style.background = `conic-gradient(var(--danger) ${frac*360}deg,rgba(255,100,124,.12) 0deg)`;
    } else {
      label.textContent = "SISA WAKTU";
      display.textContent = formatTime(t.remainingMs);
      sub.textContent = t.q("name").value.trim() || (t.mode === "paused" ? "Timer dijeda" : t.mode === "running" ? "Sesi berjalan" : "Siap memulai");
      const frac = Math.max(0, Math.min(1, t.remainingMs / Math.max(1,t.durationMs)));
      ring.style.background = `conic-gradient(var(--accent) ${frac*360}deg,rgba(124,140,255,.12) 0deg)`;
    }
  }

  function setStatus(t, message, alert = false) {
    t.q("status").textContent = message;
    t.q("status").classList.toggle("alert", alert);
  }

  async function ensureAudio() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    try {
      if (!audioContext) audioContext = new AudioCtx();
      if (audioContext.state === "suspended") await audioContext.resume();
      return audioContext.state === "running";
    } catch { return false; }
  }

  function beep() {
    if (!audioContext || audioContext.state !== "running") return;
    try {
      const osc = audioContext.createOscillator(), gain = audioContext.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, audioContext.currentTime);
      gain.gain.setValueAtTime(.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.22 * globalVolume, audioContext.currentTime + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + .55);
      osc.connect(gain); gain.connect(audioContext.destination);
      osc.start(); osc.stop(audioContext.currentTime + .58);
    } catch {}
  }

  function speak(text, timerNumber = null, isRepeat = false) {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      toast("Browser ini tidak mendukung suara otomatis.");
      return;
    }
    // Hindari pengumuman meja yang sama menumpuk berkali-kali di antrean.
    if (timerNumber !== null && queuedTimerIds.has(timerNumber)) return;
    if (timerNumber !== null) queuedTimerIds.add(timerNumber);
    speechQueue.push({ text, timerNumber, isRepeat });
    processSpeechQueue();
  }

  function processSpeechQueue() {
    if (speechBusy || speechQueue.length === 0) return;
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;

    const item = speechQueue.shift();
    speechBusy = true;
    currentSpeech = item;
    const u = new SpeechSynthesisUtterance(item.text);
    u.lang = "id-ID";
    u.rate = .9;
    u.pitch = 1;
    u.volume = globalVolume;

    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      if (item.timerNumber !== null) queuedTimerIds.delete(item.timerNumber);
      speechBusy = false;
      currentSpeech = null;
      setTimeout(processSpeechQueue, 250);
    };
    u.onend = finish;
    u.onerror = finish;
    try {
      window.speechSynthesis.speak(u);
    } catch {
      finish();
    }
  }

  function clearSpeechQueue() {
    speechQueue.length = 0;
    queuedTimerIds.clear();
    speechBusy = false;
    currentSpeech = null;
    try {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch {}
  }

  function announcement(t) {
    const name = t.q("name").value.trim();
    const consoleName = t.q("console").value;
    return `Perhatian${name ? " " + name : ""}. Waktu bermain di ${consoleName}, meja nomor ${t.number}, sudah habis. Silakan selesaikan permainan.`;
  }

  async function startTimer(t) {
    await ensureAudio();
    if (t.mode === "paused") {
      if (t.overtimeAt) {
        t.overtimeAt = Date.now() - (t.overtimeElapsed || 0);
        setMode(t, "overtime");
      } else {
        t.endAt = Date.now() + t.remainingMs;
        setMode(t, "running");
      }
      setStatus(t, `Timer meja ${t.number} dilanjutkan.`);
      return;
    }
    if (["running","overtime"].includes(t.mode)) return;
    const duration = readDuration(t);
    if (!duration) return;
    stopAlarm(t, false);
    t.durationMs = duration; t.remainingMs = duration; t.overtimeAt = 0; t.overtimeElapsed = 0; t.lateMinute = 0;
    t.endAt = Date.now() + duration;
    setMode(t, "running");
    setStatus(t, `Timer meja ${t.number} berjalan.`);
    if (!t.interval) t.interval = setInterval(() => tick(t), 250);
    render(t); updateStats();
  }

  function pauseTimer(t) {
    if (t.mode === "running") {
      t.remainingMs = Math.max(0, t.endAt - Date.now());
      setMode(t, "paused");
      setStatus(t, `Timer meja ${t.number} dijeda.`);
    } else if (t.mode === "overtime") {
      t.overtimeElapsed = Date.now() - t.overtimeAt;
      t.overtimeAt = 0;
      stopAlarm(t, false);
      setMode(t, "paused");
      setStatus(t, `Timer meja ${t.number} dijeda saat waktu tambahan.`);
    }
    render(t); updateStats();
  }

  function resetTimer(t) {
    stopAlarm(t, false);
    t.remainingMs = t.durationMs;
    t.overtimeAt = 0; t.overtimeElapsed = 0; t.lateMinute = 0;
    setMode(t, "idle");
    setStatus(t, "Timer diatur ulang dan siap digunakan.");
    render(t); updateStats();
  }

  function tick(t) {
    if (t.mode === "running") {
      t.remainingMs = Math.max(0, t.endAt - Date.now());
      if (t.remainingMs <= 0) {
        t.remainingMs = 0; t.overtimeAt = Date.now(); t.overtimeElapsed = 0;
        setMode(t, "overtime");
        setStatus(t, "Waktu habis! Pengumuman suara aktif.", true);
        startAlarm(t);
      }
    } else if (t.mode === "overtime") {
      const elapsed = Date.now() - t.overtimeAt;
      const minute = Math.floor(elapsed / 60_000);
      if (minute > t.lateMinute) {
        t.lateMinute = minute;
        setStatus(t, `Waktu tambahan ${minute} menit • Meja ${t.number}.`, true);
      }
    }
    render(t); updateStats();
  }

  function startAlarm(t) {
    if (t.alarmOn) return;
    t.alarmOn = true;
    t.lastSpokenAt = Date.now();
    beep();
    speak(announcement(t), t.number, false);

    // Pengumuman ulang lebih renggang untuk memberi kesempatan meja lain berbicara.
    t.alarmInterval = setInterval(() => {
      if (!t.alarmOn) return;
      beep();
      speak(announcement(t), t.number, true);
    }, 15000);
  }

  function stopAlarm(t, announce = true) {
    if (t.alarmInterval) clearInterval(t.alarmInterval);
    t.alarmInterval = null; t.alarmOn = false;
    if (announce) setStatus(t, "Alarm dihentikan. Timer tetap mencatat waktu tambahan.", t.mode === "overtime");
    updateStats();
  }

  function updateStats() {
    $("runningCount").textContent = timers.filter(t => t.mode === "running" || t.mode === "paused").length;
    $("overtimeCount").textContent = timers.filter(t => t.mode === "overtime").length;
    $("idleCount").textContent = timers.filter(t => t.mode === "idle" || t.mode === "finished").length;
  }

  for (let i = 1; i <= 10; i++) createCard(i);
  setInterval(() => {
    timers.forEach(t => { if (t.mode === "running" || t.mode === "overtime") tick(t); });
  }, 250);

  $("volumeRange").addEventListener("input", e => {
    globalVolume = Number(e.target.value) / 100;
    $("volumeValue").textContent = `${e.target.value}%`;
  });
  $("testVoiceBtn").addEventListener("click", async () => {
    await ensureAudio();
    beep();
    speak("Tes suara TimerStop. Perhatian, ini pengumuman contoh untuk PS 3 meja nomor satu. Volume suara dapat diatur di panel atas.");
  });
  $("stopVoiceBtn").addEventListener("click", () => {
    timers.forEach(t => stopAlarm(t, false));
    clearSpeechQueue();
    toast("Semua suara dan alarm dihentikan.");
  });
  $("stopAllBtn").addEventListener("click", () => {
    timers.forEach(t => stopAlarm(t, false));
    clearSpeechQueue();
    toast("Semua alarm dihentikan. Timer yang berjalan tetap aktif.");
  });
})();