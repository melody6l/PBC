"""审计文件匹配工具 - Flask主应用"""

import os
import json
from flask import Flask, request, jsonify, render_template, send_file
from matcher import match_files
from excel_handler import read_checklist, export_results

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = "uploads"
os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

# 全局状态（单用户模式）
state = {
    "checklist": None,       # 清单数据
    "scanned_files": None,   # 扫描到的文件列表
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
    for root, dirs, files in os.walk(folder_path):
        for f in files:
            # 排除隐藏文件和系统文件
            if not f.startswith(".") and not f.startswith("~"):
                full_path = os.path.join(root, f)
                scanned_files.append(full_path)

    state["scanned_files"] = scanned_files
    # 自动执行匹配
    if state["checklist"]:
        results = match_files(
            state["checklist"]["items"],
            scanned_files,
            mode=state["match_mode"],
        )
        state["match_results"] = results
        matched_count = sum(1 for r in results if r["status"] == "已获取")
        return jsonify({
            "success": True,
            "scanned_count": len(scanned_files),
            "results": results,
            "matched_count": matched_count,
            "total": len(results),
        })
    else:
        return jsonify({
            "success": True,
            "scanned_count": len(scanned_files),
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


@app.route("/api/export", methods=["GET"])
def export_excel():
    """导出匹配结果为Excel"""
    if not state["match_results"]:
        return jsonify({"error": "尚无匹配结果，请先执行匹配"}), 400

    checklist = state["checklist"] or {}
    output_path = export_results(
        state["match_results"],
        headers=checklist.get("headers"),
        original_data=checklist.get("data"),
    )
    return send_file(output_path, as_attachment=True, download_name="审计文件核对结果.xlsx")


if __name__ == "__main__":
    app.run(debug=True, port=5000)