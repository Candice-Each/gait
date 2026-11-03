import { $, setText } from "./dom.js";
import { state } from "./state.js";

const recState = {
  active: false,
  mode: "both",
  startPerfMs: 0,
  startWallIso: "",
  mediaRecorder: null,
  videoChunks: [],
  poseFrames: [],
  imuPackets: [],
  imuRawSamples: []
};

export function toggleRecording() {
  if (recState.active) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  const modeEl = $("recModeSelect");
  const mode = modeEl ? modeEl.value : "both";
  recState.active = true;
  recState.mode = mode;
  recState.startPerfMs = performance.now();
  recState.startWallIso = new Date().toISOString();
  recState.videoChunks = [];
  recState.poseFrames = [];
  recState.imuPackets = [];
  recState.imuRawSamples = [];

  if (mode === "both" || mode === "pose_only") {
    const canvas = $("canvas");
    if (canvas && typeof canvas.captureStream === "function") {
      const stream = canvas.captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      recState.mediaRecorder = new MediaRecorder(stream, { mimeType });
      recState.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recState.videoChunks.push(e.data);
      };
      recState.mediaRecorder.onstop = exportRecordedVideo;
      recState.mediaRecorder.start(200);
    }
  }

  const btn = $("btnToggleRec");
  if (btn) {
    btn.textContent = "■ 停止錄製";
    btn.classList.add("btn-recording");
  }
  if (modeEl) modeEl.disabled = true;
  if ($("btnExportCsv")) $("btnExportCsv").disabled = true;
  if ($("btnExportSyncJson")) $("btnExportSyncJson").disabled = true;
  updateRecStatusUi();
}

function stopRecording() {
  recState.active = false;

  if (recState.mediaRecorder && recState.mediaRecorder.state !== "inactive") {
    recState.mediaRecorder.stop();
  }

  const btn = $("btnToggleRec");
  if (btn) {
    btn.textContent = "● 開始錄製數據";
    btn.classList.remove("btn-recording");
  }
  if ($("recModeSelect")) $("recModeSelect").disabled = false;

  const hasData = recState.poseFrames.length > 0 || recState.imuPackets.length > 0;
  if ($("btnExportCsv")) $("btnExportCsv").disabled = !hasData;
  if ($("btnExportSyncJson")) $("btnExportSyncJson").disabled = !hasData;
  updateRecStatusUi(true);
}

export function recordPoseFrame(frame) {
  if (!recState.active || recState.mode === "imu_only") return;

  const relTimeMs = Number((frame.now - recState.startPerfMs).toFixed(1));
  const lowerIds = [23, 24, 25, 26, 27, 28];
  const minVis = Math.min(...lowerIds.map((i) => frame.worldLm[i].visibility || 0));

  recState.poseFrames.push({
    frameIdx: recState.poseFrames.length + 1,
    relTimeMs,
    tugState: state.tugState,
    tugTotalSec: Number(state.tugFinalSec.toFixed(2)),
    rawL_deg: Number(frame.rawL.toFixed(2)),
    rawR_deg: Number(frame.rawR.toFixed(2)),
    filtL_deg: Number(frame.filtL.toFixed(2)),
    filtR_deg: Number(frame.filtR.toFixed(2)),
    romL_deg: Number(frame.romL.toFixed(2)),
    romR_deg: Number(frame.romR.toFixed(2)),
    si_pct: Number(frame.si.toFixed(2)),
    trunk_deg: Number(frame.trunkDeg.toFixed(2)),
    minVis: Number(minVis.toFixed(3)),
    imuSeq: state.latestImu.seq,
    imuCadenceSpm: state.latestImu.cadenceSpm,
    imuSiPct: state.latestImu.imuSiPct,
    imuTremorRms: state.latestImu.tremorRms
  });

  if (recState.poseFrames.length % 10 === 0) updateRecStatusUi();
}

export function recordImuPacket(packet, arrivalPerfMs, intervalMs) {
  if (!recState.active || recState.mode === "pose_only") return;

  const relTimeMs = Number((arrivalPerfMs - recState.startPerfMs).toFixed(1));

  recState.imuPackets.push({
    seq: packet.seq || recState.imuPackets.length + 1,
    relTimeMs,
    packetIntervalMs: Number((intervalMs || 250).toFixed(1)),
    cadenceSpm: packet.cadenceSpm || 0,
    imuSiPct: packet.imuSiPct || 0,
    gyroYawDegS: packet.gyroYawDegS || 0,
    tremorRms: packet.tremorRms || 0,
    sensorMode: packet.sensorMode || "Unknown",
    sampleCount: Array.isArray(packet.samples) ? packet.samples.length : 0
  });

  if (Array.isArray(packet.samples)) {
    for (const s of packet.samples) {
      recState.imuRawSamples.push({
        seq: packet.seq || 0,
        pcRelTimeMs: relTimeMs,
        phoneTimeMs: s.tMs,
        ax: s.ax,
        ay: s.ay,
        az: s.az,
        mag: s.mag,
        gx: s.gx ?? 0,
        gy: s.gy ?? 0,
        gz: s.gz ?? 0,
        isPeak: s.isPeak
      });
    }
  }

  updateRecStatusUi();
}

function updateRecStatusUi(stopped = false) {
  const durSec = recState.startPerfMs
    ? ((performance.now() - recState.startPerfMs) / 1000).toFixed(1)
    : "0.0";
  const prefix = stopped ? "已保存" : "錄製中";
  setText(
    "s_recStatus",
    `${prefix} · ${durSec}秒 (姿態:${recState.poseFrames.length}幀 | IMU:${recState.imuPackets.length}包/${recState.imuRawSamples.length}點)`
  );
}

function exportRecordedVideo() {
  if (recState.videoChunks.length === 0) return;
  const blob = new Blob(recState.videoChunks, { type: "video/webm" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gait_video_${recState.mode}_${Date.now()}.webm`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function exportRecordedCsv() {
  const ts = Date.now();
  if (recState.poseFrames.length > 0) {
    downloadCsvFile(recState.poseFrames, `gait_pose_synced_${ts}.csv`);
  }
  if (recState.imuRawSamples.length > 0) {
    downloadCsvFile(recState.imuRawSamples, `gait_imu_50hz_${ts}.csv`);
  } else if (recState.imuPackets.length > 0) {
    downloadCsvFile(recState.imuPackets, `gait_imu_4hz_${ts}.csv`);
  }
}

function downloadCsvFile(rows, filename) {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((k) => JSON.stringify(r[k] ?? "")).join(","))
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

export function exportRecordedJson() {
  const payload = {
    meta: {
      recordedAt: recState.startWallIso,
      mode: recState.mode,
      modelVariant: $("modelSelect")?.value || "lite",
      totalPoseFrames: recState.poseFrames.length,
      totalImuPackets: recState.imuPackets.length,
      totalImuRawSamples: recState.imuRawSamples.length
    },
    poseFrames: recState.poseFrames,
    imuPackets: recState.imuPackets,
    imuRawSamples: recState.imuRawSamples
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gait_multimodal_dataset_${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}