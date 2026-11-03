export const state = {
  visionResolver: null,
  poseLandmarker: null,
  firstFrameRecorded: false,
  lastVideoTime: -1,

  totalFrames: 0,
  droppedFrames: 0,
  fpsFrameCount: 0,
  lastFpsTime: performance.now(),
  currentFps: 0,

  maeCollecting: false,
  maeSamples: [],

  jitterCollecting: false,
  jitterRawSamples: [],
  jitterFilteredSamples: [],

  tugState: "IDLE",
  tugStartMs: 0,
  phaseStartMs: 0,
  tugFinalSec: 0,
  subPhases: { s2sSec: 0, walkSec: 0, turnSec: 0, st2sSec: 0 },
  sitBaselineY: null,
  initialShoulderYaw: null,

  calibFrames: 0,
  returnStableFrames: 0,
  trunkBaselineDeg: null,

  leftRomArr: [],
  rightRomArr: [],
  leftStepTimes: [],
  rightStepTimes: [],
  prevAnkleDiffY: 0,
  prevAnkleDistL: 0,
  prevAnkleDistR: 0,
  prevVelL: 0,
  prevVelR: 0,

  lastFiltL: 0,
  lastFiltR: 0,
  lastMetrics: null,

  sessionRoom: (() => {
    try {
      const p = new URLSearchParams(location.search).get("room");
      return p ? p.trim() : "";
    } catch {
      return "";
    }
  })(),
  imuArrivalTimes: [],
  mockTimer: null,
  latestImu: {
    seq: 0,
    cadenceSpm: 0,
    imuSiPct: 0,
    tremorRms: 0,
    gyroYawDegS: 0,
    sensorMode: "Waiting",
    updatedAtMs: 0
  },
  fusedCadenceSpm: 0,

  // ---- 圖表 ----
  chartTick: 0
};