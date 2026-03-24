const userList = document.getElementById('userList');
const chatFeed = document.getElementById('chatFeed');
const roleGrid = document.getElementById('roleGrid');

let state;
let selectedUserId = '';

function getBadges(role, isActive, isProcessing, isError) {
  const badges = [];
  if (isActive) badges.push('<span class="tag">当前</span>');
  if (isProcessing) badges.push('<span class="tag tag-hot">处理中</span>');
  if (isError) badges.push('<span class="tag tag-error">失败</span>');
  return badges.join('');
}

function renderRoles() {
  roleGrid.innerHTML = '';
  const currentTask = state.taskStatus || { status: 'idle', roleId: '' };

  state.roles.forEach((role) => {
    const isActive = state.config.selectedRoleId === role.id;
    const isProcessing = currentTask.status === 'processing' && currentTask.roleId === role.id;
    const isError = currentTask.status === 'error' && currentTask.roleId === role.id;
    const el = document.createElement('article');
    el.className = `role ${isActive ? 'active' : ''} ${isProcessing ? 'processing' : ''} ${isError ? 'error' : ''}`;
    el.innerHTML = `
      <img src="${role.avatar}" alt="${role.name}" />
      <div class="role-copy">
        <div class="top-row">
          <div>
            <div class="name">${role.name}</div>
            <div class="title">${role.title}</div>
          </div>
          <div class="badges">${getBadges(role, isActive, isProcessing, isError)}</div>
        </div>
      </div>
    `;
    el.addEventListener('click', async () => {
      const resp = await window.botApp.updateConfig({ selectedRoleId: role.id });
      state.config = resp.config;
      renderRoles();
    });
    roleGrid.appendChild(el);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

function renderUsers() {
  const conversations = state.conversations || [];
  if (!selectedUserId && conversations.length > 0) {
    selectedUserId = conversations[0].userId;
  }

  userList.innerHTML = '';
  if (conversations.length === 0) {
    return;
  }

  conversations.forEach((conversation) => {
    const button = document.createElement('button');
    button.className = `user-item ${selectedUserId === conversation.userId ? 'active' : ''}`;
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    button.innerHTML = `
      <div class="user-main">
        <div class="user-name">${escapeHtml(conversation.displayName)}</div>
        <div class="user-time">${formatTime(conversation.updatedAt)}</div>
      </div>
      <div class="user-preview">${escapeHtml(lastMessage?.text || '')}</div>
    `;
    button.addEventListener('click', () => {
      selectedUserId = conversation.userId;
      renderUsers();
      renderChat();
    });
    userList.appendChild(button);
  });
}

function renderChat() {
  const conversations = state.conversations || [];
  const current = conversations.find((item) => item.userId === selectedUserId) || conversations[0];

  if (!current) {
    chatFeed.innerHTML = '';
    return;
  }

  selectedUserId = current.userId;
  chatFeed.innerHTML = current.messages.map((message) => `
    <article class="bubble ${message.role === 'assistant' ? 'assistant' : 'user'}">
      <div class="bubble-text">${escapeHtml(message.text)}</div>
      <div class="bubble-time">${formatTime(message.createdAt)}</div>
    </article>
  `).join('');
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

async function boot() {
  state = await window.botApp.getState();
  renderUsers();
  renderChat();
  renderRoles();

  window.botApp.onTaskStatus((taskStatus) => {
    state.taskStatus = taskStatus;
    renderRoles();
  });

  window.botApp.onConversations((conversations) => {
    state.conversations = conversations;
    if (!conversations.some((item) => item.userId === selectedUserId)) {
      selectedUserId = conversations[0]?.userId || '';
    }
    renderUsers();
    renderChat();
  });
}

boot();
