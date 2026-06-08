/* ui-entities.js — 通用实体管理模块（牧场/练马师/马主） */
'use strict';

const UIEntities = {
  configs: {
    farm: {
      store: 'farms', prefix: 'farm_', label: '牧场', selectLabel: '出生牧场',
      fields: [
        { name: 'name', label: '名称', required: true },
        { name: 'location', label: '所在地' },
        { name: 'notes', label: '备注', type: 'textarea' }
      ],
      statsLabel: { active: '现役产出马匹', total: '全部产出马匹' },
      horseField: 'farm'
    },
    trainer: {
      store: 'trainers', prefix: 'trn_', label: '练马师', selectLabel: '练马师',
      fields: [
        { name: 'name', label: '姓名', required: true },
        { name: 'stable', label: '所属' },
        { name: 'notes', label: '备注', type: 'textarea' }
      ],
      statsLabel: { active: '现役赛驹', total: '全部赛驹' },
      horseField: 'trainer'
    },
    owner: {
      store: 'owners', prefix: 'own_', label: '马主', selectLabel: '马主',
      fields: [
        { name: 'name', label: '名称', required: true },
        { name: 'prefix', label: '冠名', placeholder: '多个用逗号分隔' },
        { name: 'notes', label: '备注', type: 'textarea' }
      ],
      statsLabel: { active: '现役赛驹', total: '全部赛驹' },
      horseField: 'owner'
    }
  },

  _generateId(prefix) {
    return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  },

  async renderList(type) {
    const config = this.configs[type];
    const container = document.getElementById('manage-content');
    const all = await Storage.getAllEntities(config.store);
    all.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

    container.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" onclick="UIEntities.renderForm('${type}')">+ 新建${config.label}</button>
        <input type="text" class="search-input" placeholder="搜索${config.label}名..." oninput="UIEntities._filterList('${type}', this.value)">
      </div>
      <div class="entity-list" id="entity-list">
        ${all.length === 0 ? `<p class="empty">暂无${config.label}，点击上方按钮创建</p>` : ''}
        ${all.map(e => this._renderItem(type, e)).join('')}
      </div>
    `;
  },

  _renderItem(type, entity) {
    return `
      <div class="horse-item" data-name="${entity.name.toLowerCase()}">
        <span class="name">${entity.name}</span>
        <div>
          <button class="btn btn-secondary btn-sm" onclick="UIEntities.renderDetail('${type}','${entity.id}')">详情</button>
          <button class="btn btn-secondary btn-sm" onclick="UIEntities.renderForm('${type}',null,'${entity.id}')">编辑</button>
          <button class="btn btn-danger btn-sm" onclick="UIEntities.delete('${type}','${entity.id}')">删除</button>
        </div>
      </div>
    `;
  },

  _filterList(type, query) {
    const q = query.trim().toLowerCase();
    document.querySelectorAll('#entity-list .horse-item').forEach(el => {
      el.style.display = el.dataset.name.includes(q) ? '' : 'none';
    });
  },

  async renderForm(type, entity, editId) {
    const config = this.configs[type];
    if (editId) entity = await Storage.getEntity(config.store, editId);
    const e = entity || {};
    const isEdit = !!e.id;
    const container = document.getElementById('manage-content');

    container.innerHTML = `
      <div class="card">
        <h3>${isEdit ? '编辑' : '新建'}${config.label}</h3>
        <form id="entity-form" class="form-grid">
          ${config.fields.map(f => `
            <label>${f.label}${f.required ? ' *' : ''}
              ${f.type === 'textarea'
                ? `<textarea name="${f.name}" rows="3">${e[f.name] || ''}</textarea>`
                : `<input type="text" name="${f.name}" value="${e[f.name] || ''}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${f.placeholder}"` : ''}>`}
            </label>
          `).join('')}
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">${isEdit ? '保存' : '创建'}</button>
            <button type="button" class="btn btn-secondary" onclick="UIEntities.renderList('${type}')">取消</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('entity-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.save(type, new FormData(ev.target), isEdit ? e.id : null);
    });
  },

  async save(type, fd, existingId) {
    const config = this.configs[type];
    const data = { id: existingId || this._generateId(config.prefix) };
    for (const f of config.fields) {
      data[f.name] = fd.get(f.name)?.trim() || '';
    }
    if (!data.name) { alert(`${config.label}名称不能为空`); return; }
    await Storage.saveEntity(config.store, data);
    this.renderList(type);
  },

  async renderDetail(type, id) {
    // 切换到设定管理视图
    App.showView('manage');
    document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.sidebar-btn[data-tab="${type}"]`)?.classList.add('active');

    const config = this.configs[type];
    const entity = await Storage.getEntity(config.store, id);
    if (!entity) return;
    const horses = await Storage.getAllHorses();
    const related = horses.filter(h => h[config.horseField] === id);
    const active = related.filter(h => h.role === 'active');
    const container = document.getElementById('manage-content');

    container.innerHTML = `
      <div>
        <button class="btn btn-secondary btn-sm" onclick="UIEntities.renderList('${type}')">← 返回</button>
        <h3 style="display:inline;margin-left:12px">${entity.name}</h3>
      </div>
      <div class="detail-info-grid" style="margin:12px 0">
        ${config.fields.filter(f => f.name !== 'name' && entity[f.name]).map(f =>
          `<table class="detail-table"><tr><td class="dt">${f.label}</td><td class="dd">${entity[f.name]}</td></tr></table>`
        ).join('')}
      </div>
      <div class="entity-stats">
        <div>${config.statsLabel.active}: <span>${active.length}</span> 匹</div>
        <div>${config.statsLabel.total}: <span>${related.length}</span> 匹</div>
      </div>
      <div class="entity-list">
        ${related.map(h => `
          <div class="horse-item">
            <span class="name">${Utils.displayName(h)}</span>
            <span class="meta">${Utils.roleLabel(h.role)}</span>
            <button class="btn btn-secondary btn-sm" onclick="UIPedigree.showDetail('${h.id}')">详情</button>
          </div>
        `).join('') || '<p class="empty">暂无关联马匹</p>'}
      </div>
    `;
  },

  async delete(type, id) {
    const config = this.configs[type];
    const horses = await Storage.getAllHorses();
    const refs = horses.filter(h => h[config.horseField] === id);
    if (refs.length > 0) {
      alert(`有 ${refs.length} 匹马正在使用该${config.label}，无法删除。请先修改相关马匹后再试。`);
      return;
    }
    if (confirm(`确定删除该${config.label}吗？`)) {
      await Storage.deleteEntity(config.store, id);
      this.renderList(type);
    }
  }
};
