import { state } from "./state.js";
import { THRESHOLDS } from "./config.js";

let waveChart = null;
let radarChart = null;

const waveLabels = [];
const waveHistoryL = [];
const waveHistoryR = [];

const C = {
  primary: "#0284C7",
  primaryDeep: "#0C4A6E",
  primarySoft: "#EFF7FD",
  accent: "#F97316",
  border: "#DCE8F5",
  danger: "#EF4444",
  textSoft: "#334155",
  textMuted: "#64748B",
  bg: "#FFFFFF"
};

export function initCharts() {
  waveChart = echarts.init(document.getElementById("waveChart"));
  radarChart = echarts.init(document.getElementById("radarChart"));

  waveChart.setOption({
    animation: false,
    backgroundColor: C.bg,
    title: {
      text: "雙膝關節屈伸角度動態波形 (°)",
      textStyle: { color: C.primaryDeep, fontSize: 13, fontWeight: "800" },
      left: 12,
      top: 10
    },
    tooltip: { trigger: "axis" },
    legend: {
      data: ["左膝(藍)", "右膝(橙)"],
      textStyle: { color: C.textSoft, fontSize: 11, fontWeight: "600" },
      right: 12,
      top: 10
    },
    grid: { left: 38, right: 16, top: 42, bottom: 22 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: waveLabels,
      axisLine: { lineStyle: { color: C.border, width: 1 } },
      axisTick: { show: false },
      axisLabel: { show: false }
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 110,
      axisLabel: { color: C.textMuted, fontSize: 10 },
      splitLine: { lineStyle: { color: C.primarySoft, type: "dashed" } }
    },
    series: [
      {
        name: "左膝(藍)",
        type: "line",
        data: waveHistoryL,
        showSymbol: false,
        smooth: true,
        lineStyle: { color: C.primary, width: 2.5 },
        itemStyle: { color: C.primary },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(2, 132, 199, 0.18)" },
            { offset: 1, color: "rgba(2, 132, 199, 0.00)" }
          ])
        }
      },
      {
        name: "右膝(橙)",
        type: "line",
        data: waveHistoryR,
        showSymbol: false,
        smooth: true,
        lineStyle: { color: C.accent, width: 2.2, type: "dashed" },
        itemStyle: { color: C.accent },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(249, 115, 22, 0.14)" },
            { offset: 1, color: "rgba(249, 115, 22, 0.00)" }
          ])
        }
      }
    ]
  });

  radarChart.setOption({
    animation: false,
    backgroundColor: C.bg,
    title: {
      text: "五維步態安全雷達圖",
      textStyle: { color: C.primaryDeep, fontSize: 13, fontWeight: "800" },
      left: "center",
      top: 8
    },
    radar: {
      radius: "50%",
      center: ["50%", "58%"],
      nameGap: 6,
      indicator: [
        { name: "步態節奏", max: 100 },
        { name: "左膝活動", max: 100 },
        { name: "右膝活動", max: 100 },
        { name: "步伐對稱", max: 100 },
        { name: "軀幹穩定", max: 100 }
      ],
      axisName: { color: C.textSoft, fontSize: 11, fontWeight: "700" },
      splitArea: { areaStyle: { color: ["#FFFFFF", C.primarySoft] } },
      splitLine: { lineStyle: { color: C.border, width: 1 } },
      axisLine: { lineStyle: { color: C.border, width: 1 } }
    },
    series: [
      {
        type: "radar",
        symbolSize: 6,
        data: [
          {
            value: [90, 88, 88, 92, 92],
            name: "步態安全評分",
            areaStyle: { color: "rgba(2, 132, 199, 0.16)" },
            lineStyle: { color: C.primary, width: 2.2 },
            itemStyle: { color: C.accent, borderColor: "#FFFFFF", borderWidth: 1.5 }
          }
        ]
      }
    ]
  });

  window.addEventListener("resize", () => {
    waveChart && waveChart.resize();
    radarChart && radarChart.resize();
  });
}

export function updateCharts(degL, degR, romL, romR, si, trunkDeg, tugSec) {
  if (!waveChart || !radarChart) return;

  state.chartTick++;
  if (state.chartTick % THRESHOLDS.waveEvery !== 0) return;

  waveLabels.push("");
  waveHistoryL.push(Number(degL.toFixed(1)));
  waveHistoryR.push(Number(degR.toFixed(1)));

  if (waveLabels.length > THRESHOLDS.waveWindow) {
    waveLabels.shift();
    waveHistoryL.shift();
    waveHistoryR.shift();
  }

  waveChart.setOption({
    xAxis: { data: waveLabels },
    series: [{ data: waveHistoryL }, { data: waveHistoryR }]
  });

  if (state.chartTick % THRESHOLDS.radarEvery !== 0) return;

  const rhythmScore = tugSec > 0
    ? Math.max(20, Math.min(100, Math.round(100 - Math.max(0, tugSec - 8) * 6)))
    : 90;
  const lRomScore = Math.min(100, Math.max(45, Math.round((romL / 28) * 90))) || 85;
  const rRomScore = Math.min(100, Math.max(45, Math.round((romR / 28) * 90))) || 85;
  const symScore = Math.max(15, Math.min(100, Math.round(100 - si * 2.6)));
  const trunkScore = Math.max(15, Math.min(100, Math.round(100 - trunkDeg * 5.0)));

  const isHighRisk = si > THRESHOLDS.siHighRisk || trunkDeg > 9.5;

  radarChart.setOption({
    series: [
      {
        data: [
          {
            value: [rhythmScore, lRomScore, rRomScore, symScore, trunkScore],
            areaStyle: {
              color: isHighRisk ? "rgba(239, 68, 68, 0.22)" : "rgba(2, 132, 199, 0.16)"
            },
            lineStyle: {
              color: isHighRisk ? C.danger : C.primary,
              width: 2.2
            },
            itemStyle: {
              color: isHighRisk ? C.danger : C.accent,
              borderColor: "#FFFFFF",
              borderWidth: 1.5
            }
          }
        ]
      }
    ]
  });
}