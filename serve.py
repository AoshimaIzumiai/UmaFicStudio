#!/usr/bin/env python3
"""本地 HTTP 服务器 — 解决 file:// 协议下 fetch 的 CORS 限制"""
import http.server
import socketserver
import webbrowser

PORT = 8080

Handler = http.server.SimpleHTTPRequestHandler
Handler.extensions_map.update({".js": "application/javascript", ".json": "application/json"})

print(f"启动本地服务: http://localhost:{PORT}")
print("按 Ctrl+C 停止")
webbrowser.open(f"http://localhost:{PORT}")

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()
