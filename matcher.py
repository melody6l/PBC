"""文件匹配引擎 - 支持精确匹配和模糊匹配"""

import os
import re


def extract_keywords(name):
    """从文件名中提取核心关键词，去除序号、特殊字符等"""
    # 移除常见序号前缀：如 "1.", "1)", "(1)", "一、", "第1项" 等
    cleaned = re.sub(r'^[\(（]?\d+[\)）]?[.、\s]*', '', name)
    cleaned = re.sub(r'^第\d+项[、\s]*', '', cleaned)
    cleaned = re.sub(r'^[一二三四五六七八九十]+[、\s]*', '', cleaned)
    # 移除括号内的序号说明
    cleaned = re.sub(r'[\(（][^)）]*[\)）]', '', cleaned)
    # 移除特殊字符，保留中文、字母、数字
    cleaned = re.sub(r'[^\w一-鿿]+', ' ', cleaned)
    # 拆分为关键词列表
    keywords = [kw.strip() for kw in cleaned.split() if kw.strip()]
    return keywords


def exact_match(checklist_name, scanned_files):
    """精确匹配：清单文件名与实际文件名完全一致（忽略扩展名）"""
    # 清单名称去除扩展名
    checklist_base = os.path.splitext(checklist_name)[0]
    matches = []
    for file_path in scanned_files:
        file_name = os.path.basename(file_path)
        file_base = os.path.splitext(file_name)[0]
        if checklist_base == file_base:
            matches.append(file_path)
    return matches


def fuzzy_match(checklist_name, scanned_files):
    """模糊匹配：清单关键词出现在实际文件名中即匹配"""
    keywords = extract_keywords(checklist_name)
    if not keywords:
        return []
    matches = []
    for file_path in scanned_files:
        file_name = os.path.basename(file_path)
        file_base = os.path.splitext(file_name)[0]
        # 所有关键词都出现在文件名中才算匹配
        if all(kw.lower() in file_base.lower() for kw in keywords):
            matches.append(file_path)
    return matches


def match_files(checklist_items, scanned_files, mode="fuzzy"):
    """
    对清单中的每一项执行匹配

    参数:
        checklist_items: 清单文件名列表
        scanned_files: 扫描得到的文件路径列表
        mode: "exact" 或 "fuzzy"

    返回:
        匹配结果列表，每项包含:
        - index: 序号
        - checklist_name: 清单中的名称
        - status: "已获取" 或 "未获取"
        - matched_files: 匹配到的文件路径列表
        - matched_names: 匹配到的文件名列表
    """
    results = []
    match_func = exact_match if mode == "exact" else fuzzy_match

    for i, item in enumerate(checklist_items):
        checklist_name = item if isinstance(item, str) else str(item)
        matched = match_func(checklist_name, scanned_files)
        status = "已获取" if matched else "未获取"
        matched_names = [os.path.basename(f) for f in matched]
        results.append({
            "index": i + 1,
            "checklist_name": checklist_name,
            "status": status,
            "matched_files": matched,
            "matched_names": matched_names,
        })
    return results