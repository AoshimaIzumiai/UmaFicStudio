# 开发进度记录

> 更新时间：2026-06-06 20:17

## 当前状态

literal:### 数据收集
- **近10年 (2016-2025)**：✅ 全部完成，1143 匹种马，1143 匹完整五代血统
- **2000-2015 扩展**：脚本已写好 (`crawl_extend.py`)，待执行
  - 下载旧年份 CSV → 找出新种马 → 补充配种年份
- **配种年份补充**：在扩展脚本中一并处理
- **数据去重**：已完成，index 1101 匹唯一种马

### 前端功能

| 模块 | 状态 |
|------|------|
| 数据加载（双层：index + pedigree 分片） | ✅ |
| 搜索（模糊 + 筛选：产国/场地/距离） | ✅ |
| 血统表（表格式，5代，牡灰/牝白，可点击跳转） | ✅ |
| 血统表（树形图） | ✅ |
| 代数切换（3/4/5代，Cross 跟随） | ✅ |
| Cross 计算（中止规则 + 全兄弟合并） | ✅ |
| Cross 高亮（含兄弟组同色） | ✅ |
| Cross 浓度警告（≤3×3 触发） | ✅ |
| 架空马 CRUD（含父/母搜索提示、性别过滤） | ✅ |
| 架空马 `*` 标记（全局） | ✅ |
| 角色管理（种牡马/繁殖牝马时显示配种年份字段） | ✅ |
| 母系管理（根母马展开族谱、后代算已分组） | ✅ |
| 配种模拟 | ✅ |
| 导入/导出 | ✅ |
| 血统完整度指示器 | ✅ |
| 年份约束（严谨/架空模式切换） | ✅ |
| 错误处理（删除被引用时提示、循环引用检测） | ✅ |
| 返回导航 | ✅ |
| 响应式基础（移动端） | ✅ |
| .gitignore | ✅ |

### 已知问题 / 待办

- [ ] literal:扩展收录 2000-2015 年种马（脚本就绪，待执行）
- [ ] 补充所有种马的配种起止年份
- [ ] GitHub Pages 部署
- [ ] README 最终完善
- [ ] 后续维度扩展：出生牧场、练马师、马主等
- [ ] 赛事系统（远期）

## 脚本命令

```bash
# 启动本地前端
cd /Users/zejingyin/development/studData
python3 -m http.server 8080

literal:# 执行扩展数据获取（2000-2015 + 配种年份）
nohup python3 -u crawl_extend.py > extend.log 2>&1 &

# 执行后更新前端数据
python3 -c "
import json, os
with open('crawl_progress.json','r') as f:
    p = json.load(f)
index = {'version': '2026.1', 'count': len(p['index_data']), 'horses': p['index_data']}
with open('data/stallions_index.json', 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False, indent=2)
os.makedirs('data/pedigree', exist_ok=True)
for f2 in os.listdir('data/pedigree'): os.remove(f'data/pedigree/{f2}')
ids = list(p['pedigree_data'].keys())
for i in range(0, len(ids), 100):
    batch = {k: p['pedigree_data'][k] for k in ids[i:i+100]}
    with open(f'data/pedigree/pedigree_{i//100:02d}.json', 'w', encoding='utf-8') as f:
        json.dump(batch, f, ensure_ascii=False, indent=2)
print(f'更新完成: index={len(p[\"index_data\"])}, pedigree={len(ids)}')
"
```

## 项目文件结构

```
studData/
├── index.html
├── serve.py
├── css/style.css
├── js/
│   ├── app.js, utils.js, storage.js
│   ├── data-loader.js, pedigree.js, cross.js
│   ├── year-validator.js, search.js, export-import.js
│   └── ui-pedigree.js, ui-horse.js, ui-damline.js, ui-simulate.js
├── data/
│   ├── stallions_index.json (1101 匹)
│   └── pedigree/ (12 个分片)
├── crawl_pedigree.py (literal:主脚本)
├── crawl_extend.py (literal:扩展脚本)
├── crawl_retry.py, crawl_retry2.py literal:(补充获取)
├── download_and_dedup.py (CSV下载去重)
├── .gitignore
├── README.md
├── PROGRESS.md (本文件)
└── 各类设计/需求文档
```
