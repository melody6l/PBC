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
    browseDirs: "/api/browse-dirs",
};

// 全局状态
let checklistData = null;
let matchResults = null;
let scannedCount = 0;
let scanRoot = "";
let showCols = null;           // null=全部显示，或 Set 存储可见列索引
let colFilters = {};           // 列筛选条件 {colIdx: keyword}
let statusMenuIndex = null;    // 当前右键菜单对应的清单序号

// 页面初始化
document.addEventListener("DOMContentLoaded", () => {
    initUploadArea();
    initFolderInput();
    initMatchControls();
    initNameColSelector();
    initTreeToggle();
    initColToggle();
    initStatusContextMenu();
    initLlmPanel();
    initColumnResize();
    updateWorkflowState();
});

// ====== 列宽拖拽调整 ======
function initColumnResize() {
    const table = document.getElementById("main-table");
    let resizing = false;
    let thElement = null;
    let startX = 0;
    let startWidth = 0;

    table.addEventListener("mousedown", (e) => {
        const th = e.target.closest("th");
        if (!th) return;

        // 检查是否在列边框附近（右侧10px区域）
        const rect = th.getBoundingClientRect();
        const isNearRightEdge = e.clientX > rect.right - 10;

        if (isNearRightEdge) {
            resizing = true;
            thElement = th;
            startX = e.clientX;
            startWidth = th.offsetWidth;
            document.body.style.cursor = "col-resize";
            e.preventDefault();
        }
    });

    document.addEventListener("mousemove", (e) => {
        if (!resizing || !thElement) return;

        const diff = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff);
        thElement.style.width = newWidth + "px";

        // 同时调整对应列的所有单元格
        const colIndex = Array.from(thElement.parentNode.children).indexOf(thElement);
        const rows = table.querySelectorAll("tbody tr");
        rows.forEach(row => {
            const td = row.children[colIndex];
            if (td) td.style.width = newWidth + "px";
        });
    });

    document.addEventListener("mouseup", () => {
        if (resizing) {
            resizing = false;
            thElement = null;
            document.body.style.cursor = "";
        }
    });
}

// ====== 清单上传 ======

function initUploadArea() {
    const area = document.getElementById("upload-area");
    const input = document.getElementById("checklist-input");
    const triggerBtn = document.getElementById("upload-trigger-btn");
    const reuploadBtn = document.getElementById("reupload-btn");

    if (triggerBtn) triggerBtn.addEventListener("click", (e) => { e.stopPropagation(); input.click(); });
    if (reuploadBtn) reuploadBtn.addEventListener("click", (e) => { e.stopPropagation(); input.click(); });
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
            document.getElementById("stats-section").classList.add("hidden");
            document.getElementById("progress-fill").style.width = "0%";
            document.getElementById("export-btn").classList.add("hidden");
            updateUploadUI(file.name, data);
            populateNameColSelect(data);
            renderMainTable();
            updateWorkflowState();
            showToast(`清单已加载，共 ${data.total} 项`, "success");
        })
        .catch((err) => showToast("上传失败: " + err.message, "error"));
}

function updateUploadUI(filename, data) {
    const area = document.getElementById("upload-area");
    const empty = document.getElementById("upload-empty");
    const done = document.getElementById("upload-done");
    const summary = document.getElementById("upload-summary");
    area.classList.add("loaded");
    if (empty) empty.classList.add("hidden");
    if (done) done.classList.remove("hidden");
    if (summary) summary.textContent = `${filename} · 共 ${data.total} 项文件`;
    document.getElementById("checklist-badge").textContent = `✓ ${data.total}项`;
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
                updateStats(data.matched_count, data.total, data.partial_count);
                document.getElementById("export-btn").classList.remove("hidden");
            }
            if (scanRoot) loadFileTree(scanRoot);
            updateWorkflowState();
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
            document.getElementById("folder-badge").textContent = `✓ ${data.scanned_count}个文件`;
            if (data.results && data.results.length) {
                matchResults = data.results;
                renderMainTable();
                updateStats(data.matched_count, data.total, data.partial_count);
                document.getElementById("export-btn").classList.remove("hidden");
                loadFileTree(scanRoot);
            } else {
                loadFileTree(scanRoot);
            }
            updateWorkflowState();
            showToast(`已扫描 ${data.scanned_count} 个文件`, "success");
        })
        .catch((err) => showToast("扫描失败: " + err.message, "error"));
}

// ====== 匹配控制 ======

function initMatchControls() {
    document.getElementById("match-btn").addEventListener("click", () => doMatch());
    document.getElementById("export-btn").addEventListener("click", () => exportExcel());
}

async function doMatch() {
    const mode = document.getElementById("match-mode").value;
    if (!checklistData) { showToast("请先上传清单文件", "error"); return; }
    if (!scannedCount) { showToast("请先扫描目标文件夹", "error"); return; }

    try {
        const r = await fetch(API.match, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode }),
        });
        const data = await r.json();
        if (data.error) { showToast(data.error, "error"); return; }
        matchResults = data.results;
        scanRoot = data.root_path || scanRoot;
        renderMainTable();
        updateStats(data.matched_count, data.total);
        document.getElementById("export-btn").classList.remove("hidden");
        loadFileTree(scanRoot);
        updateWorkflowState();

        if (document.getElementById("llm-enabled").checked) {
            await runLlmMatch();
        } else {
            showToast(`匹配完成: ${data.matched_count}/${data.total} 已获取`, "success");
        }
    } catch (err) {
        showToast("匹配失败: " + err.message, "error");
    }
}

// ====== 统一表格渲染 ======

function renderMainTable() {
    if (!checklistData) {
        document.getElementById("split-view").classList.add("hidden");
        document.getElementById("empty-state").classList.remove("hidden");
        document.querySelector("#empty-state p").textContent = "请先上传需求文件清单，再扫描客户资料文件夹";
        return;
    }
    if (!matchResults) {
        document.getElementById("split-view").classList.add("hidden");
        document.getElementById("empty-state").classList.remove("hidden");
        document.querySelector("#empty-state p").textContent = "请继续扫描客户资料文件夹，匹配完成后显示核对结果";
        return;
    }
    document.getElementById("split-view").classList.remove("hidden");
    document.getElementById("empty-state").classList.add("hidden");

    const thead = document.getElementById("main-table-head");
    const tbody = document.getElementById("main-table-body");
    const headers = checklistData.headers;
    const data = checklistData.data;
    const hasMatch = matchResults && matchResults.length > 0;

    const validCols = [];
    headers.forEach((h, colIdx) => {
        const hasData = data.some((row) => row[colIdx] && row[colIdx].trim());
        if (h.trim() || hasData) validCols.push(colIdx);
    });

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
    if (hasMatch) headHtml += `<th class="status-head">核对结果</th><th>文件超链接</th>`;
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

        bodyHtml += "<tr>";
        validCols.forEach((colIdx) => {
            if (showCols && !showCols.has(colIdx)) return;
            bodyHtml += `<td>${row[colIdx]}</td>`;
        });
        if (hasMatch) {
            const result = matchResults[i] || { index: i + 1, status: "未获取", matched_names: [], matched_files: [], matched_types: [] };
            bodyHtml += renderStatusCell(result);
            let linkHtml = "";
            if (result.matched_names.length) {
                result.matched_names.forEach((name, j) => {
                    const filePath = result.matched_files[j];
                    const fileUrl = "/api/open?path=" + encodeURIComponent(filePath);
                    const typeTag = result.matched_types[j] === "文件夹" ? `<span class="type-tag folder">文件夹</span>` : "";
                    linkHtml += `<div><a href="${fileUrl}" title="${filePath}" target="_blank">${name}</a>${typeTag}</div>`;
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

function renderStatusCell(result) {
    const statusClass = result.status === "已获取" ? "yes" : (result.status === "部分获取" ? "partial" : "no");
    return `<td class="status-cell"><span class="status-tag ${statusClass}" title="右键切换状态" oncontextmenu="showStatusContextMenu(event, ${result.index})">${result.status}</span></td>`;
}

function toggleStatus(index, targetStatus) {
    if (!matchResults) return;
    let currentStatus = null;
    matchResults.forEach((r) => { if (r.index === index) currentStatus = r.status; });
    const newStatus = targetStatus || (currentStatus === "已获取" ? "部分获取" : (currentStatus === "部分获取" ? "未获取" : "已获取"));
    if (!newStatus || newStatus === currentStatus) return;
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
            updateWorkflowState();
            if (scanRoot) loadFileTree(scanRoot);
            showToast(`已切换为${newStatus}`, "success");
        })
        .catch((err) => showToast("更新失败: " + err.message, "error"));
}

// ====== 统计信息 ======

function updateStats(matched, total, partial) {
    partial = partial || 0;
    document.getElementById("stats-section").classList.remove("hidden");
    animateNumber("stat-total", total);
    animateNumber("stat-matched", matched);
    animateNumber("stat-incomplete", partial);
    animateNumber("stat-missing", total - matched - partial);
    const percent = total > 0 ? ((matched + partial * 0.5) / total) * 100 : 0;
    document.getElementById("progress-fill").style.width = percent + "%";
}

function updateWorkflowState() {
    const hasChecklist = Boolean(checklistData);
    const hasScannedFolder = scannedCount > 0;
    const hasMatchResult = Boolean(matchResults && matchResults.length);

    setWorkflowStep("workflow-step-1", hasChecklist ? "completed" : "active");
    setWorkflowStep("workflow-step-2", hasScannedFolder ? "completed" : (hasChecklist ? "active" : "pending"));
    setWorkflowStep("workflow-step-3", hasMatchResult ? "completed" : (hasScannedFolder ? "active" : "pending"));
    document.getElementById("name-col-selector").classList.toggle("hidden", !hasChecklist);

    document.getElementById("match-badge").textContent = hasMatchResult ? "✓ 已完成" : (hasScannedFolder ? "待匹配" : "待前置");

    const badgeText = hasMatchResult ? "匹配完成" : (hasScannedFolder ? "步骤 3 待匹配" : (hasChecklist ? "步骤 2 待扫描" : "步骤 1 待上传"));
    document.getElementById("workflow-state-badge").textContent = badgeText;
}

function setWorkflowStep(id, state) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("active", "completed", "pending");
    el.classList.add(state);
}

function animateNumber(id, target) {
    const el = document.getElementById(id);
    const start = Number(el.textContent) || 0;
    const end = Number(target) || 0;
    const duration = 360;
    const startTime = performance.now();

    function tick(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(start + (end - start) * eased);
        if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
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

        // 所有项目都可以点击展开，包括已匹配的
        nodeLine.innerHTML = `<span class="node-icon">${icon}</span><span class="node-name${item.is_dir ? ' is-dir' : ''}" ${item.is_dir ? `onclick="toggleTreeNode(this)"` : ''}>${item.name}</span>${matchedTag}`;

        // 已匹配的资料不再显示分配按钮，避免重复分配
        if (!item.is_matched) {
            const assignBtn = document.createElement("button");
            assignBtn.className = "assign-btn";
            assignBtn.textContent = "分配";
            assignBtn.onclick = () => showAssignModal(item.path, item.is_dir);
            nodeLine.appendChild(assignBtn);
        }

        nodeDiv.appendChild(nodeLine);

        // 文件夹：添加子项容器（包括已匹配的）
        if (item.is_dir) {
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

    // 分离未分配和已分配的清单项
    const unassignedItems = [];
    const assignedItems = [];

    matchResults.forEach((r) => {
        if (r.status === "已获取") {
            assignedItems.push(r);
        } else {
            unassignedItems.push(r);
        }
    });

    // 未分配清单项（可点击分配）
    if (unassignedItems.length > 0) {
        const sectionTitle = document.createElement("div");
        sectionTitle.className = "assign-section-title";
        sectionTitle.innerHTML = `<span style="color:var(--danger);font-weight:600;">&#10007; 未分配清单项</span>`;
        list.appendChild(sectionTitle);

        unassignedItems.forEach((r) => {
            const item = document.createElement("div");
            item.className = "assign-item";
            item.textContent = `${r.index}. ${r.checklist_name}`;
            item.onclick = () => {
                assignToChecklist(filePath, r.index, isDir);
                overlay.remove();
                modal.remove();
            };
            list.appendChild(item);
        });
    }

    // 已分配清单项（可点击查看）
    if (assignedItems.length > 0) {
        const sectionTitle = document.createElement("div");
        sectionTitle.className = "assign-section-title";
        sectionTitle.innerHTML = `<span style="color:var(--success);font-weight:600;">&#10003; 已分配清单项</span>`;
        list.appendChild(sectionTitle);

        assignedItems.forEach((r) => {
            const item = document.createElement("div");
            item.className = "assign-item already-matched";
            item.textContent = `${r.index}. ${r.checklist_name} (已获取)`;
            item.onclick = () => {
                // 点击已分配项可以查看或取消分配
                showAssignedDetail(r, filePath, isDir, overlay, modal);
            };
            list.appendChild(item);
        });
    }

    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

function showAssignedDetail(result, newFilePath, isDir, overlay, modal) {
    // 显示已分配项的详细信息
    const detailModal = document.createElement("div");
    detailModal.className = "assign-modal";
    detailModal.innerHTML = `
        <h3>清单项详情</h3>
        <p style="color:#666;font-size:13px;margin-bottom:12px;">${result.index}. ${result.checklist_name}</p>
        <div style="margin-bottom:12px;">
            <p style="font-weight:600;margin-bottom:8px;">当前已分配的文件:</p>
            ${result.matched_names.map((name, i) => `
                <div style="padding:6px 8px;background:rgba(39,174,96,0.1);border-radius:4px;margin-bottom:4px;font-size:13px;">
                    ${name} <span style="color:#666;">(${result.matched_types[i]})</span>
                </div>
            `).join('')}
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button class="btn btn-outline" onclick="this.closest('.assign-modal').remove();">关闭</button>
            <button class="btn btn-danger" onclick="unassignFromChecklist(${result.index}, '${newFilePath}', ${isDir})">取消分配并重新分配</button>
        </div>
    `;

    // 移除当前弹窗，显示详情弹窗
    modal.remove();
    document.body.appendChild(detailModal);
}

function unassignFromChecklist(index, newFilePath, isDir) {
    // 取消分配
    fetch(API.updateStatus, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, status: "未获取" }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) { showToast(data.error, "error"); return; }
            matchResults.forEach((r) => {
                if (r.index === index) {
                    r.status = "未获取";
                    r.matched_files = [];
                    r.matched_names = [];
                    r.matched_types = [];
                }
            });

            // 关闭详情弹窗
            document.querySelectorAll(".assign-modal").forEach(m => m.remove());
            document.querySelectorAll(".modal-overlay").forEach(o => o.remove());

            // 重新显示分配弹窗
            showAssignModal(newFilePath, isDir);

            renderMainTable();
            updateStats(data.matched_count, data.total);
            updateWorkflowState();
            showToast("已取消分配", "success");
        })
        .catch((err) => showToast("取消分配失败: " + err.message, "error"));
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
            updateWorkflowState();
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
    if (hasMatch) headHtml += `<th class="status-head">核对结果</th><th>文件超链接</th>`;
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
        bodyHtml += "<tr>";
        currentValidCols.forEach((colIdx) => {
            if (showCols && !showCols.has(colIdx)) return;
            bodyHtml += `<td>${row[colIdx]}</td>`;
        });
        if (hasMatch) {
            const result = matchResults[i] || { index: i + 1, status: "未获取", matched_names: [], matched_files: [], matched_types: [] };
            bodyHtml += renderStatusCell(result);
            let linkHtml = "";
            if (result.matched_names.length) {
                result.matched_names.forEach((name, j) => {
                    const filePath = result.matched_files[j];
                    const fileUrl = "/api/open?path=" + encodeURIComponent(filePath);
                    const typeTag = result.matched_types[j] === "文件夹" ? `<span class="type-tag folder">文件夹</span>` : "";
                    linkHtml += `<div><a href="${fileUrl}" title="${filePath}" target="_blank">${name}</a>${typeTag}</div>`;
                });
            }
            bodyHtml += `<td>${linkHtml}</td>`;
        }
        bodyHtml += "</tr>";
    });
    tbody.innerHTML = bodyHtml;
}

function initStatusContextMenu() {
    const menu = document.getElementById("status-context-menu");
    if (!menu) return;

    menu.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-status]");
        if (!btn || statusMenuIndex === null) return;
        const index = statusMenuIndex;
        const targetStatus = btn.dataset.status;
        hideStatusContextMenu();
        toggleStatus(index, targetStatus);
    });

    document.addEventListener("click", hideStatusContextMenu);
    document.addEventListener("scroll", hideStatusContextMenu, true);
}

function showStatusContextMenu(event, index) {
    event.preventDefault();
    const menu = document.getElementById("status-context-menu");
    if (!menu) return;

    statusMenuIndex = index;
    menu.classList.remove("hidden");
    const rect = menu.getBoundingClientRect();
    const left = Math.min(event.clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(event.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = Math.max(8, top) + "px";
}

function hideStatusContextMenu() {
    const menu = document.getElementById("status-context-menu");
    if (menu) menu.classList.add("hidden");
    statusMenuIndex = null;
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
    const enabled = document.getElementById("llm-enabled");
    const config = document.getElementById("llm-config");
    const provider = document.getElementById("llm-provider");
    const baseUrlInput = document.getElementById("llm-base-url");
    const hint = document.getElementById("llm-base-url-hint");
    const step3 = document.getElementById("workflow-step-3");

    enabled.addEventListener("change", () => {
        config.classList.toggle("hidden", !enabled.checked);
        step3.classList.toggle("ai-open", enabled.checked);
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
}

async function runLlmMatch() {
    if (!matchResults) { showToast("请先执行规则匹配", "error"); return false; }

    const hasUnmatched = matchResults.some((r) => r.status === "未获取");
    if (!hasUnmatched) { showToast("规则匹配已完成，暂无需AI辅助", "success"); return true; }

    const provider = document.getElementById("llm-provider").value;
    const apiKey = document.getElementById("llm-api-key").value.trim();
    const baseUrl = document.getElementById("llm-base-url").value.trim();

    if (provider !== "ollama" && !apiKey) {
        showToast("请输入API Key", "error");
        return false;
    }

    const statusEl = document.getElementById("llm-status");
    const matchBtn = document.getElementById("match-btn");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "正在AI匹配中，请稍候...";
    matchBtn.disabled = true;
    matchBtn.style.opacity = "0.6";

    try {
        const r = await fetch(API.llmMatch, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider, api_key: apiKey, base_url: baseUrl }),
        });
        const data = await r.json();
        if (data.error) { showToast(data.error, "error"); return false; }
        if (data.match_results) {
            matchResults = data.match_results;
        }
        renderMainTable();
        updateStats(data.matched_count, data.total);
        updateWorkflowState();
        loadFileTree(scanRoot);
        showToast(`AI匹配完成: ${data.llm_matched}项新增匹配 (共消耗${data.usage.total_tokens || 0} tokens)`, "success");
        return true;
    } catch (err) {
        showToast("AI匹配失败: " + err.message, "error");
        return false;
    } finally {
        statusEl.classList.add("hidden");
        matchBtn.disabled = false;
        matchBtn.style.opacity = "1";
    }
}

function initLlmPanel() {
    const enabled = document.getElementById("llm-enabled");
    const modal = document.getElementById("llm-config-modal");
    const summary = document.getElementById("llm-config-summary");
    const tag = document.getElementById("llm-config-tag");
    const provider = document.getElementById("llm-provider");
    const apiKeyInput = document.getElementById("llm-api-key");
    const baseUrlInput = document.getElementById("llm-base-url");
    const hint = document.getElementById("llm-base-url-hint");
    const cancelBtn = document.getElementById("llm-cancel-btn");
    const saveBtn = document.getElementById("llm-save-btn");

    function updateBaseUrlHint() {
        const preset = LLM_PRESETS[provider.value];
        if (preset) {
            baseUrlInput.placeholder = preset.base_url;
            hint.textContent = provider.value === "ollama" ? "请确认 Ollama 已启动" : "留空则使用默认地址";
        }
    }

    function loadForm() {
        provider.value = localStorage.getItem("llm_provider") || "deepseek";
        apiKeyInput.value = localStorage.getItem("llm_api_key") || "";
        baseUrlInput.value = localStorage.getItem("llm_base_url") || "";
        updateBaseUrlHint();
    }

    function closeModal() {
        modal.classList.add("hidden");
        if (localStorage.getItem("llm_configured") !== "true") {
            enabled.checked = false;
            summary.classList.add("hidden");
        }
    }

    function saveConfig() {
        const providerVal = provider.value;
        const apiKey = apiKeyInput.value.trim();
        const baseUrl = baseUrlInput.value.trim();

        if (providerVal !== "ollama" && !apiKey) {
            showToast("请输入API Key", "error");
            return;
        }

        localStorage.setItem("llm_provider", providerVal);
        localStorage.setItem("llm_api_key", apiKey);
        localStorage.setItem("llm_base_url", baseUrl);
        localStorage.setItem("llm_configured", "true");
        summary.classList.remove("hidden");
        enabled.checked = true;
        modal.classList.add("hidden");
        showToast("AI配置已保存", "success");
    }

    enabled.addEventListener("change", () => {
        if (enabled.checked) {
            loadForm();
            modal.classList.remove("hidden");
        }
    });
    tag.addEventListener("click", () => {
        loadForm();
        modal.classList.remove("hidden");
    });
    provider.addEventListener("change", updateBaseUrlHint);
    cancelBtn.addEventListener("click", closeModal);
    saveBtn.addEventListener("click", saveConfig);
    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
    });

    updateBaseUrlHint();
    if (localStorage.getItem("llm_configured") === "true") {
        enabled.checked = true;
        summary.classList.remove("hidden");
        loadForm();
    } else {
        enabled.checked = false;
        summary.classList.add("hidden");
    }
}

async function runLlmMatch() {
    if (!matchResults) { showToast("请先执行规则匹配", "error"); return false; }

    const hasUnmatched = matchResults.some((r) => r.status === "未获取");
    if (!hasUnmatched) { showToast("规则匹配已完成，暂无需AI辅助", "success"); return true; }

    if (localStorage.getItem("llm_configured") !== "true") {
        showToast("请先配置AI辅助匹配", "error");
        document.getElementById("llm-config-modal").classList.remove("hidden");
        return false;
    }

    const provider = localStorage.getItem("llm_provider") || "deepseek";
    const apiKey = localStorage.getItem("llm_api_key") || "";
    const baseUrl = localStorage.getItem("llm_base_url") || "";

    if (provider !== "ollama" && !apiKey) {
        showToast("请先配置AI辅助匹配", "error");
        document.getElementById("llm-config-modal").classList.remove("hidden");
        return false;
    }

    const statusEl = document.getElementById("llm-status");
    const matchBtn = document.getElementById("match-btn");
    statusEl.classList.remove("hidden");
    statusEl.textContent = "正在AI匹配中，请稍候...";
    matchBtn.disabled = true;
    matchBtn.style.opacity = "0.6";

    try {
        const r = await fetch(API.llmMatch, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider, api_key: apiKey, base_url: baseUrl }),
        });
        const data = await r.json();
        if (data.error) { showToast(data.error, "error"); return false; }
        if (data.match_results) {
            matchResults = data.match_results;
        }
        renderMainTable();
        updateStats(data.matched_count, data.total);
        updateWorkflowState();
        loadFileTree(scanRoot);
        showToast(`AI匹配完成: ${data.llm_matched}项新增匹配 (共消耗${data.usage.total_tokens || 0} tokens)`, "success");
        return true;
    } catch (err) {
        showToast("AI匹配失败: " + err.message, "error");
        return false;
    } finally {
        statusEl.classList.add("hidden");
        matchBtn.disabled = false;
        matchBtn.style.opacity = "1";
    }
}

// ====== 提示消息 ======

function showToast(message, type) {
    const toast = document.getElementById("toast");
    const icon = type === "success" ? "✓" : "!";
    toast.textContent = `${icon} ${message}`;
    toast.className = "toast " + type + " show";
    setTimeout(() => toast.classList.remove("show"), 3000);
}
