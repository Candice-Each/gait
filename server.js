const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const WebSocket = require("ws");

const HTTP_PORT = 8080;
const HTTPS_PORT = 8443;
const ROOT = path.resolve(__dirname);
const IMU_FILE = "imu.html";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm"
};

// 原生產生自簽名 SSL 憑證（無需 OpenSSL）
function derLen(len) {
  if (len < 128) return Buffer.from([len]);
  if (len < 256) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}
function derNode(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}
function generateNativeSelfSignedCert() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const spki = publicKey.export({ type: "spki", format: "der" });
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" });

  const serial = derNode(0x02, Buffer.from([0x01, 0x20, 0x26, 0x11, 0x03]));
  const sha256RsaAlg = Buffer.from("300d06092a864886f70d01010b0500", "hex");
  const cnAttr = Buffer.from("30143112301006035504030c09476169744c6f63616c", "hex");
  const validity = derNode(
    0x30,
    Buffer.concat([
      derNode(0x17, Buffer.from("260101000000Z")),
      derNode(0x17, Buffer.from("270101000000Z"))
    ])
  );

  const tbs = derNode(0x30, Buffer.concat([serial, sha256RsaAlg, cnAttr, validity, cnAttr, spki]));
  const sig = crypto.sign("sha256", tbs, privateKey);
  const sigBitString = derNode(0x03, Buffer.concat([Buffer.from([0x00]), sig]));
  const certDer = derNode(0x30, Buffer.concat([tbs, sha256RsaAlg, sigBitString]));
  const b64 = certDer.toString("base64").match(/.{1,64}/g).join("\n");
  const certPem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
  return { key: keyPem, cert: certPem };
}

/** 列舉本機局域網 IPv4 位址（跳過虛擬網卡，優先返回 192.168.x.x / 172.20.10.x） */
function getLanIps() {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    if (/virtualbox|vmware|wsl|default switch|hyper-v|docker|vbox/i.test(name)) continue;
    for (const net of nets[name]) {
      if ((net.family === "IPv4" || net.family === 4) && !net.internal) {
        if (net.address.startsWith("192.168.56.")) continue;
        if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(net.address) && !net.address.startsWith("172.20.10.")) continue;
        ips.push({ name, address: net.address });
      }
    }
  }
  ips.sort((a, b) => {
    const score = (x) =>
      x.address === "192.168.137.1" ? 100 :
      x.address.startsWith("172.20.10.") ? 90 :
      x.address.startsWith("192.168.") ? 50 : 10;
    return score(b) - score(a);
  });
  return ips;
}

function buildImuUrl(ip, proto, port) {
  return `${proto}://${ip}:${port}/${IMU_FILE}`;
}

function resolveRoute(urlPath) {
  if (urlPath === "/" || urlPath === "/index.html" || urlPath === "/gait_test_bench.html") {
    return "index.html";
  }
  if (urlPath === "/m" || urlPath === "/imu" || urlPath === `/${IMU_FILE}` || urlPath === "/imu_sender.html") {
    return IMU_FILE;
  }
  return urlPath.replace(/^\/+/, "");
}

const allClients = new Set();

function broadcastToDashboard(text) {
  allClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  });
}

function handleRequest(req, res) {
  const cleanUrl = decodeURIComponent(req.url.split("?")[0]);

  if (cleanUrl === "/api/network-info" && req.method === "GET") {
    const ips = getLanIps();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    if (ips.length === 0) {
      return res.end(JSON.stringify({
        error: "no_lan_ip",
        message: "未偵測到局域網 IP，請連接 Wi-Fi 或開啟 Windows 行動熱點",
        primaryIp: null,
        httpsUrl: null,
        httpUrl: null
      }));
    }
    const primaryIp = ips[0].address;
    return res.end(JSON.stringify({
      primaryIp,
      httpsUrl: buildImuUrl(primaryIp, "https", HTTPS_PORT),
      httpUrl: buildImuUrl(primaryIp, "http", HTTP_PORT)
    }));
  }

  if (cleanUrl === "/api/imu-push" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (body) broadcastToDashboard(body);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });
      res.end('{"ok":true}');
    });
    return;
  }

  const relPath = resolveRoute(cleanUrl);
  const fullPath = path.resolve(ROOT, relPath);

  if (fullPath !== ROOT && !fullPath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found: " + relPath);
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
}

function attachWebSocketServer(srv) {
  const wss = new WebSocket.Server({ server: srv });
  wss.on("connection", (ws) => {
    allClients.add(ws);
    ws.on("message", (message) => {
      const text = message.toString();
      allClients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(text);
        }
      });
    });
    ws.on("close", () => allClients.delete(ws));
    ws.on("error", () => allClients.delete(ws));
  });
}

function listenWithErrorHandling(server, port, label) {
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`❌ [${label}] 埠號 ${port} 已被佔用`);
    } else {
      console.error(`❌ [${label}] 啟動失敗: ${err.message}`);
    }
    process.exit(1);
  });
  server.listen(port, "0.0.0.0");
}

const httpServer = http.createServer(handleRequest);
attachWebSocketServer(httpServer);
listenWithErrorHandling(httpServer, HTTP_PORT, "HTTP");

const httpsServer = https.createServer(generateNativeSelfSignedCert(), handleRequest);
attachWebSocketServer(httpsServer);
listenWithErrorHandling(httpsServer, HTTPS_PORT, "HTTPS");

setTimeout(() => {
  const ips = getLanIps();
  console.log("====================================================================");
  console.log(`✅【1. 本機電腦測試】: http://localhost:${HTTP_PORT}`);
  console.log("--------------------------------------------------------------------");

  if (ips.length === 0) {
    console.log("未偵測到局域網 IP");
  } else {
    console.log("【局域網位址】");
    ips.forEach((ip) => {
      console.log(`[${ip.name}]`);
      console.log(`HTTP  : ${buildImuUrl(ip.address, "http", HTTP_PORT)}`);
      console.log(`HTTPS : ${buildImuUrl(ip.address, "https", HTTPS_PORT)}`);
    });
  }
  console.log("--------------------------------------------------------------------");
  console.log("手機訪問提示：");
  console.log("• 手機與電腦必須連同一個 Wi-Fi/連電腦熱點");
  console.log("• 若 HTTP 打不開，先用 localhost 確認服務是否真的啟動");
  console.log("• HTTPS 為自簽名憑證，手機首次打開需點「進階 → 繼續訪問」");
  console.log("• 若手機端仍無法連線，請確認防火牆已放行 8080 / 8443");
  console.log("====================================================================");
}, 800);