const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const DEFAULT_ROLES = [
  {
    id: 'ada-incubator',
    name: 'Ada',
    title: '创业孵化员',
    description: '创业助跑，陪跑员，递水员。',
    avatar: 'https://i.pravatar.cc/200?img=47',
    prompt: '你是 Ada，一位创业孵化员。回答要务实、鼓励、可执行，像一个创业陪跑员。'
  },
  {
    id: 'doctor',
    name: 'Mia',
    title: '医生',
    description: '先问症状再建议，关注风险提示。',
    avatar: 'https://i.pravatar.cc/200?img=5',
    prompt: '你是一名医生助手，先澄清症状，不做确诊，给出就医建议与风险提醒。'
  },
  {
    id: 'lawyer',
    name: 'Ethan',
    title: '律师',
    description: '条理清晰，给出合规与风险边界。',
    avatar: 'https://i.pravatar.cc/200?img=12',
    prompt: '你是一名律师助手，回答要有结构、给出合规边界，提醒咨询当地执业律师。'
  },
  {
    id: 'hr',
    name: 'Sophie',
    title: '人事',
    description: '招聘、绩效、组织协同建议。',
    avatar: 'https://i.pravatar.cc/200?img=32',
    prompt: '你是一名人事顾问，给出招聘、绩效和团队沟通的可执行建议。'
  },
  {
    id: 'investor',
    name: 'Noah',
    title: '投资顾问',
    description: '偏理性、重风控、给出多方案。',
    avatar: 'https://i.pravatar.cc/200?img=19',
    prompt: '你是一名投资顾问，偏重风险管理和资产配置，不承诺收益。'
  }
];

const DEFAULT_CONFIG = {
  selectedRoleId: 'ada-incubator',
  groupReplyEnabled: false,
  callbackPort: 5000,
  upstreamBase: 'http://127.0.0.1:19088',
  deepseekBaseUrl: 'https://api.deepseek.com',
  deepseekModel: 'deepseek-chat',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  injectExecutable: path.join(__dirname, 'inject.exe'),
  injectArgs: []
};

let mainWindow;
let callbackServer;
let config;
let injectProcess;
const logs = [];

function pushLog(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logs.unshift(line);
  if (logs.length > 200) logs.pop();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bot-log', line);
  }
  console.log(line);
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'bot-config.json');
}

function loadConfig() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (error) {
    pushLog(`读取配置失败，已使用默认配置: ${error.message}`);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(nextConfig) {
  config = { ...config, ...nextConfig };
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
}

async function requestDeepSeekReply(inputText) {
  if (!config.deepseekApiKey) {
    throw new Error('未设置 DeepSeek API Key');
  }
  const role = DEFAULT_ROLES.find((r) => r.id === config.selectedRoleId) || DEFAULT_ROLES[0];

  const response = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseekApiKey}`
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      messages: [
        { role: 'system', content: role.prompt },
        { role: 'user', content: inputText }
      ],
      temperature: 0.6
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek 请求失败: HTTP ${response.status} ${detail}`);
  }

  const data = await response.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error('DeepSeek 返回为空');
  }
  return reply;
}

async function sendTextMessage(wxid, msg) {
  const res = await fetch(`${config.upstreamBase}/api/send_text_msg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wxid, msg })
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`发送消息失败: HTTP ${res.status} ${detail}`);
  }
}

function extractMessage(payload) {
  const body = payload?.data || payload;
  const fromUserName = body?.FromUserName || body?.fromUserName || body?.wxid || '';
  const content = body?.Content || body?.content || body?.msg || '';
  return {
    fromUserName,
    content,
    isGroup: typeof fromUserName === 'string' && fromUserName.includes('@chatroom')
  };
}

async function handleIncomingMessage(payload) {
  const msg = extractMessage(payload);
  if (!msg.fromUserName || !msg.content) {
    pushLog('收到消息，但缺少 fromUserName/content，已跳过。');
    return;
  }

  if (msg.isGroup && !config.groupReplyEnabled) {
    pushLog(`群聊开关关闭，忽略群消息: ${msg.fromUserName}`);
    return;
  }

  pushLog(`收到消息 from ${msg.fromUserName}: ${msg.content.slice(0, 80)}`);
  const reply = await requestDeepSeekReply(msg.content);
  await sendTextMessage(msg.fromUserName, reply);
  pushLog(`已自动回复 -> ${msg.fromUserName}`);
}

function startCallbackServer() {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = undefined;
  }

  callbackServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/recvMsg') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          await handleIncomingMessage(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          pushLog(`处理回调失败: ${error.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  callbackServer.listen(config.callbackPort, '127.0.0.1', () => {
    pushLog(`回调服务已启动: http://127.0.0.1:${config.callbackPort}/api/recvMsg`);
  });
}

function startInject() {
  if (!fs.existsSync(config.injectExecutable)) {
    pushLog(`未找到 inject 程序，已跳过注入: ${config.injectExecutable}`);
    return;
  }

  injectProcess = spawn(config.injectExecutable, config.injectArgs, {
    windowsHide: false,
    detached: false,
    stdio: 'ignore'
  });

  injectProcess.on('exit', (code) => {
    pushLog(`inject 进程退出，code=${String(code)}`);
    injectProcess = undefined;
  });

  pushLog('已启动注入进程 inject.exe');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
}

app.whenReady().then(() => {
  config = loadConfig();
  createWindow();
  startCallbackServer();
  startInject();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (callbackServer) callbackServer.close();
  if (injectProcess && !injectProcess.killed) injectProcess.kill();
});

ipcMain.handle('app:get-state', () => ({
  config,
  roles: DEFAULT_ROLES,
  logs
}));

ipcMain.handle('app:update-config', (_event, patch) => {
  saveConfig(patch);
  if (patch.callbackPort) {
    startCallbackServer();
  }
  pushLog('配置已更新');
  return { config };
});
