/* ui-horse.js — 马匹管理界面 */
'use strict';

const UIHorse = {
  async init() {
    await this.renderList();
    // 加载受保护马名
    if (!this._protectedNames) {
      try {
        const resp = await fetch('data/protected_names.json');
        this._protectedNames = await resp.json();
      } catch(e) { this._protectedNames = []; }
    }
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.horse-suggest') && !e.target.matches('input[oninput*="_autocomplete"], input[oninput*="_searchHorse"], #sire-display, #dam-display')) {
        document.querySelectorAll('.horse-suggest').forEach(el => el.innerHTML = '');
      }
    });
  },

  async renderList() {
    const container = document.getElementById('manage-content');
    const horses = await Storage.getAllHorses();
    this._allHorses = horses;

    container.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" onclick="UIHorse.showCreateForm()">${I18N.t('createHorse')}</button>
        <button class="btn btn-secondary" onclick="ExportImport.exportData()">${I18N.t('export')}</button>
        <button class="btn btn-secondary" onclick="ExcelExport.exportAll()">📊 Excel</button>
        <label class="btn btn-secondary">
          ${I18N.t('import')}
          <input type="file" accept=".json" style="display:none" onchange="UIHorse.handleImport(event)">
        </label>
        <button class="btn btn-secondary" onclick="ShareCard.showImportDialog()">📥 导入名片码</button>
        <button class="btn btn-secondary" onclick="UIHorse._manageTagsPrompt()">🏷 标签管理</button>
      </div>
      <div class="filter-bar" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">
        <select id="filter-sex" onchange="UIHorse._applyFilter()">
          <option value="">全部性别</option>
          <option value="male">牡马</option>
          <option value="female">牝马</option>
          <option value="gelding">骟马</option>
        </select>
        <select id="filter-role" onchange="UIHorse._applyFilter()">
          <option value="">全部角色</option>
          <option value="active">现役</option>
          <option value="stallion">种马</option>
          <option value="broodmare">繁殖牝马</option>
          <option value="retired">退役</option>
        </select>
        <select id="filter-color" onchange="UIHorse._applyFilter()">
          <option value="">全部毛色</option>
          <option value="bay">${I18N.t('bay')}</option>
          <option value="darkBay">${I18N.t('darkBay')}</option>
          <option value="brown">${I18N.t('brown')}</option>
          <option value="chestnut">${I18N.t('chestnut')}</option>
          <option value="darkChestnut">${I18N.t('darkChestnut')}</option>
          <option value="grey">${I18N.t('grey')}</option>
          <option value="black">${I18N.t('black')}</option>
          <option value="white">${I18N.t('white')}</option>
          <option value="palomino">${I18N.t('palomino')}</option>
          <option value="buckskin">${I18N.t('buckskin')}</option>
          <option value="smokyBlack">${I18N.t('smokyBlack')}</option>
          <option value="cremello">${I18N.t('cremello')}</option>
          <option value="deerCremello">${I18N.t('deerCremello')}</option>
          <option value="blueCremello">${I18N.t('blueCremello')}</option>
          <option value="chestnutCremello">${I18N.t('chestnutCremello')}</option>
          <option value="roan">${I18N.t('roan')}</option>
          <option value="deerRoan">${I18N.t('deerRoan')}</option>
          <option value="chestnutRoan">${I18N.t('chestnutRoan')}</option>
          <option value="blueRoan">${I18N.t('blueRoan')}</option>
          <option value="pinto">${I18N.t('pinto')}</option>
        </select>
        <select id="filter-tag" onchange="UIHorse._applyFilter()">
          <option value="">全部标签</option>
        </select>
        <input type="text" id="filter-name" placeholder="搜索名字..." oninput="UIHorse._applyFilter()" style="width:140px;">
      </div>
      <div class="horse-list" id="horse-list-container">
        ${horses.length === 0 ? '<p class="empty">暂无架空马，点击上方按钮创建</p>' : ''}
        ${horses.map(h => this._renderItem(h)).join('')}
      </div>
    `;
    // 填充标签选项
    const tagRecord = await Storage.get('config', 'user_tags');
    const allTags = tagRecord ? tagRecord.value : [];
    const tagSelect = document.getElementById('filter-tag');
    if (tagSelect) allTags.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; tagSelect.appendChild(o); });
  },

  _applyFilter() {
    const sex = document.getElementById('filter-sex').value;
    const role = document.getElementById('filter-role').value;
    const color = document.getElementById('filter-color').value;
    const tag = document.getElementById('filter-tag').value;
    const name = document.getElementById('filter-name').value.trim().toLowerCase();
    const filtered = (this._allHorses || []).filter(h => {
      if (sex && h.sex !== sex) return false;
      if (role && h.role !== role) return false;
      if (color && h.color !== color) return false;
      if (tag && !(h.tags || []).includes(tag)) return false;
      if (name && !(h.name_en || '').toLowerCase().includes(name) && !(h.name_ja || '').toLowerCase().includes(name)) return false;
      return true;
    });
    const container = document.getElementById('horse-list-container');
    container.innerHTML = filtered.length === 0 ? '<p class="empty">无匹配结果</p>' : filtered.map(h => this._renderItem(h)).join('');
  },

  async _loadTagCheckboxes(selectedTags) {
    const record = await Storage.get('config', 'user_tags');
    const allTags = record ? record.value : [];
    const container = document.getElementById('tag-checkboxes');
    if (!container) return;
    container.innerHTML = allTags.map(t =>
      `<label style="font-size:12px;color:#333"><input type="checkbox" value="${Utils.escapeHtml(t)}" ${selectedTags.includes(t) ? 'checked' : ''}> ${Utils.escapeHtml(t)}</label>`
    ).join('') + (allTags.length === 0 ? '<span style="font-size:12px;color:#999">无标签，请在设定管理中创建</span>' : '');
  },

  async _manageTagsPrompt() {
    const record = await Storage.get('config', 'user_tags');
    const tags = record ? record.value : [];
    const container = document.getElementById('manage-content');
    const existing = document.getElementById('tag-manage-panel');
    if (existing) { existing.remove(); return; }
    const panel = document.createElement('div');
    panel.id = 'tag-manage-panel';
    panel.style.cssText = 'background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:12px 16px;margin:8px 0';
    panel.innerHTML = `<h4 style="margin:0 0 8px">标签管理</h4>
      <div id="tag-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${tags.map(t => `<span style="background:#e8e8ed;padding:2px 8px;border-radius:4px;font-size:13px">${Utils.escapeHtml(t)} <a data-tag="${Utils.escapeHtml(t)}" onclick="UIHorse._removeTag(this.dataset.tag)" style="cursor:pointer;color:#d00;margin-left:4px">×</a></span>`).join('')}</div>
      <div style="display:flex;gap:6px"><input type="text" id="new-tag-input" placeholder="新标签名" style="flex:1;padding:6px 10px;border:1px solid #d2d2d7;border-radius:6px;font-size:13px"><button class="btn btn-primary btn-sm" onclick="UIHorse._addTag()">添加</button></div>`;
    container.insertBefore(panel, container.children[1]);
    document.getElementById('new-tag-input').addEventListener('keydown', e => { if (e.key === 'Enter') UIHorse._addTag(); });
  },

  async _addTag() {
    const input = document.getElementById('new-tag-input');
    const name = input.value.trim();
    if (!name) return;
    const record = await Storage.get('config', 'user_tags');
    const tags = record ? record.value : [];
    if (!tags.includes(name)) tags.push(name);
    await Storage.put('config', { key: 'user_tags', value: tags });
    input.value = '';
    this._manageTagsPrompt(); this._manageTagsPrompt(); // 关闭再打开刷新
  },

  async _removeTag(tag) {
    const record = await Storage.get('config', 'user_tags');
    const tags = (record ? record.value : []).filter(t => t !== tag);
    await Storage.put('config', { key: 'user_tags', value: tags });
    document.getElementById('tag-manage-panel')?.remove();
    this._manageTagsPrompt();
  },

  _renderItem(horse) {
    const mainName = Utils.displayName(horse).replace(/\*?\([A-Z]+\)$/, '');
    const subNames = [horse.name_en, horse.name_ja, horse.name_cn].filter(Boolean).filter(n => n !== mainName.replace('*','')).join(' ');
    const isShared = horse.type === 'shared';
    return `
      <div class="horse-item${isShared ? ' shared' : ''}">
        <div>
          <span class="name">${Utils.escapeHtml(mainName)}</span>
          ${isShared ? '<span class="tag" style="background:#e0d4f5;color:#6b21a8">共享</span>' : ''}
          <span class="meta">${Utils.escapeHtml(subNames)} ${horse.country ? '(' + Utils.escapeHtml(horse.country) + ')' : ''}</span>
          <span class="tag">${Utils.roleLabel(horse.role)}</span>
        </div>
        <div>
          <span class="meta">${Utils.sexLabel(horse.sex)} ${horse.birth_year || ''}</span>
          <button class="btn btn-secondary btn-sm" onclick="UIPedigree.showDetail('${horse.id}')">详情</button>
          ${isShared ? `<button class="btn btn-danger btn-sm" onclick="UIHorse._deleteShared('${horse.id}')">删除</button>` : `<button class="btn btn-secondary btn-sm" onclick="UIHorse.showDetail('${horse.id}')">编辑</button>`}
        </div>
      </div>
    `;
  },

  async showCreateForm(editHorse = null) {
    const container = document.getElementById('manage-content');
    const h = editHorse || {};
    const isEdit = !!editHorse;

    // 预加载父/母名字用于显示
    if (h.sire_id) {
      const sire = DataLoader.getHorseFromIndex(h.sire_id) || await Storage.getHorse(h.sire_id);
      h._sire_name = sire ? Utils.safeDisplayName(sire) : h.sire_id;
    } else { h._sire_name = ''; }
    if (h.dam_id) {
      const dam = DataLoader.getHorseFromIndex(h.dam_id) || await Storage.getHorse(h.dam_id);
      h._dam_name = dam ? Utils.safeDisplayName(dam) : h.dam_id;
    } else { h._dam_name = ''; }
    // 预加载母父
    h._bms_id = '';
    h._bms_name = '';
    if (h.dam_id) {
      const dam = DataLoader.getHorseFromIndex(h.dam_id) || await Storage.getHorse(h.dam_id);
      if (dam && dam.sire_id) {
        h._bms_id = dam.sire_id;
        const bms = DataLoader.getHorseFromIndex(dam.sire_id) || await Storage.getHorse(dam.sire_id);
        h._bms_name = bms ? Utils.safeDisplayName(bms) : '';
      }
    }
    // 预加载实体名称
    if (h.farm && h.farm.startsWith('farm_')) {
      const e = await Storage.getEntity('farms', h.farm);
      h._farm_name = e ? e.name : '';
    } else { h._farm_name = h.farm || ''; }
    if (h.trainer && h.trainer.startsWith('trn_')) {
      const e = await Storage.getEntity('trainers', h.trainer);
      h._trainer_name = e ? e.name : '';
    } else { h._trainer_name = h.trainer || ''; }
    if (h.owner && h.owner.startsWith('own_')) {
      const e = await Storage.getEntity('owners', h.owner);
      h._owner_name = e ? e.name : '';
    } else { h._owner_name = h.owner || ''; }

    container.innerHTML = `
      <div class="card">
        <h3>${isEdit ? I18N.t('edit') : I18N.t('create')}</h3>
        <form id="horse-form" class="form-grid">
          <label>${I18N.t('nameEn')}
            <input type="text" name="name_en" value="${Utils.escapeHtml(h.name_en || '')}">
          </label>
          <label>${I18N.t('nameJa')}
            <input type="text" name="name_ja" value="${Utils.escapeHtml(h.name_ja || '')}">
          </label>
          <label>${I18N.t('nameCn')}
            <input type="text" name="name_cn" value="${Utils.escapeHtml(h.name_cn || '')}">
          </label>
          <label>${I18N.t('sex')} *
            <select name="sex" required>
              <option value="male" ${h.sex === 'male' ? 'selected' : ''}>${I18N.t('male')}</option>
              <option value="female" ${h.sex === 'female' ? 'selected' : ''}>${I18N.t('female')}</option>
              <option value="gelding" ${h.sex === 'gelding' ? 'selected' : ''}>${I18N.t('gelding')}</option>
            </select>
          </label>
          <label>${I18N.t('role')} *
            <select name="role" required onchange="UIHorse._onRoleChange(this.value)">
              <option value="active" ${h.role === 'active' ? 'selected' : ''}>${I18N.t('active')}</option>
              <option value="stallion" ${h.role === 'stallion' ? 'selected' : ''}>${I18N.t('stallion')}</option>
              <option value="broodmare" ${h.role === 'broodmare' ? 'selected' : ''}>${I18N.t('broodmare')}</option>
              <option value="retired" ${h.role === 'retired' ? 'selected' : ''}>${I18N.t('retired')}</option>
            </select>
          </label>
          <label>${I18N.t('birthYear')}
            <input type="number" name="birth_year" value="${h.birth_year || ''}" min="1900" max="2100">
          </label>
          <label>${I18N.t('country')}
            <input type="text" name="country" value="${Utils.escapeHtml(h.country || '')}" placeholder="JPN, USA, GB..." autocomplete="off" oninput="UIHorse._filterCountry(this)">
            <div class="horse-suggest" id="suggest-country"></div>
          </label>
          <label>${I18N.t('color')}
            <select name="color">
              <option value="">--</option>
              <option value="bay" ${h.color === 'bay' ? 'selected' : ''}>${I18N.t('bay')}</option>
              <option value="darkBay" ${h.color === 'darkBay' ? 'selected' : ''}>${I18N.t('darkBay')}</option>
              <option value="brown" ${h.color === 'brown' ? 'selected' : ''}>${I18N.t('brown')}</option>
              <option value="chestnut" ${h.color === 'chestnut' ? 'selected' : ''}>${I18N.t('chestnut')}</option>
              <option value="darkChestnut" ${h.color === 'darkChestnut' ? 'selected' : ''}>${I18N.t('darkChestnut')}</option>
              <option value="grey" ${h.color === 'grey' ? 'selected' : ''}>${I18N.t('grey')}</option>
              <option value="black" ${h.color === 'black' ? 'selected' : ''}>${I18N.t('black')}</option>
              <option value="white" ${h.color === 'white' ? 'selected' : ''}>${I18N.t('white')}</option>
              <option value="palomino" ${h.color === 'palomino' ? 'selected' : ''}>${I18N.t('palomino')}</option>
              <option value="buckskin" ${h.color === 'buckskin' ? 'selected' : ''}>${I18N.t('buckskin')}</option>
              <option value="smokyBlack" ${h.color === 'smokyBlack' ? 'selected' : ''}>${I18N.t('smokyBlack')}</option>
              <option value="cremello" ${h.color === 'cremello' ? 'selected' : ''}>${I18N.t('cremello')}</option>
              <option value="deerCremello" ${h.color === 'deerCremello' ? 'selected' : ''}>${I18N.t('deerCremello')}</option>
              <option value="blueCremello" ${h.color === 'blueCremello' ? 'selected' : ''}>${I18N.t('blueCremello')}</option>
              <option value="chestnutCremello" ${h.color === 'chestnutCremello' ? 'selected' : ''}>${I18N.t('chestnutCremello')}</option>
              <option value="roan" ${h.color === 'roan' ? 'selected' : ''}>${I18N.t('roan')}</option>
              <option value="deerRoan" ${h.color === 'deerRoan' ? 'selected' : ''}>${I18N.t('deerRoan')}</option>
              <option value="chestnutRoan" ${h.color === 'chestnutRoan' ? 'selected' : ''}>${I18N.t('chestnutRoan')}</option>
              <option value="blueRoan" ${h.color === 'blueRoan' ? 'selected' : ''}>${I18N.t('blueRoan')}</option>
              <option value="pinto" ${h.color === 'pinto' ? 'selected' : ''}>${I18N.t('pinto')}</option>
            </select>
          </label>
          <label>${I18N.t('sire')}
            <input type="hidden" name="sire_id" value="${h.sire_id || ''}">
            <input type="text" id="sire-display" value="${h._sire_name || ''}" placeholder="输入种马名搜索..." oninput="UIHorse._searchHorse(this, 'sire')">
            <div class="horse-suggest" id="suggest-sire"></div>
          </label>
          <label>${I18N.t('dam')}
            <input type="hidden" name="dam_id" value="${h.dam_id || ''}">
            <input type="text" id="dam-display" value="${h._dam_name || ''}" placeholder="输入母马名搜索..." oninput="UIHorse._searchHorse(this, 'dam')">
            <div class="horse-suggest" id="suggest-dam"></div>
          </label>
          <label>${I18N.t('bms')}
            <input type="hidden" name="bms_id" value="${h._bms_id || ''}">
            <input type="text" id="bms-display" value="${h._bms_name || ''}" placeholder="输入母父名搜索..." oninput="UIHorse._searchHorse(this, 'bms')">
            <div class="horse-suggest" id="suggest-bms"></div>
          </label>
          <label class="stud-field" style="display:${h.role === 'stallion' || h.role === 'broodmare' || h.stud_year_start || (h.career_events || []).some(e => e.type === 'stallion' || e.type === 'broodmare') ? 'flex' : 'none'}">${I18N.t('studYearStart')}
            <input type="number" name="stud_year_start" value="${h.stud_year_start || ''}" min="1900" max="2100">
          </label>
          <label class="stud-field" style="display:${h.role === 'stallion' || h.role === 'broodmare' || h.stud_year_start || (h.career_events || []).some(e => e.type === 'stallion' || e.type === 'broodmare') ? 'flex' : 'none'}">${I18N.t('studYearEnd')}
            <input type="number" name="stud_year_end" value="${h.stud_year_end || ''}" min="1900" max="2100" placeholder="空=仍在配种">
          </label>
          <label>${I18N.t('surface')}
            <div class="checkbox-group">
              <label><input type="checkbox" name="turf" ${(h.aptitude_surface || []).includes('turf') ? 'checked' : ''}> ${I18N.t('turf')}</label>
              <label><input type="checkbox" name="dirt" ${(h.aptitude_surface || []).includes('dirt') ? 'checked' : ''}> ${I18N.t('dirt')}</label>
            </div>
          </label>
          <label>${I18N.t('distance')}
            <div style="display:flex;align-items:center;gap:4px">
              <input type="number" name="distance_min" value="${h.distance_min || ''}" min="800" max="4000" step="100" placeholder="最短" style="width:80px">米 —
              <input type="number" name="distance_max" value="${h.distance_max || ''}" min="800" max="4000" step="100" placeholder="最长" style="width:80px">米
            </div>
          </label>
          ${!isEdit || h.type === 'fictional' ? `
          <fieldset class="form-section">
            <legend>${I18N.t('extInfo')}</legend>
            <label>${I18N.t('farm')}
              <input type="text" id="farm-input" value="${h._farm_name || ''}" autocomplete="off" oninput="UIHorse._filterEntities(this, 'farm', 'farm')">
              <input type="hidden" name="farm" value="${h.farm || ''}">
              <div class="horse-suggest" id="suggest-farm"></div>
            </label>
            <label>${I18N.t('trainer')}
              <input type="text" id="trainer-input" value="${h._trainer_name || ''}" autocomplete="off" oninput="UIHorse._filterEntities(this, 'trainer', 'trainer')">
              <input type="hidden" name="trainer" value="${h.trainer || ''}">
              <div class="horse-suggest" id="suggest-trainer"></div>
            </label>
            <label>${I18N.t('owner')}
              <input type="text" id="owner-input" value="${h._owner_name || ''}" autocomplete="off" oninput="UIHorse._filterEntities(this, 'owner', 'owner')">
              <input type="hidden" name="owner" value="${h.owner || ''}">
              <div class="horse-suggest" id="suggest-owner"></div>
            </label>
            <label>${I18N.t('nameMeaning')}
              <input type="text" name="name_meaning" value="${Utils.escapeHtml(h.name_meaning || '')}">
            </label>
            <label>${I18N.t('purchasePrice')}
              <input type="text" name="purchase_price" value="${Utils.escapeHtml(h.purchase_price || '')}" placeholder="例：5000万円 / $2.5M">
            </label>
            <label>标签
              <div id="tag-checkboxes" class="checkbox-group" style="flex-direction:row;flex-wrap:wrap;gap:6px"></div>
            </label>
            <label>${I18N.t('notes')}
              <textarea name="notes" rows="3">${h.notes || ''}</textarea>
            </label>
            <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:#6e6e73;grid-column:1/-1">
              <input type="checkbox" id="show-history-check" ${h.show_history ? 'checked' : ''}> ${I18N.t('showHistory')}
            </div>
            <div class="history-section">
              <label>${I18N.t('transferHistory')}</label>
              <div id="history-entries"></div>
              <button type="button" class="btn btn-secondary btn-sm" onclick="UIHorse._addHistoryEntry()">${I18N.t('addTransfer')}</button>
            </div>
            <div class="history-section">
              <label>${I18N.t('careerEvents')}</label>
              <div id="career-entries"></div>
              <button type="button" class="btn btn-secondary btn-sm" onclick="UIHorse._addCareerEntry()">+ ${I18N.t('addCareerEvent')}</button>
            </div>
          </fieldset>
          ` : ''}
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">${isEdit ? I18N.t('save') : I18N.t('create')}</button>
            <button type="button" class="btn btn-secondary" onclick="UIHorse.renderList()">${I18N.t('cancel')}</button>
            ${isEdit ? `<button type="button" class="btn btn-danger" onclick="UIHorse.deleteHorse('${h.id}')">${I18N.t('delete')}</button>` : ''}
          </div>
        </form>
      </div>
    `;

    document.getElementById('horse-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this._saveForm(e.target, isEdit ? h.id : null);
    });

    // 填充标签 checkbox
    this._loadTagCheckboxes(h.tags || []);

    // 初始化转厩/转手记录
    this._historyEntries = h.history || [];
    this._renderHistoryEntries();

    // 初始化用途变更记录
    this._careerEntries = h.career_events || [];
    this._renderCareerEntries();
  },

  _renderHistoryEntries() {
    const container = document.getElementById('history-entries');
    if (!container) return;
    container.innerHTML = this._historyEntries.map((entry, i) => `
      <div class="history-row" style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <input type="text" value="${entry.date || ''}" placeholder="${I18N.t('date')}" style="width:100px" onchange="UIHorse._historyEntries[${i}].date=this.value">
        <select onchange="UIHorse._historyEntries[${i}].type=this.value">
          <option value="owner" ${entry.type === 'owner' ? 'selected' : ''}>${I18N.t('owner')}</option>
          <option value="trainer" ${entry.type === 'trainer' ? 'selected' : ''}>${I18N.t('trainer')}</option>
          <option value="farm" ${entry.type === 'farm' ? 'selected' : ''}>${I18N.t('farm')}</option>
        </select>
        <input type="text" value="${entry.from_name || ''}" placeholder="${I18N.t('from')}" style="flex:1" onchange="UIHorse._historyEntries[${i}].from_name=this.value">
        <span>→</span>
        <input type="text" value="${entry.to_name || ''}" placeholder="${I18N.t('to')}" style="flex:1" onchange="UIHorse._historyEntries[${i}].to_name=this.value">
        <button type="button" class="btn btn-danger btn-sm" onclick="UIHorse._removeHistoryEntry(${i})">×</button>
      </div>
    `).join('');
  },

  _addHistoryEntry() {
    this._historyEntries.push({ date: '', type: 'owner', from_name: '', to_name: '' });
    this._renderHistoryEntries();
  },

  _removeHistoryEntry(index) {
    this._historyEntries.splice(index, 1);
    this._renderHistoryEntries();
  },

  _careerEntries: [],

  _renderCareerEntries() {
    const container = document.getElementById('career-entries');
    if (!container) return;
    container.innerHTML = this._careerEntries.map((entry, i) => `
      <div class="history-row" style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <input type="number" value="${entry.year || ''}" placeholder="${I18N.t('year')}" style="width:80px" onchange="UIHorse._careerEntries[${i}].year=Number(this.value)||null">
        <select onchange="UIHorse._careerEntries[${i}].type=this.value;UIHorse._renderCareerEntries()">
          <option value="stallion" ${entry.type === 'stallion' ? 'selected' : ''}>${I18N.t('careerStallion')}</option>
          <option value="broodmare" ${entry.type === 'broodmare' ? 'selected' : ''}>${I18N.t('careerBroodmare')}</option>
          <option value="retired" ${entry.type === 'retired' ? 'selected' : ''}>${I18N.t('careerRetired')}</option>
          <option value="other" ${entry.type === 'other' ? 'selected' : ''}>${I18N.t('careerOther')}</option>
          <option value="deceased" ${entry.type === 'deceased' ? 'selected' : ''}>${I18N.t('careerDeceased')}</option>
        </select>
        ${entry.type === 'other' ? `<input type="text" value="${entry.note || ''}" placeholder="${I18N.t('notes')}" style="flex:1" onchange="UIHorse._careerEntries[${i}].note=this.value">` : ''}
        <button type="button" class="btn btn-danger btn-sm" onclick="UIHorse._removeCareerEntry(${i})">×</button>
      </div>
    `).join('');
    // 如果 career_events 中有入种记录，自动显示配种年份字段
    const hasStudEvent = this._careerEntries.some(e => e.type === 'stallion' || e.type === 'broodmare');
    if (hasStudEvent) {
      document.querySelectorAll('.stud-field').forEach(el => { el.style.display = 'flex'; });
    }
  },

  _addCareerEntry() {
    this._careerEntries.push({ year: null, type: 'stallion' });
    this._renderCareerEntries();
  },

  _removeCareerEntry(index) {
    this._careerEntries.splice(index, 1);
    this._renderCareerEntries();
  },

  async _saveForm(form, existingId) {
    const fd = new FormData(form);
    const surface = [];
    if (form.querySelector('[name=turf]').checked) surface.push('turf');
    if (form.querySelector('[name=dirt]').checked) surface.push('dirt');
    const distanceMin = form.querySelector('[name=distance_min]')?.value ? parseInt(form.querySelector('[name=distance_min]').value) : null;
    const distanceMax = form.querySelector('[name=distance_max]')?.value ? parseInt(form.querySelector('[name=distance_max]').value) : null;

    const horse = {
      id: existingId || Utils.generateId(),
      name_en: fd.get('name_en').trim(),
      name_ja: fd.get('name_ja').trim(),
      name_cn: fd.get('name_cn').trim(),
      type: 'fictional',
      sex: fd.get('sex'),
      birth_year: fd.get('birth_year') ? parseInt(fd.get('birth_year')) : null,
      color: fd.get('color').trim(),
      country: fd.get('country').trim().toUpperCase(),
      role: fd.get('role'),
      aptitude_surface: surface,
      aptitude_distance: [],
      distance_min: distanceMin,
      distance_max: distanceMax,
      stud_year_start: fd.get('stud_year_start') ? parseInt(fd.get('stud_year_start')) : null,
      stud_year_end: fd.get('stud_year_end') ? parseInt(fd.get('stud_year_end')) : null,
      sire_id: fd.get('sire_id').trim() || null,
      dam_id: fd.get('dam_id').trim() || null,
      farm: null,
      trainer: null,
      owner: null,
      name_meaning: fd.get('name_meaning')?.trim() || '',
      purchase_price: fd.get('purchase_price')?.trim() || '',
      tags: [...document.querySelectorAll('#tag-checkboxes input:checked')].map(cb => cb.value),
      notes: fd.get('notes')?.trim() || '',
      pedigree_cache: null
    };

    // 处理实体字段（farm/trainer/owner）：选择已有 or 自动创建新实体
    for (const [field, type] of [['farm','farm'], ['trainer','trainer'], ['owner','owner']]) {
      const hiddenVal = fd.get(field)?.trim();
      const inputEl = document.getElementById(`${field}-input`);
      const inputVal = inputEl ? inputEl.value.trim() : '';
      if (!inputVal) {
        horse[field] = null;
      } else if (hiddenVal && hiddenVal.startsWith(UIEntities.configs[type].prefix)) {
        horse[field] = hiddenVal;
      } else if (inputVal) {
        const config = UIEntities.configs[type];
        const existing = await Storage._findEntityByName(config.store, inputVal);
        if (existing) {
          horse[field] = existing.id;
        } else {
          const id = UIEntities._generateId(config.prefix);
          await Storage.saveEntity(config.store, { id, name: inputVal });
          horse[field] = id;
        }
      }
    }

    // 转厩/转手记录（用户手动录入）
    horse.history = UIHorse._historyEntries || [];
    horse.show_history = document.getElementById('show-history-check')?.checked || false;

    // 用途变更记录
    horse.career_events = (UIHorse._careerEntries || []).filter(e => e.year);

    // 从 career_events 自动推算配种年份（适用于引退马有入种记录的情况）
    if (horse.career_events.length > 0) {
      const studEvents = horse.career_events
        .filter(e => e.type === 'stallion' || e.type === 'broodmare')
        .sort((a, b) => a.year - b.year);
      if (studEvents.length > 0) {
        const studStart = studEvents[0].year;
        // 寻找入种之后最早的 retired 或 deceased 事件作为结束年
        const endEvent = horse.career_events
          .filter(e => (e.type === 'retired' || e.type === 'deceased') && e.year > studStart)
          .sort((a, b) => a.year - b.year)[0];
        // 自动填入：如果用户没有手动填写配种年份（或 role 是 retired 导致字段隐藏）
        if (!horse.stud_year_start) {
          horse.stud_year_start = studStart;
        }
        if (!horse.stud_year_end && endEvent) {
          horse.stud_year_end = endEvent.year;
        }
      }
    }

    // 名字可以全部为空（如纯粹作为血统过渡的母马）

    // 受保护马名检查
    if (horse.name_en && UIHorse._protectedNames) {
      const checkName = horse.name_en.toLowerCase().trim();
      if (UIHorse._protectedNames.includes(checkName)) {
        if (!confirm(`"${horse.name_en}" 是 IFHA 国际受保护马名。确定使用此名字吗？`)) return;
      }
    }

    // 处理母父快捷字段：如果填了母父但没填母亲，自动创建无名母马
    const bmsId = fd.get('bms_id')?.trim();
    if (bmsId && !horse.dam_id) {
      const damId = Utils.generateId();
      const autoDam = {
        id: damId, name_en: '', name_ja: '', name_cn: '', type: 'fictional',
        sex: 'female', role: 'broodmare', birth_year: null, country: horse.country || '',
        color: '', sire_id: bmsId, dam_id: null, pedigree_cache: null
      };
      await Storage.saveHorse(autoDam);
      horse.dam_id = damId;
    } else if (bmsId && horse.dam_id) {
      // 母亲已存在，更新母亲的 sire_id
      const dam = await Storage.getHorse(horse.dam_id);
      if (dam && dam.type === 'fictional' && dam.sire_id !== bmsId) {
        dam.sire_id = bmsId;
        dam.pedigree_cache = null;
        await Storage.saveHorse(dam);
      }
    }

    // 角色约束：骟马不能设为 stallion 或 broodmare
    if (horse.sex === 'gelding' && (horse.role === 'stallion' || horse.role === 'broodmare')) {
      alert('骟马不能设为种牡马或繁殖牝马');
      return;
    }

    // 循环引用检测：不能把自己设为自己的祖先
    if (horse.sire_id === horse.id || horse.dam_id === horse.id) {
      alert('不能将自己设为自己的父/母');
      return;
    }

    // 年份校验
    const validation = await YearValidator.validate(horse);
    if (validation.errors.length > 0) {
      alert('年份约束错误（严谨模式）：\n\n' + validation.errors.join('\n'));
      return;
    }
    if (validation.warnings.length > 0) {
      if (!confirm('年份提示（架空模式）：\n\n' + validation.warnings.join('\n') + '\n\n确定继续保存吗？')) {
        return;
      }
    }

    // 记录创建/编辑模式
    horse.created_mode = await YearValidator.getMode();

    await Storage.saveHorse(horse);
    // 清除缓存链（编辑模式时子孙马的缓存需要失效）
    if (existingId) await Pedigree.onHorseUpdated(existingId);
    await this.renderList();
    // 保存后异步检查 Cross 浓度（不阻塞 UI）
    if (horse.sire_id || horse.dam_id) {
      setTimeout(async () => {
        try {
          const tree = await Pedigree.getPedigreeTree(horse.id);
          if (tree) {
            const crossResult = Cross.calculateCross(tree, 5);
            const intensityWarnings = YearValidator.checkCrossIntensity(crossResult);
            if (intensityWarnings.length > 0) {
              alert('Cross 浓度警告：\n\n' + intensityWarnings.join('\n') + '\n\n（已保存，仅作提示）');
            }
          }
        } catch (e) { console.warn('[Cross check]', e); }
      }, 100);
    }
  },

  async showDetail(id) {
    const horse = await Storage.getHorse(id);
    if (!horse) return;
    this.showCreateForm(horse);
  },

  async deleteHorse(id) {
    // 检查是否有其他马引用了它
    const refs = await Storage.findHorsesReferencing(id);
    // 检查比赛记录中的引用
    const results = await Storage.getAllEntities('results');
    const raceRefs = results.filter(r => (r.entries || []).some(e => e.horse_id === id));

    let msg = '';
    if (refs.length > 0) {
      const names = refs.map(h => h.name_en).join(', ');
      msg += `以下马匹引用了此马作为父/母：\n${names}\n删除后这些引用将失效。\n\n`;
    }
    if (raceRefs.length > 0) {
      msg += `有 ${raceRefs.length} 场比赛记录包含此马，删除后将从记录中移除。\n\n`;
    }
    msg += '确定删除吗？';
    if (!confirm(msg)) return;

    // 清理 results 中该马的出赛记录
    for (const r of raceRefs) {
      r.entries = (r.entries || []).filter(e => e.horse_id !== id);
      await Storage.put('results', r);
    }

    await Storage.deleteHorse(id);
    await Pedigree.onHorseUpdated(id);
    await this.renderList();
  },

  _onRoleChange(role) {
    const hasStudHistory = (UIHorse._careerEntries || []).some(e => e.type === 'stallion' || e.type === 'broodmare');
    const studStart = document.querySelector('[name=stud_year_start]')?.value;
    const show = role === 'stallion' || role === 'broodmare' || hasStudHistory || !!studStart;
    document.querySelectorAll('.stud-field').forEach(el => {
      el.style.display = show ? 'flex' : 'none';
    });
  },

  _searchHorse(input, type) {
    const q = input.value.trim().toLowerCase();
    const container = document.getElementById('suggest-' + type);
    if (!q) {
      if (container) container.innerHTML = '';
      const form = document.getElementById('horse-form');
      if (form) form.querySelector(`[name=${type}_id]`).value = '';
      return;
    }
    if (q.length < 2) { if (container) container.innerHTML = ''; return; }
    // 父亲只显示牡马，母亲只显示牝马
    const sexFilter = (type === 'sire' || type === 'bms') ? 'male' : 'female';
    // 搜索真实马（真实马默认都是牡马/种牡马）
    const realMatches = (DataLoader.index ? DataLoader.index.horses : [])
      .filter(h => h.name_en.toLowerCase().includes(q) && ((type === 'sire' || type === 'bms') ? h.sex === 'male' : h.sex === 'female'));
    realMatches.sort((a, b) => {
      const aExact = a.name_en.toLowerCase() === q ? 0 : 1;
      const bExact = b.name_en.toLowerCase() === q ? 0 : 1;
      return aExact - bExact;
    });
    const realHorses = realMatches.slice(0, 20);
    // 搜索架空马（按性别过滤）
    Storage.getAllHorses().then(userHorses => {
      const fictional = userHorses
        .filter(h => h.name_en.toLowerCase().includes(q) && h.sex === sexFilter)
        .slice(0, 20);
      const combined = [...fictional, ...realHorses].slice(0, 30);
      container.innerHTML = combined.map(h => {
        const displayName = Utils.safeDisplayName(h);
        return `<div class="suggest-item" data-id="${h.id}" data-name="${Utils.escapeHtml(Utils.displayName(h))}" data-type="${type}">${displayName}</div>`;
      }).join('');
      container.onclick = (e) => { const el = e.target.closest('.suggest-item'); if (el) UIHorse._selectHorse(el.dataset.id, el.dataset.name, el.dataset.type); };
    });
  },

  _selectHorse(id, name, type) {
    const form = document.getElementById('horse-form');
    if (form) form.querySelector(`[name=${type}_id]`).value = id;
    const display = document.getElementById(type + '-display');
    if (display) display.value = name;
    const container = document.getElementById('suggest-' + type);
    if (container) container.innerHTML = '';
  },

  async _filterEntities(input, type, fieldName) {
    const q = input.value.trim().toLowerCase();
    const container = document.getElementById('suggest-' + fieldName);
    if (!q) { container.innerHTML = ''; return; }
    const config = UIEntities.configs[type];
    const all = await Storage.getAllEntities(config.store);
    const sorted = all.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    const matches = sorted.filter(e => e.name.toLowerCase().includes(q)).slice(0, 10);
    container.innerHTML = matches.map(e =>
      `<div class="suggest-item" data-field="${fieldName}" data-id="${e.id}" data-name="${Utils.escapeHtml(e.name)}">${Utils.escapeHtml(e.name)}</div>`
    ).join('');
    container.onclick = (ev) => { const el = ev.target.closest('.suggest-item'); if (el) UIHorse._selectEntity(el.dataset.field, el.dataset.id, el.dataset.name); };
  },

  _selectEntity(fieldName, id, name) {
    document.querySelector(`[name=${fieldName}]`).value = id;
    document.getElementById(`${fieldName}-input`).value = name;
    document.getElementById('suggest-' + fieldName).innerHTML = '';
  },

  async _filterCountry(input) {
    const q = input.value.trim().toUpperCase();
    const container = document.getElementById('suggest-country');
    if (!q || !container) { if (container) container.innerHTML = ''; return; }
    const countries = await Storage.getAllEntities('countries');
    const matches = countries.filter(c => c.code.toUpperCase().includes(q) || (c.name_cn || '').includes(q)).slice(0, 5);
    container.innerHTML = matches.map(c =>
      `<div class="suggest-item" data-code="${Utils.escapeHtml(c.code)}">${Utils.escapeHtml(c.code)} - ${Utils.escapeHtml(c.name_cn || c.name_en || '')}</div>`
    ).join('');
    container.onclick = (e) => { const el = e.target.closest('.suggest-item'); if (el) { document.querySelector('[name=country]').value = el.dataset.code; container.innerHTML = ''; } };
  },

  async refreshPedigreeCache() {
    const horses = await Storage.getAllHorses();
    let count = 0;
    for (const h of horses) {
      if (h.pedigree_cache) {
        h.pedigree_cache = null;
        await Storage.saveHorse(h);
        count++;
      }
    }
    // 同时清除 DataLoader 的缓存
    DataLoader.pedigreeCache = {};
    DataLoader._loadedShards = new Set();
    const all = await Storage.getAll('config');
    const tx = Storage.db.transaction('config', 'readwrite');
    const store = tx.objectStore('config');
    for (const item of all) {
      if (item.key && item.key.startsWith('ped_') && item.key !== 'ped_cache_version') {
        store.delete(item.key);
      }
    }
    alert(`已刷新 ${count} 匹架空马的血统缓存`);
  },

  async _deleteShared(id) {
    if (!confirm('确定删除此共享马？')) return;
    await Storage.delete('horses', id);
    this.renderList();
  },

  async handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const result = await ExportImport.importData(file);
      const msg = `将新增 ${result.newCount} 匹马，覆盖 ${result.overwriteCount} 匹已有马，导入 ${result.groupCount} 个分组。\n确定导入吗？`;
      if (confirm(msg)) {
        await ExportImport.confirmImport(result.data);
        await this.renderList();
        alert('导入完成！');
      }
    } catch (e) {
      alert('导入失败：' + e.message);
    }
    event.target.value = '';
  }
};
