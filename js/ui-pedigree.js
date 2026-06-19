/* ui-pedigree.js — 血统表渲染（表格式 + 树形图 + Cross 高亮） */
'use strict';

const UIPedigree = {
  currentView: 'table', // 'table' or 'tree' — 默认表格式
  currentGens: 5, // 显示代数：3、4、5
  crossColors: ['#e74c3c', '#2980b9', '#27ae60', '#8e44ad', '#f39c12', '#1abc9c'],

  /**
   * 显示一匹马的血统表
   */
  async show(horseId) {
    App.showView('pedigree');
    const container = document.getElementById('pedigree-content');
    container.innerHTML = '<p>加载中...</p>';

    const horse = await Pedigree._findHorse(horseId);
    const tree = await Pedigree.getPedigreeTree(horseId);
    // 如果找不到 horse 记录但有 pedigree 数据，构建一个最小显示对象
    const displayHorse = horse || (tree ? { name_en: horseId, country: '', type: '' } : null);
    const crossResult = tree ? Cross.calculateCross(tree, this.currentGens) : null;

    container.innerHTML = `
      <div class="pedigree-header">
        <div>
          <button class="btn btn-secondary btn-sm" onclick="App.showView('search')">← 返回</button>
          <h3 style="display:inline;margin-left:12px">${Utils.displayName(displayHorse)}${displayHorse && displayHorse.created_mode ? ` <span class="mode-badge ${displayHorse.created_mode === 'strict' ? 'mode-strict' : ''}">${displayHorse.created_mode === 'strict' ? '严谨' : '架空'}</span>` : ''}</h3>
        </div>
        <div class="pedigree-controls">
          <button class="btn btn-secondary ${this.currentGens === 3 ? 'active' : ''}" onclick="UIPedigree.switchGens(3, '${horseId}')">${I18N.t('gens3')}</button>
          <button class="btn btn-secondary ${this.currentGens === 4 ? 'active' : ''}" onclick="UIPedigree.switchGens(4, '${horseId}')">${I18N.t('gens4')}</button>
          <button class="btn btn-secondary ${this.currentGens === 5 ? 'active' : ''}" onclick="UIPedigree.switchGens(5, '${horseId}')">${I18N.t('gens5')}</button>
          <span style="margin:0 8px;color:#ccc">|</span>
          <button class="btn btn-secondary ${this.currentView === 'table' ? 'active' : ''}" onclick="UIPedigree.switchView('table', '${horseId}')">${I18N.t('tableView')}</button>
          <button class="btn btn-secondary ${this.currentView === 'tree' ? 'active' : ''}" onclick="UIPedigree.switchView('tree', '${horseId}')">${I18N.t('treeView')}</button>
          <span style="margin:0 8px;color:#ccc">|</span>
          <button class="btn btn-secondary" id="btn-export-pdf" onclick="PDFExport.showModal('${horseId}')">${I18N.t('pedigreePrint')}</button>
          ${displayHorse && displayHorse.type === 'fictional' ? `<button class="btn btn-secondary" onclick="PDFExport.showProfileModal('${horseId}')">${I18N.t('profilePrint')}</button>` : ''}
        </div>
      </div>
      <div id="pedigree-display">
        ${this.currentView === 'table' ? this._renderTable(tree, crossResult, displayHorse) : this._renderTree(tree, crossResult, displayHorse)}
      </div>
      ${crossResult ? this._renderCrossPanel(crossResult) : ''}
      ${tree ? this._renderCompleteness(tree) : ''}
      ${displayHorse && displayHorse.type === 'fictional' ? await this._renderYearWarnings(displayHorse) : ''}
    `;
  },

  /** 架空马整合详情页（真实马 fallback 到 show） */
  async showDetail(horseId) {
    const horse = await Storage.getHorse(horseId);
    if (!horse || horse.type !== 'fictional') {
      return this.show(horseId);
    }
    App.showView('pedigree');
    const container = document.getElementById('pedigree-content');
    container.innerHTML = '<p>加载中...</p>';

    const tree = await Pedigree.getPedigreeTree(horseId);
    const crossResult = tree ? Cross.calculateCross(tree, this.currentGens) : null;

    // 解析实体名称
    const farmName = horse.farm ? await this._resolveEntityName('farms', horse.farm) : '';
    const trainerName = horse.trainer ? await this._resolveEntityName('trainers', horse.trainer) : '';
    const ownerName = horse.owner ? await this._resolveEntityName('owners', horse.owner) : '';

    // 标题：所有非空名字
    const names = [horse.name_en, horse.name_ja, horse.name_cn].filter(Boolean);
    const displayName = names[0] || '???';
    const subNames = names.slice(1).join('  ');

    container.innerHTML = `
      <div class="horse-detail-header">
        <div>
          <h3>${displayName}${horse.type === 'fictional' ? '*' : ''}${horse.country ? '(' + horse.country + ')' : ''}
            ${horse.created_mode ? `<span class="mode-badge ${horse.created_mode === 'strict' ? 'mode-strict' : ''}">${horse.created_mode === 'strict' ? '严谨' : '架空'}</span>` : ''}
          </h3>
          ${subNames ? `<div class="horse-detail-names">${subNames}</div>` : ''}
        </div>
        <div class="horse-detail-actions">
          <button class="btn btn-secondary btn-sm" onclick="App.showView('manage')">← 返回</button>
          <button class="btn btn-secondary btn-sm" onclick="UIHorse.showDetail('${horseId}')">编辑</button>
          <button class="btn btn-secondary btn-sm" onclick="PDFExport.showModal('${horseId}')">${I18N.t('pedigreePrint')}</button>
          <button class="btn btn-secondary btn-sm" onclick="PDFExport.showProfileModal('${horseId}')">${I18N.t('profilePrint')}</button>
        </div>
      </div>

      <div class="detail-section">
        <h4>${I18N.t('basicInfo')}</h4>
        <table class="detail-table">
          <tr><td class="dt">${I18N.t("sex")}</td><td class="dd">${Utils.sexLabel(horse.sex)}</td><td class="dt">${I18N.t("birthYear")}</td><td class="dd">${horse.birth_year || '—'}</td></tr>
          <tr><td class="dt">${I18N.t("country")}</td><td class="dd">${horse.country || '—'}</td><td class="dt">${I18N.t("color")}</td><td class="dd">${Utils.colorLabel(horse.color) || '—'}</td></tr>
          <tr><td class="dt">${I18N.t("role")}</td><td class="dd">${Utils.roleLabel(horse.role)}</td><td class="dt">${I18N.t("studYears")}</td><td class="dd">${horse.stud_year_start ? horse.stud_year_start + '—' + (horse.stud_year_end || '') : '—'}</td></tr>
          <tr><td class="dt">${I18N.t('surface')}</td><td class="dd">${(horse.aptitude_surface || []).map(s => Utils.surfaceLabel(s)).join('/') || '—'}</td><td class="dt">${I18N.t('distance')}</td><td class="dd">${(horse.aptitude_distance || []).map(d => I18N.t(d)).join('/') || '—'}</td></tr>
        </table>
      </div>

      ${farmName || trainerName || ownerName || horse.name_meaning || horse.notes ? `
      <div class="detail-section">
        <h4>${I18N.t('extInfo')}</h4>
        <table class="detail-table">
          ${farmName ? `<tr><td class="dt">${I18N.t("farm")}</td><td class="dd"><span class="entity-link" onclick="UIEntities.renderDetail('farm','${horse.farm}')">${farmName}</span></td><td class="dt"></td><td class="dd"></td></tr>` : ''}
          ${trainerName ? `<tr><td class="dt">${I18N.t("trainer")}</td><td class="dd"><span class="entity-link" onclick="UIEntities.renderDetail('trainer','${horse.trainer}')">${trainerName}</span></td>${ownerName ? `<td class="dt">${I18N.t("owner")}</td><td class="dd"><span class="entity-link" onclick="UIEntities.renderDetail('owner','${horse.owner}')">${ownerName}</span></td>` : '<td class="dt"></td><td class="dd"></td>'}</tr>` : (ownerName ? `<tr><td class="dt">${I18N.t("owner")}</td><td class="dd"><span class="entity-link" onclick="UIEntities.renderDetail('owner','${horse.owner}')">${ownerName}</span></td><td class="dt"></td><td class="dd"></td></tr>` : '')}
          ${horse.name_meaning ? `<tr><td class="dt">${I18N.t("nameMeaning")}</td><td class="dd" colspan="3">${horse.name_meaning}</td></tr>` : ''}
          ${horse.notes ? `<tr><td class="dt">${I18N.t("notes")}</td><td class="dd" colspan="3">${horse.notes}</td></tr>` : ''}
        </table>
      </div>
      ` : ''}

      ${horse.show_history && horse.history && horse.history.length > 0 ? `
      <div class="detail-section">
        <h4>${I18N.t('changeHistory')}</h4>
        <table class="race-record-table">
          <thead><tr><th>${I18N.t('date')}</th><th>${I18N.t('type')}</th><th>${I18N.t('from')}</th><th>${I18N.t('to')}</th></tr></thead>
          <tbody>${horse.history.map(h => {
            const typeLabel = h.type === 'owner' ? I18N.t('owner') : h.type === 'trainer' ? I18N.t('trainer') : I18N.t('farm');
            return `<tr><td>${h.date || '—'}</td><td>${typeLabel}</td><td>${h.from_name || '—'}</td><td>${h.to_name || '—'}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      ` : ''}

      <div class="detail-section">
        <h4>${I18N.t('pedigree')}</h4>
        <div class="pedigree-controls">
          <button class="btn btn-secondary ${this.currentGens === 3 ? 'active' : ''}" onclick="UIPedigree._switchDetailGens(3, '${horseId}')">${I18N.t('gens3')}</button>
          <button class="btn btn-secondary ${this.currentGens === 4 ? 'active' : ''}" onclick="UIPedigree._switchDetailGens(4, '${horseId}')">${I18N.t('gens4')}</button>
          <button class="btn btn-secondary ${this.currentGens === 5 ? 'active' : ''}" onclick="UIPedigree._switchDetailGens(5, '${horseId}')">${I18N.t('gens5')}</button>
          <span style="margin:0 8px;color:#ccc">|</span>
          <button class="btn btn-secondary ${this.currentView === 'table' ? 'active' : ''}" onclick="UIPedigree._switchDetailView('table', '${horseId}')">${I18N.t('tableView')}</button>
          <button class="btn btn-secondary ${this.currentView === 'tree' ? 'active' : ''}" onclick="UIPedigree._switchDetailView('tree', '${horseId}')">${I18N.t('treeView')}</button>
        </div>
        <div id="pedigree-display">
          ${this.currentView === 'table' ? this._renderTable(tree, crossResult, horse) : this._renderTree(tree, crossResult, horse)}
        </div>
      </div>

      ${crossResult ? this._renderCrossPanel(crossResult) : ''}
      ${tree ? this._renderCompleteness(tree) : ''}
      ${await this._renderYearWarnings(horse)}
      ${await this._renderRaceRecord(horseId)}
    `;
  },

  async _renderRaceRecord(horseId) {
    const allResults = await Storage.getAllEntities('results');
    const records = [];
    for (const r of allResults) {
      const entry = (r.entries || []).find(e => e.horse_id === horseId);
      if (entry) records.push({ ...r, _entry: entry });
    }
    if (records.length === 0) {
      return `<div class="detail-section"><h4>${I18N.t('raceRecord')}</h4><p class="empty">暂无出赛记录</p><button class="btn btn-secondary btn-sm" onclick="UIResults.showForm({horseId:'${horseId}'})">${I18N.t('addRecord')}</button></div>`;
    }

    // 排序：year 倒序，同年按 schedule 月份倒序
    const parseSchedule = (s) => { const m = s?.match(/(\d+)月第(\d+)周第(\d+)/); return m ? [+m[1],+m[2],+m[3]] : [99,99,99]; };
    records.sort((a, b) => {
      if ((a.year || 0) !== (b.year || 0)) return (a.year || 0) - (b.year || 0);
      const [am,aw,ad] = parseSchedule(a.schedule);
      const [bm,bw,bd] = parseSchedule(b.schedule);
      return am-bm || aw-bw || ad-bd;
    });

    // 统计
    const entries = records.map(r => r._entry);
    const validEntries = entries.filter(e => !e.status || e.status === 'relegated');
    const total = validEntries.length;
    const wins = validEntries.filter(e => e.finish === 1).length;
    const seconds = validEntries.filter(e => e.finish === 2).length;
    const thirds = validEntries.filter(e => e.finish === 3).length;
    const rest = total - wins - seconds - thirds;
    const totalPrize = entries.reduce((s, e) => s + (e.prize || 0), 0);
    const rentaiRate = total > 0 ? ((wins + seconds) / total * 100).toFixed(1) : 0;
    const fukushoRate = total > 0 ? ((wins + seconds + thirds) / total * 100).toFixed(1) : 0;
    // 分级赛/G1 统计
    const gradedGrades = ['G1','G2','G3','L','JG1','JG2','JG3'];
    const validRecords = records.filter(r => !r._entry.status || r._entry.status === 'relegated');
    const gradedWins = validRecords.filter(r => gradedGrades.includes(r.grade) && r._entry.finish === 1).length;
    const g1Wins = validRecords.filter(r => (r.grade === 'G1' || r.grade === 'JG1') && r._entry.finish === 1).length;

    // 获取马的出生年用于计算年龄
    const horse = await Storage.getHorse(horseId);
    const birthYear = horse?.birth_year;

    // 系列赛达成检测
    const seriesAchievements = await this._checkSeriesAchievements(horseId, records, birthYear);

    const rows = await Promise.all(records.map(async r => {
      const e = r._entry;
      const age = birthYear && r.year ? r.year - birthYear : '';
      const scheduleDisplay = r.schedule ? r.schedule.replace('比赛日', '日') : '';
      const yearStr = r.year ? `${r.year}年` : '';
      const ageStr = age ? `(${age}岁)` : '';
      const dateCol = yearStr + (scheduleDisplay ? ' ' + scheduleDisplay : '') + ageStr;
      const jockey = e.jockey_id ? await Storage.getEntity('jockeys', e.jockey_id) : null;
      return `<tr>
        <td>${dateCol}</td>
        <td>${r.race_name || ''}</td>
        <td>${r.grade || ''}</td>
        <td>${r.distance ? r.distance + 'm' : ''}</td>
        <td>${r.surface === 'turf' ? '草地' : r.surface === 'dirt' ? '泥地' : ''}</td>
        <td>${e.status === 'disqualified' ? '失格' : e.status === 'pulled_up' ? '中止' : e.status === 'scratched' ? '取消' : e.status === 'excluded' ? '除外' : e.status === 'relegated' ? e.finish + '着(降)' : e.finish + '着'}</td>
        <td>${jockey ? jockey.name : ''}</td>
        <td>${e.popularity ? '第' + e.popularity + '人气' : ''}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="UIResults._editResult('${r.id}')">编辑</button> <button class="btn btn-danger btn-sm" onclick="UIResults._deleteResultFromDetail('${r.id}','${horseId}')">×</button></td>
      </tr>`;
    }));

    return `
      <div class="detail-section">
        <h4>${I18N.t('raceRecord')}</h4>
        <div class="race-stats">${total}战${wins}胜 [${wins}-${seconds}-${thirds}-${rest}]　　连对率${rentaiRate}%　　复胜率${fukushoRate}%${gradedWins ? `　　分级赛${gradedWins}胜` : ''}${g1Wins ? `　　G1 ${g1Wins}胜` : ''}${seriesAchievements ? `　　${seriesAchievements}` : ''}${totalPrize ? `　　总奖金:¥${totalPrize.toLocaleString()}` : ''}</div>
        <button class="btn btn-secondary btn-sm" onclick="UIResults.showForm({horseId:'${horseId}'})" style="margin-bottom:8px">${I18N.t('addRecord')}</button>
        <table class="race-record-table">
          <thead><tr><th>日程</th><th>赛名</th><th>等级</th><th>距离</th><th>场地</th><th>名次</th><th>骑手</th><th>人气</th><th>操作</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    `;
  },

  async _checkSeriesAchievements(horseId, records, birthYear) {
    // 获取所有国家的系列赛定义
    const countries = await Storage.getAllEntities('countries');
    const allSeries = [];
    for (const c of countries) {
      for (const s of (c.series || [])) {
        if (s.race_ids && s.race_ids.length > 0) allSeries.push(s);
      }
    }
    if (allSeries.length === 0) return '';

    // 获取该马每年赢了哪些 race_id
    const winsByYear = {};
    for (const r of records) {
      if (r._entry.finish === 1 && (!r._entry.status || r._entry.status === 'relegated') && r.race_id && r.year) {
        if (!winsByYear[r.year]) winsByYear[r.year] = new Set();
        winsByYear[r.year].add(r.race_id);
      }
    }

    // 检测达成
    const achievements = [];
    for (const s of allSeries) {
      for (const [year, wonRaces] of Object.entries(winsByYear)) {
        if (s.race_ids.every(rid => wonRaces.has(rid))) {
          const yearNum = parseInt(year);
          const label = yearNum ? `${yearNum}年` : (birthYear ? `${yearNum - birthYear}岁` : '');
          achievements.push(`${s.name}（${label}）`);
        }
      }
    }
    return achievements.join('、');
  },

  _switchDetailGens(gens, horseId) { this.currentGens = gens; this.showDetail(horseId); },
  _switchDetailView(view, horseId) { this.currentView = view; this.showDetail(horseId); },

  async _resolveEntityName(store, id) {
    if (!id) return '';
    const entity = await Storage.getEntity(store, id);
    return entity ? entity.name : '';
  },

  switchView(view, horseId) {
    this.currentView = view;
    this.show(horseId);
  },

  switchGens(gens, horseId) {
    this.currentGens = gens;
    this.show(horseId);
  },

  /**
   * 传统表格式渲染（左到右）
   * 真实马显示4代（因为种马当父亲，4代够用），架空马显示5代
   * 不包含本马自身，从父/母开始
   * 父系侧（上半）加浅灰底色以区分
   */
  _renderTable(tree, crossResult, horse) {
    if (!tree) return '<p>无血统数据</p>';
    const crossKeys = this._buildCrossKeyMap(crossResult);

    const isReal = horse && horse.type === 'real';
    const generations = this.currentGens; // 跟随用户选择的代数
    const rows = Math.pow(2, generations);

    const cells = Array.from({ length: rows }, () => Array(generations).fill(null));

    const half = rows / 2;
    // sire位 = 牡马(isMale:true)，dam位 = 牝马(isMale:false)
    this._fillTableCells(tree.sire, cells, 0, 0, half, generations, true);
    this._fillTableCells(tree.dam, cells, 0, half, half, generations, false);

    let html = '<div class="pedigree-table-wrap"><table class="pedigree-table">';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < generations; c++) {
        const cell = cells[r][c];
        if (cell === 'skip') continue;
        if (cell === null) {
          html += `<td class="ped-cell">—</td>`;
          continue;
        }
        const { node, rowspan, isMale } = cell;
        const colorStyle = this._getCrossStyle(node, crossKeys);
        const sexClass = isMale ? ' ped-male' : ' ped-female';
        const name = node ? this._getNodeHtml(node) : '—';
        html += `<td rowspan="${rowspan}" class="ped-cell${sexClass}" ${colorStyle}>${name}</td>`;
      }
      html += '</tr>';
    }
    html += '</table></div>';
    return html;
  },

  _fillTableCells(node, cells, col, startRow, spanRows, maxCols, isMale) {
    if (col >= maxCols) return;

    // 当前格子（有数据或空）
    cells[startRow][col] = { node: node || null, rowspan: spanRows, isMale };
    for (let r = startRow + 1; r < startRow + spanRows; r++) cells[r][col] = 'skip';

    // 递归填充子列
    const half = Math.floor(spanRows / 2);
    if (col < maxCols - 1) {
      this._fillTableCells(node?.sire || null, cells, col + 1, startRow, half || 1, maxCols, true);
      this._fillTableCells(node?.dam || null, cells, col + 1, startRow + (half || 1), half || 1, maxCols, false);
    }
  },

  /**
   * 树形图渲染（左到右，从父/母开始，不含本马自身）
   */
  _renderTree(tree, crossResult, horse) {
    if (!tree) return '<p>无血统数据</p>';
    const crossKeys = this._buildCrossKeyMap(crossResult);
    const isReal = horse && horse.type === 'real';
    const maxDepth = this.currentGens - 1; // 跟随代数设置
    return `<div class="pedigree-tree">
      <div class="tree-node-group">
        <div class="tree-children">
          ${this._renderTreeNode(tree.sire, 0, crossKeys, maxDepth)}
          ${this._renderTreeNode(tree.dam, 0, crossKeys, maxDepth)}
        </div>
      </div>
    </div>`;
  },

  _renderTreeNode(node, depth, crossKeys, maxDepth) {
    if (!node || depth > maxDepth) return '<div class="tree-node-group"><div class="tree-node empty">—</div></div>';
    const colorStyle = this._getCrossStyle(node, crossKeys);
    const name = Utils.displayName(node);

    return `
      <div class="tree-node-group">
        <div class="tree-node" ${colorStyle}>${name}</div>
        ${depth < maxDepth && (node.sire || node.dam) ? `
          <div class="tree-children">
            ${this._renderTreeNode(node.sire, depth + 1, crossKeys, maxDepth)}
            ${this._renderTreeNode(node.dam, depth + 1, crossKeys, maxDepth)}
          </div>
        ` : ''}
      </div>
    `;
  },

  /**
   * Cross 统计面板
   */
  _renderCrossPanel(crossResult) {
    if (crossResult.total_crosses === 0) {
      return '<div class="card cross-panel"><p>无Cross（纯血外配）</p></div>';
    }

    const rows = crossResult.crosses.map((c, i) => {
      const color = this.crossColors[i % this.crossColors.length];
      return `<tr>
        <td><span style="color:${color};font-weight:bold">●</span> ${c.ancestor_name}</td>
        <td>${c.positions.sire_side.join(',')}×${c.positions.dam_side.join(',')}</td>
        <td>${c.blood_percentage.toFixed(3)}%</td>
      </tr>`;
    }).join('');

    return `
      <div class="card cross-panel">
        <h4>Cross（インブリード）— 总血量 ${crossResult.inbreeding_coefficient.toFixed(3)}%</h4>
        <table class="cross-table">
          <thead><tr><th>祖先</th><th>位置</th><th>血量</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="meta">※ 采用日本式简化血量计算法，仅计算跨父母侧的标准 Cross</p>
      </div>
    `;
  },

  /**
   * 血统完整度指示器
   */
  _renderCompleteness(tree) {
    const comp = Pedigree.checkCompleteness(tree);
    const bars = [];
    for (let g = 1; g <= 5; g++) {
      const c = comp[`gen${g}`];
      const pct = c.percent;
      const color = pct === 100 ? '#27ae60' : pct > 50 ? '#f39c12' : '#e74c3c';
      bars.push(`<div class="comp-row"><span>第${g}代</span><div class="comp-bar"><div class="comp-fill" style="width:${pct}%;background:${color}"></div></div><span>${c.filled}/${c.total}</span></div>`);
    }
    return `<div class="card comp-panel"><h4>${I18N.t('completeness')}</h4>${bars.join('')}</div>`;
  },

  async _renderYearWarnings(horse) {
    const result = await YearValidator.validate(horse, { forceMode: 'strict' });

    if (result.errors.length === 0) return '';
    const items = result.errors.map(e => `<li>${e}</li>`).join('');
    return `<div class="card year-warnings"><h4>⚠️ 年份不合理</h4><ul>${items}</ul></div>`;
  },

  /**
   * 构建 Cross 高亮映射（包含全兄弟组的所有成员）
   */
  _buildCrossKeyMap(crossResult) {
    const map = {};
    if (!crossResult) return map;
    crossResult.crosses.forEach((c, i) => {
      const color = this.crossColors[i % this.crossColors.length];
      // 主 key
      map[c.ancestor_key] = color;
      // 如果有兄弟 keys，也全部标记同色
      if (c.sibling_keys) {
        for (const k of c.sibling_keys) {
          map[k] = color;
        }
      }
    });
    return map;
  },

  _getCrossStyle(node, crossKeys) {
    if (!node) return '';
    const key = node.id || node.name_en;
    if (key && crossKeys[key]) {
      return `style="background:${crossKeys[key]}22;border-left:3px solid ${crossKeys[key]}"`;
    }
    return '';
  },

  /**
   * 获取节点的 HTML 内容（可点击跳转）
   */
  _getNodeHtml(node) {
    if (!node) return '—';
    const name = Utils.displayName(node);
    // 真实马且有 ID 的可点击
    if (node.id && (!node.type || node.type === 'real')) {
      return `<a class="ped-link" onclick="UIPedigree.show('${node.id}')">${name}</a>`;
    }
    // 架空马也可点击
    if (node.id && node.type === 'fictional') {
      return `<a class="ped-link" onclick="UIPedigree.show('${node.id}')">${name}</a>`;
    }
    return name;
  }
};
