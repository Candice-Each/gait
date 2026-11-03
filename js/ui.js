import { $ } from "./dom.js";
import { state } from "./state.js";
import { loadPoseModel, switchCameraStream } from "./pose.js";
import {
  startMaeCollection,
  resetDropStats,
  startJitterTest,
  resetTug,
  calcTugError
} from "./metrics.js";
import { toggleMockImu } from "./imu.js";
import { logGroupRow, exportReport } from "./report.js";
import {
  toggleRecording,
  exportRecordedCsv,
  exportRecordedJson
} from "./recorder.js";
import { triggerLlmGaitAnalysis } from "./llm.js";

export function bindUI() {
  $("modelSelect")?.addEventListener("change", (e) => {
    loadPoseModel(e.target.value);
  });

  $("cameraFacingSelect")?.addEventListener("change", (e) => {
    switchCameraStream(e.target.value);
  });

  $("btnCalcMae")?.addEventListener("click", startMaeCollection);
  $("btnResetDrop")?.addEventListener("click", resetDropStats);

  $("btnJitter")?.addEventListener("click", startJitterTest);
  $("btnResetTug")?.addEventListener("click", resetTug);
  $("btnCalcTugErr")?.addEventListener("click", calcTugError);

  $("btnLogNormal")?.addEventListener("click", () =>
    logGroupRow("正常步態對照組")
  );
  $("btnLogDegenerated")?.addEventListener("click", () =>
    logGroupRow("異常/跛行模擬組")
  );

  $("btnMockImu")?.addEventListener("click", (e) =>
    toggleMockImu(e.currentTarget)
  );
  $("btnExportReport")?.addEventListener("click", exportReport);

  $("btnToggleRec")?.addEventListener("click", toggleRecording);
  $("btnExportCsv")?.addEventListener("click", exportRecordedCsv);
  $("btnExportSyncJson")?.addEventListener("click", exportRecordedJson);

  $("btnManualLlm")?.addEventListener("click", () => {
    const m = state.lastMetrics || { romL: 34, romR: 35, si: 6.2, trunkDeg: 3.1 };
    triggerLlmGaitAnalysis({
      elapsedSec: state.tugFinalSec || 5.0,
      totalSteps: (state.leftStepTimes?.length || 3) + (state.rightStepTimes?.length || 3),
      ...m
    });
  });
}