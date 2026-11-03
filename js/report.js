import { $, setHtml } from "./dom.js";
import { state } from "./state.js";
import { THRESHOLDS } from "./config.js";
import { NORM_DB_VERSION } from "./llm.js";

export function logGroupRow(groupName) {
  const romText = $("a_rom")?.textContent.split("/") || [];
  const siParts = $("a_si")?.textContent.split("/") || [];
  const siVal = parseFloat(siParts[0]) || 0;
  const trunkVal = parseFloat(siParts[1]) || 0;

  if (state.tugFinalSec === 0 && state.tugStartMs > 0) {
    state.tugFinalSec = (performance.now() - state.tugStartMs) / 1000;
    state.tugState = "COMPLETED";
    setHtml("a_tugState", `<span class="pass">已鎖定 · ${state.tugFinalSec.toFixed(2)} 秒</span>`);
  }

  const isRed =
    state.tugFinalSec >= THRESHOLDS.tugHighRiskSec ||
    siVal > THRESHOLDS.siHighRisk ||
    trunkVal > 9.5;

  const riskHtml = isRed
    ? '<span class="fail">紅燈預警（高風險）</span>'
    : '<span class="pass">綠燈正常（低風險）</span>';

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${groupName}</td>
    <td>${state.tugFinalSec.toFixed(2)} 秒</td>
    <td>${romText[0]?.trim() || "--"}</td>
    <td>${romText[1]?.trim() || "--"}</td>
    <td>${siVal.toFixed(1)}% / 搖擺 ${trunkVal.toFixed(1)}°</td>
    <td>${riskHtml}</td>
  `;
  $("algComparisonBody")?.appendChild(tr);
}

export function exportReport() {
  const report = {
    評估時間: new Date().toISOString(),
    常模數據庫版本: NORM_DB_VERSION,
    受試者年齡組: $("ageGroupSelect")?.value || "70_79",
    模型規格: $("modelSelect")?.value || "lite",
    骨骼顯示模式: $("avatarModeSelect")?.value || "stickman",
    實時幀率FPS: state.currentFps.toFixed(1),
    丟幀率: $("m_dropRate")?.textContent || "--",
    下肢關鍵點可見度: $("m_visAvg")?.textContent || "--",
    膝角MAE誤差: $("m_mae")?.textContent || "--",
    右膝角度: $("a_kneeAngle")?.textContent || "--",
    靜態抖動標準差: $("a_jitter")?.textContent || "--",
    雙膝活動度ROM: $("a_rom")?.textContent || "--",
    不對稱率與軀幹搖擺: $("a_si")?.textContent || "--",
    監測時長秒: state.tugFinalSec,
    計時誤差: $("a_tugErr")?.textContent || "--",
    數據分析: $("clinicalNormBox")?.innerText || "",
    建議: $("chineseAdviceBox")?.innerText || "",
    手機IMU推送狀態: $("s_imuInterval")?.textContent || "--",
    手機IMU步頻與不對稱率: $("s_imuJitter")?.textContent || "--",
    合規聲明: "本結果僅為初篩提示，不替代臨床醫生診斷。"
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json"
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `步態循證評估審計報告_${Date.now()}.json`;
  a.click();

  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}