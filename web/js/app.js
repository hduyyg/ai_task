/**
 * 主应用逻辑
 */

// DOM元素
const loginPage = document.getElementById('login-page');
const mainPage = document.getElementById('main-page');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authMessage = document.getElementById('auth-message');
const logoutBtn = document.getElementById('logout-btn');
const currentUsername = document.getElementById('current-username');

// 客户端数据缓存
let clientsCache = [];

// 任务列表自动刷新定时器
let tasksRefreshTimer = null;

// 当前状态筛选值
let currentStatusFilter = ['pending', 'running', 'suspended', 'completed'];

// 任务 flow_status 缓存（用于检测变化）
let taskFlowStatusCache = {};

// 浏览器通知是否已授权
let notificationPermission = 'default';

// 初始化应用
document.addEventListener('DOMContentLoaded', async () => {
    // 先加载API配置（获取后端地址）
    await initAPIConfig();

    initAuth();
    initTabs();
    initNavigation();
    initForms();
    initModals();
    initNotification();
});

// ===== 浏览器通知 =====

// 初始化通知权限
function initNotification() {
    // 检查浏览器是否支持通知
    if (!('Notification' in window)) {
        console.log('此浏览器不支持通知功能');
        return;
    }
    
    notificationPermission = Notification.permission;
    
    // 如果还没有请求过权限，在用户首次交互时请求
    if (notificationPermission === 'default') {
        // 在页面上添加一个提示，让用户点击授权
        document.addEventListener('click', requestNotificationPermission, { once: true });
    }
}

// 请求通知权限
async function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    
    if (Notification.permission === 'default') {
        try {
            const permission = await Notification.requestPermission();
            notificationPermission = permission;
            if (permission === 'granted') {
                console.log('通知权限已授权');
            }
        } catch (error) {
            console.error('请求通知权限失败:', error);
        }
    }
}

// 发送浏览器通知
function sendNotification(title, body, taskKey) {
    if (!('Notification' in window)) return;
    
    if (Notification.permission !== 'granted') return;
    
    const notification = new Notification(title, {
        body: body,
        icon: 'favicon.ico', // 可选：添加图标
        tag: `task-${taskKey}`, // 相同 tag 的通知会合并
        requireInteraction: false
    });
    
    // 点击通知时聚焦到页面
    notification.onclick = function() {
        window.focus();
        notification.close();
    };
    
    // 5秒后自动关闭
    setTimeout(() => notification.close(), 5000);
}

// 检测 flow_status 变化并发送通知
function checkFlowStatusChanges(tasks) {
    if (Notification.permission !== 'granted') return;
    
    tasks.forEach(task => {
        const taskId = task.id;
        const currentFlowStatus = task.flow_status || '';
        const previousFlowStatus = taskFlowStatusCache[taskId];
        
        // 如果之前有缓存，且状态发生了变化
        if (previousFlowStatus !== undefined && previousFlowStatus !== currentFlowStatus) {
            sendNotification(
                `任务状态更新: ${task.key}`,
                `${task.title}\n执行状态: ${previousFlowStatus || '-'} → ${currentFlowStatus || '-'}`,
                task.key
            );
        }
        
        // 更新缓存
        taskFlowStatusCache[taskId] = currentFlowStatus;
    });
}

// ===== 认证相关 =====

function initAuth() {
    if (isLoggedIn()) {
        showMainPage();
        loadUserInfo();
    } else {
        showLoginPage();
    }
    
    logoutBtn.addEventListener('click', logout);
}

function showLoginPage() {
    loginPage.classList.add('active');
    mainPage.classList.remove('active');
    
    // 停止任务列表自动刷新
    stopTasksAutoRefresh();
}

function showMainPage() {
    loginPage.classList.remove('active');
    mainPage.classList.add('active');

    // 初始化任务筛选控件
    initTaskFilter();

    // 初始化待办事项
    initTodos();

    // 初始化秘钥管理
    initSecrets();

    // 初始化客户端搜索
    initClientSearch();

    // 加载数据
    loadClients();
    loadTasks();
    loadTodos();
    loadSecrets();

    // 启动任务列表自动刷新（每10秒）
    startTasksAutoRefresh();
}

async function loadUserInfo() {
    const user = getCurrentUser();
    if (user) {
        currentUsername.textContent = user.name;
    }
}

function logout() {
    clearAuth();
    showLoginPage();
    showToast('已退出登录', 'success');
}

// ===== Tab切换 =====

function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            // 切换tab按钮状态
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // 切换表单显示
            document.querySelectorAll('.auth-form').forEach(form => {
                form.classList.remove('active');
            });
            document.getElementById(`${tab}-form`).classList.add('active');
            
            // 清除消息
            hideAuthMessage();
        });
    });
}

// ===== 导航切换（Hash 路由）=====

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    
    // 点击导航时更新 hash
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.dataset.view;
            window.location.hash = `/${view}`;
        });
    });
    
    // 监听 hash 变化
    window.addEventListener('hashchange', handleHashChange);
    
    // 初始化时根据 hash 显示对应视图
    handleHashChange();
}

function handleHashChange() {
    // 从 hash 中提取视图名称，如 #/clients -> clients
    const hash = window.location.hash;
    let view = 'tasks'; // 默认视图
    
    if (hash.startsWith('#/')) {
        view = hash.substring(2); // 去掉 #/
    }
    
    // 验证视图是否存在
    if (!document.getElementById(`${view}-view`)) {
        view = 'tasks';
    }
    
    switchToView(view);
}

function switchToView(view) {
    const navItems = document.querySelectorAll('.nav-item');

    // 切换导航状态
    navItems.forEach(n => n.classList.remove('active'));
    document.querySelector(`[data-view="${view}"]`)?.classList.add('active');

    // 切换视图
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
    });
    document.getElementById(`${view}-view`)?.classList.add('active');

    // 视图切换时加载对应数据
    if (view === 'okr') {
        loadObjectives();
        initOKREvents();
    } else if (view === 'secrets') {
        loadSecrets();
    }
}

// ===== 表单处理 =====

function initForms() {
    // 登录表单
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        
        if (!username || !password) {
            showAuthMessage('请填写用户名和密码', 'error');
            return;
        }
        
        try {
            const passwordHash = await sha256(password);
            const result = await userAPI.login(username, passwordHash);

            // 后端返回格式: {code, message, data: {id, name, token}}
            const userData = result.data;
            setToken(userData.token);
            setCurrentUser({id: userData.id, name: userData.name});

            showToast('登录成功', 'success');
            showMainPage();
            loadUserInfo();
        } catch (error) {
            showAuthMessage(error.message, 'error');
        }
    });
    
    // 注册表单
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('register-username').value.trim();
        const password = document.getElementById('register-password').value;
        const confirm = document.getElementById('register-confirm').value;
        
        if (!username || !password || !confirm) {
            showAuthMessage('请填写所有字段', 'error');
            return;
        }
        
        if (password !== confirm) {
            showAuthMessage('两次输入的密码不一致', 'error');
            return;
        }
        
        if (password.length < 6) {
            showAuthMessage('密码长度至少6位', 'error');
            return;
        }
        
        try {
            const passwordHash = await sha256(password);
            await userAPI.register(username, passwordHash);
            
            showAuthMessage('注册成功，请登录', 'success');
            
            // 切换到登录tab
            document.querySelector('[data-tab="login"]').click();
            document.getElementById('login-username').value = username;
        } catch (error) {
            showAuthMessage(error.message, 'error');
        }
    });
    
    // 添加客户端按钮
    document.getElementById('add-client-btn').addEventListener('click', () => {
        showAddClientModal();
    });
    
    // 添加任务按钮
    document.getElementById('add-task-btn').addEventListener('click', () => {
        showAddTaskModal();
    });
}

function showAuthMessage(message, type) {
    authMessage.textContent = message;
    authMessage.className = `message ${type}`;
}

function hideAuthMessage() {
    authMessage.className = 'message';
    authMessage.textContent = '';
}

// ===== 模态框 =====

function initModals() {
    const overlay = document.getElementById('modal-overlay');
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeModal();
        }
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });
}

function openModal(title, content, modalClass = '') {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-content').innerHTML = content;
    
    // 移除之前可能添加的自定义类
    const modal = document.querySelector('.modal');
    modal.classList.remove('modal-lg', 'modal-flow', 'modal-task-detail');
    
    // 添加新的自定义类
    if (modalClass) {
        modal.classList.add(modalClass);
    }
    
    document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
}

// 简化版 showModal（供 OKR 模块使用）
function showModal(title, content) {
    openModal(title, content);
}

// ===== 客户端管理 =====

// 当前客户端搜索的ID
let currentClientSearchId = null;
// 客户端分页状态
let clientsNextCursor = null;
let clientsHasMore = false;
let clientsLoading = false;
// 只看我的筛选
let clientsOnlyMine = false;
// 心跳记录缓存
let heartbeatMap = {};

// 初始化客户端搜索和筛选
function initClientSearch() {
    const searchInput = document.getElementById('client-search-input');
    const searchBtn = document.getElementById('client-search-btn');
    const clearBtn = document.getElementById('client-search-clear-btn');
    const onlyMineCheckbox = document.getElementById('client-only-mine');

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const inputVal = searchInput.value.trim();
            if (inputVal) {
                const searchId = parseInt(inputVal);
                if (!isNaN(searchId)) {
                    currentClientSearchId = searchId;
                    // 搜索时在当前已加载的数据中过滤
                    renderClients(filterClientsBySearch(clientsCache));
                } else {
                    showToast('请输入有效的客户端ID', 'error');
                }
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            currentClientSearchId = null;
            renderClients(clientsCache);
        });
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchBtn.click();
            }
        });
    }

    // 只看我的筛选
    if (onlyMineCheckbox) {
        onlyMineCheckbox.addEventListener('change', () => {
            clientsOnlyMine = onlyMineCheckbox.checked;
            // 重新加载客户端列表
            resetAndLoadClients();
        });
    }

    // 初始化无限滚动
    initClientsInfiniteScroll();
}

// 初始化客户端列表无限滚动
function initClientsInfiniteScroll() {
    const tableContainer = document.querySelector('#clients-view .table-container');
    if (!tableContainer) return;

    tableContainer.addEventListener('scroll', () => {
        if (clientsLoading || !clientsHasMore) return;
        
        // 当滚动到底部附近时加载更多
        const scrollTop = tableContainer.scrollTop;
        const scrollHeight = tableContainer.scrollHeight;
        const clientHeight = tableContainer.clientHeight;
        
        if (scrollTop + clientHeight >= scrollHeight - 100) {
            loadMoreClients();
        }
    });
}

// 根据搜索ID过滤客户端列表
function filterClientsBySearch(clients) {
    if (currentClientSearchId === null) {
        return clients;
    }
    return clients.filter(client => client.id === currentClientSearchId);
}

// 重置并加载客户端列表
async function resetAndLoadClients() {
    clientsCache = [];
    clientsNextCursor = null;
    clientsHasMore = false;
    currentClientSearchId = null;
    const searchInput = document.getElementById('client-search-input');
    if (searchInput) searchInput.value = '';
    
    await loadClients();
}

// 加载客户端列表（首次加载）
async function loadClients() {
    if (clientsLoading) return;
    clientsLoading = true;

    try {
        const [clientsResult, heartbeatsResult] = await Promise.all([
            clientAPI.list({ limit: 20, only_mine: clientsOnlyMine }),
            clientAPI.getHeartbeats()
        ]);
        
        const data = clientsResult.data || {};
        clientsCache = data.items || [];
        clientsNextCursor = data.next_cursor;
        clientsHasMore = data.has_more || false;
        
        const heartbeats = heartbeatsResult.data || [];

        // 创建心跳记录的映射 (client_id -> last_sync_at)
        heartbeatMap = {};
        heartbeats.forEach(hb => {
            heartbeatMap[hb.client_id] = hb.last_sync_at;
        });

        // 合并心跳时间到客户端数据
        clientsCache.forEach(client => {
            if (heartbeatMap[client.id]) {
                client.last_sync_at = heartbeatMap[client.id];
            }
        });

        renderClients(clientsCache);
        updateLoadMoreIndicator();
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        clientsLoading = false;
    }
}

// 加载更多客户端
async function loadMoreClients() {
    if (clientsLoading || !clientsHasMore || !clientsNextCursor) return;
    clientsLoading = true;
    
    updateLoadMoreIndicator(true);

    try {
        const result = await clientAPI.list({
            cursor: clientsNextCursor,
            limit: 20,
            only_mine: clientsOnlyMine
        });
        
        const data = result.data || {};
        const newItems = data.items || [];
        clientsNextCursor = data.next_cursor;
        clientsHasMore = data.has_more || false;

        // 合并心跳时间
        newItems.forEach(client => {
            if (heartbeatMap[client.id]) {
                client.last_sync_at = heartbeatMap[client.id];
            }
        });

        // 追加到缓存
        clientsCache = clientsCache.concat(newItems);
        
        // 追加渲染
        appendClients(newItems);
        updateLoadMoreIndicator();
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        clientsLoading = false;
    }
}

// 更新加载更多指示器
function updateLoadMoreIndicator(loading = false) {
    let indicator = document.getElementById('clients-load-more');
    if (!indicator) {
        // 创建指示器
        const tableContainer = document.querySelector('#clients-view .table-container');
        if (tableContainer) {
            indicator = document.createElement('div');
            indicator.id = 'clients-load-more';
            indicator.className = 'load-more-indicator';
            tableContainer.appendChild(indicator);
        }
    }
    
    if (indicator) {
        if (loading) {
            indicator.innerHTML = '<span class="loading-spinner"></span> 加载中...';
            indicator.style.display = 'block';
        } else if (clientsHasMore) {
            indicator.innerHTML = '向下滚动加载更多';
            indicator.style.display = 'block';
        } else if (clientsCache.length > 0) {
            indicator.innerHTML = '已加载全部';
            indicator.style.display = 'block';
        } else {
            indicator.style.display = 'none';
        }
    }
}

function renderClients(clients) {
    const tbody = document.getElementById('clients-table-body');
    const emptyState = document.getElementById('clients-empty');

    if (clients.length === 0) {
        tbody.innerHTML = '';
        emptyState.classList.add('show');
        return;
    }

    emptyState.classList.remove('show');

    tbody.innerHTML = clients.map(client => renderClientRow(client)).join('');
}

// 追加渲染客户端行
function appendClients(clients) {
    const tbody = document.getElementById('clients-table-body');
    const emptyState = document.getElementById('clients-empty');
    
    if (clients.length === 0) return;
    
    emptyState.classList.remove('show');
    tbody.innerHTML += clients.map(client => renderClientRow(client)).join('');
}

// 渲染单个客户端行
function renderClientRow(client) {
    let actionsHtml = '';
    if (client.editable) {
        actionsHtml = `<button class="btn-action btn-edit" onclick="editClient(${client.id})">编辑</button>
            <button class="btn-action btn-delete" onclick="deleteClient(${client.id})">删除</button>`;
    } else if (client.is_public) {
        // 公开客户端但非创建者，显示查看按钮
        actionsHtml = `<button class="btn-action btn-info" onclick="viewClient(${client.id})">查看</button>`;
    } else {
        actionsHtml = '<span class="text-muted">只读</span>';
    }
    return `
    <tr>
        <td>${client.id}</td>
        <td><strong>${escapeHtml(client.name)}</strong></td>
        <td>${escapeHtml(client.creator_name || '-')}</td>
        <td>${client.is_public ? '<span class="status-tag status-running">是</span>' : '<span class="status-tag status-pending">否</span>'}</td>
        <td class="time-display ${getHeartbeatClass(client.last_sync_at)}">${formatRelativeTime(client.last_sync_at)}</td>
        <td class="time-display">${formatDateTime(client.created_at)}</td>
        <td>${actionsHtml}</td>
    </tr>
`;
}

function getHeartbeatClass(lastSync) {
    if (!lastSync) return 'offline';
    const diff = new Date() - new Date(lastSync);
    return diff < 300000 ? 'online' : 'offline'; // 5分钟内为在线
}

async function showAddClientModal() {
    // 获取可用的Agent列表
    let agentOptions = ['Claude Code'];
    try {
        const result = await clientAPI.getAgents();
        if (result.data && result.data.length > 0) {
            agentOptions = result.data;
        }
    } catch (error) {
        console.warn('获取Agent列表失败，使用默认值:', error);
    }

    const agentOptionsHtml = agentOptions.map(agent => 
        `<option value="${escapeHtml(agent)}">${escapeHtml(agent)}</option>`
    ).join('');

    const content = `
        <form id="add-client-form">
            <div class="form-row">
                <div class="form-group form-group-half">
                    <label>客户端名称</label>
                    <input type="text" id="client-name" placeholder="请输入名称（最多16个字符）" maxlength="16" required>
                </div>
                <div class="form-group form-group-quarter">
                    <label>是否公开</label>
                    <select id="client-is-public" class="status-select">
                        <option value="false">否</option>
                        <option value="true">是</option>
                    </select>
                </div>
                <div class="form-group form-group-quarter">
                    <label>Agent</label>
                    <select id="client-agent" class="status-select">
                        ${agentOptionsHtml}
                    </select>
                </div>
            </div>
            <div class="form-group">
                <div class="label-with-action">
                    <label>仓库配置 <span class="text-muted">(必须指定一个文档仓库)</span></label>
                    <button type="button" id="add-repo-btn" class="btn-small btn-add">+ 添加仓库</button>
                </div>
                <div class="repos-waterfall" id="repos-waterfall">
                    <!-- 动态填充 -->
                </div>
            </div>
            <button type="submit" class="btn-primary">创建</button>
        </form>
    `;

    openModal('添加客户端', content, 'modal-lg');

    // 仓库配置列表
    let reposList = [];

    // 渲染仓库配置列表（瀑布流卡片式）
    function renderReposList() {
        const container = document.getElementById('repos-waterfall');
        if (reposList.length === 0) {
            container.innerHTML = '<div class="repos-empty-tip">暂无仓库配置，点击上方按钮添加</div>';
            return;
        }

        container.innerHTML = reposList.map((repo, index) => `
            <div class="repo-card ${repo.docs_repo ? 'repo-card-docs' : ''}" data-index="${index}">
                <div class="repo-card-header">
                    <span class="repo-card-index">#${index + 1}</span>
                    <label class="repo-docs-toggle">
                        <input type="radio" name="docs-repo" class="repo-is-docs" data-index="${index}" ${repo.docs_repo ? 'checked' : ''}>
                        <span class="repo-docs-label">文档仓库</span>
                    </label>
                    <button type="button" class="btn-small btn-delete" onclick="removeRepoItem(${index})">删除</button>
                </div>
                <div class="repo-card-body">
                    <div class="repo-field-row repo-field-row-3">
                        <div class="repo-field repo-field-url">
                            <label>URL</label>
                            <input type="text" class="repo-url" data-index="${index}" value="${escapeHtml(repo.url || '')}" placeholder="仓库克隆地址">
                        </div>
                        <div class="repo-field repo-field-short">
                            <label>默认主分支</label>
                            <input type="text" class="repo-branch" data-index="${index}" value="${escapeHtml(repo.default_branch || '')}" placeholder="可不填，自动获取">
                        </div>
                        <div class="repo-field repo-field-short">
                            <label>分支前缀</label>
                            <input type="text" class="repo-branch-prefix" data-index="${index}" value="${escapeHtml(repo.branch_prefix || 'ai_')}" placeholder="ai_">
                        </div>
                    </div>
                    <div class="repo-field">
                        <label>Token</label>
                        <input type="text" class="repo-token" data-index="${index}" value="${escapeHtml(repo.token || '')}" placeholder="访问令牌，http地址必填">
                    </div>
                    <div class="repo-field">
                        <label>简介</label>
                        <textarea class="repo-desc" data-index="${index}" placeholder="仓库简介说明（必填）" rows="2">${escapeHtml(repo.desc || '')}</textarea>
                    </div>
                </div>
            </div>
        `).join('');

        // 绑定文档仓库选择事件
        bindDocsRepoEvents();
    }

    // 绑定文档仓库选择事件
    function bindDocsRepoEvents() {
        document.querySelectorAll('.repo-is-docs').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const selectedIndex = parseInt(e.target.dataset.index);
                // 更新数据：只有选中的才是文档仓库
                reposList.forEach((repo, index) => {
                    repo.docs_repo = (index === selectedIndex);
                });
                // 重新渲染以更新卡片样式
                renderReposList();
            });
        });
    }

    window.removeRepoItem = function(index) { reposList.splice(index, 1); renderReposList(); };

    document.getElementById('add-repo-btn').addEventListener('click', () => {
        // 如果是第一个仓库，默认设为文档仓库
        const isFirst = reposList.length === 0;
        reposList.push({ desc: '', url: '', token: '', default_branch: '', branch_prefix: 'ai_', docs_repo: isFirst });
        renderReposList();
    });

    // 监听仓库输入变化
    document.getElementById('repos-waterfall').addEventListener('input', (e) => {
        const index = parseInt(e.target.dataset.index);
        if (isNaN(index)) return;
        if (e.target.classList.contains('repo-desc')) reposList[index].desc = e.target.value;
        if (e.target.classList.contains('repo-url')) reposList[index].url = e.target.value;
        if (e.target.classList.contains('repo-token')) reposList[index].token = e.target.value;
        if (e.target.classList.contains('repo-branch')) reposList[index].default_branch = e.target.value;
        if (e.target.classList.contains('repo-branch-prefix')) reposList[index].branch_prefix = e.target.value;
    });

    renderReposList();

    // 表单提交
    document.getElementById('add-client-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('client-name').value.trim();
        const isPublic = document.getElementById('client-is-public').value === 'true';
        const agent = document.getElementById('client-agent').value;

        try {
            // 创建客户端
            const result = await clientAPI.create(name, [], {
                is_public: isPublic,
                agent: agent
            });
            const clientId = result.data.id;
            // 保存仓库配置
            if (reposList.length > 0) {
                await clientAPI.updateRepos(clientId, reposList);
            }
            showToast('客户端创建成功', 'success');
            closeModal();
            loadClients();
        } catch (error) {
            showToast(error.message, 'error');
        }
    });
}

async function deleteClient(id) {
    if (!confirm('确定要删除这个客户端吗？')) {
        return;
    }
    
    try {
        await clientAPI.delete(id);
        showToast('客户端删除成功', 'success');
        loadClients();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// 查看公开客户端配置（只读模式）
async function viewClient(id) {
    let clientData;
    let reposData = [];
    try {
        const [clientResult, reposResult] = await Promise.all([
            clientAPI.get(id),
            clientAPI.getRepos(id)
        ]);
        clientData = clientResult.data;
        reposData = reposResult.data || [];
    } catch (error) {
        showToast(error.message, 'error');
        return;
    }

    // 渲染只读仓库列表
    const reposHtml = reposData.length === 0 
        ? '<div class="repos-empty-tip">暂无仓库配置</div>'
        : reposData.map((repo, index) => `
            <div class="repo-card ${repo.docs_repo ? 'repo-card-docs' : ''}">
                <div class="repo-card-header">
                    <span class="repo-card-index">#${index + 1}</span>
                    ${repo.docs_repo ? '<span class="repo-docs-label">文档仓库</span>' : ''}
                </div>
                <div class="repo-card-body">
                    <div class="repo-field-row repo-field-row-3">
                        <div class="repo-field repo-field-url">
                            <label>URL</label>
                            <div class="readonly-field">${escapeHtml(repo.url || '-')}</div>
                        </div>
                        <div class="repo-field repo-field-short">
                            <label>默认主分支</label>
                            <div class="readonly-field">${escapeHtml(repo.default_branch || '-')}</div>
                        </div>
                        <div class="repo-field repo-field-short">
                            <label>分支前缀</label>
                            <div class="readonly-field">${escapeHtml(repo.branch_prefix || 'ai_')}</div>
                        </div>
                    </div>
                    <div class="repo-field">
                        <label>Token</label>
                        <div class="readonly-field">${repo.token ? '********' : '-'}</div>
                    </div>
                    <div class="repo-field">
                        <label>简介</label>
                        <div class="readonly-field">${escapeHtml(repo.desc || '-')}</div>
                    </div>
                </div>
            </div>
        `).join('');

    const content = `
        <div class="client-view-content">
            <div class="form-row">
                <div class="form-group form-group-half">
                    <label>客户端名称</label>
                    <div class="readonly-field">${escapeHtml(clientData.name)}</div>
                </div>
                <div class="form-group form-group-quarter">
                    <label>是否公开</label>
                    <div class="readonly-field">${clientData.is_public ? '是' : '否'}</div>
                </div>
                <div class="form-group form-group-quarter">
                    <label>Agent</label>
                    <div class="readonly-field">${escapeHtml(clientData.agent || 'Claude Code')}</div>
                </div>
            </div>
            <div class="form-group">
                <label>仓库配置</label>
                <div class="repos-waterfall">
                    ${reposHtml}
                </div>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="closeModal()">关闭</button>
            </div>
        </div>
    `;

    openModal('查看客户端配置', content, 'modal-lg');
}

async function editClient(id) {
    // 获取客户端信息、仓库配置和Agent列表
    let clientData;
    let reposData = [];
    let agentOptions = ['Claude Code'];
    try {
        const [clientResult, reposResult, agentsResult] = await Promise.all([
            clientAPI.get(id),
            clientAPI.getRepos(id),
            clientAPI.getAgents()
        ]);
        clientData = clientResult.data;
        reposData = reposResult.data || [];
        if (agentsResult.data && agentsResult.data.length > 0) {
            agentOptions = agentsResult.data;
        }
    } catch (error) {
        showToast(error.message, 'error');
        return;
    }

    const agentOptionsHtml = agentOptions.map(agent => 
        `<option value="${escapeHtml(agent)}" ${agent === clientData.agent ? 'selected' : ''}>${escapeHtml(agent)}</option>`
    ).join('');

    const content = `
        <form id="edit-client-form">
            <div class="form-row">
                <div class="form-group form-group-half">
                    <label>客户端名称</label>
                    <input type="text" id="client-name" placeholder="请输入名称（最多16个字符）" maxlength="16" required>
                </div>
                <div class="form-group form-group-quarter">
                    <label>是否公开</label>
                    <select id="client-is-public" class="status-select">
                        <option value="false">否</option>
                        <option value="true">是</option>
                    </select>
                </div>
                <div class="form-group form-group-quarter">
                    <label>Agent</label>
                    <select id="client-agent" class="status-select">
                        ${agentOptionsHtml}
                    </select>
                </div>
            </div>
            <div class="form-group">
                <div class="label-with-action">
                    <label>仓库配置 <span class="text-muted">(必须指定一个文档仓库)</span></label>
                    <button type="button" id="add-repo-btn" class="btn-small btn-add">+ 添加仓库</button>
                </div>
                <div class="repos-waterfall" id="repos-waterfall">
                    <!-- 动态填充 -->
                </div>
            </div>
            <button type="submit" class="btn-primary">保存</button>
        </form>
    `;

    openModal('编辑客户端', content, 'modal-lg');

    // 填充现有数据
    document.getElementById('client-name').value = clientData.name;
    document.getElementById('client-is-public').value = clientData.is_public ? 'true' : 'false';

    // 仓库配置列表
    let reposList = reposData.map(r => ({...r}));

    // 渲染仓库配置列表（瀑布流卡片式）
    function renderReposList() {
        const container = document.getElementById('repos-waterfall');
        if (reposList.length === 0) {
            container.innerHTML = '<div class="repos-empty-tip">暂无仓库配置，点击下方按钮添加</div>';
            return;
        }

        container.innerHTML = reposList.map((repo, index) => `
            <div class="repo-card ${repo.docs_repo ? 'repo-card-docs' : ''}" data-index="${index}">
                <div class="repo-card-header">
                    <span class="repo-card-index">#${index + 1}</span>
                    <label class="repo-docs-toggle">
                        <input type="radio" name="docs-repo" class="repo-is-docs" data-index="${index}" ${repo.docs_repo ? 'checked' : ''}>
                        <span class="repo-docs-label">文档仓库</span>
                    </label>
                    <button type="button" class="btn-small btn-delete" onclick="removeRepoItem(${index})">删除</button>
                </div>
                <div class="repo-card-body">
                    <div class="repo-field-row repo-field-row-3">
                        <div class="repo-field repo-field-url">
                            <label>URL</label>
                            <input type="text" class="repo-url" data-index="${index}" value="${escapeHtml(repo.url || '')}" placeholder="仓库克隆地址">
                        </div>
                        <div class="repo-field repo-field-short">
                            <label>默认主分支</label>
                            <input type="text" class="repo-branch" data-index="${index}" value="${escapeHtml(repo.default_branch || '')}" placeholder="可不填，自动获取">
                        </div>
                        <div class="repo-field repo-field-short">
                            <label>分支前缀</label>
                            <input type="text" class="repo-branch-prefix" data-index="${index}" value="${escapeHtml(repo.branch_prefix || 'ai_')}" placeholder="ai_">
                        </div>
                    </div>
                    <div class="repo-field">
                        <label>Token</label>
                        <input type="text" class="repo-token" data-index="${index}" value="${escapeHtml(repo.token || '')}" placeholder="访问令牌，http地址必填">
                    </div>
                    <div class="repo-field">
                        <label>简介</label>
                        <textarea class="repo-desc" data-index="${index}" placeholder="仓库简介说明（必填）" rows="2">${escapeHtml(repo.desc || '')}</textarea>
                    </div>
                </div>
            </div>
        `).join('');

        // 绑定文档仓库选择事件
        bindDocsRepoEvents();
    }

    // 绑定文档仓库选择事件
    function bindDocsRepoEvents() {
        document.querySelectorAll('.repo-is-docs').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const selectedIndex = parseInt(e.target.dataset.index);
                // 更新数据：只有选中的才是文档仓库
                reposList.forEach((repo, index) => {
                    repo.docs_repo = (index === selectedIndex);
                });
                // 重新渲染以更新卡片样式
                renderReposList();
            });
        });
    }

    window.removeRepoItem = function(index) { reposList.splice(index, 1); renderReposList(); };

    document.getElementById('add-repo-btn').addEventListener('click', () => {
        // 如果是第一个仓库，默认设为文档仓库
        const isFirst = reposList.length === 0;
        reposList.push({ desc: '', url: '', token: '', default_branch: '', branch_prefix: 'ai_', docs_repo: isFirst });
        renderReposList();
    });

    // 监听仓库输入变化
    document.getElementById('repos-waterfall').addEventListener('input', (e) => {
        const index = parseInt(e.target.dataset.index);
        if (isNaN(index)) return;
        if (e.target.classList.contains('repo-desc')) reposList[index].desc = e.target.value;
        if (e.target.classList.contains('repo-url')) reposList[index].url = e.target.value;
        if (e.target.classList.contains('repo-token')) reposList[index].token = e.target.value;
        if (e.target.classList.contains('repo-branch')) reposList[index].default_branch = e.target.value;
        if (e.target.classList.contains('repo-branch-prefix')) reposList[index].branch_prefix = e.target.value;
    });

    renderReposList();

    // 表单提交
    document.getElementById('edit-client-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('client-name').value.trim();
        const isPublic = document.getElementById('client-is-public').value === 'true';
        const agent = document.getElementById('client-agent').value;

        try {
            // 先保存仓库配置（后端会校验文档仓库）
            await clientAPI.updateRepos(id, reposList);
            // 再保存客户端配置
            await clientAPI.update(id, name, [], {
                is_public: isPublic,
                agent: agent
            });
            showToast('客户端更新成功', 'success');
            closeModal();
            loadClients();
        } catch (error) {
            showToast(error.message, 'error');
        }
    });
}

// ===== 任务管理 =====

// 初始化任务筛选控件
function initTaskFilter() {
    const statusFilter = document.getElementById('status-filter');
    const checkboxes = statusFilter.querySelectorAll('input[type="checkbox"]');
    
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            // 更新按钮样式
            const label = checkbox.parentElement;
            if (checkbox.checked) {
                label.classList.add('checked');
            } else {
                label.classList.remove('checked');
            }
            
            // 获取所有选中的值
            currentStatusFilter = Array.from(checkboxes)
                .filter(cb => cb.checked)
                .map(cb => cb.value);
            loadTasks();
        });
    });
}

// 启动任务列表自动刷新
function startTasksAutoRefresh() {
    // 清除已存在的定时器
    stopTasksAutoRefresh();
    
    // 每10秒刷新一次
    tasksRefreshTimer = setInterval(() => {
        loadTasks();
    }, 10000);
}

// 停止任务列表自动刷新
function stopTasksAutoRefresh() {
    if (tasksRefreshTimer) {
        clearInterval(tasksRefreshTimer);
        tasksRefreshTimer = null;
    }
}

async function loadTasks() {
    try {
        const result = await taskAPI.list();
        let allTasks = result.data || [];
        
        // 检测 flow_status 变化并发送通知（使用全部任务，不受筛选影响）
        checkFlowStatusChanges(allTasks);
        
        // 根据状态筛选（仅用于显示）
        let tasks = allTasks;
        if (currentStatusFilter.length > 0) {
            tasks = allTasks.filter(task => currentStatusFilter.includes(task.status));
        }
        
        // 按状态排序：进行中 > 未开始 > 已结束
        const statusOrder = { 'running': 0, 'pending': 1, 'suspended': 2, 'completed': 3 };
        tasks.sort((a, b) => {
            const orderA = statusOrder[a.status] ?? 99;
            const orderB = statusOrder[b.status] ?? 99;
            return orderA - orderB;
        });
        
        renderTasks(tasks);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function renderTasks(tasks) {
    const tbody = document.getElementById('tasks-table-body');
    const emptyState = document.getElementById('tasks-empty');

    if (tasks.length === 0) {
        tbody.innerHTML = '';
        emptyState.classList.add('show');
        return;
    }

    emptyState.classList.remove('show');

    // 缓存任务数据用于弹窗显示
    window.tasksCache = tasks.reduce((acc, t) => { acc[t.id] = t; return acc; }, {});

    tbody.innerHTML = tasks.map(task => {
        // 直接使用后端返回的 flow_status 字段
        const flowStatusText = task.flow_status || '-';
        
        // 判断是否是 client_error 状态，如果是则添加错误提示按钮
        const isClientError = task.flow_status === 'client_error';
        let flowStatusHtml = '';
        if (isClientError) {
            // 从 flow.error 获取错误信息
            const errorMsg = task.flow && task.flow.error ? task.flow.error : '未知错误';
            flowStatusHtml = `<span class="flow-status-error" title="${escapeHtml(errorMsg)}">${flowStatusText} <button class="btn-error-detail" onclick="showClientErrorDetail(${task.id})">查看</button></span>`;
        } else {
            flowStatusHtml = flowStatusText;
        }

        // 审核相关按钮：reviewing 状态显示通过和修订，done 状态显示修订
        const isReviewing = task.flow_status === 'reviewing';
        const isDone = task.flow_status === 'done';
        let reviewButtons = '';
        if (isReviewing) {
            reviewButtons = `<button class="btn-action btn-approve" onclick="approveTask(${task.id})">通过</button>
                <button class="btn-action btn-revise" onclick="showReviseModal(${task.id})">修订</button>`;
        } else if (isDone) {
            reviewButtons = `<button class="btn-action btn-revise" onclick="showReviseModal(${task.id})">修订</button>`;
        }

        return `
        <tr>
            <td><span class="task-id">${task.id}</span></td>
            <td><span class="task-key">${task.key}</span></td>
            <td>${escapeHtml(task.title)}</td>
            <td>
                <select class="status-select status-${task.status}" onchange="updateTaskStatus(${task.id}, this.value, this)">
                    <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>未开始</option>
                    <option value="running" ${task.status === 'running' ? 'selected' : ''}>进行中</option>
                    <option value="suspended" ${task.status === 'suspended' ? 'selected' : ''}>已挂起</option>
                    <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>已结束</option>
                </select>
            </td>
            <td>${task.client_name ? escapeHtml(task.client_name) : '<span class="text-muted">-</span>'}</td>
            <td>${flowStatusHtml}</td>
            <td class="time-display">${formatDateTime(task.created_at)}</td>
            <td class="time-display">${formatDateTime(task.updated_at)}</td>
            <td>
                <button class="btn-action btn-info" onclick="showTaskDetailModal(${task.id})">任务详情</button>
                <button class="btn-action btn-delete" onclick="deleteTask(${task.id})">删除</button>
                <button class="btn-action btn-edit" onclick="showFlowDetailModal(${task.id})">执行详情</button>
                <button class="btn-action btn-reset" onclick="resetTask(${task.id})">重置</button>
                ${isClientError ? `<button class="btn-action btn-retry" onclick="retryTask(${task.id})">重试</button>` : ''}
                ${reviewButtons}
            </td>
        </tr>
    `}).join('');
}

// 解析任务desc为结构化数据（兼容历史数据）
function parseTaskDesc(desc) {
    if (!desc) return { links: [], desc: '' };
    try {
        const parsed = JSON.parse(desc);
        return {
            links: Array.isArray(parsed.links) ? parsed.links : [],
            desc: typeof parsed.desc === 'string' ? parsed.desc : ''
        };
    } catch (e) {
        // JSON解析失败，作为纯文本处理
        return { links: [], desc: desc };
    }
}

// 统一的任务编辑弹窗状态
let taskEditCurrentId = null;  // null 表示新建模式
let taskEditMode = false;      // false 表示查看模式，true 表示编辑模式
let taskEditLinks = [];
let taskEditDesc = '';
let usableClientsCache = [];   // 可用于创建任务的客户端列表

// 显示统一的任务编辑弹窗（创建或编辑）
async function showTaskEditModal(taskId = null, startInEditMode = false) {
    taskEditCurrentId = taskId;
    
    if (taskId) {
        // 查看/编辑模式 - 从缓存获取任务信息
        const task = window.tasksCache && window.tasksCache[taskId];
        if (!task) {
            showToast('无法获取任务信息', 'error');
            return;
        }
        
        const parsedDesc = parseTaskDesc(task.desc);
        taskEditLinks = [...parsedDesc.links];
        taskEditDesc = parsedDesc.desc;
        taskEditMode = startInEditMode;  // 默认查看模式
        
        renderTaskEditModal(task);
    } else {
        // 创建模式 - 初始化空数据并获取可用客户端列表
        taskEditLinks = [];
        taskEditDesc = '';
        taskEditMode = true;  // 创建模式始终是编辑模式
        
        // 获取可用客户端列表
        try {
            const result = await clientAPI.listUsable();
            usableClientsCache = result.data || [];
        } catch (error) {
            console.warn('获取可用客户端列表失败:', error);
            usableClientsCache = [];
        }
        
        renderTaskEditModal(null);
    }
}

// 兼容旧的调用方式
function showTaskDetailModal(taskId) {
    showTaskEditModal(taskId, false);  // 查看模式
}

// 进入编辑模式
async function enterTaskEditMode() {
    taskEditMode = true;
    const task = taskEditCurrentId ? (window.tasksCache && window.tasksCache[taskEditCurrentId]) : null;
    if (task) {
        // 获取可用客户端列表（编辑模式下需要选择客户端）
        try {
            const result = await clientAPI.listUsable();
            usableClientsCache = result.data || [];
        } catch (error) {
            console.warn('获取可用客户端列表失败:', error);
            usableClientsCache = [];
        }
        renderTaskEditModal(task);
    }
}

// 取消编辑
function cancelTaskEdit() {
    if (taskEditCurrentId) {
        // 编辑模式 - 重置数据并返回查看模式
        const task = window.tasksCache && window.tasksCache[taskEditCurrentId];
        if (task) {
            const parsedDesc = parseTaskDesc(task.desc);
            taskEditLinks = [...parsedDesc.links];
            taskEditDesc = parsedDesc.desc;
            taskEditMode = false;
            renderTaskEditModal(task);
        }
    } else {
        closeModal();
    }
}

// 渲染任务编辑弹窗
function renderTaskEditModal(task) {
    const isCreateMode = taskEditCurrentId === null;
    const isEditing = taskEditMode;
    const modalTitle = isCreateMode ? '新建任务' : `任务详情 - ${escapeHtml(task.title)}`;
    
    // 构建客户端和任务类型区域
    let headerInfoHtml = '';
    let titleInputHtml = '';
    
    // 状态选择器文本映射
    const statusText = { pending: '未开始', running: '进行中', suspended: '已挂起', completed: '已结束' };

    if (isCreateMode) {
        // 创建模式 - 可编辑的标题和选择框
        const clientOptions = usableClientsCache.map(c =>
            `<option value="${c.id}" data-types='${JSON.stringify(c.types || [])}'>${escapeHtml(c.name)}</option>`
        ).join('');

        titleInputHtml = `
            <div class="form-group">
                <label>任务标题 <span class="required">*</span></label>
                <input type="text" id="task-edit-title" placeholder="请输入任务标题（最多45字符）" maxlength="45" required>
            </div>
        `;

        headerInfoHtml = `
            <div class="form-row">
                <div class="form-group form-group-half">
                    <label>关联客户端 <span class="required">*</span></label>
                    <select id="task-edit-client" class="status-select" required>
                        <option value="">请选择客户端</option>
                        ${clientOptions}
                    </select>
                </div>
                <div class="form-group form-group-half">
                    <label>任务状态</label>
                    <select id="task-edit-status" class="status-select status-running">
                        <option value="pending">未开始</option>
                        <option value="running" selected>进行中</option>
                        <option value="suspended">已挂起</option>
                        <option value="completed">已结束</option>
                    </select>
                </div>
            </div>
        `;
    } else {
        // 查看/编辑模式 - 只读信息并排显示
        titleInputHtml = `
            <div class="form-group">
                <label>任务标题</label>
                <div class="readonly-field">${escapeHtml(task.title)}</div>
            </div>
        `;

        // 状态区域：编辑模式显示选择框，查看模式显示只读标签
        let statusHtml = '';
        let clientHtml = '';
        if (isEditing) {
            // 编辑模式 - 客户端可选择
            const clientOptions = usableClientsCache.map(c =>
                `<option value="${c.id}" ${c.id === task.client_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
            ).join('');
            
            clientHtml = `
                <div class="form-group form-group-half">
                    <label>关联客户端</label>
                    <select id="task-edit-client" class="status-select">
                        <option value="0" ${!task.client_id ? 'selected' : ''}>不指定客户端</option>
                        ${clientOptions}
                    </select>
                </div>
            `;
            
            statusHtml = `
                <div class="form-group form-group-half">
                    <label>任务状态</label>
                    <select id="task-edit-status" class="status-select status-${task.status}">
                        <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>未开始</option>
                        <option value="running" ${task.status === 'running' ? 'selected' : ''}>进行中</option>
                        <option value="suspended" ${task.status === 'suspended' ? 'selected' : ''}>已挂起</option>
                        <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>已结束</option>
                    </select>
                </div>
            `;
        } else {
            // 查看模式 - 只读
            clientHtml = `
                <div class="form-group form-group-half">
                    <label>关联客户端</label>
                    <div class="readonly-field">${task.client_name ? escapeHtml(task.client_name) : '-'}</div>
                </div>
            `;
            
            statusHtml = `
                <div class="form-group form-group-half">
                    <label>任务状态</label>
                    <div class="readonly-field"><span class="status-tag status-${task.status}">${statusText[task.status] || task.status}</span></div>
                </div>
            `;
        }

        headerInfoHtml = `
            <div class="form-row">
                ${clientHtml}
                ${statusHtml}
            </div>
        `;
    }
    
    // 链接区域
    let linksHtml = '';
    if (isEditing) {
        // 编辑模式 - 可编辑链接
        linksHtml = `
            <div class="form-group">
                <label>相关链接</label>
                <div class="links-editor">
                    <table class="types-table" id="links-table">
                        <thead>
                            <tr>
                                <th>标题</th>
                                <th>链接</th>
                                <th style="width: 80px;">操作</th>
                            </tr>
                        </thead>
                        <tbody id="links-tbody">
                            ${taskEditLinks.map((link, index) => `
                                <tr>
                                    <td><input type="text" class="link-title-input" data-index="${index}" value="${escapeHtml(link.title || '')}" placeholder="链接标题"></td>
                                    <td><input type="text" class="link-url-input" data-index="${index}" value="${escapeHtml(link.url || '')}" placeholder="链接地址"></td>
                                    <td><button type="button" class="btn-small btn-delete" onclick="removeTaskEditLink(${index})">删除</button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <button type="button" class="btn-small btn-add" onclick="addTaskEditLink()" style="margin-top: 8px;">+ 添加链接</button>
                </div>
            </div>
        `;
    } else {
        // 查看模式 - 只读链接
        const linksContent = taskEditLinks.length > 0
            ? `<div class="task-links-list">${taskEditLinks.map(link => 
                `<a href="${escapeHtml(link.url || '#')}" target="_blank" class="task-link-item">${escapeHtml(link.title || link.url || '未命名链接')}</a>`
            ).join('')}</div>`
            : '<span class="text-muted">暂无相关链接</span>';
        
        linksHtml = `
            <div class="form-group">
                <label>相关链接</label>
                ${linksContent}
            </div>
        `;
    }
    
    // 描述区域
    let descHtml = '';
    if (isCreateMode) {
        // 创建模式 - 可编辑描述
        descHtml = `
            <div class="form-group">
                <label>任务描述</label>
                <textarea id="task-edit-desc" placeholder="请输入任务描述">${escapeHtml(taskEditDesc)}</textarea>
            </div>
        `;
    } else {
        // 查看/编辑模式 - 描述只读
        const descContent = taskEditDesc 
            ? `<div class="task-desc-text">${escapeHtml(taskEditDesc)}</div>`
            : '<span class="text-muted">暂无任务描述</span>';
        
        descHtml = `
            <div class="form-group">
                <label>任务描述</label>
                ${descContent}
            </div>
        `;
    }
    
    // 底部按钮
    let actionsHtml = '';
    if (isCreateMode) {
        actionsHtml = `
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
                <button type="button" class="btn-primary" onclick="saveTaskEdit()">创建任务</button>
            </div>
        `;
    } else if (isEditing) {
        actionsHtml = `
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="cancelTaskEdit()">取消</button>
                <button type="button" class="btn-primary" onclick="saveTaskEdit()">保存</button>
            </div>
        `;
    } else {
        actionsHtml = `
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="closeModal()">关闭</button>
                <button type="button" class="btn-primary" onclick="enterTaskEditMode()">编辑</button>
            </div>
        `;
    }
    
    const content = `
        <div class="task-edit-content">
            <div class="task-edit-scroll">
                ${titleInputHtml}
                ${headerInfoHtml}
                ${linksHtml}
                ${descHtml}
            </div>
            ${actionsHtml}
        </div>
    `;
    
    openModal(modalTitle, content, 'modal-task-edit');
    
    // 绑定事件
    if (isEditing) {
        bindTaskEditEvents(isCreateMode);
    }
}

// 绑定任务编辑弹窗事件
function bindTaskEditEvents(isCreateMode) {
    // 绑定链接输入事件
    document.querySelectorAll('.link-title-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            if (taskEditLinks[index]) {
                taskEditLinks[index].title = e.target.value;
            }
        });
    });
    
    document.querySelectorAll('.link-url-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            if (taskEditLinks[index]) {
                taskEditLinks[index].url = e.target.value;
            }
        });
    });
    
    // 创建模式不再需要客户端选择事件，因为任务类型已改为手动输入
}

// 添加链接
function addTaskEditLink() {
    taskEditLinks.push({ title: '', url: '' });
    const task = taskEditCurrentId ? (window.tasksCache && window.tasksCache[taskEditCurrentId]) : null;
    renderTaskEditModal(task);
}

// 删除链接
function removeTaskEditLink(index) {
    taskEditLinks.splice(index, 1);
    const task = taskEditCurrentId ? (window.tasksCache && window.tasksCache[taskEditCurrentId]) : null;
    renderTaskEditModal(task);
}

// 保存任务编辑
async function saveTaskEdit() {
    const isCreateMode = taskEditCurrentId === null;
    
    // 获取描述内容
    const descTextarea = document.getElementById('task-edit-desc');
    if (descTextarea) {
        taskEditDesc = descTextarea.value;
    }
    
    // 过滤掉空的链接
    const validLinks = taskEditLinks.filter(link => link.title || link.url);
    
    // 构建desc JSON
    const descJson = JSON.stringify({
        links: validLinks,
        desc: taskEditDesc
    });
    
    if (isCreateMode) {
        // 创建模式 - 验证并创建
        const title = document.getElementById('task-edit-title')?.value.trim();
        const clientId = document.getElementById('task-edit-client')?.value;
        const type = document.getElementById('task-edit-type')?.value.trim();
        
        if (!title) {
            showToast('请输入任务标题', 'error');
            return;
        }
        
        if (!clientId) {
            showToast('请选择客户端', 'error');
            return;
        }
        
        try {
            const selectedStatus = document.getElementById('task-edit-status')?.value || 'running';
            const parsedClientId = parseInt(clientId);
            await taskAPI.create(title, type, parsedClientId, descJson, selectedStatus);
            showToast('任务创建成功', 'success');
            closeModal();
            loadTasks();
        } catch (error) {
            showToast(error.message, 'error');
        }
    } else {
        // 编辑模式 - 更新客户端和状态（标题和描述不可编辑）
        try {
            const newStatus = document.getElementById('task-edit-status')?.value;
            const newClientId = document.getElementById('task-edit-client')?.value;
            const parsedClientId = newClientId ? parseInt(newClientId) : 0;
            
            // 更新客户端
            await taskAPI.updateClient(taskEditCurrentId, parsedClientId);
            
            // 更新状态
            if (newStatus) {
                await taskAPI.updateStatus(taskEditCurrentId, newStatus);
            }
            
            showToast('任务保存成功', 'success');

            // 更新缓存
            if (window.tasksCache && window.tasksCache[taskEditCurrentId]) {
                window.tasksCache[taskEditCurrentId].client_id = parsedClientId;
                if (newStatus) {
                    window.tasksCache[taskEditCurrentId].status = newStatus;
                }
            }

            closeModal();
            loadTasks();
        } catch (error) {
            showToast('保存失败：' + error.message, 'error');
        }
    }
}

// 删除任务
async function deleteTask(id) {
    if (!confirm('确定要删除这个任务吗？')) {
        return;
    }

    try {
        await taskAPI.delete(id);
        showToast('任务删除成功', 'success');
        loadTasks();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// 重置任务：以当前任务信息创建新任务，然后删除旧任务
async function resetTask(id) {
    // 从缓存获取任务信息
    const task = window.tasksCache && window.tasksCache[id];
    if (!task) {
        showToast('无法获取任务信息', 'error');
        return;
    }

    if (!confirm('确定要重置这个任务吗？将以当前任务信息创建新任务并删除旧任务。')) {
        return;
    }

    try {
        // 1. 创建新任务（使用原任务的标题、描述、客户端、任务类型）
        const createResult = await taskAPI.create(
            task.title,
            task.type,
            task.client_id,
            task.desc || null
        );
        
        const newTaskId = createResult.data.id;
        
        // 2. 如果原任务状态不是默认的 pending，更新新任务的状态
        if (task.status && task.status !== 'pending') {
            await taskAPI.updateStatus(newTaskId, task.status);
        }
        
        // 3. 删除旧任务
        await taskAPI.delete(id);
        
        showToast('任务重置成功', 'success');
        loadTasks();
    } catch (error) {
        showToast('任务重置失败：' + error.message, 'error');
        loadTasks(); // 重新加载以刷新列表状态
    }
}

// 重试任务：将 flow_status 改为 pending
async function retryTask(taskId) {
    try {
        await taskAPI.updateFlow(taskId, null, 'pending');
        showToast('任务已重新加入队列', 'success');
        loadTasks();
    } catch (error) {
        showToast('重试失败：' + error.message, 'error');
    }
}

// 审核通过任务
async function approveTask(taskId) {
    if (!confirm('确定要通过审核吗？')) {
        return;
    }
    
    try {
        await taskAPI.review(taskId, 'approve');
        showToast('审核通过成功', 'success');
        loadTasks();
    } catch (error) {
        showToast('审核通过失败：' + error.message, 'error');
    }
}

// 显示修订反馈弹窗
let reviseTaskId = null;

function showReviseModal(taskId) {
    reviseTaskId = taskId;
    const modal = document.getElementById('revise-modal');
    const textarea = document.getElementById('revise-feedback');
    textarea.value = '';
    modal.classList.add('show');
    textarea.focus();
}

function hideReviseModal() {
    const modal = document.getElementById('revise-modal');
    modal.classList.remove('show');
    reviseTaskId = null;
}

async function submitRevise() {
    const feedback = document.getElementById('revise-feedback').value.trim();
    
    if (!feedback) {
        showToast('请填写反馈内容', 'error');
        return;
    }
    
    try {
        await taskAPI.review(reviseTaskId, 'revise', feedback);
        showToast('已提交修订反馈', 'success');
        hideReviseModal();
        loadTasks();
    } catch (error) {
        showToast('提交修订失败：' + error.message, 'error');
    }
}

// 显示 client_error 错误详情弹窗
function showClientErrorDetail(taskId) {
    const task = window.tasksCache && window.tasksCache[taskId];
    if (!task) {
        showToast('无法获取任务信息', 'error');
        return;
    }
    
    const errorMsg = task.flow && task.flow.error ? task.flow.error : '未知错误';
    
    const content = `
        <div class="error-detail-content">
            <div class="error-detail-icon">⚠️</div>
            <div class="error-detail-title">任务执行异常</div>
            <div class="error-detail-message">
                <pre class="error-pre">${escapeHtml(errorMsg)}</pre>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="closeModal()">关闭</button>
            </div>
        </div>
    `;
    
    openModal('错误详情', content);
}

// 显示执行详情弹窗（显示最新节点信息）
async function showFlowDetailModal(taskId) {
    const task = window.tasksCache && window.tasksCache[taskId];
    if (!task) {
        showToast('无法获取任务信息', 'error');
        return;
    }
    
    // 检查是否有 flow 数据和节点
    const hasNodes = task.flow && task.flow.nodes && task.flow.nodes.length > 0;
    
    if (!hasNodes) {
        const content = `
            <div class="flow-modal-content">
                <div class="flow-modal-empty">
                    <span class="empty-icon">📊</span>
                    <p>该任务暂无执行记录</p>
                </div>
            </div>
        `;
        openModal('执行详情', content, 'modal-flow');
        return;
    }
    
    // 获取最新的节点（数组最后一个）
    const latestNode = task.flow.nodes[task.flow.nodes.length - 1];
    
    // 渲染节点详情
    const nodeDetailHtml = renderNodeDetailForModal(latestNode);
    
    const content = `
        <div class="flow-modal-content">
            <div class="flow-modal-header-info">
                <span class="flow-modal-label">流程状态:</span>
                <span class="flow-status-badge status-${task.flow_status || ''}">${getFlowStatusText(task.flow_status)}</span>
                <span class="flow-modal-label" style="margin-left: 16px;">节点数量:</span>
                <span>${task.flow.nodes.length}</span>
            </div>
            <div class="flow-modal-node-title">
                <span class="node-status-icon">${getNodeStatusIcon(latestNode.status)}</span>
                <span>最新节点: ${escapeHtml(latestNode.label || latestNode.id)}</span>
                <span class="node-status-badge status-${latestNode.status}">${getNodeStatusText(latestNode.status)}</span>
            </div>
            <div class="flow-modal-node-detail">
                ${nodeDetailHtml}
            </div>
        </div>
    `;
    
    openModal('执行详情 - ' + escapeHtml(task.title), content, 'modal-flow');
}

// 渲染节点详情（用于弹窗）
function renderNodeDetailForModal(node) {
    if (!node.fields || node.fields.length === 0) {
        return '<div class="node-panel-empty-fields">暂无字段信息</div>';
    }
    
    // 对字段进行排序，link 类型排在最前面
    const sortedFields = [...node.fields].sort((a, b) => {
        const aIsLink = a.field_type === 'link' || a.fieldType === 'link' ? 0 : 1;
        const bIsLink = b.field_type === 'link' || b.fieldType === 'link' ? 0 : 1;
        return aIsLink - bIsLink;
    });
    
    return sortedFields.map(field => {
        const fieldType = field.field_type || field.fieldType || 'text';
        const fieldLabel = field.label || field.key;
        let valueHtml = '';
        
        switch (fieldType) {
            case 'link':
                // 链接类型
                const linkUrl = field.value || '';
                if (linkUrl) {
                    valueHtml = `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer" class="node-link-btn">🔗 ${escapeHtml(fieldLabel)}</a>`;
                } else {
                    valueHtml = '<span class="text-muted">-</span>';
                }
                break;
                
            case 'link_list':
                // 链接列表类型
                if (Array.isArray(field.value) && field.value.length > 0) {
                    valueHtml = `<div class="node-link-list">${field.value.map(link => {
                        const linkLabel = link.label || link.title || '链接';
                        const linkUrl = link.url || '';
                        return linkUrl ? `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer" class="node-link-btn">🔗 ${escapeHtml(linkLabel)}</a>` : '';
                    }).join('')}</div>`;
                } else {
                    valueHtml = '<span class="text-muted">-</span>';
                }
                break;
                
            case 'table':
                // 表格类型
                valueHtml = renderTableFieldForModal(field.value);
                break;
                
            case 'textarea':
            case 'markdown':
                // 文本区域/Markdown
                valueHtml = `<div class="node-field-html">${parseSimpleMarkdown(field.value || '-')}</div>`;
                break;
                
            default:
                // 默认文本
                valueHtml = `<div class="node-field-html">${parseSimpleMarkdown(String(field.value || '-'))}</div>`;
        }
        
        return `
            <div class="node-field">
                <label class="node-field-label">${escapeHtml(fieldLabel)}</label>
                ${valueHtml}
            </div>
        `;
    }).join('');
}

// 渲染表格字段（用于弹窗）
function renderTableFieldForModal(tableData) {
    if (!tableData || !tableData.headers || !tableData.rows) {
        return '<span class="text-muted">-</span>';
    }
    
    const headers = tableData.headers;
    const rows = tableData.rows;
    
    const headerHtml = headers.map(h => `<th class="node-table-th">${escapeHtml(String(h))}</th>`).join('');
    
    const rowsHtml = rows.map(row => {
        const cells = row.map(cell => {
            return `<td class="node-table-td">${parseSimpleMarkdown(String(cell ?? ''))}</td>`;
        }).join('');
        return `<tr class="node-table-tr">${cells}</tr>`;
    }).join('');
    
    return `
        <div class="node-table-wrapper">
            <table class="node-table">
                <thead class="node-table-thead">
                    <tr class="node-table-tr">${headerHtml}</tr>
                </thead>
                <tbody class="node-table-tbody">
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    `;
}

// 简单的 Markdown 解析
function parseSimpleMarkdown(text) {
    if (!text) return '';
    
    let html = escapeHtml(text);
    
    // 链接: [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // 加粗: **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // 行内代码: `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // 换行
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

// 获取流程状态文本
function getFlowStatusText(status) {
    const texts = {
        '': '无',
        'init': '初始化',
        'ready': '就绪',
        'running': '执行中',
        'paused': '暂停',
        'completed': '已完成',
        'error': '异常',
        'client_error': '客户端异常'
    };
    return texts[status] || status || '无';
}

// 获取节点状态图标
function getNodeStatusIcon(status) {
    const icons = {
        pending: '⏳',
        running: '🔄',
        reviewing: '👀',
        reviewed: '✅',
        revising: '✍️',
        done: '🎉',
        completed: '✅',
        in_progress: '🔄',
        skipped: '⏭️',
        failed: '❌',
        error: '⚠️'
    };
    return icons[status] || '⏳';
}

// 获取节点状态文本
function getNodeStatusText(status) {
    const texts = {
        pending: '待处理',
        running: '进行中',
        reviewing: '待审核',
        reviewed: '已审核',
        revising: '修订中',
        done: '已完成',
        completed: '已完成',
        in_progress: '进行中',
        skipped: '已跳过',
        failed: '失败',
        error: '异常'
    };
    return texts[status] || '待处理';
}

// 兼容旧的调用方式
function showAddTaskModal() {
    showTaskEditModal(null);
}

async function updateTaskStatus(taskId, status, selectElement) {
    try {
        await taskAPI.updateStatus(taskId, status);
        // 更新 select 元素的状态类
        if (selectElement) {
            selectElement.classList.remove('status-pending', 'status-running', 'status-completed');
            selectElement.classList.add('status-' + status);
        }
        showToast('状态更新成功', 'success');
    } catch (error) {
        showToast(error.message, 'error');
        loadTasks(); // 重新加载以恢复正确状态
    }
}


// ===== 待办事项管理 =====

let todosCache = [];
let currentTodoFilter = 'pending'; // 默认显示未完成

async function loadTodos() {
    try {
        const result = await todoAPI.list();
        todosCache = result.data || [];
        renderTodos(getFilteredTodos());
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function getFilteredTodos() {
    if (currentTodoFilter === 'all') {
        return todosCache;
    } else if (currentTodoFilter === 'completed') {
        return todosCache.filter(t => t.completed);
    } else {
        return todosCache.filter(t => !t.completed);
    }
}

function renderTodos(todos) {
    const todoList = document.getElementById('todo-list');
    const emptyState = document.getElementById('todos-empty');

    if (todos.length === 0) {
        todoList.innerHTML = '';
        emptyState.classList.add('show');
        return;
    }

    emptyState.classList.remove('show');

    todoList.innerHTML = todos.map(todo => `
        <div class="todo-item ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
            <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''} onchange="toggleTodoComplete(${todo.id}, this.checked)">
            <span class="todo-content" onclick="startEditTodo(${todo.id})">${escapeHtml(todo.content)}</span>
            <button class="todo-delete" onclick="deleteTodo(${todo.id})">删除</button>
        </div>
    `).join('');
}

async function addTodo() {
    const input = document.getElementById('new-todo-input');
    const content = input.value.trim();

    if (!content) {
        showToast('请输入待办内容', 'error');
        return;
    }

    try {
        await todoAPI.create(content);
        input.value = '';
        loadTodos();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function toggleTodoComplete(id, completed) {
    try {
        await todoAPI.update(id, null, completed);
        loadTodos();
    } catch (error) {
        showToast(error.message, 'error');
        loadTodos();
    }
}

function startEditTodo(id) {
    const todo = todosCache.find(t => t.id === id);
    if (!todo) return;

    const todoItem = document.querySelector(`.todo-item[data-id="${id}"]`);
    const contentSpan = todoItem.querySelector('.todo-content');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'todo-content-input';
    input.value = todo.content;
    input.maxLength = 500;

    const saveEdit = async () => {
        const newContent = input.value.trim();
        if (newContent && newContent !== todo.content) {
            try {
                await todoAPI.update(id, newContent, null);
                loadTodos();
            } catch (error) {
                showToast(error.message, 'error');
                loadTodos();
            }
        } else {
            loadTodos();
        }
    };

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        }
        if (e.key === 'Escape') {
            loadTodos();
        }
    });

    contentSpan.replaceWith(input);
    input.focus();
    input.select();
}

async function deleteTodo(id) {
    try {
        await todoAPI.delete(id);
        loadTodos();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function initTodos() {
    const addBtn = document.getElementById('add-todo-btn');
    const input = document.getElementById('new-todo-input');

    if (addBtn) {
        addBtn.addEventListener('click', addTodo);
    }

    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addTodo();
            }
        });
    }

    // 初始化筛选控件
    initTodoFilter();
}

function initTodoFilter() {
    const todoFilter = document.getElementById('todo-filter');
    if (!todoFilter) return;

    const radios = todoFilter.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => {
        // 设置初始选中状态的样式
        if (radio.checked) {
            radio.parentElement.classList.add('checked');
        }

        radio.addEventListener('change', () => {
            // 更新样式
            radios.forEach(r => r.parentElement.classList.remove('checked'));
            radio.parentElement.classList.add('checked');

            // 更新筛选值并重新渲染
            currentTodoFilter = radio.value;
            renderTodos(getFilteredTodos());
        });
    });
}

// ===== 秘钥管理 =====

let secretsCache = [];

async function loadSecrets() {
    try {
        const result = await secretAPI.list();
        secretsCache = result.data || [];
        renderSecrets(secretsCache);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function renderSecrets(secrets) {
    const tbody = document.getElementById('secrets-table-body');
    const emptyState = document.getElementById('secrets-empty');

    if (!tbody) return;

    if (secrets.length === 0) {
        tbody.innerHTML = '';
        emptyState.classList.add('show');
        return;
    }

    emptyState.classList.remove('show');

    tbody.innerHTML = secrets.map(secret => `
        <tr>
            <td>${escapeHtml(secret.name)}</td>
            <td><code style="font-size: 12px; word-break: break-all;">${escapeHtml(secret.secret)}</code></td>
            <td class="time-display">${formatDateTime(secret.created_at)}</td>
            <td>
                <button class="btn-action btn-delete" onclick="deleteSecret(${secret.id})">删除</button>
            </td>
        </tr>
    `).join('');
}

async function deleteSecret(id) {
    if (!confirm('确定要删除这个秘钥吗？')) return;

    try {
        await secretAPI.delete(id);
        showToast('秘钥删除成功', 'success');
        loadSecrets();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function showAddSecretModal() {
    const content = `
        <form id="add-secret-form">
            <div class="form-group">
                <label>秘钥名称</label>
                <input type="text" id="secret-name" placeholder="请输入秘钥名称" maxlength="64" required>
            </div>
            <button type="submit" class="btn-primary">创建</button>
        </form>
    `;

    openModal('新增秘钥', content);

    document.getElementById('add-secret-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('secret-name').value.trim();

        try {
            await secretAPI.create(name);
            showToast('秘钥创建成功', 'success');
            closeModal();
            loadSecrets();
        } catch (error) {
            showToast(error.message, 'error');
        }
    });
}

function initSecrets() {
    const addBtn = document.getElementById('add-secret-btn');
    if (addBtn) {
        addBtn.addEventListener('click', showAddSecretModal);
    }
}

// ===== 工具函数 =====

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

