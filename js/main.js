/**
 * gait_test Workstation - 頂層主入口
 * 啟動順序：圖表 → 攝像頭（核心資產優先）→ UI 綁定（try/catch 隔離）→ 無線配對 → IMU 通道
 *
 * - state.sessionRoom 優先讀取 URL ?room=；若無，則由 initWirelessQrCode() 隨機生成並寫回 state
 * - connectImuSocket() 必須在 initWirelessQrCode() 完成後執行，確保訂閱到正確的房間號
 */
import { initCharts } from "./charts.js";
import { initCamera } from "./pose.js";
import { connectImuSocket } from "./imu.js";
import { bindUI } from "./ui.js";
import { initWirelessQrCode } from "./llm.js";

initCharts();

initCamera().catch((err) => {
  const el = document.getElementById("m_load");
  if (el) {
    el.innerHTML = `<span class="fail">攝像頭啟動失敗：${err.message}<br>請使用 https:// 或 localhost 訪問並允許攝像頭權限。</span>`;
  }
  console.error("[main] initCamera 失敗:", err);
});

try {
  bindUI();
} catch (err) {
  console.error("[main] bindUI 失敗（不影響攝像頭與 IMU）:", err);
}

initWirelessQrCode()
  .catch((err) => console.warn("[main] QR 初始化失敗:", err))
  .finally(() => connectImuSocket());