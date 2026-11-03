import { $, setText } from "./dom.js";
import { state } from "./state.js";

export const NORM_DB_VERSION = "Hollman 2011 · OARSI Knee OA · 香港衛生署防跌框架 (v2026.01)";

export const CLINICAL_NORMS = {
  "60_69": {
    label: "60–69 歲社區長者常模",
    romMean: 36.0, romSd: 5.5, romCutOff: 24.0,
    siMean: 5.5,   siSd: 2.8,  siCutOff: 13.0,
    swayMean: 3.2, swaySd: 1.4, swayCutOff: 8.0,
    cadenceMean: 106, cadenceCutOff: 90
  },
  "70_79": {
    label: "70–79 歲社區長者常模",
    romMean: 33.0, romSd: 6.0, romCutOff: 21.0,
    siMean: 6.8,   siSd: 3.2,  siCutOff: 15.0,
    swayMean: 4.0, swaySd: 1.8, swayCutOff: 9.5,
    cadenceMean: 100, cadenceCutOff: 84
  },
  "80_plus": {
    label: "80 歲及以上高齡常模",
    romMean: 28.5, romSd: 6.2, romCutOff: 18.0,
    siMean: 8.2,   siSd: 3.6,  siCutOff: 16.5,
    swayMean: 5.0, swaySd: 2.0, swayCutOff: 10.5,
    cadenceMean: 92,  cadenceCutOff: 76
  },
  "adult": {
    label: "18–59 歲健康成年常模",
    romMean: 40.0, romSd: 5.0, romCutOff: 28.0,
    siMean: 4.2,   siSd: 2.2,  siCutOff: 11.0,
    swayMean: 2.5, swaySd: 1.1, swayCutOff: 7.0,
    cadenceMean: 112, cadenceCutOff: 96
  }
};

let lastSpokenText = "";
let lastSpokenMs = 0;

export function speakGuidance(text, force = false) {
  const voiceToggle = $("voiceEnableCheck");
  if (voiceToggle && !voiceToggle.checked) return;
  if (!("speechSynthesis" in window)) return;

  const now = performance.now();
  if (!force && text === lastSpokenText && now - lastSpokenMs < 5500) return;

  lastSpokenText = text;
  lastSpokenMs = now;

  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = $("voiceLangSelect")?.value || "zh-CN";
  u.rate = 0.92;
  window.speechSynthesis.speak(u);
}

/** 產生 8 字元 base32 房間號（去除易混淆字元），約 40 bit 熵 */
function generateRoomId() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += alphabet[b % alphabet.length];
  return out;
}

/** 把文字渲染為 QR Code 到 canvas（依賴全域 qrcode-generator） */
function renderQrToCanvas(text, canvas) {
  if (!canvas) return;
  if (typeof window.qrcode !== "function") {
    console.warn("[QR] qrcode-generator 未載入，略過繪製");
    return;
  }
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const cells = qr.getModuleCount();
  const size = canvas.width;
  const cell = Math.max(1, Math.floor(size / (cells + 2)));
  const offset = Math.floor((size - cell * cells) / 2);

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#0C4A6E";
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
      }
    }
  }
}

export async function initWirelessQrCode() {
  const urlRoom = (() => {
    try { return new URLSearchParams(location.search).get("room"); }
    catch { return null; }
  })();

  // GitHub Pages略過
  let cachedInfo;
  async function fetchNetworkInfo() {
    if (cachedInfo !== undefined) return cachedInfo;
    if (location.protocol === "file:" || location.hostname.endsWith("github.io")) {
      cachedInfo = null;
      return null;
    }
    try {
      const res = await fetch("/api/network-info", { cache: "no-store" });
      const ct = res.headers.get("content-type") || "";
      cachedInfo = res.ok && ct.includes("application/json") ? await res.json() : null;
    } catch {
      cachedInfo = null;
    }
    return cachedInfo;
  }

  async function buildTargetUrl(room) {
    const info = await fetchNetworkInfo();
    if (info && info.httpsUrl) {
      // 保留伺服器回報的真實埠號，不硬編 8443
      const u = new URL(info.httpsUrl);
      u.pathname = "/m";
      u.search = `?room=${encodeURIComponent(room)}`;
      return u.toString();
    }
    // GitHub Pages 或本地降級：以當前 origin 拼同目錄 imu.html
    const dir = location.pathname.replace(/\/[^/]*$/, "/");
    return `${location.origin}${dir}imu.html?room=${encodeURIComponent(room)}`;
  }

  async function applyRoom(room) {
    state.sessionRoom = room;
    setText("roomCodeText", room);

    const targetUrl = await buildTargetUrl(room);
    const linkEl = $("wirelessUrlLink");
    if (linkEl) {
      linkEl.href = targetUrl;
      linkEl.textContent = targetUrl;
    }
    renderQrToCanvas(targetUrl, $("wirelessQrCanvas"));
  }

  const initialRoom = (urlRoom && urlRoom.trim()) || generateRoomId();
  await applyRoom(initialRoom);

  $("btnNewRoom")?.addEventListener("click", () => {
    applyRoom(generateRoomId());
  });
}

export function evaluateClinicalNorms(m) {
  const norm = CLINICAL_NORMS[m.ageGroup] || CLINICAL_NORMS["70_79"];
  const minRom = Math.min(m.romL, m.romR);
  const romDiff = Math.abs(m.romL - m.romR);
  const weakerSide = m.romL < m.romR ? "左膝" : "右膝";

  const zRom = Number(((minRom - norm.romMean) / norm.romSd).toFixed(2));
  const zSi = Number(((m.si - norm.siMean) / norm.siSd).toFixed(2));
  const zSway = Number(((m.trunkDeg - norm.swayMean) / norm.swaySd).toFixed(2));

  let riskPoints = 0;
  const items = [];

  if (m.si > norm.siCutOff) {
    riskPoints += 2;
    items.push(`<span class="fail">● [步態對稱性異常] SI=${m.si.toFixed(1)}% (同齡閾值≤${norm.siCutOff}%, Z=+${zSi}SD)：</span>提示偏載或護痛性跛行節律。`);
  } else {
    items.push(`<span class="pass">● [步態對稱性正常] SI=${m.si.toFixed(1)}% (Z=${zSi >= 0 ? "+" : ""}${zSi}SD)：</span>符合${norm.label}對稱範圍。`);
  }

  if (minRom < norm.romCutOff || romDiff > 12) {
    riskPoints += 2;
    items.push(`<span class="fail">● [OARSI 膝關節活動受限] 左${m.romL.toFixed(1)}°/右${m.romR.toFixed(1)}° (Z=${zRom}SD)：</span>${weakerSide}擺動相屈曲不足或雙側失衡，存在拖步風險。`);
  } else {
    items.push(`<span class="pass">● [OARSI 膝關節活動良好] 左${m.romL.toFixed(1)}°/右${m.romR.toFixed(1)}° (Z=${zRom >= 0 ? "+" : ""}${zRom}SD)：</span>擺動相足離地間隙充足。`);
  }

  if (m.trunkDeg > norm.swayCutOff) {
    riskPoints += 1;
    items.push(`<span class="warn-text">● [軀幹動態穩定減弱] 搖擺 ${m.trunkDeg.toFixed(1)}° (Z=+${zSway}SD)：</span>超過同齡安全線 (${norm.swayCutOff}°)，核心平衡控制下降。`);
  } else {
    items.push(`<span class="pass">● [軀幹核心控制穩定] 搖擺 ${m.trunkDeg.toFixed(1)}° (Z=${zSway >= 0 ? "+" : ""}${zSway}SD)：</span>骨盆與脊柱中軸穩定。`);
  }

  const riskLevel =
    riskPoints >= 2 ? "高風險預警（需防跌倒與康復干預）" :
    riskPoints === 1 ? "中度關注（輕度生物力學偏離）" :
    "低風險（符合同齡健康步態常模）";

  return {
    normLabel: norm.label,
    riskPoints,
    riskLevel,
    weakerSide,
    romDiff: Number(romDiff.toFixed(1)),
    zScores: { zRom, zSi, zSway },
    html: items.join("<br>")
  };
}

export function renderClinicalBaseline(cb) {
  const el = $("clinicalNormBox");
  if (!el) return;
  const cls = cb.riskPoints >= 2 ? "fail" : cb.riskPoints === 1 ? "warn-text" : "pass";
  el.innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
      <b>基線：${cb.normLabel}</b>
      <span class="${cls}">${cb.riskLevel}</span>
    </div>
    ${cb.html}
  `;
}

/**
 * 優先 /api/llm-analyze（本機 Ollama 或 server.js 內建規則引擎），失敗走前端內建規則保底
 */
export async function triggerLlmGaitAnalysis(metricsSnapshot) {
  const badgeEl = $("adviceBadge");
  const boxEl = $("chineseAdviceBox");
  const ollamaModel = $("ollamaModelInput")?.value?.trim() || "qwen2.5:1.5b";

  if (badgeEl) {
    badgeEl.textContent = "本地 LLM 正在分析多模態步態數據…";
    badgeEl.className = "card-sub warn-text";
  }

  const telemetry = {
    elapsedSec: Number((metricsSnapshot.elapsedSec || state.tugFinalSec || 5).toFixed(1)),
    totalSteps: metricsSnapshot.totalSteps || state.leftStepTimes.length + state.rightStepTimes.length,
    romL: Number((metricsSnapshot.romL || 0).toFixed(1)),
    romR: Number((metricsSnapshot.romR || 0).toFixed(1)),
    si: Number((metricsSnapshot.si || 0).toFixed(1)),
    trunkDeg: Number((metricsSnapshot.trunkDeg || 0).toFixed(1)),
    cadenceSpm: state.latestImu?.cadenceSpm || 96,
    tremorRms: state.latestImu?.tremorRms || 0.08,
    gyroYawDegS: state.latestImu?.gyroYawDegS || 12.0
  };

  try {
    const resp = await fetch("/api/llm-analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telemetry, ollamaModel })
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || "本地推理異常");

    const r = data.result;
    const isHigh = String(r.riskLevel).includes("高");
    if (badgeEl) {
      badgeEl.textContent = `${r.riskLevel} · ${r.source}`;
      badgeEl.className = `card-sub ${isHigh ? "fail" : "pass"}`;
    }
    if (boxEl) {
      boxEl.innerHTML = `
        <div style="font-size:15px; font-weight:800; color:${isHigh ? "var(--danger)" : "var(--primary-deep)"}; margin-bottom:6px;">
          【核心結論】${r.summary}
        </div>
        <div style="margin-bottom:6px;"><b>多模態生物力學解析：</b>${r.biomechanicalAnalysis}</div>
        <div style="margin-bottom:6px;"><b>居家康復與防跌倒建議：</b>${r.rehabAdvice}</div>
        <div style="font-size:12px; color:var(--text-muted);">適老化語音播報：「${r.voiceScript}」</div>
      `;
    }
    if (r.voiceScript) speakGuidance(r.voiceScript, true);
  } catch (err) {
    if (boxEl) {
      boxEl.innerHTML = `<span class="fail">本地評估提示：${err.message}</span>`;
    }
  }
}