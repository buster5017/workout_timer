// ================= 1. 기본 샘플 데이터 (자전거 케이던스 훈련 32분) =================
const DEFAULT_WORKOUT = {
  title: "자전거 케이던스 훈련",
  warmup: { duration: 600, color: "#2563eb" }, // 10분 (파랑)
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
  cooldown: { duration: 600, color: "#0d9488" } // 10분 (청록)
};

// 상태 관리 변수
let currentConfig = null;
let presets = {};
let executionQueue = [];
let currentStepIndex = 0;

// 정밀 타이머 변수 (절대 시각 기준)
let isRunning = false;
let isPaused = false;
let stepEndTime = 0;
let stepRemainingMs = 0;
let lastAnnouncedSec = -1;
let workerTimer = null;

// 오디오 & 화면켜짐 유지 변수
let audioCtx = null;
let wakeLock = null;

// ================= 2. 초기화 및 로컬 스토리지 연동 =================
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
  select.innerHTML = "";
  Object.keys(presets).forEach(title => {
    const opt = document.createElement("option");
    opt.value = title;
    opt.textContent = title;
    if (currentConfig && currentConfig.title === title) opt.selected = true;
    select.appendChild(opt);
  });
}

// ================= 3. 설정 화면 렌더링 및 조작 =================
function renderSetupUI() {
  document.getElementById("workout-title").value = currentConfig.title || "";

  // 준비 & 쿨다운
  document.getElementById("warmup-min").value = Math.floor(currentConfig.warmup.duration / 60);
  document.getElementById("warmup-sec").value = currentConfig.warmup.duration % 60;
  document.getElementById("warmup-color").value = currentConfig.warmup.color || "#2563eb";

  document.getElementById("cooldown-min").value = Math.floor(currentConfig.cooldown.duration / 60);
  document.getElementById("cooldown-sec").value = currentConfig.cooldown.duration % 60;
  document.getElementById("cooldown-color").value = currentConfig.cooldown.color || "#0d9488";

  document.getElementById("cycle-count").textContent = currentConfig.cycles;

  // 세트 렌더링
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
  currentConfig.title = document.getElementById("workout-title").value.trim() || "나의 운동 루틴";

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
  document.getElementById("setup-total-time").textContent = formatTime(totalSec);
}

// ================= 4. 실행 큐(1열 대본) 평탄화 생성 =================
function buildExecutionQueue(cfg) {
  const queue = [];

  // 1) 준비
  if (cfg.warmup.duration > 0) {
    queue.push({
      name: "준비",
      duration: cfg.warmup.duration,
      color: cfg.warmup.color,
      badge: "준비 (Warm-up)"
    });
  }

  // 2) 싸이클 -> 세트 -> 라운드 -> 인터벌 중첩 전개
  for (let c = 1; c <= cfg.cycles; c++) {
    cfg.sets.forEach((setItem, sIdx) => {
      for (let r = 1; r <= setItem.rounds; r++) {
        setItem.intervals.forEach(intv => {
          if (intv.duration > 0) {
            queue.push({
              name: intv.name,
              duration: intv.duration,
              color: intv.color,
              badge: `싸이클 ${c}/${cfg.cycles} · 세트 ${sIdx + 1} · 라운드 ${r}/${setItem.rounds}`
            });
          }
        });
      }
    });
  }

  // 3) 쿨다운
  if (cfg.cooldown.duration > 0) {
    queue.push({
      name: "쿨다운",
      duration: cfg.cooldown.duration,
      color: cfg.cooldown.color,
      badge: "쿨다운 (Cool-down)"
    });
  }

  return queue;
}

// ================= 5. 백그라운드 유지 & 오디오/TTS 엔진 =================
function initWebWorker() {
  // 백그라운드에서도 스로틀링 없이 100ms마다 틱을 발생시키는 인라인 Web Worker
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

function startSilentAudioAndWakeLock() {
  // 1) Web Audio API 초기화 및 무음 오실레이터 지속 실행 (백그라운드 슬립 방지)
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  // 무음 스트림 유지
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  gain.gain.value = 0.0001; // 사람 귀에 들리지 않는 극미세 출력
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();

  // 2) 화면 켜짐 유지 (Wake Lock)
  if ("wakeLock" in navigator) {
    navigator.wakeLock.request("screen").then(lock => {
      wakeLock = lock;
    }).catch(() => {});
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => { wakeLock = null; }).catch(() => {});
  }
}

// 비프음 발생기 (5초~1초 카운트다운용)
function playBeep(freq = 880, durationMs = 120) {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

  gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durationMs / 1000);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + durationMs / 1000);
}

// 한국어 TTS 음성 안내
function speakTTS(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel(); // 이전 음성 겹침 방지
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ko-KR";
  utter.rate = 1.15; // 운동 중 명확하게 들리도록 약간 경쾌한 속도
  utter.pitch = 1.0;
  window.speechSynthesis.speak(utter);
}

// ================= 6. 타이머 실행 및 좌->우 색상 오버랩 제어 =================
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

  // 절대 종료 시각 설정
  const durationMs = currentStep.duration * 1000;
  stepEndTime = Date.now() + durationMs;
  stepRemainingMs = durationMs;
  lastAnnouncedSec = currentStep.duration; // 시작 시점 초 기록 (중복 멘트 방지)

  // 1) 중앙 타이머 텍스트 재설정 및 색상 레이어 세팅
  const timerBlock = document.getElementById("timer-block");
  const nextFill = document.getElementById("timer-next-fill");

  // 현재 구간 배경색 지정
  timerBlock.style.backgroundColor = currentStep.color;

  // 다음 구간 색상 지정 (마지막 구간인 경우 완료 색상인 어두운 골드/다크블루로 설정)
  nextFill.style.backgroundColor = nextStep ? nextStep.color : "#1e293b";
  nextFill.style.transform = "scaleX(0)";

  // 중앙 고정 텍스트 업데이트
  document.getElementById("runner-phase-badge").textContent = currentStep.badge;
  document.getElementById("current-interval-name").textContent = currentStep.name;
  document.getElementById("current-time-left").textContent = formatTime(currentStep.duration);

  if (nextStep) {
    document.getElementById("next-interval-preview").textContent =
      `다음: ${nextStep.name} (${formatTime(nextStep.duration)})`;
  } else {
    document.getElementById("next-interval-preview").textContent = `다음: 운동 완료 🎉`;
  }

  // 시작 즉시 현재 구간 이름 TTS 안내
  speakTTS(currentStep.name);
  updateOverallProgressUI(currentStep.duration);
}

function onTimerTick() {
  const now = Date.now();
  stepRemainingMs = stepEndTime - now;

  const currentStep = executionQueue[currentStepIndex];
  const totalStepMs = currentStep.duration * 1000;

  if (stepRemainingMs <= 0) {
    // 현재 구간 종료 -> 즉시 다음 구간으로 전환 (중앙 타이머 재설정)
    startStep(currentStepIndex + 1);
    return;
  }

  // 1) 왼쪽 -> 오른쪽 색상 차오름 비율 계산 (0.0 ~ 1.0)
  const elapsedRatio = Math.min(1, Math.max(0, (totalStepMs - stepRemainingMs) / totalStepMs));
  document.getElementById("timer-next-fill").style.transform = `scaleX(${elapsedRatio})`;

  // 2) 남은 초 계산 (올림 처리하여 00:01까지 명확히 표시)
  const remainingSec = Math.ceil(stepRemainingMs / 1000);

  if (remainingSec !== lastAnnouncedSec) {
    lastAnnouncedSec = remainingSec;
    document.getElementById("current-time-left").textContent = formatTime(remainingSec);
    updateOverallProgressUI(remainingSec);

    // 3) TTS 및 비프음 트리거 (시작 시점과 겹치지 않을 때만 작동)
    if (remainingSec < currentStep.duration) {
      if (remainingSec === 300) {
        speakTTS("5분");
      } else if (remainingSec === 60) {
        speakTTS("1분");
      } else if (remainingSec === 10) {
        speakTTS("10");
      } else if (remainingSec <= 5 && remainingSec >= 1) {
        playBeep(880, 110); // 5, 4, 3, 2, 1초 짧은 비프음
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
  document.getElementById("overall-bar-fill").style.width = `${progressPercent}%`;
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

  playBeep(1046.5, 350);
  speakTTS("운동 완료");
  releaseWakeLock();
}

// ================= 7. 버튼 이벤트 바인딩 =================
function bindEvents() {
  // 설정 값 변경 시 실시간 저장
  ["workout-title", "warmup-min", "warmup-sec", "warmup-color", "cooldown-min", "cooldown-sec", "cooldown-color"].forEach(id => {
    document.getElementById(id).addEventListener("input", saveLastConfig);
  });

  // 세트 추가
  document.getElementById("btn-add-set").addEventListener("click", () => {
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

  // 프리셋 저장
  document.getElementById("btn-save-preset").addEventListener("click", () => {
    syncUIFromDOM();
    const title = currentConfig.title.trim();
    if (!title) return alert("훈련 제목을 입력해주세요.");
    presets[title] = JSON.parse(JSON.stringify(currentConfig));
    localStorage.setItem("workout_presets_v1", JSON.stringify(presets));
    updatePresetSelect();
    alert(`'${title}' 루틴이 저장되었습니다.`);
  });

  // 프리셋 불러오기
  document.getElementById("btn-load-preset").addEventListener("click", () => {
    const selectedTitle = document.getElementById("preset-select").value;
    if (presets[selectedTitle]) {
      currentConfig = JSON.parse(JSON.stringify(presets[selectedTitle]));
      localStorage.setItem("workout_last_config_v1", JSON.stringify(currentConfig));
      renderSetupUI();
    }
  });

  // 프리셋 삭제
  document.getElementById("btn-delete-preset").addEventListener("click", () => {
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

  // 운동 시작
  document.getElementById("btn-start-workout").addEventListener("click", startWorkout);

  // 일시정지 / 재개
  document.getElementById("btn-pause").addEventListener("click", () => {
    if (!isRunning) return;
    const btn = document.getElementById("btn-pause");
    if (!isPaused) {
      isPaused = true;
      stepRemainingMs = Math.max(0, stepEndTime - Date.now());
      window.speechSynthesis.cancel();
      btn.textContent = "▶ 재개";
    } else {
      isPaused = false;
      stepEndTime = Date.now() + stepRemainingMs;
      btn.textContent = "⏸ 일시정지";
    }
  });

  // 이전 구간
  document.getElementById("btn-prev").addEventListener("click", () => {
    if (!isRunning) return;
    isPaused = false;
    document.getElementById("btn-pause").textContent = "⏸ 일시정지";
    startStep(Math.max(0, currentStepIndex - 1));
  });

  // 다음 구간
  document.getElementById("btn-next").addEventListener("click", () => {
    if (!isRunning) return;
    isPaused = false;
    document.getElementById("btn-pause").textContent = "⏸ 일시정지";
    startStep(currentStepIndex + 1);
  });

  // 종료 (설정 화면으로 복귀)
  document.getElementById("btn-stop").addEventListener("click", () => {
    isRunning = false;
    isPaused = false;
    workerTimer.postMessage("stop");
    window.speechSynthesis.cancel();
    releaseWakeLock();
    document.getElementById("runner-view").classList.remove("active");
    document.getElementById("setup-view").classList.add("active");
  });

  // 화면 다시 켜졌을 때 WakeLock 재요청
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isRunning) {
      startSilentAudioAndWakeLock();
    }
  });
}

// 시간 포맷 함수 (MM:SS)
function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}