# wechat-electrobun-bot

把原来的 MCP 启动脚本改为 **ElectroBun（Electron + Bun）桌面应用**。

## 功能

- 打开应用后自动：
  - 尝试启动 `inject.exe` 注入
  - 启动本地消息回调监听（默认 `http://127.0.0.1:5000/api/recvMsg`）
  - 收到消息后调用 DeepSeek 自动回复
- 单页面 UI：
  - 角色切换（默认：**创业孵化员 Ada**）
  - 群聊回复开关（关闭后不回复群消息）
  - API Key / 回调端口配置
  - 实时日志

## 预设角色

- Ada / 创业孵化员（创业助跑，陪跑员，递水员）
- Mia / 医生
- Ethan / 律师
- Sophie / 人事
- Noah / 投资顾问

## 启动

```bash
bun install
bun run dev
```

> 也可使用 `npm install && npm run dev`。

## 配置说明

- DeepSeek API Key：界面填写或通过环境变量 `DEEPSEEK_API_KEY`
- 回调端口：默认 5000
- 上游网关：默认 `http://127.0.0.1:19088`
- 注入程序：默认读取项目根目录 `inject.exe`

## 回调格式

应用会从回调中尽量提取下列字段：

- `FromUserName` / `fromUserName` / `wxid`
- `Content` / `content` / `msg`

提取成功后调用 `/api/send_text_msg` 自动回复。
