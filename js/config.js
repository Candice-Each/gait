export const THRESHOLDS = {
  visMin: 0.60,
  maeMax: 6.0,

  jitterSdMax: 1.2,
  tugErrMax: 0.5,
  tugHighRiskSec: 14,
  siHighRisk: 15,
  stepMinIntervalMs: 380,

  romWindow: 240,
  waveWindow: 80,
  waveEvery: 2,
  radarEvery: 8
};

const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

export const WASM_URL = `${CDN}/wasm`;

export const MODEL_URL = (variant) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`;