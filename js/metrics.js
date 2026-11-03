import { $, setText, setHtml } from "./dom.js";
import { state } from "./state.js";
import { THRESHOLDS } from "./config.js";
import { OneEuroFilter } from "./filters.js";
import { calc3DAngle, calcStdDev, meanStep } from "./math.js";
import { updateCharts } from "./charts.js";
import { recordPoseFrame } from "./recorder.js";
import {
  speakGuidance,
  evaluateClinicalNorms,
  renderClinicalBaseline,
  triggerLlmGaitAnalysis
} from "./llm.js";

const leftFilter = new OneEuroFilter(1.8, 0.08);
const rightFilter = new OneEuroFilter(1.8, 0.08);

function clearRollingBuffers() {
  state.leftRomArr = [];
  state.rightRomArr = [];
  state.leftStepTimes = [];
  state.rightStepTimes = [];
}

function resolveTugElapsedSec() {
  if (state.tugFinalSec > 0) return state.tugFinalSec;
  if (state.tugStartMs > 0) return (performance.now() - state.tugStartMs) / 1000;
  return 0;
}

export function processPose(normLm, worldLm, now) {
  const rawL = 180 - calc3DAngle(worldLm[23], worldLm[25], worldLm[27]);
  const rawR = 180 - calc3DAngle(worldLm[24], worldLm[26], worldLm[28]);
  const filtL = leftFilter.filter(rawL, now);
  const filtR = rightFilter.filter(rawR, now);

  state.lastFiltL = filtL;
  state.lastFiltR = filtR;

  collectMae(filtR);
  collectJitter(rawR, filtR);

  state.leftRomArr.push(filtL);
  state.rightRomArr.push(filtR);
  if (state.leftRomArr.length > THRESHOLDS.romWindow) state.leftRomArr.shift();
  if (state.rightRomArr.length > THRESHOLDS.romWindow) state.rightRomArr.shift();

  const ankleDiffY = worldLm[27].y - worldLm[28].y;
  if (
    ankleDiffY > 0.012 &&
    state.prevAnkleDiffY <= 0.012 &&
    (state.leftStepTimes.length === 0 ||
      now - state.leftStepTimes.at(-1) > THRESHOLDS.stepMinIntervalMs)
  ) {
    state.leftStepTimes.push(now);
    if (state.leftStepTimes.length > 20) state.leftStepTimes.shift();
  }
  if (
    ankleDiffY < -0.012 &&
    state.prevAnkleDiffY >= -0.012 &&
    (state.rightStepTimes.length === 0 ||
      now - state.rightStepTimes.at(-1) > THRESHOLDS.stepMinIntervalMs)
  ) {
    state.rightStepTimes.push(now);
    if (state.rightStepTimes.length > 20) state.rightStepTimes.shift();
  }
  state.prevAnkleDiffY = ankleDiffY;

  const midShoulderX = (worldLm[11].x + worldLm[12].x) / 2;
  const midShoulderY = (worldLm[11].y + worldLm[12].y) / 2;
  const midShoulderZ = (worldLm[11].z + worldLm[12].z) / 2;
  const rawTrunkDeg =
    Math.atan2(Math.hypot(midShoulderX, midShoulderZ), Math.abs(midShoulderY)) *
    (180 / Math.PI);

  if (state.trunkBaselineDeg === null) {
    state.trunkBaselineDeg = rawTrunkDeg;
  } else if (state.tugState === "IDLE") {
    state.trunkBaselineDeg = 0.92 * state.trunkBaselineDeg + 0.08 * rawTrunkDeg;
  }
  const trunkDeg = Math.abs(rawTrunkDeg - state.trunkBaselineDeg);

  const romL =
    state.leftRomArr.length > 8
      ? Math.max(...state.leftRomArr) - Math.min(...state.leftRomArr)
      : 0;
  const romR =
    state.rightRomArr.length > 8
      ? Math.max(...state.rightRomArr) - Math.min(...state.rightRomArr)
      : 0;

  const tL = meanStep(state.leftStepTimes);
  const tR = meanStep(state.rightStepTimes);
  const visTimeSi =
    tL > 0 && tR > 0
      ? Math.min(45, (Math.abs(tL - tR) / (0.5 * (tL + tR))) * 100)
      : 0;

  const maxRom = Math.max(romL, romR);
  const visRomSi = maxRom > 14 ? (Math.abs(romL - romR) / maxRom) * 48 : 0;
  const imuFresh = now - (state.latestImu?.updatedAtMs || 0) < 3000;
  const phoneImuSi = imuFresh ? state.latestImu?.imuSiPct || 0 : 0;

  const timeComponent = phoneImuSi > 0 ? phoneImuSi : visTimeSi;
  const si = timeComponent > 0 ? Math.max(timeComponent * 0.6 + visRomSi * 0.4, visRomSi) : visRomSi;

  state.lastMetrics = { romL, romR, si, trunkDeg };

  if (state.totalFrames % 3 === 0) {
    setText("a_kneeAngle", `${rawR.toFixed(1)}° / ${filtR.toFixed(1)}°`);
    setText("a_rom", `${romL.toFixed(1)}° / ${romR.toFixed(1)}°`);
    setText("a_si", `${si.toFixed(1)}% / ${trunkDeg.toFixed(1)}°`);
  }

  if (state.totalFrames % 10 === 0 && maxRom > 8) {
    const cb = evaluateClinicalNorms({
      ageGroup: $("ageGroupSelect")?.value || "70_79",
      romL,
      romR,
      si,
      trunkDeg
    });
    renderClinicalBaseline(cb);
  }

  runStandingGaitMachine(filtL, filtR, romL, romR, si, trunkDeg, now);
  updateCharts(filtL, filtR, romL, romR, si, trunkDeg, state.tugFinalSec);
  recordPoseFrame({ now, rawL, rawR, filtL, filtR, romL, romR, si, trunkDeg, worldLm });
}

function runStandingGaitMachine(filtL, filtR, romL, romR, si, trunkDeg, now) {
  state.calibFrames = (state.calibFrames || 0) + 1;
  const totalSteps = state.leftStepTimes.length + state.rightStepTimes.length;
  const isWalkingOrStepping = Math.abs(filtL - filtR) > 9 || romL > 18 || romR > 18;

  if (state.tugState === "IDLE") {
    if (state.calibFrames === 2) {
      speakGuidance("已識別全身，請保持站立一秒完成校準");
    }
    if (state.calibFrames < 15) {
      setText("a_tugState", `站立仰角自動校準中 (${state.calibFrames}/15)…`);
    } else {
      if (state.calibFrames === 15) {
        clearRollingBuffers();
        speakGuidance("校準完成，請自然走動或原地踏步五秒鐘");
        return;
      }
      setText("a_tugState", "已校準 · 請自然走動或踏步");
      if (isWalkingOrStepping) {
        state.tugState = "WALKING";
        state.tugStartMs = now;
        state.tugFinalSec = 0;
        state.returnStableFrames = 0;
      }
    }
    return;
  }

  if (state.tugState === "WALKING") {
    const elapsedSec = (now - state.tugStartMs) / 1000;
    state.tugFinalSec = elapsedSec;
    setText("a_tugState", `步態採集中 · ${elapsedSec.toFixed(1)}秒 (${totalSteps}步)`);

    if (!isWalkingOrStepping && elapsedSec > 2.5) {
      state.returnStableFrames++;
    } else {
      state.returnStableFrames = 0;
    }

    if ((elapsedSec >= 5.0 && totalSteps >= 4) || state.returnStableFrames >= 12) {
      state.tugState = "COMPLETED";
      setHtml(
        "a_tugState",
        `<span class="pass">評估完成 · ${elapsedSec.toFixed(2)}秒 (${totalSteps}步)</span>`
      );
      triggerLlmGaitAnalysis({ elapsedSec, totalSteps, romL, romR, si, trunkDeg });
    }
  }
}

function collectMae(filtR) {
  if (!state.maeCollecting) return;
  const input = $("trueAngleInput");
  const trueAngle = parseFloat(input?.value) || 0;
  state.maeSamples.push(Math.abs(filtR - trueAngle));
  setText("m_mae", `採集中 ${state.maeSamples.length}/100…`);

  if (state.maeSamples.length >= 100) {
    state.maeCollecting = false;
    const mae = state.maeSamples.reduce((a, b) => a + b, 0) / state.maeSamples.length;
    const ok = mae <= THRESHOLDS.maeMax;
    setHtml("m_mae", `<span class="${ok ? "pass" : "fail"}">${mae.toFixed(2)}° · ${ok ? "達標" : "偏高"}</span>`);
  }
}

function collectJitter(rawR, filtR) {
  if (!state.jitterCollecting) return;
  state.jitterRawSamples.push(rawR);
  state.jitterFilteredSamples.push(filtR);
}

export function startMaeCollection() {
  state.maeSamples = [];
  state.maeCollecting = true;
  setText("m_mae", "採集中 0/100…");
}

export function resetDropStats() {
  state.totalFrames = 0;
  state.droppedFrames = 0;
  setText("m_dropRate", "0.0% (0/0)");
}

export function startJitterTest() {
  state.jitterRawSamples = [];
  state.jitterFilteredSamples = [];
  state.jitterCollecting = true;
  setText("a_jitter", "採集中 · 請保持站立靜止 5 秒…");

  const btn = $("btnJitter");
  if (btn) btn.disabled = true;

  setTimeout(() => {
    state.jitterCollecting = false;
    if (btn) btn.disabled = false;

    if (state.jitterFilteredSamples.length < 10) {
      setHtml("a_jitter", '<span class="warn-text">有效樣本不足（請確保全身入畫）</span>');
      return;
    }

    const rawSd = calcStdDev(state.jitterRawSamples);
    const filtSd = calcStdDev(state.jitterFilteredSamples);
    const ok = filtSd < THRESHOLDS.jitterSdMax;

    setHtml("a_jitter", `<span class="${ok ? "pass" : "fail"}">${filtSd.toFixed(2)}°</span> · 原始 ${rawSd.toFixed(2)}°`);
  }, 5000);
}

export function resetTug() {
  state.tugState = "IDLE";
  state.calibFrames = 0;
  state.tugStartMs = 0;
  state.tugFinalSec = 0;
  state.trunkBaselineDeg = null;
  clearRollingBuffers();
  setText("a_tugState", "已重置 · 正在重新校準站姿基線");
}

export function calcTugError() {
  const effectiveSec = resolveTugElapsedSec();
  const input = $("manualTugInput");
  const manual = parseFloat(input?.value) || 0;
  const err = Math.abs(effectiveSec - manual);
  const ok = err <= THRESHOLDS.tugErrMax;

  setHtml("a_tugErr", `<span class="${ok ? "pass" : "fail"}">${err.toFixed(2)} 秒 · ${ok ? "達標" : "超差"}</span>`);
}