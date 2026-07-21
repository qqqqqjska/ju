# mcp-cors-proxy

一个极小的 CORS 中转代理：让浏览器里的网页应用能连上一个只支持服务器直连、不允许跨域的 MCP 服务。

浏览器 → 本代理（Render）→ 官方 MCP 服务器。服务器之间没有跨域限制，所以能通。
代理只做转发，不做登录：你的访问令牌由网页在请求里带过来，代理原样转发。

## 在 Render 部署

1. 把本仓库的文件放进一个 GitHub 仓库。
2. Render → New + → Web Service → 连接这个仓库。
3. Runtime 选 **Docker**，Instance Type 选 **Free**。
4. 环境变量：
   - `TARGET_BASE` = `https://gwmcp.lkcoffee.com`（要转发到的 MCP 根地址，不带路径）
   - （可选）`PROXY_SECRET` = 一段只有你知道的随机字符串。设置后，请求必须带 header `x-proxy-secret: <该值>` 才放行，防止别人乱用你的代理。
5. 部署完成后拿到地址，例如 `https://mcp-proxy-xxxx.onrender.com`。

## 接入 MCP 应用

把「服务地址」从
`https://gwmcp.lkcoffee.com/order/user/mcp`
改成
`https://mcp-proxy-xxxx.onrender.com/order/user/mcp`
（域名换成你的 Render 地址，后面的路径原样保留）。令牌照旧填「访问令牌」。

## 说明

- Render 免费版空闲 15 分钟会休眠，休眠后首次请求冷启动约 50 秒，多等一下或再点一次。
- `GET /` 或 `GET /health` 返回 `proxy ok`，可用来测试代理是否活着。
