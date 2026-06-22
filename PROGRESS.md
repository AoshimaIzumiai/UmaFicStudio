# 开发进度记录

## 2026-06-22 会话

### Bug 修复

1. **马匹编辑保存无反应** — 距离适性改版时遗留多余 `</div>`，破坏 form 结构导致 submit 按钮落在 form 外面。已修复。
2. **血统表内创建牝马回车无效** — 缺 `event.preventDefault()`，回车被 form 默认行为吞掉。已修复。
3. **创建牝马后血统表不显示新名字** — 顶层马的 `pedigree_cache` 未清除。已修复。
4. **修改子孙马名字后上层血统表仍显示旧名** — `onHorseUpdated` 递归在中间层无缓存时中断。改为无论有无缓存都继续递归。已修复。
5. **创建牝马时不继承母父** — 新增逻辑：检查 parent 的 pedigree_cache 中是否已知该母位的 sire，有则自动填入新牝马的 `sire_id`。

### 性能优化

- Cross 浓度检查改为 `setTimeout` 异步，不阻塞保存流程
- `Pedigree.onHorseUpdated` 加入 visited Set 防循环递归

### 数据更新

| 项目 | 结果 |
|------|------|
| 日文名 (name_ja) | 3035/3035 全部写入 |
| 中文名 (name_cn) | 678/3035（wpstud 642 + 民间表港译 36） |
| 数据来源 wpstud.com | 已保存 `reference/wpstud_translations.json`（2677 条） |
| 未匹配列表 | `reference/种马未匹配中文名.xlsx` |

### 未完成 / 待运行

1. **1974-1989 种马扩充**：脚本 `crawl_1974_stallions.py` 已写好
   - 529 匹新马（每年 top100 去重），ID 在 `raw_data/new_stallions_1974_1989_top100.json`
   - 含五代血统爬取（BFS 层序解析，已验证正确）
   - 运行命令：`cmd-crawl-1974-stallions.txt`
   - 爬完后需要合并到 `stallions_index.json` 和 pedigree 数据

2. **中文名补充**：爬完 1974 马后可再用 wpstud + 民间表交叉匹配一次

3. **种马中文名分类表重新生成**：等所有数据稳定后重新生成 `reference/种马中文名分类.xlsx`

### 修改文件清单

- `js/ui-horse.js` — 保存卡死修复、标签多余 div 移除
- `js/ui-pedigree.js` — 创建牝马 preventDefault + 缓存清除 + sire 继承
- `js/pedigree.js` — onHorseUpdated 递归修复
- `data/stallions_index.json` — name_ja 全量写入 + name_cn 678 条
- `crawl_ja_names.py` — 日文名爬虫（已完成）
- `crawl_1974_stallions.py` — 1974-1989 种马爬虫（待运行）
- `PROGRESS.md` — 本文件
