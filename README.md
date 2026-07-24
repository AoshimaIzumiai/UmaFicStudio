# UmaFicStudio — 架空赛马设定管理工具

[English](#english) | [中文](#中文)

---

## 中文

面向喜欢设定和编写架空赛马的爱好者，提供血统、赛事、人物等全方位设定管理功能。

### 功能

#### 种马数据库
- 浏览 4400+ 匹真实种马数据（日本 1974-2025 供用种牡马 + 国际名马）
- 五代血统表展示（表格式 + 树形图）
- 多维度筛选（国家、场地适性、距离适性、供用年份、父系谱系）
- ※仅收录史实种牡马数据，不含史实牝马或未入种牡马

#### 架空马管理
- 创建/编辑架空马，自由指定血统关系
- Cross（近亲交配）自动计算与高亮
- 配种模拟（预览后代血统与 Cross）
- 配种推荐（Cross 平衡度评分 + 近亲警告）
- 年份约束校验（严谨模式 / 自由模式）
- 受保护马名检测（IFHA 2025）

#### 赛事系统
- 架空国赛事模板创建（分级、距离、场地、限定条件）
- 比赛记录录入（着顺、骑手、人气、奖金、闸位、用时、着差等）
- 战绩表自动生成（胜率、连对率、分级赛胜数）
- 同着（Dead Heat）支持
- 系列赛设定
- JRA 140 场重赏赛预置数据

#### 人物与组织
- 马主 / 练马师 / 牧场 / 骑手 CRUD
- 详情页整合关联马匹列表
- 骑手骑乘战绩与重赏胜利一览
- 转厩/转手记录（用户自定义设定）

#### 母系管理
- 牝系族群分组
- 繁殖牝马后代展开

#### 产驹成绩
- 种牡马：产驹成绩 + BMS 成绩统计
- 繁殖牝马：产驹数量 + 全部产驹列表

#### 时间线
- 按年份展示架空马生涯大事年表
- 自动推算出道年，不同事件类型图标着色

#### Press（竞马文章编辑器）
- Markdown 编辑 + 竞马风格主题渲染
- 数据块嵌入（血统表、战绩、出马表等）
- PNG / PDF 导出
- 草稿管理 + 自动保存

#### 导出与分享
- PDF / PNG 高清导出（五代血统表 + 战绩 + 产驹成绩）
- Excel 导出（带样式五代血统表 + 比赛记录）
- 名片码分享（压缩马匹数据为文本码，可跨用户导入）
- 数据导入/导出（JSON 格式）
- 赛事数据独立导入/导出

### 运行方式

**在线访问：** https://umaficstudio.com

**本地运行：**
```bash
python3 -m http.server 8080
```
然后在浏览器中访问 `http://localhost:8080`

### 技术栈

- 纯原生 HTML/CSS/JavaScript，无外部依赖
- 数据存储：IndexedDB（浏览器本地）
- 部署：Cloudflare Pages
- 离线可用

### 使用须知

发布和该工具相关的内容时（如在社交媒体发表由该网页制成的血统表等），请标注来源：https://github.com/AoshimaIzumiai/UmaFicStudio

### 数据说明

本项目中的真实种马数据（马名、血统关系、配种年份等）均为赛马界的公开客观事实信息，由项目作者独立整理编排，不代表任何特定数据库的复制或转载。

本项目仅供个人学习、研究及同人创作使用，不用于任何商业目的。如有权利方认为本项目内容侵犯了相关权益，请通过 Issue 联系，将在确认后及时处理。

---

## English

A world-building tool for fictional horse racing enthusiasts, providing comprehensive management of bloodlines, races, characters, and more.

### Features

#### Stallion Database
- Browse 4,400+ real stallion records (Japan 1974–2025 stud stallions + international sires)
- Five-generation pedigree display (table & tree view)
- Multi-dimensional filtering (country, surface, distance aptitude, stud years, sire line)
- ※ Only real-world stallions are included; no mares or non-stud horses

#### Fictional Horse Management
- Create/edit fictional horses with custom bloodline relationships
- Automatic inbreeding (Cross) calculation & highlighting
- Breeding simulation (preview offspring pedigree & crosses)
- Breeding recommendations (Cross balance scoring + inbreeding warnings)
- Year constraint validation (strict mode / free mode)
- Protected horse name detection (IFHA 2025)

#### Race System
- Custom race templates (grading, distance, surface, conditions)
- Race result entry (finish position, jockey, odds, prize, gate, time, margins, etc.)
- Auto-generated career stats (win rate, place rate, graded wins)
- Dead heat support
- Series racing
- 140 JRA graded races pre-loaded

#### Characters & Organizations
- Owner / Trainer / Farm / Jockey CRUD
- Detail pages with linked horse lists
- Jockey riding records & graded race victories
- Stable/ownership transfer records

#### Dam Line Management
- Female family grouping
- Broodmare offspring expansion

#### Progeny Records
- Stallions: progeny results + BMS (broodmare sire) statistics
- Broodmares: foal count + complete foal list

#### Timeline
- Year-by-year career event chronology for fictional horses
- Auto-calculated debut year with color-coded event icons

#### Press (Racing Article Editor)
- Markdown editing + racing-themed rendering
- Data block embedding (pedigree, race results, runner lists, etc.)
- PNG / PDF export
- Draft management + auto-save

#### Export & Sharing
- High-quality PDF / PNG export (pedigree + race record + progeny)
- Excel export (styled pedigree table + race records)
- Share card (compressed horse data as text code, importable cross-user)
- Data import/export (JSON)
- Independent race data import/export

### Getting Started

**Online:** https://umaficstudio.com

**Run locally:**
```bash
python3 -m http.server 8080
```
Then visit `http://localhost:8080` in your browser.

### Tech Stack

- Pure vanilla HTML/CSS/JavaScript, no framework dependencies
- Storage: IndexedDB (browser-local)
- Deployment: Cloudflare Pages
- Works offline

### Attribution

When publishing content made with this tool (e.g., pedigree charts on social media), please credit: https://github.com/AoshimaIzumiai/UmaFicStudio

### Disclaimer

All real stallion data (names, pedigree relationships, stud years, etc.) in this project consists of publicly known objective facts in the horse racing industry, independently compiled and organized by the project author. This does not represent a copy or reproduction of any specific database.

This project is intended solely for personal study, research, and fan creation purposes, and is not used for any commercial purpose. If any rights holder believes that the content of this project infringes upon their rights, please contact us via Issue and it will be promptly addressed upon confirmation.
