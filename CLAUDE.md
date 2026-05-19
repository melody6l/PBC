# 审计文件核对工具 (PBC)

## 项目概述
审计师用于核对客户提供的文件是否覆盖需求文件清单的工具。用户导入Excel清单，扫描客户资料文件夹，自动匹配文件名，在UI标记获取状态，导出核对结果。

## 技术架构
- 后端: Python Flask — 文件扫描、Excel读写、匹配逻辑
- 前端: HTML + CSS + JS（无构建工具）
- Excel: openpyxl（读清单 + 导出结果）
- 匹配: 精确匹配（文件名完全一致）+ 模糊匹配（关键词包含），用户可切换

## 项目结构
```
app.py              — Flask主应用（路由+核心逻辑）
matcher.py          — 文件匹配引擎（精确+模糊匹配）
excel_handler.py    — Excel读写（读清单、导出结果带颜色/超链接）
templates/index.html — 主页面UI
static/css/style.css — 样式
static/js/main.js   — 前端交互逻辑
requirements.txt    — flask, openpyxl
uploads/            — 上传文件临时存储
exports/            — 导出Excel输出目录
```

## API路由
- `GET /` — 主页面
- `POST /api/upload-checklist` — 上传Excel清单，自动识别文件名称列
- `POST /api/scan-folder` — 输入路径扫描文件夹，有清单时自动执行匹配
- `POST /api/match` — 执行匹配（参数: mode=exact/fuzzy）
- `POST /api/update-status` — 手动切换某行获取状态
- `GET /api/export` — 导出结果为Excel（带颜色标识和超链接）

## 当前状态
- 代码已全部编写完成，尚未运行测试
- 系统未安装Python，需先安装 Python 3.10+ 后执行:
  ```
  python -m pip install flask openpyxl
  python app.py
  ```
  浏览器访问 http://localhost:5000

## 待完成
- 安装Python并启动应用测试全流程
- 验证: 上传清单 → 扫描文件夹 → 切换匹配模式 → 手动改状态 → 导出Excel