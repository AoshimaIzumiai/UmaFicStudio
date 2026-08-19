/* ui-damline.js — 母系管理界面 */
'use strict';

const UIDamline = {
  currentGroupId: null,
  viewMode: 'family', // 'family' or 'line'

  currentTab: 'damline', // 'damline' or 'sireline'

  async init() {
    await this.render();
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('#pedigree-tabs .btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`#pedigree-tabs .btn[onclick*="${tab}"]`)?.classList.add('active');
    if (tab === 'damline') this.render();
    else this.renderSireLine();
  },

  async render() {
    const container = document.getElementById('damline-content');
    const groups = await Storage.getAllGroups();
    const allHorses = await Storage.getAllHorses();
    const broodmares = allHorses.filter(h => h.sex === 'female');
    // 找出所有已分组的马（包括根母马的所有后代）
    const groupedIds = new Set();
    for (const g of groups) {
      for (const id of g.horse_ids) {
        groupedIds.add(id);
        // 递归找该马的所有后代也算已分组
        const addDescendants = (parentId) => {
          allHorses.filter(h => h.dam_id === parentId).forEach(child => {
            groupedIds.add(child.id);
            addDescendants(child.id);
          });
        };
        addDescendants(id);
      }
    }
    const ungrouped = broodmares.filter(h => !groupedIds.has(h.id));

    container.innerHTML = `
      <div class="damline-layout">
        <aside class="damline-sidebar">
          <h4>${I18N.t('damGroups')}</h4>
          <button class="btn btn-primary btn-sm" onclick="UIDamline.createGroup()">${I18N.t('newGroup')}</button>
          <div class="group-list">
            ${groups.map(g => `
              <div class="group-item ${this.currentGroupId === g.id ? 'active' : ''}" onclick="UIDamline.selectGroup('${g.id}')">
                <span>${Utils.escapeHtml(g.name)}</span>
                <span class="meta">${g.horse_ids.length} 匹</span>
              </div>
            `).join('')}
            ${ungrouped.length ? `
              <div class="group-item ${this.currentGroupId === '__ungrouped' ? 'active' : ''}" onclick="UIDamline.selectGroup('__ungrouped')">
                <span>${I18N.t('ungrouped')}</span>
                <span class="meta">${ungrouped.length} 匹</span>
              </div>
            ` : ''}
          </div>
        </aside>
        <main class="damline-main">
          <div id="damline-detail"></div>
        </main>
      </div>
    `;

    if (this.currentGroupId) this.selectGroup(this.currentGroupId);
  },

  async selectGroup(groupId) {
    this.currentGroupId = groupId;
    const detail = document.getElementById('damline-detail');
    if (!detail) return;

    let horses;
    let groupName;
    let groupObj = null;
    if (groupId === '__ungrouped') {
      const allHorses = await Storage.getAllHorses();
      const groups = await Storage.getAllGroups();
      horses = allHorses.filter(h => h.sex === 'female' && !groups.some(g => g.horse_ids.includes(h.id)));
      groupName = I18N.t('ungroupedMares');
    } else {
      groupObj = await Storage.getGroup(groupId);
      if (!groupObj) return;
      groupName = groupObj.name;
      horses = [];
      for (const id of groupObj.horse_ids) {
        const h = await Storage.getHorse(id);
        if (h) horses.push(h);
      }
    }

    // 根母马：group 中直接添加的马都作为根显示
    const allHorsesAll = await Storage.getAllHorses();
    const roots = horses;

    // 构建黑体马战绩缓存
    await this._buildBlackTypeCache(allHorsesAll);

    // 母系特征
    let damTraitsHtml = '';
    if (groupObj) {
      const damTraitsRecord = await Storage.get('config', `damline_traits_${groupId}`);
      const damTraits = damTraitsRecord ? damTraitsRecord.value : null;
      const tagsHtml = damTraits ? SireTraits.renderTags(damTraits) : '<span class="meta">未设定</span>';
      damTraitsHtml = `
        <div class="damline-traits-row" style="margin:8px 0;display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:#666">母系特征：</span>${tagsHtml}
          <button class="btn btn-secondary btn-sm" style="font-size:10px" onclick="UIDamline.editDamTraits('${groupId}')">编辑</button>
        </div>
      `;
    }

    detail.innerHTML = `
      <div class="damline-header">
        <h3>${groupName}</h3>
        <div class="damline-controls">
          <button class="btn btn-secondary btn-sm ${this.viewMode === 'family' ? 'active' : ''}" onclick="UIDamline.setView('family')">家族树</button>
          <button class="btn btn-secondary btn-sm ${this.viewMode === 'line' ? 'active' : ''}" onclick="UIDamline.setView('line')">线形</button>
          ${groupObj ? `<button class="btn btn-primary btn-sm" onclick="UIDamline.addHorseToGroup('${groupId}')">+ 添加马</button>` : ''}
          ${groupObj ? `<button class="btn btn-danger btn-sm" onclick="UIDamline.deleteGroup('${groupId}')">${I18N.t('deleteGroup')}</button>` : ''}
        </div>
      </div>
      ${damTraitsHtml}
      <div class="damline-horses">
        ${roots.length === 0 ? '<p class="empty">该分组中无根母马</p>' : roots.map(h => {
          const tree = this._buildFamilyTree(h.id, allHorsesAll);
          return '<div class="card mare-card">' + (this.viewMode === 'family' ? this._renderFamilyTree(tree, 0, allHorsesAll) : this._renderLines(tree, [])) + '</div>';
        }).join('')}
      </div>
    `;
  },

  _renderMare(horse) {
    return `
      <div class="card mare-card">
        <div class="mare-header">
          <strong>${horse.name_en}</strong>
          <span class="meta">${horse.birth_year || ''} ${horse.country ? '(' + horse.country + ')' : ''}</span>
          <button class="btn btn-secondary btn-sm" onclick="UIPedigree.show('${horse.id}')">血统表</button>
        </div>
        <div class="mare-tree" id="mare-tree-${horse.id}">
          <button class="btn btn-secondary btn-sm" onclick="UIDamline.showProgeny('${horse.id}')">${I18N.t('expandProgeny')}</button>
        </div>
      </div>
    `;
  },

  async showProgeny(mareId) {
    const container = document.getElementById(`mare-tree-${mareId}`);
    if (!container) return;
    const allHorses = await Storage.getAllHorses();
    const tree = this._buildFamilyTree(mareId, allHorses);
    container.innerHTML = this.viewMode === 'family'
      ? this._renderFamilyTree(tree, 0, allHorses)
      : this._renderLines(tree, []);
  },

  _buildFamilyTree(mareId, allHorses) {
    const mare = allHorses.find(h => h.id === mareId);
    if (!mare) return null;
    // 预加载父亲名字
    if (mare.sire_id && !mare._sire_name) {
      const sire = allHorses.find(h => h.id === mare.sire_id) || DataLoader.getHorseFromIndex(mare.sire_id);
      mare._sire_name = sire ? Utils.safeDisplayName(sire) : '—';
    }
    // 找所有以该马为母亲的后代
    const children = allHorses.filter(h => h.dam_id === mareId);
    // 对每个 child 也加载父亲名字
    for (const child of children) {
      if (child.sire_id && !child._sire_name) {
        const sire = allHorses.find(h => h.id === child.sire_id) || DataLoader.getHorseFromIndex(child.sire_id);
        child._sire_name = sire ? Utils.safeDisplayName(sire) : '—';
      }
    }
    return {
      horse: mare,
      children: children.map(c => this._buildFamilyTree(c.id, allHorses)).filter(Boolean)
    };
  },

  _renderFamilyTree(node, depth, allHorses) {
    if (!node) return '';
    const h = node.horse;
    let sireName = '—';
    if (h.sire_id) {
      const sire = DataLoader.getHorseFromIndex(h.sire_id) || (allHorses || []).find(x => x.id === h.sire_id);
      sireName = sire ? Utils.safeDisplayName(sire) : '—';
    }
    const star = h.type === 'fictional' ? '*' : '';
    const bt = this._blackTypeCache?.[h.id];
    const isBold = bt && bt.wins > 0;
    const nameTag = isBold ? 'strong' : 'span';
    const winsText = bt && bt.wins > 0 ? ` ${bt.wins} Wins` : '';
    
    let recordHtml = '';
    if (bt && bt.records.length > 0) {
      const grouped = {1: [], 2: [], 3: []};
      for (const r of bt.records) {
        if (grouped[r.finish]) grouped[r.finish].push(`${r.race}(${r.grade})`);
      }
      const lines = [];
      if (grouped[1].length) lines.push(`<div class="bt-record"><strong>1st</strong>: ${grouped[1].join(', ')}</div>`);
      if (grouped[2].length) lines.push(`<div class="bt-record"><strong>2nd</strong>: ${grouped[2].join(', ')}</div>`);
      if (grouped[3].length) lines.push(`<div class="bt-record"><strong>3rd</strong>: ${grouped[3].join(', ')}</div>`);
      recordHtml = lines.join('');
    }
    
    const childrenHtml = node.children.map(c => this._renderFamilyTree(c, depth + 1, allHorses)).join('');
    if (depth === 0) {
      return `<div class="tree-line" style="border-left:none;padding-left:0">
        <span>${Utils.sexLabel(h.sex)}</span>
        <${nameTag}>${h.name_en || h.name_cn || '—'}${star}</${nameTag}>
        <span class="meta">${h.birth_year || ''} 父:${sireName}${winsText}</span>
        ${recordHtml}
      </div>${childrenHtml ? `<div class="tree-group">${childrenHtml}</div>` : ''}`;
    }
    return `<div class="tree-line">
      <span>${Utils.sexLabel(h.sex)}</span>
      <${nameTag}>${h.name_en || h.name_cn || '—'}${star}</${nameTag}>
      <span class="meta">${h.birth_year || ''} 父:${sireName}${winsText}</span>
      ${recordHtml}
      ${childrenHtml ? `<div class="tree-group">${childrenHtml}</div>` : ''}
    </div>`;
  },

  _renderLines(node, path) {
    if (!node) return '';
    const currentPath = [...path, node.horse.name_en];
    let html = '';
    if (node.children.length === 0) {
      html += `<div class="line-item">${currentPath.join(' → ')}</div>`;
    } else {
      for (const child of node.children) {
        html += this._renderLines(child, currentPath);
      }
    }
    return html;
  },

  setView(mode) {
    this.viewMode = mode;
    if (this.currentGroupId) this.selectGroup(this.currentGroupId);
  },

  async createGroup() {
    const name = prompt(I18N.t('promptGroupName'));
    if (!name) return;
    const group = { id: Utils.generateGroupId(), name, description: '', horse_ids: [] };
    await Storage.saveGroup(group);
    await this.render();
  },

  async addHorseToGroup(groupId) {
    const allHorses = await Storage.getAllHorses();
    const mares = allHorses.filter(h => h.sex === 'female');
    const group = await Storage.getGroup(groupId);
    const available = mares.filter(h => !group.horse_ids.includes(h.id));
    if (available.length === 0) { alert('没有可添加的牝马'); return; }
    const names = available.map((h, i) => `${i + 1}. ${h.name_en || h.name_cn || '—'} ${h.birth_year || ''}`).join('\n');
    const choice = prompt(`选择要添加的马（输入序号）：\n${names}`);
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < available.length) {
      group.horse_ids.push(available[idx].id);
      await Storage.saveGroup(group);
      this.selectGroup(groupId);
    }
  },

  async deleteGroup(groupId) {
    if (!confirm(I18N.t('confirmDeleteGroup'))) return;
    await Storage.deleteGroup(groupId);
    this.currentGroupId = null;
    await this.render();
  },

  // === 种马谱系 ===

  sireLineRoot: null,

  async renderSireLine() {
    const container = document.getElementById('damline-content');
    
    // 加载特征数据
    await SireTraits.load();
    
    // 读取自立标记
    const indepRecord = await Storage.get('config', 'sireline_independent');
    const independentIds = new Set(indepRecord ? indepRecord.value : []);
    this._independentIds = independentIds;
    
    // 构建所有种马的父子关系（不从childMap中移除自立马）
    const allStallions = await this._getAllStallions();
    
    const childMap = {};
    for (const h of allStallions) {
      const sireId = this._getSireId(h, allStallions);
      if (sireId) {
        if (!childMap[sireId]) childMap[sireId] = [];
        childMap[sireId].push(h);
      }
    }
    
    // 始祖 = 无父亲且有子代的自然始祖 + 手动自立马（无条件）
    const roots = allStallions.filter(h => {
      if (independentIds.has(h.id)) return true;
      if (!this._getSireId(h, allStallions) && childMap[h.id]) return true;
      return false;
    });
    
    // 按后代数排序
    const countDescendants = (id) => {
      const children = childMap[id] || [];
      return children.length + children.reduce((s, c) => s + countDescendants(c.id), 0);
    };
    roots.sort((a, b) => countDescendants(b.id) - countDescendants(a.id));
    const indepRoots = roots.filter(h => independentIds.has(h.id));

    container.innerHTML = `
      <div class="damline-layout">
        <aside class="damline-sidebar">
          <h4>父系谱系</h4>
          <input type="text" class="search-input" placeholder="搜索始祖..." oninput="UIDamline._filterSireRoots(this.value)" style="margin-bottom:8px;width:100%">
          <div class="group-list" id="sireline-roots">
            ${roots.filter(h => independentIds.has(h.id)).concat(roots.filter(h => !independentIds.has(h.id))).map(h => {
              const desc = countDescendants(h.id);
              const isIndep = independentIds.has(h.id);
              return `<div class="group-item ${this.sireLineRoot === h.id ? 'active' : ''}" onclick="UIDamline.selectSireRoot('${h.id}')">
                <span>${h.name_en}${isIndep ? ' ★' : ''}</span>
                <span class="meta">${desc}</span>
              </div>`;
            }).join('')}
          </div>
        </aside>
        <main class="damline-main">
          <div id="sireline-detail">${this.sireLineRoot ? '' : '<p class="empty">选择左侧始祖查看谱系</p>'}</div>
        </main>
      </div>
    `;
    
    // 缓存数据供后续使用
    this._sireLineStallions = allStallions;
    this._sireLineChildMap = childMap;
    this._sireLineRoots = roots;
    
    if (this.sireLineRoot) this.selectSireRoot(this.sireLineRoot);
  },

  async selectSireRoot(rootId) {
    this.sireLineRoot = rootId;
    const detail = document.getElementById('sireline-detail');
    if (!detail) return;
    
    document.querySelectorAll('#sireline-roots .group-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`#sireline-roots .group-item[onclick*="${rootId}"]`)?.classList.add('active');
    
    const root = this._sireLineStallions.find(h => h.id === rootId);
    if (!root) return;
    
    const indepRecord = await Storage.get('config', 'sireline_independent');
    const isIndep = (indepRecord?.value || []).includes(rootId);
    const cancelBtn = isIndep ? ` <button class="btn btn-danger btn-sm" style="font-size:11px" onclick="UIDamline.removeIndependent('${rootId}')">取消自立</button>` : '';
    
    const tree = this._buildSireTree(rootId, 0);
    detail.innerHTML = `
      <h3>${root.name_en}${root.country ? ' (' + root.country + ')' : ''} 系${cancelBtn}</h3>
      <div class="sireline-tree">${this._renderSireTree(tree, 0)}</div>
    `;
  },

  _buildSireTree(id, depth) {
    if (depth > 8) return null;
    const horse = this._sireLineStallions.find(h => h.id === id);
    if (!horse) return null;
    // 自立马：不展开子代
    if (depth > 0 && this._independentIds && this._independentIds.has(id)) {
      return { horse, children: [], isIndependent: true };
    }
    const children = (this._sireLineChildMap[id] || [])
      .sort((a, b) => (a.name_en || '').localeCompare(b.name_en || ''));
    return {
      horse,
      children: children.map(c => this._buildSireTree(c.id, depth + 1)).filter(Boolean)
    };
  },

  _renderSireTree(node, depth) {
    if (!node) return '';
    const h = node.horse;
    const star = h.type === 'fictional' ? '*' : '';
    const yearInfo = h.stud_year_start ? ` (${h.stud_year_start}-${h.stud_year_end || ''})` : '';
    const countryInfo = h.country ? `(${h.country})` : '';
    const childrenHtml = node.children.map(c => this._renderSireTree(c, depth + 1)).join('');
    // 特征标签（仅对有直接标注的节点显示）
    const traitsData = SireTraits._loaded && SireTraits._data ? SireTraits._data[h.id] : null;
    const tagsHtml = traitsData ? ' ' + SireTraits.renderTags(traitsData) : '';
    let actionBtn = '';
    if (depth > 0) {
      if (node.isIndependent) {
        actionBtn = ` <a class="btn btn-secondary btn-sm" style="font-size:10px;padding:1px 5px;cursor:pointer" onclick="UIDamline.selectSireRoot('${h.id}')">→ 查看该系</a>`;
      } else {
        actionBtn = ` <button class="btn btn-secondary btn-sm" style="font-size:10px;padding:1px 5px" onclick="UIDamline.markIndependent('${h.id}')">自立</button>`;
      }
    }
    if (depth === 0) {
      return `<div class="tree-line" style="border-left:none;padding-left:0">
        <strong>${h.name_en || '?'}${star}</strong>
        <span class="meta">${countryInfo}${yearInfo}</span>${tagsHtml}
      </div>${childrenHtml ? `<div class="tree-group">${childrenHtml}</div>` : ''}`;
    }
    return `<div class="tree-line">
      <strong>${h.name_en || '?'}${star}</strong>
      <span class="meta">${countryInfo}${yearInfo}</span>${tagsHtml}${actionBtn}
      ${childrenHtml ? `<div class="tree-group">${childrenHtml}</div>` : ''}
    </div>`;
  },

  async _getAllStallions() {
    // 真实种马 + 架空种马 + 被标记自立的马（无论role）
    const realHorses = DataLoader.index ? DataLoader.index.horses.filter(h => h.role === 'stallion') : [];
    const userHorses = await Storage.getAllHorses();
    const fictionalStallions = userHorses.filter(h => h.role === 'stallion');
    const all = [...realHorses, ...fictionalStallions];
    // 确保自立标记的马也在列表中
    if (this._independentIds) {
      for (const id of this._independentIds) {
        if (!all.some(h => h.id === id)) {
          const h = userHorses.find(x => x.id === id);
          if (h) all.push(h);
        }
      }
    }
    return all;
  },

  _getSireId(horse, allStallions) {
    // 优先用 index 中的 sire_id
    if (horse.sire_id) {
      // 只有父亲也是种马时才算
      if (allStallions.some(s => s.id === horse.sire_id)) return horse.sire_id;
    }
    // 从血统数据中获取 sire 的 ID
    const ped = DataLoader.pedigreeCache[horse.id];
    if (ped && ped.sire && ped.sire.id) {
      if (allStallions.some(s => s.id === ped.sire.id)) return ped.sire.id;
    }
    return null;
  },

  async _buildBlackTypeCache(allHorses) {
    const gradedGrades = ['G1','G2','G3','GI','GII','GIII','JpnI','JpnII','JpnIII','JG1','JG2','JG3','L'];
    const allResults = await Storage.getAllEntities('results');
    this._blackTypeCache = {};
    
    for (const r of allResults) {
      for (const e of (r.entries || [])) {
        if (e.finish >= 1 && e.horse_id && (!e.status || e.status === 'relegated')) {
          if (!this._blackTypeCache[e.horse_id]) {
            this._blackTypeCache[e.horse_id] = { wins: 0, records: [] };
          }
          const bt = this._blackTypeCache[e.horse_id];
          if (e.finish === 1) bt.wins++;
          if (gradedGrades.includes(r.grade) && e.finish <= 3) {
            bt.records.push({ finish: e.finish, race: r.race_name || '', grade: r.grade, status: e.status });
          }
        }
      }
    }
  },

  async markIndependent(horseId) {
    const horse = this._sireLineStallions.find(h => h.id === horseId);
    if (!confirm(`将 ${horse.name_en} 标记为自立谱系？\n它将作为独立谱系显示在左侧。`)) return;
    let independent = await Storage.get('config', 'sireline_independent');
    const list = independent ? independent.value : [];
    if (!list.includes(horseId)) list.push(horseId);
    await Storage.put('config', { key: 'sireline_independent', value: list });
    this.renderSireLine();
  },

  async removeIndependent(horseId) {
    let independent = await Storage.get('config', 'sireline_independent');
    if (!independent) return;
    const list = independent.value.filter(id => id !== horseId);
    await Storage.put('config', { key: 'sireline_independent', value: list });
    this.renderSireLine();
  },

  _filterSireRoots(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('#sireline-roots .group-item').forEach(el => {
      const name = el.querySelector('span').textContent.toLowerCase();
      el.style.display = name.includes(q) ? '' : 'none';
    });
  },

  // === 母系特征编辑 ===
  async editDamTraits(groupId) {
    // 先清除已有的弹窗
    document.getElementById('dam-traits-modal')?.remove();
    
    const record = await Storage.get('config', `damline_traits_${groupId}`);
    const t = record ? record.value : { surface: 0.5, distance: [1600, 2200], maturity: [0.3, 0.6], temperament: 0.5, power: 0.5 };

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'dam-traits-modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:400px">
        <h4>编辑母系特征</h4>
        <div class="dam-traits-form">
          <div class="trait-edit-row">
            <label>场地 <span class="meta">草地 ← → 泥地</span></label>
            <input type="range" id="dt-surface" min="0" max="100" value="${Math.round(t.surface * 100)}" oninput="document.getElementById('dt-surface-v').textContent=this.value+'%'">
            <span id="dt-surface-v">${Math.round(t.surface * 100)}%</span>
          </div>
          <div class="trait-edit-row">
            <label>距离下限 (m)</label>
            <input type="number" id="dt-dist-min" value="${t.distance[0]}" min="800" max="3200" step="100">
          </div>
          <div class="trait-edit-row">
            <label>距离上限 (m)</label>
            <input type="number" id="dt-dist-max" value="${t.distance[1]}" min="800" max="3200" step="100">
          </div>
          <div class="trait-edit-row">
            <label>成长型 <span class="meta">早熟 ← → 晚成</span></label>
            <input type="range" id="dt-mat" min="0" max="100" value="${Math.round(((t.maturity[0] + t.maturity[1]) / 2) * 100)}">
          </div>
          <div class="trait-edit-row">
            <label>气性 <span class="meta">暴躁 ← → 沉稳</span></label>
            <input type="range" id="dt-temp" min="0" max="100" value="${Math.round(t.temperament * 100)}">
          </div>
          <div class="trait-edit-row">
            <label>类型 <span class="meta">速力 ← → 耐力</span></label>
            <input type="range" id="dt-power" min="0" max="100" value="${Math.round(t.power * 100)}">
          </div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn btn-primary" onclick="UIDamline.saveDamTraits('${groupId}')">保存</button>
          <button class="btn btn-danger" onclick="UIDamline.clearDamTraits('${groupId}')">清除</button>
          <button class="btn btn-secondary" onclick="document.getElementById('dam-traits-modal').remove()">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  async saveDamTraits(groupId) {
    const matCenter = parseInt(document.getElementById('dt-mat').value) / 100;
    const traits = {
      surface: parseInt(document.getElementById('dt-surface').value) / 100,
      distance: [
        parseInt(document.getElementById('dt-dist-min').value) || 1600,
        parseInt(document.getElementById('dt-dist-max').value) || 2200
      ],
      maturity: [Math.max(0, matCenter - 0.1), Math.min(1, matCenter + 0.1)],
      temperament: parseInt(document.getElementById('dt-temp').value) / 100,
      power: parseInt(document.getElementById('dt-power').value) / 100
    };
    await Storage.put('config', { key: `damline_traits_${groupId}`, value: traits });
    document.getElementById('dam-traits-modal')?.remove();
    this.selectGroup(groupId);
  },

  async clearDamTraits(groupId) {
    await Storage.delete('config', `damline_traits_${groupId}`);
    document.getElementById('dam-traits-modal')?.remove();
    this.selectGroup(groupId);
  }
};
