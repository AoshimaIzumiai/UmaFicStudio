/* ui-damline.js — 母系管理界面 */
'use strict';

const UIDamline = {
  currentGroupId: null,
  viewMode: 'family', // 'family' or 'line'

  async init() {
    await this.render();
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
                <span>${g.name}</span>
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
      mare._sire_name = sire ? Utils.displayName(sire) : '—';
    }
    // 找所有以该马为母亲的后代
    const children = allHorses.filter(h => h.dam_id === mareId);
    // 对每个 child 也加载父亲名字
    for (const child of children) {
      if (child.sire_id && !child._sire_name) {
        const sire = allHorses.find(h => h.id === child.sire_id) || DataLoader.getHorseFromIndex(child.sire_id);
        child._sire_name = sire ? Utils.displayName(sire) : '—';
      }
    }
    return {
      horse: mare,
      children: children.map(c => this._buildFamilyTree(c.id, allHorses)).filter(Boolean)
    };
  },

  _renderFamilyTree(node, depth, allHorses) {
    if (!node) return '';
    const indent = depth * 24;
    const h = node.horse;
    // 实时查找父亲名字
    let sireName = '—';
    if (h.sire_id) {
      const sire = DataLoader.getHorseFromIndex(h.sire_id) || (allHorses || []).find(x => x.id === h.sire_id);
      sireName = sire ? Utils.displayName(sire) : '—';
    }
    const star = h.type === 'fictional' ? '*' : '';
    let html = `<div class="tree-line" style="padding-left:${indent}px">
      <span>${Utils.sexLabel(h.sex)}</span>
      <strong>${h.name_en || h.name_cn || '—'}${star}</strong>
      <span class="meta">${h.birth_year || ''} 父:${sireName}</span>
    </div>`;
    for (const child of node.children) {
      html += this._renderFamilyTree(child, depth + 1, allHorses);
    }
    return html;
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
  }
};
