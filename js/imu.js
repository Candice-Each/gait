import { $, setText, setHtml } from "./dom.js";
import { state } from "./state.js";
import { calcStdDev } from "./math.js";
import { recordImuPacket } from "./recorder.js";

const WSS_BROKERS = [
  "wss://broker.hivemq.com:8884/mqtt",
  "wss://broker.emqx.io:8084/mqtt",
  "wss://test.mosquitto.org:8081/mqtt"
];

const TOPIC_PREFIX = "gait_workstation_hk_2026/room_";
const topicFor = (room) => `${TOPIC_PREFIX}${room}`;

let lastReceivedSeq = -1;
const mqttClients = [];
let currentTopic = "";
let desiredRoom = "8888";
let localWsOpen = false;

export function handleImuPacket(packetStr, channelTag = "跨網中繼") {
  const now = performance.now();
  let data;
  try {
    data = JSON.parse(packetStr);
  } catch {
    return;
  }

  if (data.seq && data.seq === lastReceivedSeq) return;
  if (data.seq) lastReceivedSeq = data.seq;

  state.imuArrivalTimes.push(now);
  if (state.imuArrivalTimes.length > 40) state.imuArrivalTimes.shift();

  let lastIntervalMs = 250;
  if (state.imuArrivalTimes.length >= 2) {
    const intervals = [];
    for (let i = 1; i < state.imuArrivalTimes.length; i++) {
      intervals.push(state.imuArrivalTimes[i] - state.imuArrivalTimes[i - 1]);
    }
    lastIntervalMs = intervals.at(-1);
    const avgDt = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const sdDt = calcStdDev(intervals);

    setHtml(
      "s_imuInterval",
      `<span class="pass">${avgDt.toFixed(1)} ms · 包 #${data.seq || state.imuArrivalTimes.length} (${channelTag})</span>`
    );
    setText(
      "s_imuJitter",
      `±${sdDt.toFixed(0)}ms | 步頻:${data.cadenceSpm || 0}步/分 | 觸地SI:${data.imuSiPct || 0}%`
    );
    const badge = $("imuConnBadge");
    if (badge) {
      badge.textContent = "手機 IMU 即時同步";
      badge.className = "card-sub pass";
    }
  }

  state.latestImu = {
    seq: data.seq || 0,
    cadenceSpm: data.cadenceSpm || 0,
    imuSiPct: data.imuSiPct || 0,
    tremorRms: data.tremorRms || 0,
    gyroYawDegS: data.gyroYawDegS || 0,
    sensorMode: `${data.sensorMode || "手機 IMU"} (${channelTag})`,
    updatedAtMs: now
  };

  recordImuPacket(data, now, lastIntervalMs);
}

export function connectImuSocket() {
  if (!location.hostname.endsWith("github.io") && location.protocol !== "file:") {
    try {
      const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${wsProto}//${location.host}`);
      ws.onopen = () => { localWsOpen = true; };
      ws.onclose = () => { localWsOpen = false; };
      ws.onerror = () => { localWsOpen = false; };
      ws.onmessage = (e) => handleImuPacket(e.data, "本地直連");
    } catch {}
  }

  if (window.mqtt) {
    WSS_BROKERS.forEach((url) => {
      try {
        const client = window.mqtt.connect(url, { connectTimeout: 4000 });
        client.on("connect", () => {
          mqttClients.push(client);
          client.subscribe(topicFor(state.sessionRoom || desiredRoom));
        });
        client.on("message", (_t, payload) => {
          if (localWsOpen) return;
          handleImuPacket(payload.toString(), "雲端中繼");
        });
      } catch {}
    });
  }
}

export function subscribeRoomTopic(roomId) {
  desiredRoom = (roomId || "8888").trim();
  const nextTopic = topicFor(desiredRoom);
  mqttClients.forEach((client) => {
    if (client.connected) {
      if (currentTopic && currentTopic !== nextTopic) client.unsubscribe(currentTopic);
      client.subscribe(nextTopic);
    }
  });
  currentTopic = nextTopic;
}

export function toggleMockImu(btn) {
  if (state.mockTimer) {
    clearInterval(state.mockTimer);
    state.mockTimer = null;
    if (btn) btn.textContent = "開啟本機 250ms 模擬 IMU 推送";
    return;
  }

  let seq = 10000;
  if (btn) btn.textContent = "停止本機 250ms 模擬推送";
  state.mockTimer = setInterval(() => {
    seq++;
    const nowMs = Math.round(performance.now());
    const mockSamples = [];
    for (let i = 0; i < 12; i++) {
      const phase = (seq * 12 + i) * 0.25;
      const mag = Number((9.8 + Math.sin(phase) * 1.6).toFixed(3));
      mockSamples.push({
        tMs: nowMs - (12 - i) * 20,
        ax: 0.2,
        ay: Number((mag * 0.95).toFixed(3)),
        az: 1.8,
        mag,
        gx: 4.5,
        gy: Number((Math.cos(phase) * 22).toFixed(1)),
        gz: 3.1,
        isPeak: i === 6 ? 1 : 0
      });
    }
    handleImuPacket(
      JSON.stringify({
        seq,
        cadenceSpm: 106,
        imuSiPct: 4.5,
        tremorRms: 0.12,
        gyroYawDegS: 16.5,
        sensorMode: "本機模擬流",
        samples: mockSamples,
        ts: Date.now()
      }),
      "本機模擬"
    );
  }, 250);
}