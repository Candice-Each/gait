import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

import { state } from "./state.js";
import { THRESHOLDS, MODEL_URL, WASM_URL } from "./config.js";
import { setText, setHtml, $ } from "./dom.js";
import { processPose } from "./metrics.js";

let video = null;
let canvas = null;
let ctx = null;
let drawingUtils = null;
let rafId = null;

const CANVAS = {
  bg: "#F0F7FE",
  grid: "#E4EEF9",
  skeleton: "#0C4A6E",
  limbLeft: "#0284C7",
  limbRight: "#F97316"
};

export async function loadPoseModel(variant = "lite") {
  setText("m_load", `正在加載 ${variant.toUpperCase()}…`);
  const t0 = performance.now();

  try {
    if (!state.visionResolver) {
      state.visionResolver = await FilesetResolver.forVisionTasks(WASM_URL);
    }
    if (state.poseLandmarker) {
      state.poseLandmarker.close();
      state.poseLandmarker = null;
    }

    state.poseLandmarker = await PoseLandmarker.createFromOptions(state.visionResolver, {
      baseOptions: { modelAssetPath: MODEL_URL(variant), delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1
    });

    state.firstFrameRecorded = false;
    const ms = (performance.now() - t0).toFixed(0);
    setHtml("m_load", `<span class="pass">${variant.toUpperCase()} 就緒 · ${ms} ms</span>`);
  } catch (err) {
    setHtml("m_load", `<span class="fail">加載失敗: ${err.message}</span>`);
  }
}

export async function switchCameraStream(facingMode = "user") {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("請使用 https:// 或 localhost 訪問以啟用攝像頭");
  }
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode }
    });
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 }
    });
  }
  video.srcObject = stream;
}

export async function initCamera() {
  video = $("webcam");
  canvas = $("canvas");
  ctx = canvas.getContext("2d");
  drawingUtils = new DrawingUtils(ctx);

  await loadPoseModel("lite");
  await switchCameraStream($("cameraFacingSelect")?.value || "user");

  video.addEventListener("loadeddata", () => {
    if (rafId === null) predictLoop();
  });
}

function predictLoop() {
  const now = performance.now();

  if (state.poseLandmarker && video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;

    const t0 = performance.now();
    const result = state.poseLandmarker.detectForVideo(video, t0);
    const inferCost = performance.now() - t0;

    if (!state.firstFrameRecorded) {
      state.firstFrameRecorded = true;
      setText("m_firstFrame", `${inferCost.toFixed(1)} ms`);
    }

    state.fpsFrameCount++;
    if (now - state.lastFpsTime >= 1000) {
      state.currentFps = (state.fpsFrameCount * 1000) / (now - state.lastFpsTime);
      const fpsHtml =
        state.currentFps < 8.0
          ? `<span class="warn-text">${state.currentFps.toFixed(1)} FPS (偏低·已由IMU補償)</span>`
          : `${state.currentFps.toFixed(1)} FPS · ${inferCost.toFixed(1)} ms`;
      setHtml("m_fps", fpsHtml);
      state.fpsFrameCount = 0;
      state.lastFpsTime = now;
    }

    renderStage(result, now);
  }

  rafId = requestAnimationFrame(predictLoop);
}

function renderStage(result, now) {
  const showRaw = $("showRawVideo").checked;
  const w = canvas.width;
  const h = canvas.height;

  if (showRaw) {
    ctx.drawImage(video, 0, 0, w, h);
  } else {
    ctx.fillStyle = CANVAS.bg;
    ctx.fillRect(0, 0, w, h);
    drawPrivacyGrid(ctx, w, h);
  }

  if (!result.landmarks.length || !result.worldLandmarks.length) {
    drawStatusBanner(ctx, w, "未檢測到人物，請站立於攝像頭前 1.8~2.5 米處", "#64748B");
    return;
  }

  const normLm = result.landmarks[0];
  const worldLm = result.worldLandmarks[0];

  const lowerIds = [23, 24, 25, 26, 27, 28];
  const lowerInBounds = lowerIds.every(
    (i) => normLm[i].x >= 0.02 && normLm[i].x <= 0.98 && normLm[i].y >= 0.05 && normLm[i].y <= 0.98
  );
  const visList = lowerIds.map((i) => Math.min(normLm[i].visibility ?? 0, worldLm[i].visibility ?? 0));
  const minVis = Math.min(...visList);
  const avgVis = visList.reduce((a, b) => a + b, 0) / visList.length;

  setText("m_visAvg", `均值 ${avgVis.toFixed(2)} · 最低 ${minVis.toFixed(2)}`);

  const avatarMode = $("avatarModeSelect")?.value || "stickman";
  drawAvatarByMode(ctx, drawingUtils, normLm, w, h, avatarMode);

  state.totalFrames++;
  if (!lowerInBounds || avgVis < THRESHOLDS.visMin) {
    state.droppedFrames++;
    setText("a_kneeAngle", "等待雙腿入畫");
    setText("a_tugState", "請退後：需全身及雙腳入畫");
    drawStatusBanner(ctx, w, "⚠ 僅檢測到上半身，請向後退直至雙腿雙腳完整進入畫面", "#EA580C");
  } else {
    processPose(normLm, worldLm, now);
    drawStatusBanner(
      ctx,
      w,
      `✔ 全身追蹤正常 | 左膝(藍): ${(state.lastFiltL || 0).toFixed(0)}° · 右膝(橙): ${(state.lastFiltR || 0).toFixed(0)}°`,
      "#0284C7"
    );
  }

  const pct = state.totalFrames ? (state.droppedFrames / state.totalFrames) * 100 : 0;
  setText("m_dropRate", `${pct.toFixed(1)}% (${state.droppedFrames}/${state.totalFrames})`);
}

function drawAvatarByMode(context, dUtils, lm, w, h, mode) {
  if (mode === "raw") {
    dUtils.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: CANVAS.skeleton, lineWidth: 2.5 });
    dUtils.drawLandmarks(lm, { radius: 3.5, color: CANVAS.limbLeft, fillColor: "#FFFFFF" });
    return;
  }

  const pt = (idx) => ({ x: lm[idx].x * w, y: lm[idx].y * h, v: lm[idx].visibility ?? 0 });
  const mid = (p1, p2) => ({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });

  const nose = pt(0);
  const lSh = pt(11), rSh = pt(12);
  const lEl = pt(13), rEl = pt(14);
  const lWr = pt(15), rWr = pt(16);
  const lHip = pt(23), rHip = pt(24);
  const lKn = pt(25), rKn = pt(26);
  const lAnk = pt(27), rAnk = pt(28);
  const lToe = pt(31), rToe = pt(32);

  const neck = mid(lSh, rSh);
  const pelvis = mid(lHip, rHip);
  const shWidth = Math.hypot(lSh.x - rSh.x, lSh.y - rSh.y);
  const headRadius = Math.max(18, Math.min(42, shWidth * 0.38 || 26));

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  if (mode === "capsule") {
    context.fillStyle = "rgba(2, 132, 199, 0.15)";
    context.strokeStyle = CANVAS.skeleton;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(lSh.x, lSh.y);
    context.lineTo(rSh.x, rSh.y);
    context.lineTo(rHip.x, rHip.y);
    context.lineTo(lHip.x, lHip.y);
    context.closePath();
    context.fill();
    context.stroke();
  }

  drawLimb(context, neck, pelvis, CANVAS.skeleton, mode === "capsule" ? 10 : 6);
  drawLimb(context, lSh, rSh, CANVAS.skeleton, 5);
  drawLimb(context, lHip, rHip, CANVAS.skeleton, 5);

  const limbW = mode === "capsule" ? 11 : 6;
  drawLimb(context, lSh, lEl, CANVAS.limbLeft, limbW - 1);
  drawLimb(context, lEl, lWr, CANVAS.limbLeft, limbW - 2);
  drawLimb(context, lHip, lKn, CANVAS.limbLeft, limbW + 1);
  drawLimb(context, lKn, lAnk, CANVAS.limbLeft, limbW);
  drawLimb(context, lAnk, lToe, CANVAS.limbLeft, limbW - 1);

  drawLimb(context, rSh, rEl, CANVAS.limbRight, limbW - 1);
  drawLimb(context, rEl, rWr, CANVAS.limbRight, limbW - 2);
  drawLimb(context, rHip, rKn, CANVAS.limbRight, limbW + 1);
  drawLimb(context, rKn, rAnk, CANVAS.limbRight, limbW);
  drawLimb(context, rAnk, rToe, CANVAS.limbRight, limbW - 1);

  const headCenter = { x: nose.x, y: Math.min(nose.y, neck.y - headRadius * 0.9) };
  drawLimb(context, neck, headCenter, CANVAS.skeleton, 5);
  context.fillStyle = "#FFFFFF";
  context.strokeStyle = CANVAS.skeleton;
  context.lineWidth = 3.5;
  context.beginPath();
  context.arc(headCenter.x, headCenter.y, headRadius, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.fillStyle = CANVAS.limbLeft;
  context.beginPath();
  context.arc(nose.x, headCenter.y - 2, 3.5, 0, Math.PI * 2);
  context.fill();

  const joints = [
    { p: lSh, c: CANVAS.limbLeft }, { p: rSh, c: CANVAS.limbRight },
    { p: lHip, c: CANVAS.limbLeft }, { p: rHip, c: CANVAS.limbRight },
    { p: lKn, c: CANVAS.limbLeft }, { p: rKn, c: CANVAS.limbRight },
    { p: lAnk, c: CANVAS.limbLeft }, { p: rAnk, c: CANVAS.limbRight }
  ];
  for (const j of joints) {
    if (j.p.v < 0.35) continue;
    context.fillStyle = "#FFFFFF";
    context.strokeStyle = j.c;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(j.p.x, j.p.y, 5.5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  if (lKn.v > 0.5 && state.lastFiltL !== undefined) {
    drawAngleTag(context, lKn.x - 46, lKn.y, `左 ${state.lastFiltL.toFixed(0)}°`, CANVAS.limbLeft);
  }
  if (rKn.v > 0.5 && state.lastFiltR !== undefined) {
    drawAngleTag(context, rKn.x + 10, rKn.y, `右 ${state.lastFiltR.toFixed(0)}°`, CANVAS.limbRight);
  }

  context.restore();
}

function drawLimb(context, p1, p2, color, width) {
  if (p1.v < 0.3 || p2.v < 0.3) return;
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(p1.x, p1.y);
  context.lineTo(p2.x, p2.y);
  context.stroke();
}

function drawAngleTag(context, x, y, text, bg) {
  context.font = "700 11px system-ui, sans-serif";
  context.fillStyle = bg;
  context.beginPath();
  context.roundRect(x, y - 10, 42, 18, 5);
  context.fill();
  context.fillStyle = "#FFFFFF";
  context.fillText(text, x + 5, y + 3);
}

function drawStatusBanner(context, w, text, color) {
  context.save();
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.fillRect(0, 0, w, 28);
  context.fillStyle = color;
  context.font = "700 12px system-ui, sans-serif";
  context.fillText(text, 12, 18);
  context.restore();
}

function drawPrivacyGrid(context, w, h) {
  context.strokeStyle = CANVAS.grid;
  context.lineWidth = 1;
  for (let x = 0; x < w; x += 40) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, h); context.stroke();
  }
  for (let y = 0; y < h; y += 40) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(w, y); context.stroke();
  }
}