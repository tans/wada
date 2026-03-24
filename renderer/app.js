const roleGrid = document.getElementById('roleGrid');
const logBox = document.getElementById('logBox');
const groupToggle = document.getElementById('groupToggle');
const apiKey = document.getElementById('apiKey');
const callbackPort = document.getElementById('callbackPort');
const saveBtn = document.getElementById('saveBtn');

let state;

function renderRoles() {
  roleGrid.innerHTML = '';
  state.roles.forEach((role) => {
    const el = document.createElement('article');
    el.className = `role ${state.config.selectedRoleId === role.id ? 'active' : ''}`;
    el.innerHTML = `
      <img src="${role.avatar}" alt="${role.name}" />
      <div class="name">${role.name}</div>
      <div class="title">${role.title}</div>
      <div class="desc">${role.description}</div>
    `;
    el.addEventListener('click', async () => {
      const resp = await window.botApp.updateConfig({ selectedRoleId: role.id });
      state.config = resp.config;
      renderRoles();
    });
    roleGrid.appendChild(el);
  });
}

function renderLogs(lines) {
  logBox.textContent = lines.join('\n');
}

async function boot() {
  state = await window.botApp.getState();
  groupToggle.checked = Boolean(state.config.groupReplyEnabled);
  apiKey.value = state.config.deepseekApiKey || '';
  callbackPort.value = String(state.config.callbackPort || 5000);

  renderRoles();
  renderLogs(state.logs || []);

  window.botApp.onLog((line) => {
    const lines = logBox.textContent ? logBox.textContent.split('\n') : [];
    lines.unshift(line);
    logBox.textContent = lines.slice(0, 200).join('\n');
  });
}

saveBtn.addEventListener('click', async () => {
  const patch = {
    groupReplyEnabled: groupToggle.checked,
    deepseekApiKey: apiKey.value.trim(),
    callbackPort: Number(callbackPort.value) || 5000
  };
  const resp = await window.botApp.updateConfig(patch);
  state.config = resp.config;
  alert('配置已保存');
});

boot();
