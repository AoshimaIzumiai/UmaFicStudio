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
          <button class="btn btn-secondary ${this.currentGens === 3 ? 'active' : ''}" onclick="UIPedigree.switchGens(3, '${horseId}')">3代</button>
          <button class="btn btn-secondary ${this.currentGens === 4 ? 'active' : ''}" onclick="UIPedigree.switchGens(4, '${horseId}')">4代</button>
          <button class="btn btn-secondary ${this.currentGens === 5 ? 'active' : ''}" onclick="UIPedigree.switchGens(5, '${horseId}')">5代</button>
          <span style="margin:0 8px;color:#ccc">|</span>
          <button class="btn btn-secondary ${this.currentView === 'table' ? 'active' : ''}" onclick="UIPedigree.switchView('table', '${horseId}')">表格式</button>
          <button class="btn btn-secondary ${this.currentView === 'tree' ? 'active' : ''}" onclick="UIPedigree.switchView('tree', '${horseId}')">树形图</button>
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
        if (cell === null) continue;
        if (cell === 'skip') continue;
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
    if (col >= maxCols || !node) {
      if (col < maxCols) {
        cells[startRow][col] = { node: null, rowspan: spanRows, isMale };
        for (let r = startRow + 1; r < startRow + spanRows; r++) cells[r][col] = 'skip';
      }
      return;
    }

    cells[startRow][col] = { node, rowspan: spanRows, isMale };
    for (let r = startRow + 1; r < startRow + spanRows; r++) cells[r][col] = 'skip';

    const half = Math.floor(spanRows / 2);
    if (col < maxCols - 1) {
      // 子节点的 sire 位是牡马，dam 位是牝马
      this._fillTableCells(node.sire, cells, col + 1, startRow, half || 1, maxCols, true);
      this._fillTableCells(node.dam, cells, col + 1, startRow + (half || 1), half || 1, maxCols, false);
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
      return '<div class="card cross-panel"><p>无 Cross（アウトブリード）</p></div>';
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
    return `<div class="card comp-panel"><h4>血统完整度</h4>${bars.join('')}</div>`;
  },

  async _renderYearWarnings(horse) {
    // 临时切到 strict 模式做校验（不管当前模式）
    const origMode = await YearValidator.getMode();
    await YearValidator.setMode('strict');
    const result = await YearValidator.validate(horse);
    await YearValidator.setMode(origMode);

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
