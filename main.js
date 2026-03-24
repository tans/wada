const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const LOG_PATH = path.join(process.cwd(), 'log.txt');
const MAX_LOG_LINES = 200;

const DEFAULT_ROLES = [
  {
    id: 'ada-incubator',
    name: 'Ada',
    title: '创业孵化顾问',
    description: '关注商业路径、执行节奏和冷启动推进，适合创业咨询与项目推进场景。',
    avatar: 'https://randomuser.me/api/portraits/women/68.jpg',
    prompt: '你是 Ada，一位创业孵化顾问。回答务实、直接、可执行，像经验丰富的创业陪跑顾问。'
  },
  {
    id: 'doctor',
    name: 'Mia',
    title: '医疗顾问',
    description: '先澄清症状与背景，再给出风险提示和就医建议，不做正式诊断。',
    avatar: 'https://randomuser.me/api/portraits/women/44.jpg',
    prompt: '你是一名医疗顾问助理。先澄清症状与背景，不做确诊，给出风险提醒和就医建议。'
  },
  {
    id: 'lawyer',
    name: 'Ethan',
    title: '法律顾问',
    description: '回答强调边界、合规和风险，适合合同、沟通留痕与基础法律咨询。',
    avatar: 'https://randomuser.me/api/portraits/men/32.jpg',
    prompt: '你是一名法律顾问助理。回答要有结构，说明合规边界与风险，并提醒咨询当地执业律师。'
  },
  {
    id: 'hr',
    name: 'Sophie',
    title: '人力资源顾问',
    description: '适合招聘、绩效、组织协同与团队沟通类问题，强调可落地动作。',
    avatar: 'https://randomuser.me/api/portraits/women/22.jpg',
    prompt: '你是一名人力资源顾问，给出招聘、绩效和团队沟通的可执行建议。'
  },
  {
    id: 'investor',
    name: 'Noah',
    title: '投资顾问',
    description: '偏理性分析和风险控制，适合资产配置、投研思路与方案比较。',
    avatar: 'https://randomuser.me/api/portraits/men/75.jpg',
    prompt: '你是一名投资顾问，侧重风险管理、资产配置与多方案比较，不承诺收益。'
  },
  {
    id: 'insurance-advisor',
    name: 'Olivia',
    title: '保险理财顾问',
    description: '擅长梳理保障缺口、家庭现金流和保单配置，优先考虑风险覆盖与长期规划。',
    avatar: 'https://randomuser.me/api/portraits/women/63.jpg',
    prompt: '你是一名保险理财顾问。回答聚焦保障缺口、保费压力、现金流匹配和长期规划，不夸大收益。'
  },
  {
    id: 'real-estate-sales',
    name: 'Daniel',
    title: '房地产销售',
    description: '适合介绍房源价值、区域配套、交易流程与客户异议处理，表达专业但不过度施压。',
    avatar: 'https://randomuser.me/api/portraits/men/54.jpg',
    prompt: '你是一名房地产销售顾问。回答要专业、清晰，突出房源价值、区域配套、交易流程与客户顾虑化解。'
  }
];

function getProgramDirectory() {
  return app.isPackaged ? path.dirname(process.execPath) : process.cwd();
}

function getDefaultInjectExecutable() {
  return path.join(getProgramDirectory(), 'inject.exe');
}

const DEFAULT_CONFIG = {
  selectedRoleId: 'ada-incubator',
  groupReplyEnabled: false,
  callbackPort: 5000,
  upstreamBase: 'http://127.0.0.1:19088',
  deepseekBaseUrl: 'https://api.deepseek.com',
  deepseekModel: 'deepseek-chat',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  injectExecutable: getDefaultInjectExecutable(),
  injectArgs: []
};

let mainWindow;
let callbackServer;
let config;
let injectProcess;
let logs = [];
let taskStatus = { roleId: '', status: 'idle', fromUserName: '', updatedAt: 0 };
let taskStatusResetTimer;

function ensureRuntimeFiles() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
  }
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, '', 'utf8');
  }
}

function loadRecentLogs() {
  try {
    const text = fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf8') : '';
    return text.split(/\r?\n/).filter(Boolean).slice(-MAX_LOG_LINES).reverse();
  } catch (error) {
    console.error(`Failed to read log file: ${error.message}`);
    return [];
  }
}

function pushLog(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logs.unshift(line);
  if (logs.length > MAX_LOG_LINES) logs.pop();

  try {
    fs.appendFileSync(LOG_PATH, `${line}\n`, 'utf8');
  } catch (error) {
    console.error(`Failed to append log: ${error.message}`);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bot-log', line);
  }
  console.log(line);
}

function emitTaskStatus(nextTaskStatus) {
  taskStatus = nextTaskStatus;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('task-status', taskStatus);
  }
}

function setTaskStatus(status, extras = {}) {
  emitTaskStatus({
    roleId: config?.selectedRoleId || '',
    status,
    fromUserName: extras.fromUserName || '',
    updatedAt: Date.now()
  });
}

function scheduleTaskStatusReset(delay = 1800) {
  if (taskStatusResetTimer) clearTimeout(taskStatusResetTimer);
  taskStatusResetTimer = setTimeout(() => {
    emitTaskStatus({ roleId: '', status: 'idle', fromUserName: '', updatedAt: Date.now() });
    taskStatusResetTimer = undefined;
  }, delay);
}

function loadConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      injectExecutable: parsed.injectExecutable || DEFAULT_CONFIG.injectExecutable
    };
  } catch (error) {
    pushLog(`璇诲彇 config.json 澶辫触锛屽凡鍥為€€鍒伴粯璁ら厤缃? ${error.message}`);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(nextConfig) {
  config = { ...config, ...nextConfig };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function getInjectExecutableCandidates() {
  return [getDefaultInjectExecutable(), config.injectExecutable].filter(Boolean).filter((item, index, list) => list.indexOf(item) === index);
}

async function requestDeepSeekReply(inputText) {
  if (!config.deepseekApiKey) {
    throw new Error('鏈缃?DeepSeek API Key');
  }

  const role = DEFAULT_ROLES.find((item) => item.id === config.selectedRoleId) || DEFAULT_ROLES[0];
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
    throw new Error(`DeepSeek 璇锋眰澶辫触: HTTP ${response.status} ${detail}`);
  }

  const data = await response.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error('DeepSeek 杩斿洖涓虹┖');
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
    throw new Error(`鍙戦€佹秷鎭け璐? HTTP ${res.status} ${detail}`);
  }
}

function extractMessage(payload) {
  const body = payload?.data || payload;
  const fromUserName = body?.FromUserName || body?.fromUserName || body?.fromUsr || body?.wxid || '';
  const content = normalizeMessageContent(body?.Content ?? body?.content ?? body?.msg ?? body?.reply ?? '');
  return {
    fromUserName,
    content,
    isGroup: typeof fromUserName === 'string' && fromUserName.includes('@chatroom')
  };
}

function normalizeMessageContent(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value.map((item) => normalizeMessageContent(item)).filter(Boolean).join('\n').trim();
  }

  if (value && typeof value === 'object') {
    const preferredKeys = ['text', 'content', 'title', 'desc', 'description'];
    for (const key of preferredKeys) {
      const normalized = normalizeMessageContent(value[key]);
      if (normalized) return normalized;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  return '';
}

function getMessagePreview(content, limit = 80) {
  if (!content) return '';
  const singleLine = content.replace(/\s+/g, ' ').trim();
  return singleLine.length > limit ? `${singleLine.slice(0, limit)}...` : singleLine;
}

async function handleIncomingMessage(payload) {
  const msg = extractMessage(payload);
  if (!msg.fromUserName || !msg.content) {
    pushLog('Skipped callback message because fromUserName or content is missing.');
    return;
  }

  if (msg.isGroup && !config.groupReplyEnabled) {
    pushLog(`Ignored group message because group replies are disabled: ${msg.fromUserName}`);
    return;
  }

  setTaskStatus('processing', { fromUserName: msg.fromUserName });
  pushLog(`Received message from ${msg.fromUserName}: ${getMessagePreview(msg.content)}`);

  try {
    const reply = await requestDeepSeekReply(msg.content);
    await sendTextMessage(msg.fromUserName, reply);
    pushLog(`Auto replied to ${msg.fromUserName}`);
    setTaskStatus('success', { fromUserName: msg.fromUserName });
    scheduleTaskStatusReset();
  } catch (error) {
    setTaskStatus('error', { fromUserName: msg.fromUserName });
    scheduleTaskStatusReset(2600);
    throw error;
  }
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
          pushLog(`澶勭悊鍥炶皟澶辫触: ${error.message}`);
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
    pushLog(`鍥炶皟鏈嶅姟宸插惎鍔? http://127.0.0.1:${config.callbackPort}/api/recvMsg`);
  });
}

function startInject() {
  const executable = getInjectExecutableCandidates().find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    pushLog(`鏈壘鍒?inject.exe锛屽凡鎸夊綋鍓嶇▼搴忕洰褰曟煡鎵? ${getDefaultInjectExecutable()}`);
    return;
  }

  injectProcess = spawn(executable, config.injectArgs, {
    windowsHide: false,
    detached: false,
    stdio: 'ignore'
  });

  injectProcess.on('exit', (code) => {
    pushLog(`inject 杩涚▼閫€鍑猴紝code=${String(code)}`);
    injectProcess = undefined;
  });

  pushLog(`宸插惎鍔ㄦ敞鍏ヨ繘绋? ${executable}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    backgroundColor: '#f4efe6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
}

app.whenReady().then(() => {
  ensureRuntimeFiles();
  logs = loadRecentLogs();
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
  if (taskStatusResetTimer) clearTimeout(taskStatusResetTimer);
});

ipcMain.handle('app:get-state', () => ({
  config,
  roles: DEFAULT_ROLES,
  logs,
  taskStatus,
  paths: {
    configPath: CONFIG_PATH,
    logPath: LOG_PATH,
    programDirectory: getProgramDirectory()
  }
}));

ipcMain.handle('app:update-config', (_event, patch) => {
  saveConfig(patch);
  if (Object.prototype.hasOwnProperty.call(patch, 'callbackPort')) {
    startCallbackServer();
  }
  pushLog('閰嶇疆宸叉洿鏂板苟鍐欏叆 config.json');
  return {
    config,
    taskStatus,
    paths: {
      configPath: CONFIG_PATH,
      logPath: LOG_PATH,
      programDirectory: getProgramDirectory()
    }
  };
});
