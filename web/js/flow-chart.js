/**
 * 流程图组件 - 纯 JS 实现
 * 支持 DAG 自动布局、节点状态、右侧面板编辑
 */

class FlowChart {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' 
            ? document.querySelector(container) 
            : container;
        this.options = {
            readonly: false,
            nodeWidth: 220,
            nodeHeight: 80,
            horizontalGap: 100,
            verticalGap: 80,
            ...options
        };
        this.flow = { nodes: [], edges: [] };
        this.onNodeClick = options.onNodeClick || null;
        this.onNodeUpdate = options.onNodeUpdate || null;
        this.selectedNodeId = null;
    }

    /**
     * 设置流程数据
     */
    setData(flow) {
        this.flow = flow || { nodes: [], edges: [] };
        this.render();
    }

    /**
     * 获取当前流程数据
     */
    getData() {
        return this.flow;
    }

    /**
     * 获取选中的节点
     */
    getSelectedNode() {
        if (!this.selectedNodeId) return null;
        return this.flow.nodes.find(n => n.id === this.selectedNodeId);
    }

    /**
     * 渲染流程图
     */
    render() {
        if (!this.container) return;

        // 计算节点位置（DAG 自动布局）
        this.calculateLayout();

        // 构建 HTML
        const html = `
            <div class="flow-chart-canvas">
                <svg class="flow-chart-edges"></svg>
                <div class="flow-chart-nodes">
                    ${this.flow.nodes.map(node => this.renderNode(node)).join('')}
                </div>
            </div>
        `;

        this.container.innerHTML = html;

        // 渲染连接线
        this.renderEdges();

        // 绑定事件
        this.bindEvents();
    }

    /**
     * 计算 DAG 布局（拓扑排序 + 分层）- 垂直布局（从上到下）
     */
    calculateLayout() {
        if (!this.flow.nodes.length) return;

        const nodeMap = new Map();
        const inDegree = new Map();
        const children = new Map();

        // 初始化
        this.flow.nodes.forEach(node => {
            nodeMap.set(node.id, node);
            inDegree.set(node.id, 0);
            children.set(node.id, []);
        });

        // 根据 edges 计算入度和子节点
        this.flow.edges.forEach(edge => {
            const count = inDegree.get(edge.target) || 0;
            inDegree.set(edge.target, count + 1);
            const childList = children.get(edge.source) || [];
            childList.push(edge.target);
            children.set(edge.source, childList);
        });

        // BFS 分层
        const levels = [];
        const visited = new Set();
        
        // 找到所有入度为 0 的节点作为起始层
        let currentLevel = [];
        inDegree.forEach((degree, nodeId) => {
            if (degree === 0) currentLevel.push(nodeId);
        });

        while (currentLevel.length > 0) {
            levels.push(currentLevel);
            currentLevel.forEach(id => visited.add(id));

            const nextLevel = [];
            currentLevel.forEach(nodeId => {
                const childNodes = children.get(nodeId) || [];
                childNodes.forEach(childId => {
                    if (!visited.has(childId) && !nextLevel.includes(childId)) {
                        // 检查所有父节点是否已访问
                        const allParentsVisited = this.flow.edges
                            .filter(e => e.target === childId)
                            .every(e => visited.has(e.source));
                        if (allParentsVisited) {
                            nextLevel.push(childId);
                        }
                    }
                });
            });
            currentLevel = nextLevel;
        }

        // 添加未访问的节点（处理孤立节点）
        this.flow.nodes.forEach(node => {
            if (!visited.has(node.id)) {
                if (levels.length === 0) levels.push([]);
                levels[levels.length - 1].push(node.id);
            }
        });

        // 计算位置（从上到下布局 - 垂直方向）
        const { nodeWidth, nodeHeight, horizontalGap, verticalGap } = this.options;
        
        levels.forEach((levelNodes, levelIndex) => {
            // 计算当前层的总宽度
            const totalWidth = levelNodes.length * nodeWidth + (levelNodes.length - 1) * horizontalGap;
            // 居中起始X位置
            const startX = Math.max(40, (800 - totalWidth) / 2);

            levelNodes.forEach((nodeId, nodeIndex) => {
                const node = nodeMap.get(nodeId);
                if (node) {
                    node.position = {
                        x: startX + nodeIndex * (nodeWidth + horizontalGap),
                        y: 40 + levelIndex * (nodeHeight + verticalGap)
                    };
                }
            });
        });
    }

    /**
     * 渲染单个节点
     */
    renderNode(node) {
        const statusClass = `flow-node-${node.status || 'pending'}`;
        const selectedClass = this.selectedNodeId === node.id ? 'flow-node-selected' : '';
        const style = node.position 
            ? `left: ${node.position.x}px; top: ${node.position.y}px;` 
            : '';

        return `
            <div class="flow-node ${statusClass} ${selectedClass}" 
                 data-node-id="${node.id}" 
                 style="${style}">
                <div class="flow-node-content">
                    <span class="flow-node-status-icon">${this.getStatusIcon(node.status)}</span>
                    <span class="flow-node-label">${this.escapeHtml(node.label || node.id)}</span>
                </div>
                <div class="flow-node-status-badge">${this.getStatusText(node.status)}</div>
            </div>
        `;
    }

    /**
     * 渲染连接线（贝塞尔曲线）- 垂直方向（从上到下）
     */
    renderEdges() {
        const svg = this.container.querySelector('.flow-chart-edges');
        if (!svg) return;

        const nodeElements = this.container.querySelectorAll('.flow-node');
        const nodePositions = new Map();
        const canvas = this.container.querySelector('.flow-chart-canvas');
        const containerRect = canvas.getBoundingClientRect();

        nodeElements.forEach(el => {
            const nodeId = el.dataset.nodeId;
            const rect = el.getBoundingClientRect();
            
            nodePositions.set(nodeId, {
                x: rect.left - containerRect.left,
                y: rect.top - containerRect.top,
                width: rect.width,
                height: rect.height
            });
        });

        // 绘制边（从底部连接到顶部 - 垂直方向）
        let pathsHtml = '';
        this.flow.edges.forEach(edge => {
            const source = nodePositions.get(edge.source);
            const target = nodePositions.get(edge.target);

            if (source && target) {
                // 起点：源节点底部中心
                const startX = source.x + source.width / 2;
                const startY = source.y + source.height;
                // 终点：目标节点顶部中心
                const endX = target.x + target.width / 2;
                const endY = target.y;

                // 垂直贝塞尔曲线控制点
                const cpOffset = Math.min(50, (endY - startY) / 2);
                const path = `M ${startX} ${startY} C ${startX} ${startY + cpOffset}, ${endX} ${endY - cpOffset}, ${endX} ${endY}`;

                pathsHtml += `
                    <path class="flow-edge" d="${path}" 
                          marker-end="url(#arrowhead)"
                          data-source="${edge.source}" 
                          data-target="${edge.target}"/>
                `;
            }
        });

        svg.innerHTML = `
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" 
                        refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#64748b"/>
                </marker>
            </defs>
            ${pathsHtml}
        `;

        // 设置 SVG 尺寸
        svg.style.width = canvas.scrollWidth + 'px';
        svg.style.height = canvas.scrollHeight + 'px';
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // 节点点击
        this.container.querySelectorAll('.flow-node').forEach(el => {
            el.addEventListener('click', (e) => {
                const nodeId = el.dataset.nodeId;
                this.selectNode(nodeId);
                if (this.onNodeClick) {
                    const node = this.flow.nodes.find(n => n.id === nodeId);
                    this.onNodeClick(node);
                }
            });
        });
    }

    /**
     * 选中节点
     */
    selectNode(nodeId) {
        this.selectedNodeId = nodeId;
        this.container.querySelectorAll('.flow-node').forEach(el => {
            el.classList.toggle('flow-node-selected', el.dataset.nodeId === nodeId);
        });
    }

    /**
     * 更新节点数据
     */
    updateNode(nodeId, updates) {
        const node = this.flow.nodes.find(n => n.id === nodeId);
        if (node) {
            Object.assign(node, updates);
            this.render();
            // 保持选中状态
            if (this.selectedNodeId === nodeId) {
                this.selectNode(nodeId);
            }
            if (this.onNodeUpdate) {
                this.onNodeUpdate(node, this.flow);
            }
        }
    }

    /**
     * 更新节点字段值
     */
    updateNodeField(nodeId, fieldKey, value) {
        const node = this.flow.nodes.find(n => n.id === nodeId);
        if (node && node.fields) {
            const field = node.fields.find(f => f.key === fieldKey);
            if (field) {
                field.value = value;
                if (this.onNodeUpdate) {
                    this.onNodeUpdate(node, this.flow);
                }
            }
        }
    }

    /**
     * 获取状态图标
     */
    getStatusIcon(status) {
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

    /**
     * 获取状态文本
     */
    getStatusText(status) {
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

    /**
     * HTML 转义
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 导出到全局
window.FlowChart = FlowChart;


/**
 * 节点详情面板组件
 */
class NodeDetailPanel {
    constructor(container, options = {}) {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;
        this.options = {
            readonly: false,
            onFieldChange: null,
            onStatusChange: null,
            ...options
        };
        this.currentNode = null;
    }

    /**
     * 设置当前节点
     */
    setNode(node) {
        this.currentNode = node;
        this.render();
    }

    /**
     * 清空面板
     */
    clear() {
        this.currentNode = null;
        if (this.container) {
            this.container.innerHTML = `
                <div class="node-panel-empty">
                    <span class="empty-icon">👆</span>
                    <p>点击左侧节点查看详情</p>
                </div>
            `;
        }
    }

    /**
     * 设置只读模式
     */
    setReadonly(readonly) {
        this.options.readonly = readonly;
    }

    /**
     * 渲染面板
     */
    render() {
        if (!this.container || !this.currentNode) {
            this.clear();
            return;
        }

        const node = this.currentNode;
        const isEditable = !this.options.readonly;

        const fieldsHtml = this.renderFields(node.fields || [], isEditable);
        const statusOptions = [
            { value: 'pending', label: '待处理' },
            { value: 'running', label: '进行中' },
            { value: 'reviewing', label: '待审核' },
            { value: 'reviewed', label: '已审核' },
            { value: 'revising', label: '修订中' },
            { value: 'done', label: '已完成' },
            { value: 'error', label: '异常' }
        ];

        this.container.innerHTML = `
            <div class="node-panel">
                <div class="node-panel-header">
                    <div class="node-panel-icon">${this.getStatusIcon(node.status)}</div>
                    <div class="node-panel-info">
                        <h3 class="node-panel-title">${this.escapeHtml(node.label || node.id)}</h3>
                        <span class="node-panel-id">ID: ${this.escapeHtml(node.id)}</span>
                    </div>
                </div>
                
                <div class="node-panel-section">
                    <label class="node-panel-label">节点状态</label>
                    ${isEditable ? `
                        <select class="node-panel-select" data-field="status">
                            ${statusOptions.map(opt => `
                                <option value="${opt.value}" ${node.status === opt.value ? 'selected' : ''}>
                                    ${opt.label}
                                </option>
                            `).join('')}
                        </select>
                    ` : `
                        <div class="node-panel-value status-badge status-${node.status}">
                            ${this.getStatusText(node.status)}
                        </div>
                    `}
                </div>

                ${node.pre_node ? `
                    <div class="node-panel-section">
                        <label class="node-panel-label">前置节点</label>
                        <div class="node-panel-value">${this.escapeHtml(node.pre_node)}</div>
                    </div>
                ` : ''}

                <div class="node-panel-divider"></div>

                <div class="node-panel-section">
                    <label class="node-panel-label section-title">节点字段</label>
                    ${fieldsHtml || '<div class="node-panel-empty-fields">暂无字段配置</div>'}
                </div>
            </div>
        `;

        this.bindEvents();
    }

    /**
     * 渲染字段列表
     */
    renderFields(fields, isEditable) {
        if (!fields || fields.length === 0) return '';

        // 对字段进行排序，link 类型排在最前面
        const sortedFields = [...fields].sort((a, b) => {
            const aIsLink = a.fieldType === 'link' ? 0 : 1;
            const bIsLink = b.fieldType === 'link' ? 0 : 1;
            return aIsLink - bIsLink;
        });

        // 获取当前节点状态
        const nodeStatus = this.currentNode?.status;

        return sortedFields.map(field => {
            const fieldId = `field-${field.key}`;
            let inputHtml = '';

            // 特殊处理：feedback 字段只在编辑模式+revising状态下可编辑
            const isFeedbackField = field.key === 'feedback';
            const fieldEditable = isFeedbackField 
                ? (isEditable && nodeStatus === 'revising')  // feedback: 编辑模式 + revising 状态才可编辑
                : isEditable;                                 // 其他字段遵循原有逻辑

            switch (field.fieldType) {
                case 'text':
                    inputHtml = fieldEditable
                        ? `<input type="text" id="${fieldId}" class="node-field-input" 
                             data-field-key="${field.key}"
                             value="${this.escapeHtml(field.value || '')}" 
                             placeholder="请输入${field.label || field.key}">`
                        : `<div class="node-field-html">${this.parseMarkdown(field.value || '-')}</div>`;
                    break;

                case 'number':
                    inputHtml = fieldEditable
                        ? `<input type="number" id="${fieldId}" class="node-field-input" 
                             data-field-key="${field.key}"
                             value="${field.value || ''}" 
                             placeholder="请输入${field.label || field.key}">`
                        : `<span class="node-field-value">${field.value !== undefined ? field.value : '-'}</span>`;
                    break;

                case 'textarea':
                    inputHtml = fieldEditable
                        ? `<textarea id="${fieldId}" class="node-field-textarea" 
                             data-field-key="${field.key}"
                             placeholder="请输入${field.label || field.key}">${this.escapeHtml(field.value || '')}</textarea>`
                        : `<div class="node-field-html">${this.parseMarkdown(field.value || '-')}</div>`;
                    break;

                case 'select':
                    if (fieldEditable && field.choices) {
                        inputHtml = `<select id="${fieldId}" class="node-field-select" data-field-key="${field.key}">
                            <option value="">请选择</option>
                            ${field.choices.map(choice => `
                                <option value="${this.escapeHtml(choice.value)}" ${field.value === choice.value ? 'selected' : ''}>
                                    ${this.escapeHtml(choice.label)}
                                </option>
                            `).join('')}
                        </select>`;
                    } else {
                        const selectedChoice = field.choices?.find(c => c.value === field.value);
                        inputHtml = `<span class="node-field-value">${this.escapeHtml(selectedChoice?.label || field.value || '-')}</span>`;
                    }
                    break;

                case 'table':
                    inputHtml = this.renderTableField(field, fieldEditable);
                    break;

                case 'link':
                    // 超链接类型
                    // 编辑模式：展示链接原本的文本内容
                    // 非编辑模式：展示以 label 为标题的跳转按钮
                    if (fieldEditable) {
                        inputHtml = `<input type="url" id="${fieldId}" class="node-field-input" 
                             data-field-key="${field.key}"
                             value="${this.escapeHtml(field.value || '')}" 
                             placeholder="请输入链接地址">`;
                    } else {
                        const linkUrl = field.value || '';
                        if (linkUrl) {
                            inputHtml = `<a href="${this.escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer" class="node-link-btn">
                                🔗 ${this.escapeHtml(field.label || field.key)}
                            </a>`;
                        } else {
                            inputHtml = `<span class="node-field-value">-</span>`;
                        }
                    }
                    break;

                case 'html':
                case 'richtext':
                    // HTML富文本类型 - 直接渲染HTML内容（支持超链接等）
                    inputHtml = `<div class="node-field-html">${this.sanitizeHtml(field.value || '-')}</div>`;
                    break;

                case 'markdown':
                    // Markdown格式 - 解析Markdown并渲染为HTML
                    inputHtml = `<div class="node-field-html">${this.parseMarkdown(field.value || '-')}</div>`;
                    break;

                default:
                    // 默认也支持Markdown链接解析
                    inputHtml = `<div class="node-field-html">${this.parseMarkdown(field.value || '-')}</div>`;
            }

            return `
                <div class="node-field ${field.required ? 'node-field-required' : ''}">
                    <label class="node-field-label">${this.escapeHtml(field.label || field.key)}</label>
                    ${inputHtml}
                </div>
            `;
        }).join('');
    }

    /**
     * 安全处理 HTML 内容 - 允许常用标签，过滤危险内容
     */
    sanitizeHtml(html) {
        if (!html) return '';
        
        // 创建临时容器
        const temp = document.createElement('div');
        temp.innerHTML = html;
        
        // 允许的标签列表
        const allowedTags = ['a', 'b', 'strong', 'i', 'em', 'u', 'br', 'p', 'span', 'div', 'ul', 'ol', 'li', 'code', 'pre'];
        
        // 递归清理节点
        const sanitizeNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return;
            }
            
            if (node.nodeType === Node.ELEMENT_NODE) {
                const tagName = node.tagName.toLowerCase();
                
                // 移除不允许的标签（保留内容）
                if (!allowedTags.includes(tagName)) {
                    const parent = node.parentNode;
                    while (node.firstChild) {
                        parent.insertBefore(node.firstChild, node);
                    }
                    parent.removeChild(node);
                    return;
                }
                
                // 处理 a 标签 - 确保在新窗口打开并添加安全属性
                if (tagName === 'a') {
                    node.setAttribute('target', '_blank');
                    node.setAttribute('rel', 'noopener noreferrer');
                    // 只保留 href 属性
                    const href = node.getAttribute('href');
                    // 移除所有属性
                    while (node.attributes.length > 0) {
                        node.removeAttribute(node.attributes[0].name);
                    }
                    // 重新设置允许的属性
                    if (href) node.setAttribute('href', href);
                    node.setAttribute('target', '_blank');
                    node.setAttribute('rel', 'noopener noreferrer');
                }
                
                // 移除所有事件属性（onclick等）
                const attrs = Array.from(node.attributes);
                attrs.forEach(attr => {
                    if (attr.name.startsWith('on') || attr.name === 'style') {
                        node.removeAttribute(attr.name);
                    }
                });
                
                // 递归处理子节点
                Array.from(node.childNodes).forEach(child => sanitizeNode(child));
            }
        };
        
        Array.from(temp.childNodes).forEach(child => sanitizeNode(child));
        
        return temp.innerHTML;
    }

    /**
     * 解析 Markdown 为 HTML
     */
    parseMarkdown(text) {
        if (!text) return '';
        
        let html = this.escapeHtml(text);
        
        // 先提取链接，用占位符替换，避免URL中的特殊字符被后续规则处理
        // 使用不含下划线和星号的占位符
        const links = [];
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
            const placeholder = `\x00LINK${links.length}\x00`;
            links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${linkText}</a>`);
            return placeholder;
        });
        
        // 行内代码: `code` (先处理，避免代码块内容被其他规则影响)
        const codes = [];
        html = html.replace(/`([^`]+)`/g, (match, code) => {
            const placeholder = `\x00CODE${codes.length}\x00`;
            codes.push(`<code>${code}</code>`);
            return placeholder;
        });
        
        // 加粗: **text** 或 __text__
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        
        // 斜体: *text* (不再支持 _text_ 以避免 snake_case 变量名/分支名中的下划线被误解析)
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        
        // 换行
        html = html.replace(/\n/g, '<br>');
        
        // 还原代码块
        codes.forEach((code, i) => {
            html = html.replace(`\x00CODE${i}\x00`, code);
        });
        
        // 还原链接
        links.forEach((link, i) => {
            html = html.replace(`\x00LINK${i}\x00`, link);
        });
        
        return html;
    }

    /**
     * 渲染表格类型字段
     */
    renderTableField(field, isEditable = false) {
        const tableData = field.value;

        // 如果没有表格数据，显示占位符
        if (!tableData || !tableData.headers || !tableData.rows) {
            return '<span class="node-field-value">-</span>';
        }

        const headers = tableData.headers;
        const rows = tableData.rows;
        const fieldKey = field.key;

        const headerHtml = headers.map(h => `<th class="node-table-th">${this.escapeHtml(String(h))}</th>`).join('');

        const rowsHtml = rows.map((row, rowIndex) => {
            const cells = row.map((cell, colIndex) => {
                if (isEditable) {
                    // 编辑模式：使用 input 允许修改
                    return `<td class="node-table-td">
                        <input type="text"
                            class="node-table-input"
                            data-table-field="${fieldKey}"
                            data-row="${rowIndex}"
                            data-col="${colIndex}"
                            value="${this.escapeHtml(String(cell ?? ''))}"
                        />
                    </td>`;
                } else {
                    // 只读模式：解析 Markdown 渲染富文本
                    return `<td class="node-table-td">${this.parseMarkdown(String(cell ?? ''))}</td>`;
                }
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

    /**
     * 绑定事件
     */
    bindEvents() {
        if (!this.container) return;

        // 状态选择变更
        const statusSelect = this.container.querySelector('[data-field="status"]');
        if (statusSelect) {
            statusSelect.addEventListener('change', (e) => {
                if (this.options.onStatusChange && this.currentNode) {
                    this.options.onStatusChange(this.currentNode.id, e.target.value);
                }
            });
        }

        // 字段输入变更
        this.container.querySelectorAll('[data-field-key]').forEach(input => {
            const eventType = input.tagName === 'SELECT' ? 'change' : 'input';
            input.addEventListener(eventType, (e) => {
                if (this.options.onFieldChange && this.currentNode) {
                    this.options.onFieldChange(this.currentNode.id, input.dataset.fieldKey, e.target.value);
                }
            });
        });

        // 表格单元格输入变更
        this.container.querySelectorAll('.node-table-input').forEach(input => {
            input.addEventListener('input', (e) => {
                if (this.options.onFieldChange && this.currentNode) {
                    const fieldKey = input.dataset.tableField;
                    const rowIndex = parseInt(input.dataset.row, 10);
                    const colIndex = parseInt(input.dataset.col, 10);

                    // 找到对应字段并更新
                    const field = this.currentNode.fields?.find(f => f.key === fieldKey);
                    if (field && field.value && field.value.rows) {
                        field.value.rows[rowIndex][colIndex] = e.target.value;
                        // 通知变更（传递整个 table value）
                        this.options.onFieldChange(this.currentNode.id, fieldKey, field.value);
                    }
                }
            });
        });
    }

    /**
     * 获取状态图标
     */
    getStatusIcon(status) {
        const icons = {
            pending: '⏳',
            running: '🔄',
            reviewing: '👀',
            reviewed: '✅',
            revising: '✍️',
            done: '🎉',
            completed: '✅',
            in_progress: '🔄',
            error: '⚠️'
        };
        return icons[status] || '⏳';
    }

    /**
     * 获取状态文本
     */
    getStatusText(status) {
        const texts = {
            pending: '待处理',
            running: '进行中',
            reviewing: '待审核',
            reviewed: '已审核',
            revising: '修订中',
            done: '已完成',
            completed: '已完成',
            in_progress: '进行中',
            error: '异常'
        };
        return texts[status] || '待处理';
    }

    /**
     * HTML 转义
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 导出到全局
window.NodeDetailPanel = NodeDetailPanel;
