"""Excel 读写处理 - 读取清单文件、导出匹配结果。"""

import os

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


def find_name_column(headers):
    """自动识别包含文件名称的列。"""
    name_keywords = ["文件名", "名称", "资料名称", "文件名称", "文档名称", "清单名称", "材料名称"]
    for i, header in enumerate(headers):
        if isinstance(header, str):
            for kw in name_keywords:
                if kw in header:
                    return i
    # 默认返回第二列，通常序号在第一列，名称在第二列
    return 1 if len(headers) > 1 else 0


def read_checklist(file_path):
    """读取 Excel 清单文件，返回列头和数据。"""
    wb = openpyxl.load_workbook(file_path)
    ws = wb.active

    rows = []
    for row in ws.iter_rows(values_only=True):
        rows.append(list(row))

    if not rows:
        return {"headers": [], "data": [], "name_col_index": 0, "items": []}

    headers = rows[0]
    data = rows[1:]
    name_col_index = find_name_column(headers)

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


def export_results(results, headers, data, name_col_index):
    """将匹配结果导出为 Excel 文件。"""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "文件核对结果"

    green_fill = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
    red_fill = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
    partial_fill = PatternFill(start_color="FFEB9C", end_color="FFEB9C", fill_type="solid")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=11)

    # 过滤掉所有数据行中都为空的列
    valid_cols = []
    for col_idx in range(len(headers)):
        header_val = headers[col_idx].strip() if col_idx < len(headers) else ""
        has_data = any(
            len(row) > col_idx and row[col_idx] and str(row[col_idx]).strip()
            for row in data
        )
        if header_val or has_data:
            valid_cols.append(col_idx)

    col_headers = [headers[c] for c in valid_cols] + ["核对结果", "文件超链接"]
    for i, h in enumerate(col_headers, 1):
        cell = ws.cell(row=1, column=i, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    # 按清单名称建立索引，便于快速定位原始行
    checklist_lookup = {}
    for row in data:
        if len(row) > name_col_index:
            name_val = str(row[name_col_index]).strip() if row[name_col_index] else ""
            if name_val and name_val not in checklist_lookup:
                checklist_lookup[name_val] = row

    row_idx = 2
    for result in results:
        checklist_name = result.get("checklist_name", "")
        orig_row = checklist_lookup.get(checklist_name, [])
        matched_files = result.get("matched_files", []) or []
        matched_names = result.get("matched_names", []) or []
        n_rows = max(1, len(matched_files))

        start_row = row_idx
        end_row = row_idx + n_rows - 1

        for sub_idx in range(n_rows):
            current_row = row_idx + sub_idx

            # 原始列只在第一行写入，后续通过纵向合并展示
            if sub_idx == 0 and orig_row:
                for col_num, col_idx in enumerate(valid_cols, 1):
                    cell_val = orig_row[col_idx] if len(orig_row) > col_idx else ""
                    cell = ws.cell(row=current_row, column=col_num, value=cell_val)
                    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

            # 核对结果列只在第一行写入，后续通过纵向合并展示
            if sub_idx == 0:
                status_col = len(valid_cols) + 1
                status_cell = ws.cell(row=current_row, column=status_col, value=result["status"])
                status_cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                if result["status"] == "已获取":
                    status_cell.fill = green_fill
                elif result["status"] == "部分获取":
                    status_cell.fill = partial_fill
                else:
                    status_cell.fill = red_fill

            # 文件超链接列：每个文件独占一行
            link_col = len(valid_cols) + 2
            if sub_idx < len(matched_files):
                file_name = matched_names[sub_idx] if sub_idx < len(matched_names) else ""
                file_path = matched_files[sub_idx]
                link_url = "file:///" + file_path.replace("\\", "/")
                link_cell = ws.cell(row=current_row, column=link_col, value=file_name)
                link_cell.hyperlink = link_url
                link_cell.font = Font(color="0563C1", underline="single")
                link_cell.alignment = Alignment(vertical="center")

        if n_rows > 1:
            # 原始列纵向合并
            for col_num in range(1, len(valid_cols) + 1):
                ws.merge_cells(
                    start_row=start_row,
                    start_column=col_num,
                    end_row=end_row,
                    end_column=col_num,
                )
                merged_cell = ws.cell(row=start_row, column=col_num)
                merged_cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

            # 状态列纵向合并
            status_col = len(valid_cols) + 1
            ws.merge_cells(
                start_row=start_row,
                start_column=status_col,
                end_row=end_row,
                end_column=status_col,
            )
            status_cell = ws.cell(row=start_row, column=status_col)
            status_cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

        row_idx += n_rows

    # 设置列宽
    for i in range(1, len(col_headers) + 1):
        if i <= len(valid_cols):
            ws.column_dimensions[get_column_letter(i)].width = 18
        elif i == len(valid_cols) + 1:
            ws.column_dimensions[get_column_letter(i)].width = 12
        else:
            ws.column_dimensions[get_column_letter(i)].width = 36

    os.makedirs("exports", exist_ok=True)
    output_path = "exports/result.xlsx"
    wb.save(output_path)
    wb.close()
    return output_path
