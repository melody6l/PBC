"""审计文件匹配工具 - Flask主应用"""

import os
import json
import urllib.parse
from flask import Flask, request, jsonify, render_template, send_file, make_response
from matcher import match_files
from excel_handler import read_checklist, export_results

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = "uploads"
os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

# 全局状态（单用户模式）
state = {
    "checklist": None,       # 清单数据
    "scanned_files": None,   # 扫描到的文件列表
    "scanned_folders": None, # 扫描到的文件夹列表
    "match_results": None,   # 匹配结果
    "match_mode": "fuzzy",   # 当前匹配模式
}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/upload-checklist", methods=["POST"])
def upload_checklist():
    """上传并解析Excel清单文件"""
    if "file" not in request.files:
        return jsonify({"error": "未提供文件"}), 400
    file = request.files["file"]
    if not file.filename.endswith(".xlsx"):
        return jsonify({"error": "仅支持.xlsx格式文件"}), 400

    # 保存上传文件
    save_path = os.path.join(app.config["UPLOAD_FOLDER"], file.filename)
    file.save(save_path)

    # 读取清单
    try:
        checklist = read_checklist(save_path)
        state["checklist"] = checklist
        state["match_results"] = None  # 清除旧匹配结果
        return jsonify({
            "success": True,
            "headers": checklist["headers"],
            "data": checklist["data"],
            "items": checklist["items"],
            "name_col_index": checklist["name_col_index"],
            "total": len(checklist["items"]),
        })
    except Exception as e:
        return jsonify({"error": f"读取Excel失败: {str(e)}"}), 500


@app.route("/api/scan-folder", methods=["POST"])
def scan_folder():
    """扫描指定文件夹"""
    data = request.get_json()
    folder_path = data.get("folder_path", "")
    if not folder_path or not os.path.isdir(folder_path):
        return jsonify({"error": "文件夹路径无效"}), 400

    scanned_files = []
    scanned_folders = []
    for root, dirs, files in os.walk(folder_path):
        for d in dirs:
            # 排除隐藏文件夹和系统文件夹
            if not d.startswith(".") and not d.startswith("~"):
                full_path = os.path.join(root, d)
                scanned_folders.append(full_path)
        for f in files:
            # 排除隐藏文件和系统文件
            if not f.startswith(".") and not f.startswith("~"):
                full_path = os.path.join(root, f)
                scanned_files.append(full_path)

    state["scanned_files"] = scanned_files
    state["scanned_folders"] = scanned_folders
    # 自动执行匹配
    if state["checklist"]:
        results = match_files(
            state["checklist"]["items"],
            scanned_files,
            scanned_folders,
            mode=state["match_mode"],
        )
        state["match_results"] = results
        matched_count = sum(1 for r in results if r["status"] == "已获取")
        return jsonify({
            "success": True,
            "scanned_count": len(scanned_files) + len(scanned_folders),
            "results": results,
            "matched_count": matched_count,
            "total": len(results),
        })
    else:
        return jsonify({
            "success": True,
            "scanned_count": len(scanned_files) + len(scanned_folders),
            "results": [],
            "message": "请先上传清单文件再执行匹配",
        })


@app.route("/api/match", methods=["POST"])
def do_match():
    """执行匹配（可切换匹配模式）"""
    data = request.get_json()
    mode = data.get("mode", "fuzzy")
    state["match_mode"] = mode

    if not state["checklist"]:
        return jsonify({"error": "请先上传清单文件"}), 400
    if not state["scanned_files"]:
        return jsonify({"error": "请先扫描目标文件夹"}), 400

    results = match_files(
        state["checklist"]["items"],
        state["scanned_files"],
        state.get("scanned_folders", []),
        mode=mode,
    )
    state["match_results"] = results
    matched_count = sum(1 for r in results if r["status"] == "已获取")
    return jsonify({
        "success": True,
        "results": results,
        "matched_count": matched_count,
        "total": len(results),
        "mode": mode,
    })


@app.route("/api/set-name-column", methods=["POST"])
def set_name_column():
    """手动设置文件名称列，重新提取匹配项并重新匹配"""
    data = request.get_json()
    name_col_index = data.get("name_col_index")

    if not state["checklist"]:
        return jsonify({"error": "请先上传清单文件"}), 400

    # 重新提取文件名称列表
    checklist = state["checklist"]
    items = []
    for row in checklist["data"]:
        if row and len(row) > name_col_index:
            name = row[name_col_index]
            if name and str(name).strip():
                items.append(str(name).strip())

    checklist["name_col_index"] = name_col_index
    checklist["items"] = items
    state["match_results"] = None

    # 如果已扫描文件夹，自动重新匹配
    matched_count = 0
    total = len(items)
    results = []
    if state["scanned_files"]:
        results = match_files(items, state["scanned_files"], state.get("scanned_folders", []), mode=state["match_mode"])
        state["match_results"] = results
        matched_count = sum(1 for r in results if r["status"] == "已获取")

    return jsonify({
        "success": True,
        "items": items,
        "name_col_index": name_col_index,
        "total": total,
        "results": results,
        "matched_count": matched_count,
    })


@app.route("/api/update-status", methods=["POST"])
def update_status():
    """手动更新某行的获取状态"""
    data = request.get_json()
    index = data.get("index")  # 1-based
    status = data.get("status")  # "已获取" 或 "未获取"

    if not state["match_results"]:
        return jsonify({"error": "尚无匹配结果"}), 400

    for r in state["match_results"]:
        if r["index"] == index:
            r["status"] = status
            matched_count = sum(1 for r in state["match_results"] if r["status"] == "已获取")
            return jsonify({
                "success": True,
                "matched_count": matched_count,
                "total": len(state["match_results"]),
            })

    return jsonify({"error": "未找到指定序号"}), 400


@app.route("/api/open", methods=["GET"])
def open_file():
    """通过Flask中转打开本地文件或浏览文件夹"""
    path = request.args.get("path", "")
    path = urllib.parse.unquote(path)
    if not path or not os.path.exists(path):
        return jsonify({"error": "路径不存在"}), 404

    if os.path.isdir(path):
        # 文件夹：返回内容列表页面
        items = []
        for item in os.listdir(path):
            if item.startswith(".") or item.startswith("~"):
                continue
            full = os.path.join(path, item)
            items.append({
                "name": item,
                "path": full,
                "is_dir": os.path.isdir(full),
                "size": os.path.getsize(full) if os.path.isfile(full) else None,
            })
        return render_template("folder_view.html", folder_path=path, items=items)
    else:
        # 文件：直接提供下载/打开
        directory = os.path.dirname(path)
        filename = os.path.basename(path)
        return send_file(path, as_attachment=False)


@app.route("/api/export", methods=["GET"])
def export_excel():
    """导出匹配结果为Excel"""
    if not state["match_results"]:
        return jsonify({"error": "尚无匹配结果，请先执行匹配"}), 400

    checklist = state["checklist"] or {}
    output_path = export_results(
        state["match_results"],
        headers=checklist.get("headers", []),
        data=checklist.get("data", []),
        name_col_index=checklist.get("name_col_index", 0),
    )
    return send_file(output_path, as_attachment=True, download_name="文件核对结果.xlsx")


if __name__ == "__main__":
    app.run(debug=True, port=5000)