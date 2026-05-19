/* 审计文件匹配工具 - 前端交互逻辑 */

const API = {
    uploadChecklist: "/api/upload-checklist",
    scanFolder: "/api/scan-folder",
    match: "/api/match",
    updateStatus: "/api/update-status",
    export: "/api/export",
};

// 全局状态
let checklistData = null;
let matchResults = null;
let scannedCount = 0;

// 页面初始化
document.addEventListener("DOMContentLoaded", () => {
    initUploadArea();
    initFolderInput();
    initMatchControls();
});

// ====== 清单上传 ======

function initUploadArea() {
    const area = document.getElementById("upload-area");
    const input = document.getElementById("checklist-input");

    area.addEventListener("click", () => input.click());
    area.addEventListener("dragover", (e) => {
        e.preventDefault();
        area.classList.add("dragover");
    });
    area.addEventListener("dragleave", () => area.classList.remove("dragover"));
    area.addEventListener("drop", (e) => {
        e.preventDefault();
        area.classList.remove("dragover");
        if (e.dataTransfer.files.length) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
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
            if (data.error) {
                showToast(data.error, "error");
                return;
            }
            checklistData = data;
            updateUploadUI(file.name, data);
            renderChecklistPreview(data);
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
        <p>共 ${data.total} 项文件 | 识别名称列: 第${data.name_col_index + 1}列</p>
    `;
}

function renderChecklistPreview(data) {
    const preview = document.getElementById("checklist-preview");
    preview.classList.remove("hidden");

    let html = '<table class="result-table"><thead><tr>';
    data.headers.forEach((h) => html += `<th>${h}</th>`);
    html += "</tr></thead><tbody>";
    data.data.forEach((row) => {
        html += "<tr>";
        row.forEach((cell) => html += `<td>${cell}</td>`);
        html += "</tr>";
    });
    html += "</tbody></table>";
    preview.querySelector(".preview-content").innerHTML = html;
}

// ====== 文件夹扫描 ======

function initFolderInput() {
    const btn = document.getElementById("scan-btn");
    btn.addEventListener("click", () => scanFolder());
}

function scanFolder() {
    const folderPath = document.getElementById("folder-path").value.trim();
    if (!folderPath) {
        showToast("请输入文件夹路径", "error");
        return;
    }

    fetch(API.scanFolder, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: folderPath }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) {
                showToast(data.error, "error");
                return;
            }
            scannedCount = data.scanned_count;
            updateScanUI(data);
            if (data.results && data.results.length) {
                matchResults = data.results;
                renderResults(data.results);
                updateStats(data.matched_count, data.total);
            }
            showToast(`已扫描 ${data.scanned_count} 个文件`, "success");
        })
        .catch((err) => showToast("扫描失败: " + err.message, "error"));
}

function updateScanUI(data) {
    const info = document.getElementById("scan-info");
    info.classList.remove("hidden");
    info.textContent = `已扫描 ${data.scanned_count} 个文件`;
}

// ====== 匹配控制 ======

function initMatchControls() {
    const matchBtn = document.getElementById("match-btn");
    const exportBtn = document.getElementById("export-btn");

    matchBtn.addEventListener("click", () => doMatch());
    exportBtn.addEventListener("click", () => exportExcel());
}

function doMatch() {
    const mode = document.getElementById("match-mode").value;

    if (!checklistData) {
        showToast("请先上传清单文件", "error");
        return;
    }
    if (!scannedCount) {
        showToast("请先扫描目标文件夹", "error");
        return;
    }

    fetch(API.match, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) {
                showToast(data.error, "error");
                return;
            }
            matchResults = data.results;
            renderResults(data.results);
            updateStats(data.matched_count, data.total);
            showToast(`匹配完成: ${data.matched_count}/${data.total} 已获取 (模式: ${data.mode})`, "success");
        })
        .catch((err) => showToast("匹配失败: " + err.message, "error"));
}

// ====== 结果渲染 ======

function renderResults(results) {
    const section = document.getElementById("result-section");
    section.classList.remove("hidden");

    const tbody = document.getElementById("result-tbody");
    tbody.innerHTML = "";

    results.forEach((r) => {
        const tr = document.createElement("tr");
        const statusClass = r.status === "已获取" ? "yes" : "no";
        const toggleLabel = r.status === "已获取" ? "改为未获取" : "改为已获取";
        const toggleClass = r.status === "已获取" ? "to-no" : "to-yes";

        // 构建文件超链接
        let matchedHtml = "";
        if (r.matched_names.length) {
            r.matched_names.forEach((name, i) => {
                const filePath = r.matched_files[i];
                // 使用file:///协议创建本地文件链接
                const fileUrl = "file:///" + filePath.replace(/\\/g, "/");
                matchedHtml += `<a href="${fileUrl}" title="${filePath}">${name}</a>`;
                if (i < r.matched_names.length - 1) matchedHtml += ", ";
            });
        }

        tr.innerHTML = `
            <td class="index-cell">${r.index}</td>
            <td>${r.checklist_name}</td>
            <td class="status-cell">
                <span class="status-tag ${statusClass}">${r.status}</span>
                <button class="toggle-btn ${toggleClass}" onclick="toggleStatus(${r.index})">${toggleLabel}</button>
            </td>
            <td>${matchedHtml}</td>
            <td></td>
        `;
        tbody.appendChild(tr);
    });
}

function toggleStatus(index) {
    let currentStatus = null;
    matchResults.forEach((r) => {
        if (r.index === index) currentStatus = r.status;
    });
    const newStatus = currentStatus === "已获取" ? "未获取" : "已获取";

    fetch(API.updateStatus, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, status: newStatus }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.error) {
                showToast(data.error, "error");
                return;
            }
            // 更新本地数据
            matchResults.forEach((r) => {
                if (r.index === index) r.status = newStatus;
            });
            renderResults(matchResults);
            updateStats(data.matched_count, data.total);
        })
        .catch((err) => showToast("更新失败: " + err.message, "error"));
}

// ====== 统计信息 ======

function updateStats(matched, total) {
    const missing = total - matched;
    document.getElementById("stat-total").textContent = total;
    document.getElementById("stat-matched").textContent = matched;
    document.getElementById("stat-missing").textContent = missing;

    // 更新进度条
    const percent = total > 0 ? (matched / total) * 100 : 0;
    document.getElementById("progress-fill").style.width = percent + "%";
}

// ====== 导出Excel ======

function exportExcel() {
    if (!matchResults) {
        showToast("尚无匹配结果，请先执行匹配", "error");
        return;
    }

    // 直接下载文件
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