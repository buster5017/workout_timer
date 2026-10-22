// ================= 1. 기본 샘플 데이터 (자전거 케이던스 훈련 32분) =================
const DEFAULT_WORKOUT = {
  title: "자전거 케이던스 훈련",
  warmup: { duration: 600, color: "#2563eb" },
  cycles: 2,
  sets: [
    {
      rounds: 2,
      intervals: [
        { name: "케이던스 95", duration: 20, color: "#f59e0b" },
        { name: "케이던스 100", duration: 20, color: "#ea580c" },
        { name: "케이던스 105", duration: 20, color: "#dc2626" },
        { name: "회복", duration: 60, color: "#16a34a" }
      ]
    },
    {
      rounds: 1,
      intervals: [
        { name: "케이던스 125", duration: 20, color: "#e11d48" },
        { name: "케이던스 130", duration: 20, color: "#be123c" },
        { name: "케이던스 135", duration: 20, color: "#9333ea" },
        { name: "회복", duration: 60, color: "#16a34a" }
      ]
    }
  ],
  cooldown: { duration: 600, color: "#0d9488" }
};

let currentConfig = null;
let presets = {};
let executionQueue = [];
let currentStepIndex = 0;

let isRunning = false;
let isPaused = false;
let stepEndTime = 0;
let stepRemainingMs = 0;
let lastAnnouncedSec = -1;
let workerTimer = null;

let audioCtx = null;
let wakeLock = null;
let keepAwakeVideo = null;
let ttsKeepAliveTimer = null;

// 볼륨 기준값 상수 (마스터 슬라이더와 연동)
const BEEP_MAX_GAIN = 0.4; // TTS가 1.0일 때 비프음의 최대 비율

window.addEventListener("DOMContentLoaded", () => {
  loadStorage();
  renderSetupUI();
  bindEvents();
  initWebWorker();
});

function loadStorage() {
  const savedPresets = localStorage.getItem("workout_presets_v1");
  const savedLast = localStorage.getItem("workout_last_config_v1");

  if (savedPresets) {
    presets = JSON.parse(savedPresets);
  } else {
    presets = { "자전거 케이던스 훈련": JSON.parse(JSON.stringify(DEFAULT_WORKOUT)) };
    localStorage.setItem("workout_presets_v1", JSON.stringify(presets));
  }

  if (savedLast) {
    currentConfig = JSON.parse(savedLast);
  } else {
    currentConfig = JSON.parse(JSON.stringify(DEFAULT_WORKOUT));
  }
  updatePresetSelect();
}

function saveLastConfig() {
  syncUIFromDOM();
  localStorage.setItem("workout_last_config_v1", JSON.stringify(currentConfig));
  updateTotalDurationPreview();
}

function updatePresetSelect() {
  const select = document.getElementById("preset-select");
  if (!select) return;
  select.innerHTML = "";
  Object.keys(presets).forEach(title => {
    const opt = document.createElement("option");
    opt.value = title;
    opt.textContent = title;
    if (currentConfig && currentConfig.title === title) opt.selected = true;
    select.appendChild(opt);
  });
}

function renderSetupUI() {
  const titleInput = document.getElementById("workout-title");
  if (!titleInput) return;

  titleInput.value = currentConfig.title || "";
  document.getElementById("warmup-min").value = Math.floor(currentConfig.warmup.duration / 60);
  document.getElementById("warmup-sec").value = currentConfig.warmup.duration % 60;
  document.getElementById("warmup-color").value = currentConfig.warmup.color || "#2563eb";

  document.getElementById("cooldown-min").value = Math.floor(currentConfig.cooldown.duration / 60);
  document.getElementById("cooldown-sec").value = currentConfig.cooldown.duration % 60;
  document.getElementById("cooldown-color").value = currentConfig.cooldown.color || "#0d9488";

  document.getElementById("cycle-count").textContent = currentConfig.cycles;

  const container = document.getElementById("sets-container");
  container.innerHTML = "";

  currentConfig.sets.forEach((setItem, sIdx) => {
    const setDiv = document.createElement("div");
    setDiv.className = "set-box";

    let intervalsHTML = "";
    setItem.intervals.forEach((intv, iIdx) => {
      const iMin = Math.floor(intv.duration / 60);
      const iSec = intv.duration % 60;
      intervalsHTML += `
        <div class="interval-row" data-sidx="${sIdx}" data-iidx="${iIdx}">
          <input type="color" class="color-picker intv-color" value="${intv.color}" onchange="saveLastConfig()">
          <input type="text" class="intv-name" value="${intv.name}" placeholder="인터벌 이름" oninput="saveLastConfig()">
          <input type="number" class="mini-time intv-min" min="0" max="99" value="${iMin}" oninput="saveLastConfig()"><span>분</span>
          <input type="number" class="mini-time intv-sec" min="0" max="59" value="${iSec}" oninput="saveLastConfig()"><span>초</span>
          <button type="button" class="btn-icon-del" onclick="removeInterval(${sIdx}, ${iIdx})" title="삭제">✕</button>
        </div>
      `;
    });

    setDiv.innerHTML = `
      <div class="set-header">
        <span class="set-title">세트 ${sIdx + 1}</span>
        <div class="set-controls">
          <div class="stepper">
            <button type="button" class="btn-step" onclick="changeRound(${sIdx}, -1)">-</button>
            <span>${setItem.rounds}</span><span>라운드</span>
            <button type="button" class="btn-step" onclick="changeRound(${sIdx}, 1)">+</button>
          </div>
          <button type="button" class="btn-icon-del" onclick="removeSet(${sIdx})" title="세트 삭제">🗑️</button>
        </div>
      </div>
      <div class="intervals-list">${intervalsHTML}</div>
      <button type="button" class="btn-dashed" onclick="addInterval(${sIdx})">+ 인터벌 타이머 추가</button>
    `;
    container.appendChild(setDiv);
  });

  updateTotalDurationPreview();
}

function syncUIFromDOM() {
  const titleInput = document.getElementById("workout-title");
  if (!titleInput) return;

  currentConfig.title = titleInput.value.trim() || "나의 운동 루틴";
  const wMin = parseInt(document.getElementById("warmup-min").value) || 0;
  const wSec = parseInt(document.getElementById("warmup-sec").value) || 0;
  currentConfig.warmup.duration = wMin * 60 + wSec;
  currentConfig.warmup.color = document.getElementById("warmup-color").value;

  const cMin = parseInt(document.getElementById("cooldown-min").value) || 0;
  const cSec = parseInt(document.getElementById("cooldown-sec").value) || 0;
  currentConfig.cooldown.duration = cMin * 60 + cSec;
  currentConfig.cooldown.color = document.getElementById("cooldown-color").value;

  const setBoxes = document.querySelectorAll(".set-box");
  setBoxes.forEach((box, sIdx) => {
    const rows = box.querySelectorAll(".interval-row");
    const newIntervals = [];
    rows.forEach(row => {
      const color = row.querySelector(".intv-color").value;
      const name = row.querySelector(".intv-name").value.trim() || "인터벌";
      const min = parseInt(row.querySelector(".intv-min").value) || 0;
      const sec = parseInt(row.querySelector(".intv-sec").value) || 0;
      newIntervals.push({ name, duration: Math.max(1, min * 60 + sec), color });
    });
    currentConfig.sets[sIdx].intervals = newIntervals;
  });
}

window.changeCycle = function(delta) {
  syncUIFromDOM();
  currentConfig.cycles = Math.max(1, currentConfig.cycles + delta);
  document.getElementById("cycle-count").textContent = currentConfig.cycles;
  saveLastConfig();
};

window.changeRound = function(sIdx, delta) {
  syncUIFromDOM();
  currentConfig.sets[sIdx].rounds = Math.max(1, currentConfig.sets[sIdx].rounds + delta);
  renderSetupUI();
  saveLastConfig();
};

window.addInterval = function(sIdx) {
  syncUIFromDOM();
  currentConfig.sets[sIdx].intervals.push({ name: "새 인터벌", duration: 30, color: "#ea580c" });
  renderSetupUI();
  saveLastConfig();
};

window.removeInterval = function(sIdx, iIdx) {
  syncUIFromDOM();
  if (currentConfig.sets[sIdx].intervals.length <= 1) {
    alert("세트 내에 최소 1개의 인터벌이 필요합니다.");
    return;
  }
  currentConfig.sets[sIdx].intervals.splice(iIdx, 1);
  renderSetupUI();
  saveLastConfig();
};

window.removeSet = function(sIdx) {
  syncUIFromDOM();
  if (currentConfig.sets.length <= 1) {
    alert("최소 1개의 세트가 있어야 합니다.");
    return;
  }
  currentConfig.sets.splice(sIdx, 1);
  renderSetupUI();
  saveLastConfig();
};

function updateTotalDurationPreview() {
  const queue = buildExecutionQueue(currentConfig);
  const totalSec = queue.reduce((acc, cur) => acc + cur.duration, 0);
  const totalTimeEl = document.getElementById("setup-total-time");
  if (totalTimeEl) totalTimeEl.textContent = formatTime(totalSec);
}

function buildExecutionQueue(cfg) {
  const queue = [];
  if (cfg.warmup.duration > 0) {
    queue.push({ name: "준비", duration: cfg.warmup.duration, color: cfg.warmup.color, badge: "준비 (Warm-up)" });
  }
  for (let c = 1; c <= cfg.cycles; c++) {
    cfg.sets.forEach((setItem, sIdx) => {
      for (let r = 1; r <= setItem.rounds; r++) {
        setItem.intervals.forEach(intv => {
          if (intv.duration > 0) {
            queue.push({ name: intv.name, duration: intv.duration, color: intv.color, badge: `싸이클 ${c}/${cfg.cycles} · 세트 ${sIdx + 1} · 라운드 ${r}/${setItem.rounds}` });
          }
        });
      }
    });
  }
  if (cfg.cooldown.duration > 0) {
    queue.push({ name: "쿨다운", duration: cfg.cooldown.duration, color: cfg.cooldown.color, badge: "쿨다운 (Cool-down)" });
  }
  return queue;
}

function initWebWorker() {
  const blob = new Blob([`
    let timer = null;
    self.onmessage = function(e) {
      if (e.data === 'start') {
        if (timer) clearInterval(timer);
        timer = setInterval(() => self.postMessage('tick'), 80);
      } else if (e.data === 'stop') {
        clearInterval(timer);
        timer = null;
      }
    };
  `], { type: "application/javascript" });

  workerTimer = new Worker(URL.createObjectURL(blob));
  workerTimer.onmessage = () => {
    if (isRunning && !isPaused) onTimerTick();
  };
}

function initKeepAwakeVideo() {
  if (keepAwakeVideo) return;
  keepAwakeVideo = document.createElement("video");
  keepAwakeVideo.setAttribute("playsinline", "");
  keepAwakeVideo.setAttribute("muted", "");
  keepAwakeVideo.setAttribute("loop", "");
  keepAwakeVideo.muted = true;
  keepAwakeVideo.style.position = "fixed";
  keepAwakeVideo.style.top = "-10px";
  keepAwakeVideo.style.left = "-10px";
  keepAwakeVideo.style.width = "1px";
  keepAwakeVideo.style.height = "1px";
  keepAwakeVideo.style.opacity = "0.01";
  keepAwakeVideo.style.pointerEvents = "none";
  keepAwakeVideo.src = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAu1tZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE0OCByMjc5NSA2YThhOWI2IC0gSC4yNjQvTVBFRy00 AVCIGNvZGVjIC0gQ29weXJpZ2h0IDIwMDMtMjAxNyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwcyk9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfHlyaW1pZD0yIGJfYWRhcHQ9MS bi_m_ia=0";
  document.body.appendChild(keepAwakeVideo);
}

function startSilentAudioAndWakeLock() {
  try {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  } catch (e) {}

  try {
    initKeepAwakeVideo();
    keepAwakeVideo.play();
  } catch (e) {}

  if ("wakeLock" in navigator) {
    navigator.wakeLock.request("screen").then(lock => {
      wakeLock = lock;
    }).catch(() => {});
  }

  if (ttsKeepAliveTimer) clearInterval(ttsKeepAliveTimer);
  ttsKeepAliveTimer = setInterval(() => {
    if (isRunning && !isPaused && "speechSynthesis" in window) {
      const silentUtter = new SpeechSynthesisUtterance("");
      silentUtter.volume = 0;
      window.speechSynthesis.speak(silentUtter);
    }
  }, 12000);
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => { wakeLock = null; }).catch(() => {});
  }
  if (keepAwakeVideo) {
    keepAwakeVideo.pause();
  }
  if (ttsKeepAliveTimer) {
    clearInterval(ttsKeepAliveTimer);
    ttsKeepAliveTimer = null;
  }
}

// 1100Hz 중고음 부저 비프음 (볼륨 슬라이더 연동)
function playBeep(freq = 1100, durationMs = 200) {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();

  const volumeEl = document.getElementById("master-volume");
  const masterVol = volumeEl ? parseFloat(volumeEl.value) : 0.8;
  const currentGain = masterVol * BEEP_MAX_GAIN;

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();

  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, now);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(2200, now);

  gain.gain.setValueAtTime(0.01, now);
  gain.gain.linearRampToValueAtTime(currentGain, now + 0.015);
  gain.gain.setValueAtTime(currentGain, now + 0.15);
  gain.gain.linearRampToValueAtTime(0.001, now + (durationMs / 1000));

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + (durationMs / 1000));

  if ("vibrate" in navigator) {
    navigator.vibrate(100);
  }
}

// 한국어 TTS (마스터 볼륨 연동 및 수면 방지 처리)
function speakTTS(text) {
  if (!("speechSynthesis" in window)) return;

  const volumeEl = document.getElementById("master-volume");
  const masterVol = volumeEl ? parseFloat(volumeEl.value) : 0.8;

  window.speechSynthesis.resume();
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ko-KR";
  utter.volume = masterVol;
  utter.rate = 1.05;
  utter.pitch = 1.1;
  window.speechSynthesis.speak(utter);
}

function startWorkout() {
  syncUIFromDOM();
  saveLastConfig();
  executionQueue = buildExecutionQueue(currentConfig);

  if (executionQueue.length === 0) {
    alert("설정된 타이머 시간이 없습니다.");
    return;
  }

  document.getElementById("setup-view").classList.remove("active");
  document.getElementById("runner-view").classList.add("active");
  document.getElementById("runner-workout-title").textContent = currentConfig.title;

  startSilentAudioAndWakeLock();

  currentStepIndex = 0;
  isRunning = true;
  isPaused = false;
  document.getElementById("btn-pause").textContent = "⏸ 일시정지";

  startStep(0);
  workerTimer.postMessage("start");
}

function startStep(index) {
  if (index >= executionQueue.length) {
    completeWorkout();
    return;
  }

  currentStepIndex = index;
  const currentStep = executionQueue[currentStepIndex];
  const nextStep = executionQueue[currentStepIndex + 1] || null;

  const durationMs = currentStep.duration * 1000;
  stepEndTime = Date.now() + durationMs;
  stepRemainingMs = durationMs;
  lastAnnouncedSec = currentStep.duration;

  const timerBlock = document.getElementById("timer-block");
  const nextFill = document.getElementById("timer-next-fill");

  timerBlock.style.backgroundColor = currentStep.color;
  nextFill.style.backgroundColor = nextStep ? nextStep.color : "#1e293b";
  nextFill.style.transform = "scaleX(0)";

  document.getElementById("runner-phase-badge").textContent = currentStep.badge;
  document.getElementById("current-interval-name").textContent = currentStep.name;
  document.getElementById("current-time-left").textContent = formatTime(currentStep.duration);

  if (nextStep) {
    document.getElementById("next-interval-preview").textContent = `다음: ${nextStep.name} (${formatTime(nextStep.duration)})`;
  } else {
    document.getElementById("next-interval-preview").textContent = `다음: 운동 완료 🎉`;
  }

  speakTTS(currentStep.name);
  updateOverallProgressUI(currentStep.duration);
}

function onTimerTick() {
  const now = Date.now();
  stepRemainingMs = stepEndTime - now;

  const currentStep = executionQueue[currentStepIndex];
  const totalStepMs = currentStep.duration * 1000;

  if (stepRemainingMs <= 0) {
    startStep(currentStepIndex + 1);
    return;
  }

  const elapsedRatio = Math.min(1, Math.max(0, (totalStepMs - stepRemainingMs) / totalStepMs));
  document.getElementById("timer-next-fill").style.transform = `scaleX(${elapsedRatio})`;

  const remainingSec = Math.ceil(stepRemainingMs / 1000);

  if (remainingSec !== lastAnnouncedSec) {
    lastAnnouncedSec = remainingSec;
    document.getElementById("current-time-left").textContent = formatTime(remainingSec);
    updateOverallProgressUI(remainingSec);

    if (remainingSec < currentStep.duration) {
      if (remainingSec === 300) {
        speakTTS("5분");
      } else if (remainingSec === 60) {
        speakTTS("1분");
      } else if (remainingSec === 10) {
        speakTTS("10초");
      } else if (remainingSec <= 5 && remainingSec >= 1) {
        playBeep(1100, 180);
      }
    }
  }
}

function updateOverallProgressUI(currentStepRemSec) {
  let totalSec = 0;
  let remainingTotalSec = currentStepRemSec;

  executionQueue.forEach((step, idx) => {
    totalSec += step.duration;
    if (idx > currentStepIndex) {
      remainingTotalSec += step.duration;
    }
  });

  const progressPercent = ((totalSec - remainingTotalSec) / totalSec) * 100;
  document.getElementById("overall-step-text").textContent = `${currentStepIndex + 1}/${executionQueue.length}`;
  document.getElementById("overall-time-left").textContent = formatTime(remainingTotalSec);
  document.getElementById("overall-bar-fill").style.width = `${progressPercent%}`;
}

function completeWorkout() {
  isRunning = false;
  workerTimer.postMessage("stop");

  document.getElementById("timer-next-fill").style.transform = "scaleX(1)";
  document.getElementById("current-interval-name").textContent = "운동 완료!";
  document.getElementById("current-time-left").textContent = "00:00";
  document.getElementById("next-interval-preview").textContent = "수고하셨습니다 👏";
  document.getElementById("overall-time-left").textContent = "00:00";
  document.getElementById("overall-bar-fill").style.width = "100%";

  playBeep(1320, 350);
  speakTTS("운동 완료");
  releaseWakeLock();
}

function bindEvents() {
  ["workout-title", "warmup-min", "warmup-sec", "warmup-color", "cooldown-min", "cooldown-sec", "cooldown-color"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", saveLastConfig);
  });

  const addSetBtn = document.getElementById("btn-add-set");
  if (addSetBtn) {
    addSetBtn.addEventListener("click", () => {
      syncUIFromDOM();
      currentConfig.sets.push({
        rounds: 1,
        intervals: [
          { name: "인터벌", duration: 30, color: "#ea580c" },
          { name: "회복", duration: 60, color: "#16a34a" }
        ]
      });
      renderSetupUI();
      saveLastConfig();
    });
  }

  const savePresetBtn = document.getElementById("btn-save-preset");
  if (savePresetBtn) {
    savePresetBtn.addEventListener("click", () => {
      syncUIFromDOM();
      const title = currentConfig.title.trim();
      if (!title) return alert("훈련 제목을 입력해주세요.");
      presets[title] = JSON.parse(JSON.stringify(currentConfig));
      localStorage.setItem("workout_presets_v1", JSON.stringify(presets));
      updatePresetSelect();
      alert(`'${title}' 루틴이 저장되었습니다.`);
    });
  }

  const loadPresetBtn = document.getElementById("btn-load-preset");
  if (loadPresetBtn) {
    loadPresetBtn.addEventListener("click", () => {
      const selectedTitle = document.getElementById("preset-select").value;
      if (presets[selectedTitle]) {
        currentConfig = JSON.parse(JSON.stringify(presets[selectedTitle]));
        localStorage.setItem("workout_last_config_v1", JSON.stringify(currentConfig));
        renderSetupUI();
      }
    });
  }

  const deletePresetBtn = document.getElementById("btn-delete-preset");
  if (deletePresetBtn) {
    deletePresetBtn.addEventListener("click", () => {
      const selectedTitle = document.getElementById("preset-select").value;
      if (Object.keys(presets).length <= 1) {
        return alert("최소 1개의 프리셋은 남겨두어야 합니다.");
      }
      if (confirm(`'${selectedTitle}' 루틴을 삭제하시겠습니까?`)) {
        delete presets[selectedTitle];
        localStorage.setItem("workout_presets_v1", JSON.stringify(presets));
        const firstKey = Object.keys(presets)[0];
        currentConfig = JSON.parse(JSON.stringify(presets[firstKey]));
        updatePresetSelect();
        renderSetupUI();
      }
    });
  }

  const startWorkoutBtn = document.getElementById("btn-start-workout");
  if (startWorkoutBtn) startWorkoutBtn.addEventListener("click", startWorkout);

  const pauseBtn = document.getElementById("btn-pause");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      if (!isRunning) return;
      if (!isPaused) {
        isPaused = true;
        stepRemainingMs = Math.max(0, stepEndTime - Date.now());
        window.speechSynthesis.cancel();
        pauseBtn.textContent = "▶ 재개";
      } else {
        isPaused = false;
        stepEndTime = Date.now() + stepRemainingMs;
        pauseBtn.textContent = "⏸ 일시정지";
      }
    });
  }

  const prevBtn = document.getElementById("btn-prev");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (!isRunning) return;
      isPaused = false;
      if (pauseBtn) pauseBtn.textContent = "⏸ 일시정지";
      startStep(Math.max(0, currentStepIndex - 1));
    });
  }

  const nextBtn = document.getElementById("btn-next");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (!isRunning) return;
      isPaused = false;
      if (pauseBtn) pauseBtn.textContent = "⏸ 일시정지";
      startStep(currentStepIndex + 1);
    });
  }

  const stopBtn = document.getElementById("btn-stop");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      isRunning = false;
      isPaused = false;
      workerTimer.postMessage("stop");
      window.speechSynthesis.cancel();
      releaseWakeLock();
      document.getElementById("runner-view").classList.remove("active");
      document.getElementById("setup-view").classList.add("active");
    });
  }

  // 블랙 스크린 잠금 모드 이벤트 바인딩
  const lockOverlay = document.getElementById("screen-lock-overlay");
  const lockBtn = document.getElementById("btn-lock-screen");
  if (lockBtn && lockOverlay) {
    lockBtn.addEventListener("click", () => {
      lockOverlay.style.display = "flex";
    });
  }

  // 자물쇠 아이콘 더블 탭 해제 로직
  let lastUnlockTap = 0;
  const unlockBtn = document.getElementById("lock-unlock-btn");
  if (unlockBtn && lockOverlay) {
    unlockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const now = Date.now();
      if (now - lastUnlockTap < 350) {
        lockOverlay.style.display = "none";
      }
      lastUnlockTap = now;
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isRunning) {
      startSilentAudioAndWakeLock();
    }
  });
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
} 