/* 文件核对工具 - 前端交互逻辑 */

const API = {
    uploadChecklist: "/api/upload-checklist",
    scanFolder: "/api/scan-folder",
    match: "/api/match",
    updateStatus: "/api/update-status",
    setNameColumn: "/api/set-name-column",
    manualMatch: "/api/manual-match",
    folderTree: "/api/folder-tree",
    export: "/api/export",
    llmMatch: "/api/llm-match",
};

// 全局状态
let checklistData = null;
let matchResults = null;
let scannedCount = 0;
let scanRoot = "";
let showCols = null;           // null=全部显示，或 Set 存储可见列索引
let colFilters = {};           // 列筛选条件 {colIdx: keyword}
let statusFilter = "all";      // "all" | "yes" | "no"

// 页面初始化
document.addEventListener("DOMContentLoaded", () => {
    initUploadArea();
    initFolderInput();
    initMatchControls();
    initNameColSelector();
    initTreeToggle();
    initColToggle();
    initStatusFilter();
    initLlmPanel();
});

// ====== 清单上传 ======

function initUploadArea() {
    const area = document.getElementById("upload-area");
    const input = document.getElementById("checklist-input");
    area.addEventListener("click", () => input.click());
    area.addEventListener("dragover", (e) => { e.preventDefault(); area.classList.add("dragover"); });
    area.addEventListener("dragleave", () => area.classList.remove("dragover"));
    area.addEventListener("drop", (e) => {
        e.preventDefault();
        area.classList.remove("dragover");
        if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files[0]);
    });
    input.addEventListener("change", () => {
        if (input.files.length) handleFileUpload(input.files[0]);
    });
}

function handleFileUpload(file) {
    if (!file.name.endsWith(".xlsx")) { showToast("仅支持.xlsx格式文件", "error"); return; }
    const formData = new FormData();
    formData.append("file", file);
    fetch(API.uploadChecklist, { method: "POST", body: formData })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) { showToast(data.error, "error"); return; }
            checklistData = data;
            matchResults = null;
            updateUploadUI(file.name, data);
            populateNameColSelect(data);
            renderMainTable();
            showToast(`清单已加载，共 ${data.total} 项`, "success");
        })
        .catch((err) => showToast("上传失败: " + err.message, "error"));
}

function updateUploadUI(filename, data) {
    const area = document.getElementById("upload-area");
    area.classList.add("loaded");
    area.innerHTML = `<div class="upload-icon">&#9989;</div><p class="filename">${filename}</p><p>共 ${data.total} 项文件</p>`;
    document.getElementById("checklist-badge").textContent = `${data.total}项`;
}

// ====== 名称列选择 ======

function initNameColSelector() {
    document.getElementById("name-col-select").addEventListener("change", () => {
        setNameColumn(parseInt(document.getElementById("name-col-select").value));
    });
}

function populateNameColSelect(data) {
    const selector = document.getElementById("name-col-selector");
    const select = document.getElementById("name-col-select");
    const hint = document.getElementById("name-col-hint");
    selector.classList.remove("hidden");
    select.innerHTML = "";
    data.headers.forEach((h, i) => {
        const hasData = data.data.some((row) => row[i] && row[i].trim());
        if (!h.trim() && !hasData) return;
        const option = document.createElement("option");
        option.value = i;
        option.textContent = `第${i + 1}列: ${h}`;
        if (i === data.name_col_index) option.selected = true;
        select.appendChild(option);
    });
    hint.textContent = `(自动识别: 第${data.name_col_index + 1}列 "${data.headers[data.name_col_index]}")`;
}

function setNameColumn(newIndex) {
    if (!checklistData) return;
    fetch(API.setNameColumn, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name_col_index: newIndex }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) { showToast(data.error, "error"); return; }
            checklistData.name_col_index = newIndex;
            checklistData.items = data.items;
            matchResults = data.results.length ? data.results : null;
            renderMainTable();
            if (matchResults) {
                updateStats(data.matched_count, data.total);
                document.getElementById("export-btn").classList.remove("hidden");
            }
            if (scanRoot) loadFileTree(scanRoot);
            showToast(`名称列已切换为第${newIndex + 1}列`, "success");
        })
        .catch((err) => showToast("切换失败: " + err.message, "error"));
}

// ====== 文件夹扫描 ======

function initFolderInput() {
    document.getElementById("scan-btn").addEventListener("click", () => scanFolder());
}

function scanFolder() {
    const folderPath = document.getElementById("folder-path").value.trim();
    if (!folderPath) { showToast("请输入文件夹路径", "error"); return; }
    fetch(API.scanFolder, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: folderPath }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) { showToast(data.error, "error"); return; }
            scannedCount = data.scanned_count;
            scanRoot = data.root_path || folderPath;
            document.getElementById("scan-info").classList.remove("hidden");
            document.getElementById("scan-info").textContent = `已扫描 ${data.scanned_count} 个文件`;
            document.getElementById("folder-badge").textContent = `${data.scanned_count}个文件`;
            if (data.results && data.results.length) {
                matchResults = data.results;
                renderMainTable();
                updateStats(data.matched_count, data.total);
                document.getElementById("export-btn").classList.remove("hidden");
                loadFileTree(scanRoot);
            }
            showToast(`已扫描 ${data.scanned_count} 个文件`, "success");
        })
        .catch((err) => showToast("扫描失败: " + err.message, "error"));
}

// ====== 匹配控制 ======

function initMatchControls() {
    document.getElementById("match-btn").addEventListener("click", () => doMatch());
    document.getElementById("export-btn").addEventListener("click", () => exportExcel());
}

function doMatch() {
    const mode = document.getElementById("match-mode").value;
    if (!checklistData) { showToast("请先上传清单文件", "error"); return; }
    if (!scannedCount) { showToast("请先扫描目标文件夹", "error"); return; }
    fetch(API.match, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) { showToast(data.error, "error"); return; }
            matchResults = data.results;
            scanRoot = data.root_path || scanRoot;
            renderMainTable();
            updateStats(data.matched_count, data.total);
            document.getElementById("export-btn").classList.remove("hidden");
            loadFileTree(scanRoot);
            showToast(`匹配完成: ${data.matched_count}/${data.total} 已获取`, "success");
        })
        .catch((err) => showToast("匹配失败: " + err.message, "error"));
}

// ====== 统一表格渲染 ======

function renderMainTable() {
    if (!checklistData) {
        document.getElementById("split-view").classList.add("hidden");
        document.getElementById("empty-state").classList.remove("hidden");
        return;
    }
    document.getElementById("split-view").classList.remove("hidden");
    document.getElementById("empty-state").classList.add("hidden");

    const thead = document.getElementById("main-table-head");
    const tbody = document.getElementById("main-table-body");
    const headers = checklistData.headers;
    const data = checklistData.data;
    const hasMatch = matchResults && matchResults.length > 0;

    // 显示状态筛选栏（有匹配结果时）
    const filterBar = document.getElementById("status-filter-bar");
    if (hasMatch) {
        filterBar.classList.remove("hidden");
    } else {
        filterBar.classList.add("hidden");
        statusFilter = "all";
    }

    const validCols = [];
    headers.forEach((h, colIdx) => {
        const hasData = data.some((row) => row[colIdx] && row[colIdx].trim());
        if (h.trim() || hasData) validCols.push(colIdx);
    });

    // 保存 validCols 供列选择器使用
    currentValidCols = validCols;

    const validRows = [];
    const nameColIdx = checklistData.name_col_index;
    data.forEach((row, i) => {
        const nameVal = validCols.includes(nameColIdx) ? row[nameColIdx] : "";
        const hasAnyData = validCols.some((colIdx) => row[colIdx] && row[colIdx].trim());
        if (hasAnyData && (nameVal && nameVal.trim())) validRows.push({ row, i });
    });

    let headHtml = "<tr>";
    validCols.forEach((colIdx) => {
        if (!showCols || showCols.has(colIdx)) {
            headHtml += `<th>${headers[colIdx]}</th>`;
        }
    });
    if (hasMatch) headHtml += `<th>核对结果</th><th>文件超链接</th>`;
    headHtml += "</tr>";
    thead.innerHTML = headHtml;

    let bodyHtml = "";
    validRows.forEach(({ row, i }) => {
        // 应用列筛选
        const matchColFilters = colFilters && Object.keys(colFilters).length > 0;
        let skip = false;
        if (matchColFilters) {
            for (const [colIdx, keyword] of Object.entries(colFilters)) {
                if (keyword && (!row[colIdx] || !row[colIdx].toLowerCase().includes(keyword.toLowerCase()))) {
                    skip = true;
                    break;
                }
            }
        }
        if (skip) return;

        // 应用状态筛选
        if (hasMatch && statusFilter !== "all") {
            const result = matchResults[i];
            const matchStatus = result ? result.status : "未获取";
            if (statusFilter === "yes" && matchStatus !== "已获取") return;
            if (statusFilter === "no" && matchStatus !== "未获取") return;
        }

        bodyHtml += "<tr>";
        validCols.forEach((colIdx) => {
            // 检查列是否可见
            if (showCols && !showCols.has(colIdx)) return;
            bodyHtml += `<td>${row[colIdx]}</td>`;
        });
        if (hasMatch) {
            const result = matchResults[i] || { index: i + 1, status: "未获取", matched_names: [], matched_files: [], matched_types: [] };
            const statusClass = result.status === "已获取" ? "yes" : "no";
            const toggleLabel = result.status === "已获取" ? "改为未获取" : "改为已获取";
            const toggleClass = result.status === "已获取" ? "to-no" : "to-yes";
            bodyHtml += `<td class="status-cell"><div class="status-row"><span class="status-tag ${statusClass}">${result.status}</span><button class="toggle-btn ${toggleClass}" onclick="toggleStatus(${result.index})">${toggleLabel}</button></div></td>`;
            let linkHtml = "";
            if (result.status === "已获取" && result.matched_names.length) {
                result.matched_names.forEach((name, j) => {
                    const filePath = result.matched_files[j];
                    const fileUrl = "/api/open?path=" + encodeURIComponent(filePath);
                    const typeTag = result.matched_types[j] === "文件夹" ? `<span class="type-tag folder">文件夹</span>` : "";
                    linkHtml += `<a href="${fileUrl}" title="${filePath}" target="_blank">${name}</a>${typeTag}`;
                    if (j < result.matched_names.length - 1) linkHtml += ", ";
                });
            }
            bodyHtml += `<td>${linkHtml}</td>`;
        }
        bodyHtml += "</tr>";
    });
    tbody.innerHTML = bodyHtml;

    // 同步列选择器
    renderColSelector();
}

// ====== 状态切换 ======

function toggleStatus(index) {
    if (!matchResults) return;
    let currentStatus = null;
    matchResults.forEach((r) => { if (r.index === index) currentStatus = r.status; });
    const newStatus = currentStatus === "已获取" ? "未获取" : "已获取";
    fetch(API.updateStatus, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, status: newStatus }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) { showToast(data.error, "error"); return; }
            matchResults.forEach((r) => {
                if (r.index === index) {
                    r.status = newStatus;
                    // 改为未获取时清空匹配数据，移除超链接
                    if (newStatus === "未获取") {
                        r.matched_files = [];
                        r.matched_names = [];
                        r.matched_types = [];
                    }
                }
            });
            renderMainTable();
            updateStats(data.matched_count, data.total);
            if (scanRoot) loadFileTree(scanRoot);
        })
        .catch((err) => showToast("更新失败: " + err.message, "error"));
}

// ====== 统计信息 ======

function updateStats(matched, total) {
    document.getElementById("stats-section").classList.remove("hidden");
    document.getElementById("stat-total").textContent = total;
    document.getElementById("stat-matched").textContent = matched;
    document.getElementById("stat-missing").textContent = total - matched;
    const percent = total > 0 ? (matched / total) * 100 : 0;
    document.getElementById("progress-fill").style.width = percent + "%";
}

// ====== 文件树 ======

function initTreeToggle() {
    document.getElementById("toggle-tree-btn").addEventListener("click", () => {
        const panel = document.getElementById("file-tree-panel");
        panel.classList.toggle("collapsed");
        const btn = document.getElementById("toggle-tree-btn");
        btn.textContent = panel.classList.contains("collapsed") ? "\u{1F4C2} 显示资料" : "\u{1F4C2} 隐藏资料";
    });
    document.getElementById("tree-close-btn").addEventListener("click", () => {
        document.getElementById("file-tree-panel").classList.add("collapsed");
        document.getElementById("toggle-tree-btn").textContent = "\u{1F4C2} 显示资料";
    });
}

function loadFileTree(path) {
    fetch(API.folderTree + "?path=" + encodeURIComponent(path))
        .then((r) => r.json())
        .then((data) => {
            if (data.error) { showToast(data.error, "error"); return; }
            renderTreeNodes(data.items, document.getElementById("file-tree"));
            // 确保面板可见
            document.getElementById("file-tree-panel").classList.remove("collapsed");
            document.getElementById("toggle-tree-btn").textContent = "\u{1F4C2} 隐藏资料";
        })
        .catch((err) => showToast("加载失败: " + err.message, "error"));
}

function renderTreeNodes(items, container) {
    container.innerHTML = "";
    items.forEach((item) => {
        const nodeDiv = document.createElement("div");
        nodeDiv.className = "tree-item";

        const nodeLine = document.createElement("div");
        nodeLine.className = "tree-node";
        const icon = item.is_dir ? "\u{1F4C1}" : "\u{1F4C4}";
        const matchedTag = item.is_matched ? `<span class="type-tag matched">已匹配</span>` : "";

        nodeLine.innerHTML = `<span class="node-icon">${icon}</span><span class="node-name${item.is_dir ? ' is-dir' : ''}" ${item.is_dir && !item.is_matched ? `onclick="toggleTreeNode(this)"` : ''}>${item.name}</span>${matchedTag}`;

        // 未匹配项添加分配按钮
        if (!item.is_matched) {
            const assignBtn = document.createElement("button");
            assignBtn.className = "assign-btn";
            assignBtn.textContent = "分配";
            assignBtn.onclick = () => showAssignModal(item.path, item.is_dir);
            nodeLine.appendChild(assignBtn);
        }

        nodeDiv.appendChild(nodeLine);

        // 文件夹且未匹配：添加子项容器
        if (item.is_dir && !item.is_matched) {
            const childDiv = document.createElement("div");
            childDiv.className = "tree-children collapsed";
            childDiv.dataset.path = item.path;
            nodeDiv.appendChild(childDiv);
        }

        container.appendChild(nodeDiv);
    });
}

function toggleTreeNode(nameEl) {
    const treeItem = nameEl.closest(".tree-item");
    const childDiv = treeItem.querySelector(".tree-children");
    if (!childDiv) return;

    if (childDiv.classList.contains("collapsed")) {
        // 展开：懒加载子项
        if (childDiv.innerHTML === "") {
            const path = childDiv.dataset.path;
            fetch(API.folderTree + "?path=" + encodeURIComponent(path))
                .then((r) => r.json())
                .then((data) => {
                    if (data.error) return;
                    renderTreeNodes(data.items, childDiv);
                });
        }
        childDiv.classList.remove("collapsed");
        nameEl.textContent = nameEl.textContent; // 视觉上保持
    } else {
        childDiv.classList.add("collapsed");
    }
}

function showAssignModal(filePath, isDir) {
    if (!matchResults) { showToast("请先执行匹配", "error"); return; }

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.onclick = () => { overlay.remove(); modal.remove(); };

    const modal = document.createElement("div");
    modal.className = "assign-modal";
    modal.innerHTML = `<h3>分配到清单项</h3><p style="color:#666;font-size:13px;margin-bottom:12px;">${isDir ? "文件夹" : "文件"}: ${filePath.split(/[\\/]/).pop()}</p><div class="assign-list"></div>`;

    const list = modal.querySelector(".assign-list");
    matchResults.forEach((r) => {
        const item = document.createElement("div");
        item.className = "assign-item" + (r.status === "已获取" ? " already-matched" : "");
        item.textContent = `${r.index}. ${r.checklist_name}` + (r.status === "已获取" ? " (已获取)" : "");
        if (r.status !== "已获取") {
            item.onclick = () => {
                assignToChecklist(filePath, r.index, isDir);
                overlay.remove();
                modal.remove();
            };
        }
        list.appendChild(item);
    });

    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

function assignToChecklist(filePath, index, isDir) {
    fetch(API.manualMatch, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: filePath, index }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) { showToast(data.error, "error"); return; }
            matchResults.forEach((r) => {
                if (r.index === index) {
                    r.status = "已获取";
                    r.matched_files.push(filePath);
                    r.matched_names.push(filePath.split(/[\\/]/).pop());
                    r.matched_types.push(isDir ? "文件夹" : "文件");
                }
            });
            renderMainTable();
            updateStats(data.matched_count, data.total);
            loadFileTree(scanRoot);
            showToast("已分配到清单项", "success");
        })
        .catch((err) => showToast("分配失败: " + err.message, "error"));
}

// ====== 导出Excel ======

function exportExcel() {
    if (!matchResults) { showToast("尚无匹配结果", "error"); return; }
    window.location.href = API.export;
    showToast("正在导出Excel...", "success");
}

// ====== 列显示控制 ======

let currentValidCols = []; // 有效列索引列表（由 renderMainTable 更新）

function initColToggle() {
    const btn = document.getElementById("col-toggle-btn");
    const dropdown = document.getElementById("col-toggle-dropdown");
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.classList.toggle("hidden");
    });
    // 点击外部关闭
    document.addEventListener("click", (e) => {
        if (!dropdown.contains(e.target) && e.target !== btn) {
            dropdown.classList.add("hidden");
        }
    });
}

function renderColSelector() {
    if (!checklistData) return;
    const dropdown = document.getElementById("col-toggle-dropdown");
    const headers = checklistData.headers;
    dropdown.innerHTML = "";
    currentValidCols.forEach((colIdx) => {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = colIdx;
        // 默认全部勾选（showCols 为 null 时视为全选）
        checkbox.checked = !showCols || showCols.has(colIdx);
        checkbox.addEventListener("change", () => {
            if (!showCols) {
                // 首次取消勾选时，从全集开始构建 Set
                showCols = new Set(currentValidCols);
            }
            if (checkbox.checked) {
                showCols.add(colIdx);
            } else {
                showCols.delete(colIdx);
            }
            // 如果全部勾选了，重置为 null（全选状态）
            if (showCols.size === currentValidCols.length) {
                showCols = null;
            }
            renderMainTableBody();
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(headers[colIdx] || `第${colIdx + 1}列`));
        dropdown.appendChild(label);
    });
}

function renderMainTableBody() {
    // 仅重绘表头和数据体（保持状态筛选等逻辑不变）
    if (!checklistData) return;
    const thead = document.getElementById("main-table-head");
    const tbody = document.getElementById("main-table-body");
    const headers = checklistData.headers;
    const data = checklistData.data;
    const hasMatch = matchResults && matchResults.length > 0;

    let headHtml = "<tr>";
    currentValidCols.forEach((colIdx) => {
        if (!showCols || showCols.has(colIdx)) {
            headHtml += `<th>${headers[colIdx]}</th>`;
        }
    });
    if (hasMatch) headHtml += `<th>核对结果</th><th>文件超链接</th>`;
    headHtml += "</tr>";
    thead.innerHTML = headHtml;

    const nameColIdx = checklistData.name_col_index;
    const validRows = [];
    data.forEach((row, i) => {
        const nameVal = currentValidCols.includes(nameColIdx) ? row[nameColIdx] : "";
        const hasAnyData = currentValidCols.some((colIdx) => row[colIdx] && row[colIdx].trim());
        if (hasAnyData && (nameVal && nameVal.trim())) validRows.push({ row, i });
    });

    let bodyHtml = "";
    validRows.forEach(({ row, i }) => {
        // 状态筛选
        if (hasMatch && statusFilter !== "all") {
            const result = matchResults[i];
            const matchStatus = result ? result.status : "未获取";
            if (statusFilter === "yes" && matchStatus !== "已获取") return;
            if (statusFilter === "no" && matchStatus !== "未获取") return;
        }

        bodyHtml += "<tr>";
        currentValidCols.forEach((colIdx) => {
            if (showCols && !showCols.has(colIdx)) return;
            bodyHtml += `<td>${row[colIdx]}</td>`;
        });
        if (hasMatch) {
            const result = matchResults[i] || { index: i + 1, status: "未获取", matched_names: [], matched_files: [], matched_types: [] };
            const statusClass = result.status === "已获取" ? "yes" : "no";
            const toggleLabel = result.status === "已获取" ? "改为未获取" : "改为已获取";
            const toggleClass = result.status === "已获取" ? "to-no" : "to-yes";
            bodyHtml += `<td class="status-cell"><div class="status-row"><span class="status-tag ${statusClass}">${result.status}</span><button class="toggle-btn ${toggleClass}" onclick="toggleStatus(${result.index})">${toggleLabel}</button></div></td>`;
            let linkHtml = "";
            if (result.status === "已获取" && result.matched_names.length) {
                result.matched_names.forEach((name, j) => {
                    const filePath = result.matched_files[j];
                    const fileUrl = "/api/open?path=" + encodeURIComponent(filePath);
                    const typeTag = result.matched_types[j] === "文件夹" ? `<span class="type-tag folder">文件夹</span>` : "";
                    linkHtml += `<a href="${fileUrl}" title="${filePath}" target="_blank">${name}</a>${typeTag}`;
                    if (j < result.matched_names.length - 1) linkHtml += ", ";
                });
            }
            bodyHtml += `<td>${linkHtml}</td>`;
        }
        bodyHtml += "</tr>";
    });
    tbody.innerHTML = bodyHtml;
}

// ====== 状态筛选 ======

function initStatusFilter() {
    const bar = document.getElementById("status-filter-bar");
    bar.addEventListener("click", (e) => {
        const btn = e.target.closest(".filter-btn");
        if (!btn) return;
        const filter = btn.dataset.filter;
        if (filter === statusFilter) return;
        statusFilter = filter;
        bar.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderMainTableBody();
    });
}

// ====== AI辅助匹配 ======

const LLM_PRESETS = {
    "deepseek": { model: "deepseek-chat", base_url: "https://api.deepseek.com/v1" },
    "openai-gpt4o-mini": { model: "gpt-4o-mini", base_url: "https://api.openai.com/v1" },
    "openai-gpt4o": { model: "gpt-4o", base_url: "https://api.openai.com/v1" },
    "zhipu-glm4": { model: "glm-4", base_url: "https://open.bigmodel.cn/api/paas/v4" },
    "qwen": { model: "qwen-plus", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    "ollama": { model: "qwen2.5:7b", base_url: "http://localhost:11434/v1" },
};

function initLlmPanel() {
    const btn = document.getElementById("llm-toggle-btn");
    const config = document.getElementById("llm-config");
    const provider = document.getElementById("llm-provider");
    const baseUrlInput = document.getElementById("llm-base-url");
    const hint = document.getElementById("llm-base-url-hint");
    const matchBtn = document.getElementById("llm-match-btn");

    btn.addEventListener("click", () => {
        config.classList.toggle("hidden");
    });

    function updateBaseUrlHint() {
        const p = provider.value;
        const preset = LLM_PRESETS[p];
        if (preset) {
            baseUrlInput.placeholder = preset.base_url;
            hint.textContent = p === "ollama" ? "确保Ollama已启动" : "留空则使用默认地址";
        }
    }
    provider.addEventListener("change", updateBaseUrlHint);
    updateBaseUrlHint();

    matchBtn.addEventListener("click", () => doLlmMatch());
}

function doLlmMatch() {
    if (!matchResults) { showToast("请先执行规则匹配", "error"); return; }

    const hasUnmatched = matchResults.some((r) => r.status === "未获取");
    if (!hasUnmatched) { showToast("所有项目已匹配，无需AI辅助", "success"); return; }

    const provider = document.getElementById("llm-provider").value;
    const apiKey = document.getElementById("llm-api-key").value.trim();
    const baseUrl = document.getElementById("llm-base-url").value.trim();

    if (provider !== "ollama" && !apiKey) {
        showToast("请输入API Key", "error");
        return;
    }

    const statusEl = document.getElementById("llm-status");
    const matchBtn = document.getElementById("llm-match-btn");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "正在AI匹配中，请稍候...";
    matchBtn.disabled = true;
    matchBtn.style.opacity = "0.6";

    fetch(API.llmMatch, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey, base_url: baseUrl }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) { showToast(data.error, "error"); return; }
            // 后端已更新 match_results，直接用返回的 results 同步前端
            if (data.match_results) {
                matchResults = data.match_results;
            }
            renderMainTable();
            updateStats(data.matched_count, data.total);
            loadFileTree(scanRoot);
            showToast(`AI匹配完成: ${data.llm_matched}项新增匹配 (共消耗${data.usage.total_tokens || 0} tokens)`, "success");
        })
        .catch((err) => showToast("AI匹配失败: " + err.message, "error"))
        .finally(() => {
            statusEl.classList.add("hidden");
            matchBtn.disabled = false;
            matchBtn.style.opacity = "1";
        });
}

// ====== 提示消息 ======

function showToast(message, type) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "toast " + type + " show";
    setTimeout(() => toast.classList.remove("show"), 3000);
}