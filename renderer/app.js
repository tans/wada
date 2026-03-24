const roleGrid = document.getElementById('roleGrid');

let state;

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
        <div class="desc">${role.description}</div>
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

async function boot() {
  state = await window.botApp.getState();
  renderRoles();

  window.botApp.onTaskStatus((taskStatus) => {
    state.taskStatus = taskStatus;
    renderRoles();
  });
}

boot();
