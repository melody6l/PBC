/* 审计文件匹配工具 - 前端交互逻辑 */

const API = {
    uploadChecklist: "/api/upload-checklist",
    scanFolder: "/api/scan-folder",
    match: "/api/match",
    updateStatus: "/api/update-status",
    setNameColumn: "/api/set-name-column",
    export: "/api/export",
};

// 全局状态
let checklistData = null;   // 清单原始数据（headers, data, items, name_col_index）
let matchResults = null;    // 匹配结果数组
let scannedCount = 0;

// 页面初始化
document.addEventListener("DOMContentLoaded", () => {
    initUploadArea();
    initFolderInput();
    initMatchControls();
    initNameColSelector();
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
    if (!file.name.endsWith(".xlsx")) {
        showToast("仅支持.xlsx格式文件", "error");
        return;
    }

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
    area.innerHTML = `
        <div class="upload-icon">&#9989;</div>
        <p class="filename">${filename}</p>
        <p>共 ${data.total} 项文件</p>
    `;
    document.getElementById("checklist-badge").textContent = `${data.total}项`;
}

// ====== 名称列选择 ======

function initNameColSelector() {
    const select = document.getElementById("name-col-select");
    select.addEventListener("change", () => {
        const newIndex = parseInt(select.value);
        setNameColumn(newIndex);
    });
}

function populateNameColSelect(data) {
    const selector = document.getElementById("name-col-selector");
    const select = document.getElementById("name-col-select");
    const hint = document.getElementById("name-col-hint");

    selector.classList.remove("hidden");
    select.innerHTML = "";

    data.headers.forEach((h, i) => {
        // 跳过空列头且所有数据行中该列也为空的列
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: folderPath }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) { showToast(data.error, "error"); return; }
            scannedCount = data.scanned_count;
            document.getElementById("scan-info").classList.remove("hidden");
            document.getElementById("scan-info").textContent = `已扫描 ${data.scanned_count} 个文件`;
            document.getElementById("folder-badge").textContent = `${data.scanned_count}个文件`;
            if (data.results && data.results.length) {
                matchResults = data.results;
                renderMainTable();
                updateStats(data.matched_count, data.total);
                document.getElementById("export-btn").classList.remove("hidden");
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) { showToast(data.error, "error"); return; }
            matchResults = data.results;
            renderMainTable();
            updateStats(data.matched_count, data.total);
            document.getElementById("export-btn").classList.remove("hidden");
            showToast(`匹配完成: ${data.matched_count}/${data.total} 已获取`, "success");
        })
        .catch((err) => showToast("匹配失败: " + err.message, "error"));
}

// ====== 统一表格渲染 ======

function renderMainTable() {
    if (!checklistData) {
        document.getElementById("main-table-section").classList.add("hidden");
        document.getElementById("empty-state").classList.remove("hidden");
        return;
    }

    // 显示表格区域，隐藏空状态
    document.getElementById("main-table-section").classList.remove("hidden");
    document.getElementById("empty-state").classList.add("hidden");

    const thead = document.getElementById("main-table-head");
    const tbody = document.getElementById("main-table-body");
    const headers = checklistData.headers;
    const data = checklistData.data;
    const hasMatch = matchResults && matchResults.length > 0;

    // 过滤空列：跳过所有数据行中均为空的列
    const validCols = [];
    headers.forEach((h, colIdx) => {
        const hasData = data.some((row) => row[colIdx] && row[colIdx].trim());
        if (h.trim() || hasData) validCols.push(colIdx);
    });

    // 过滤空行：跳过整行所有有效列都为空的行
    const validRows = [];
    const nameColIdx = checklistData.name_col_index;
    data.forEach((row, i) => {
        const nameVal = validCols.includes(nameColIdx) ? row[nameColIdx] : "";
        const hasAnyData = validCols.some((colIdx) => row[colIdx] && row[colIdx].trim());
        if (hasAnyData && (nameVal && nameVal.trim())) validRows.push({ row, i });
    });

    // 构建表头：有效原始列 + 核对结果(倒数第二列) + 文件超链接(最后一列)
    let headHtml = "<tr>";
    validCols.forEach((colIdx) => headHtml += `<th>${headers[colIdx]}</th>`);
    if (hasMatch) {
        headHtml += `<th>核对结果</th><th>文件超链接</th>`;
    }
    headHtml += "</tr>";
    thead.innerHTML = headHtml;

    // 构建数据行
    let bodyHtml = "";
    validRows.forEach(({ row, i }) => {
        bodyHtml += "<tr>";
        // 有效原始列数据
        validCols.forEach((colIdx) => bodyHtml += `<td>${row[colIdx]}</td>`);
        // 核对附加列（仅匹配后显示）
        if (hasMatch) {
            const result = matchResults[i] || { index: i + 1, status: "未获取", matched_names: [], matched_files: [], matched_types: [] };
            const statusClass = result.status === "已获取" ? "yes" : "no";
            const toggleLabel = result.status === "已获取" ? "改为未获取" : "改为已获取";
            const toggleClass = result.status === "已获取" ? "to-no" : "to-yes";

            // 核对结果列（倒数第二列）：状态标签 + 手动切换按钮，同行显示
            bodyHtml += `<td class="status-cell">
                <div class="status-row">
                    <span class="status-tag ${statusClass}">${result.status}</span>
                    <button class="toggle-btn ${toggleClass}" onclick="toggleStatus(${result.index})">${toggleLabel}</button>
                </div>
            </td>`;

            // 文件超链接列（最后一列）：通过Flask中转打开文件/文件夹
            let linkHtml = "";
            if (result.matched_names.length) {
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

// ====== 状态切换 ======

function toggleStatus(index) {
    if (!matchResults) return;
    let currentStatus = null;
    matchResults.forEach((r) => { if (r.index === index) currentStatus = r.status; });
    const newStatus = currentStatus === "已获取" ? "未获取" : "已获取";

    fetch(API.updateStatus, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, status: newStatus }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) { showToast(data.error, "error"); return; }
            matchResults.forEach((r) => { if (r.index === index) r.status = newStatus; });
            renderMainTable();
            updateStats(data.matched_count, data.total);
        })
        .catch((err) => showToast("更新失败: " + err.message, "error"));
}

// ====== 统计信息 ======

function updateStats(matched, total) {
    const section = document.getElementById("stats-section");
    section.classList.remove("hidden");
    const missing = total - matched;
    document.getElementById("stat-total").textContent = total;
    document.getElementById("stat-matched").textContent = matched;
    document.getElementById("stat-missing").textContent = missing;
    const percent = total > 0 ? (matched / total) * 100 : 0;
    document.getElementById("progress-fill").style.width = percent + "%";
}

// ====== 导出Excel ======

function exportExcel() {
    if (!matchResults) { showToast("尚无匹配结果", "error"); return; }
    window.location.href = API.export;
    showToast("正在导出Excel...", "success");
}

// ====== 提示消息 ======

function showToast(message, type) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "toast " + type + " show";
    setTimeout(() => toast.classList.remove("show"), 3000);
}