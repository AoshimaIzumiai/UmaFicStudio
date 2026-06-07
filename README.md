# UmaStudio — 架空赛马血统管理工具

面向喜欢设定和编写架空赛马的爱好者，提供血统管理、查询、创建功能。

## 功能

- 浏览真实种马数据库（日本近10年种牡马）
- 创建/管理架空马，自由指定血统
- 五代血统表展示（表格式 + 树形图）
- Cross（近亲交配）自动计算与高亮
- 配种模拟（预览后代血统与 Cross）
- 母系（牝系）族群管理
- 数据导入/导出

## 运行方式

### 在线访问
部署到 GitHub Pages 后直接访问。

### 本地运行
```bash
python3 serve.py
```
然后在浏览器中访问 `http://localhost:8080`

## 演示视频

https://www.bilibili.com/video/BV1w5EJ6gEsY/

## 使用须知

发布和该工具相关的内容时（如在社交媒体发表由该网页制成的血统表等），请标注来源：https://github.com/AoshimaIzumiai/UmaStudio

## 数据说明

本项目中的真实种马数据（马名、血统关系、配种年份等）均为赛马界的公开客观事实信息，由项目作者独立整理编排，不代表任何特定数据库的复制或转载。

本项目仅供个人学习、研究及同人创作使用，不用于任何商业目的。如有权利方认为本项目内容侵犯了相关权益，请通过 Issue 联系，将在确认后及时处理。

## Disclaimer

All real stallion data (names, pedigree relationships, stud years, etc.) in this project consists of publicly known objective facts in the horse racing industry, independently compiled and organized by the project author. This does not represent a copy or reproduction of any specific database.

This project is intended solely for personal study, research, and fan creation purposes, and is not used for any commercial purpose. If any rights holder believes that the content of this project infringes upon their rights, please contact us via Issue and it will be promptly addressed upon confirmation.

## 技术栈

- 纯原生 HTML/CSS/JavaScript，无外部依赖
- 数据存储：IndexedDB（浏览器本地）
- 离线可用
