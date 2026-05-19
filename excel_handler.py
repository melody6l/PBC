"""Excel读写处理 - 读取清单文件、导出匹配结果"""

import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment
from openpyxl.utils import get_column_letter


def find_name_column(headers):
    """自动识别包含文件名称的列"""
    name_keywords = ["文件名", "名称", "资料名称", "文件名称", "文档名称", "清单名称", "材料名称"]
    for i, header in enumerate(headers):
        if isinstance(header, str):
            for kw in name_keywords:
                if kw in header:
                    return i
    # 默认返回第二列（通常序号在第一列，名称在第二列）
    return 1 if len(headers) > 1 else 0


def read_checklist(file_path):
    """读取Excel清单文件，返回列头和数据"""
    wb = openpyxl.load_workbook(file_path)
    ws = wb.active

    # 读取所有行
    rows = []
    for row in ws.iter_rows(values_only=True):
        rows.append(list(row))

    if not rows:
        return {"headers": [], "data": [], "name_col_index": 0, "items": []}

    # 第一行作为列头
    headers = rows[0]
    data = rows[1:]

    # 自动识别文件名称列
    name_col_index = find_name_column(headers)

    # 提取文件名称列表（用于匹配）
    items = []
    for row in data:
        if row and len(row) > name_col_index:
            name = row[name_col_index]
            if name and str(name).strip():
                items.append(str(name).strip())

    wb.close()
    return {
        "headers": [str(h) if h else "" for h in headers],
        "data": [[str(cell) if cell else "" for cell in row] for row in data],
        "name_col_index": name_col_index,
        "items": items,
    }


def export_results(results, headers=None, original_data=None):
    """将匹配结果导出为Excel文件"""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "审计文件核对结果"

    # 定义填充色
    green_fill = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
    red_fill = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=11)

    # 写入列头
    col_headers = ["序号", "文件名称", "获取状态", "匹配到的文件名", "备注"]
    if headers and original_data:
        # 保留原始清单的额外列
        for h in headers:
            if h and h not in ["序号", "文件名称", "名称"]:
                col_headers.append(h)

    for i, h in enumerate(col_headers, 1):
        cell = ws.cell(row=1, column=i, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    # 写入数据
    for row_idx, result in enumerate(results, 2):
        ws.cell(row=row_idx, column=1, value=result["index"]).alignment = Alignment(horizontal="center")
        ws.cell(row=row_idx, column=2, value=result["checklist_name"])

        status_cell = ws.cell(row=row_idx, column=3, value=result["status"])
        status_cell.alignment = Alignment(horizontal="center")
        if result["status"] == "已获取":
            status_cell.fill = green_fill
        else:
            status_cell.fill = red_fill

        # 匹配到的文件名（多个用逗号分隔）
        matched_str = ", ".join(result["matched_names"]) if result["matched_names"] else ""
        ws.cell(row=row_idx, column=4, value=matched_str)

        # 备注
        ws.cell(row=row_idx, column=5, value="")

        # 添加超链接（如果有匹配到的文件）
        if result["matched_files"]:
            link_path = result["matched_files"][0]
            # Windows路径转file:///格式
            link_url = "file:///" + link_path.replace("\\", "/")
            ws.cell(row=row_idx, column=4).hyperlink = link_url

    # 设置列宽
    col_widths = [6, 30, 10, 40, 15]
    for i, width in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = width

    # 保存到临时文件
    output_path = "exports/result.xlsx"
    import os
    os.makedirs("exports", exist_ok=True)
    wb.save(output_path)
    wb.close()
    return output_path