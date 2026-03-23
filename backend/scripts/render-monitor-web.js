#!/usr/bin/env node
/**
 * Render free tier does not offer Background Workers.
 * Run the monitor + Telegram bot as a Web Service: bind $PORT for health checks,
 * then start the same monitor loop as monitor-loop.js.
 */
const http = require("http");

const port = Number(process.env.PORT || 10000);

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ ok: true, service: "b-hive-monitor" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[render-monitor-web] health check listening on 0.0.0.0:${port}`);
});

require("./monitor-loop.js");
