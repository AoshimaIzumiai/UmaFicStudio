/* ui-horse.js — 马匹管理界面 */
'use strict';

const UIHorse = {
  async init() {
    await this.renderList();
  },

  async renderList() {
    const container = document.getElementById('horse-content');
    const horses = await Storage.getAllHorses();

    container.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" onclick="UIHorse.showCreateForm()">+ 创建架空马</button>
        <button class="btn btn-secondary" onclick="ExportImport.exportData()">导出数据</button>
        <label class="btn btn-secondary">
          导入数据
          <input type="file" accept=".json" style="display:none" onchange="UIHorse.handleImport(event)">
        </label>
      </div>
      <div class="horse-list">
        ${horses.length === 0 ? '<p class="empty">暂无架空马，点击上方按钮创建</p>' : ''}
        ${horses.map(h => this._renderItem(h)).join('')}
      </div>
    `;
  },

  _renderItem(horse) {
    return `
      <div class="horse-item" onclick="UIHorse.showDetail('${horse.id}')">
        <div>
          <span class="name">${horse.name_en}</span>
          <span class="meta">${horse.name_ja || ''} ${horse.country ? '(' + horse.country + ')' : ''}</span>
          <span class="tag">${Utils.roleLabel(horse.role)}</span>
        </div>
        <div class="meta">
          ${Utils.sexLabel(horse.sex)} ${horse.birth_year || ''}
        </div>
      </div>
    `;
  },

  showCreateForm(editHorse = null) {
    const container = document.getElementById('horse-content');
    const h = editHorse || {};
    const isEdit = !!editHorse;

    container.innerHTML = `
      <div class="card">
        <h3>${isEdit ? '编辑马匹' : '创建架空马'}</h3>
        <form id="horse-form" class="form-grid">
          <label>英文名 *
            <input type="text" name="name_en" value="${h.name_en || ''}" required>
          </label>
          <label>日文名
            <input type="text" name="name_ja" value="${h.name_ja || ''}">
          </label>
          <label>性别 *
            <select name="sex" required>
              <option value="male" ${h.sex === 'male' ? 'selected' : ''}>牡</option>
              <option value="female" ${h.sex === 'female' ? 'selected' : ''}>牝</option>
              <option value="gelding" ${h.sex === 'gelding' ? 'selected' : ''}>骟</option>
            </select>
          </label>
          <label>角色 *
            <select name="role" required>
              <option value="active" ${h.role === 'active' ? 'selected' : ''}>现役马</option>
              <option value="stallion" ${h.role === 'stallion' ? 'selected' : ''}>种牡马</option>
              <option value="broodmare" ${h.role === 'broodmare' ? 'selected' : ''}>繁殖牝马</option>
              <option value="retired" ${h.role === 'retired' ? 'selected' : ''}>引退马</option>
            </select>
          </label>
          <label>出生年
            <input type="number" name="birth_year" value="${h.birth_year || ''}" min="1900" max="2100">
          </label>
          <label>产国
            <input type="text" name="country" value="${h.country || ''}" placeholder="JPN, USA, GB...">
          </label>
          <label>毛色
            <input type="text" name="color" value="${h.color || ''}" placeholder="鹿毛, 青鹿毛...">
          </label>
          <label>父亲 ID
            <input type="text" name="sire_id" value="${h.sire_id || ''}" placeholder="输入种马名搜索..." oninput="UIHorse._searchHorse(this, 'sire')">
            <div class="horse-suggest" id="suggest-sire"></div>
          </label>
          <label>母亲 ID
            <input type="text" name="dam_id" value="${h.dam_id || ''}" placeholder="输入母马名搜索...">
          </label>
          <label>场地适性
            <div class="checkbox-group">
              <label><input type="checkbox" name="turf" ${(h.aptitude_surface || []).includes('turf') ? 'checked' : ''}> 芝</label>
              <label><input type="checkbox" name="dirt" ${(h.aptitude_surface || []).includes('dirt') ? 'checked' : ''}> ダート</label>
            </div>
          </label>
          <label>距离适性
            <div class="checkbox-group">
              <label><input type="checkbox" name="sprint" ${(h.aptitude_distance || []).includes('sprint') ? 'checked' : ''}> 短途</label>
              <label><input type="checkbox" name="mile" ${(h.aptitude_distance || []).includes('mile') ? 'checked' : ''}> 一哩</label>
              <label><input type="checkbox" name="intermediate" ${(h.aptitude_distance || []).includes('intermediate') ? 'checked' : ''}> 中距离</label>
              <label><input type="checkbox" name="long" ${(h.aptitude_distance || []).includes('long') ? 'checked' : ''}> 长途</label>
            </div>
          </label>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">${isEdit ? '保存' : '创建'}</button>
            <button type="button" class="btn btn-secondary" onclick="UIHorse.renderList()">取消</button>
            ${isEdit ? `<button type="button" class="btn btn-danger" onclick="UIHorse.deleteHorse('${h.id}')">删除</button>` : ''}
          </div>
        </form>
      </div>
    `;

    document.getElementById('horse-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this._saveForm(e.target, isEdit ? h.id : null);
    });
  },

  async _saveForm(form, existingId) {
    const fd = new FormData(form);
    const surface = [];
    if (form.querySelector('[name=turf]').checked) surface.push('turf');
    if (form.querySelector('[name=dirt]').checked) surface.push('dirt');
    const distance = [];
    if (form.querySelector('[name=sprint]').checked) distance.push('sprint');
    if (form.querySelector('[name=mile]').checked) distance.push('mile');
    if (form.querySelector('[name=intermediate]').checked) distance.push('intermediate');
    if (form.querySelector('[name=long]').checked) distance.push('long');

    const horse = {
      id: existingId || Utils.generateId(),
      name_en: fd.get('name_en').trim(),
      name_ja: fd.get('name_ja').trim(),
      type: 'fictional',
      sex: fd.get('sex'),
      birth_year: fd.get('birth_year') ? parseInt(fd.get('birth_year')) : null,
      color: fd.get('color').trim(),
      country: fd.get('country').trim().toUpperCase(),
      role: fd.get('role'),
      aptitude_surface: surface,
      aptitude_distance: distance,
      stud_year_start: null,
      stud_year_end: null,
      sire_id: fd.get('sire_id').trim() || null,
      dam_id: fd.get('dam_id').trim() || null,
      pedigree_cache: null
    };

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
    // 清除缓存链
    if (existingId) await Pedigree.onHorseUpdated(existingId);
    await this.renderList();
  },

  async showDetail(id) {
    const horse = await Storage.getHorse(id);
    if (!horse) return;
    this.showCreateForm(horse);
  },

  async deleteHorse(id) {
    // 检查是否有其他马引用了它
    const refs = await Storage.findHorsesReferencing(id);
    if (refs.length > 0) {
      const names = refs.map(h => h.name_en).join(', ');
      if (!confirm(`警告：以下马匹引用了此马作为父/母：\n${names}\n\n删除后这些引用将失效。确定删除吗？`)) return;
    } else {
      if (!confirm('确定删除这匹马吗？')) return;
    }
    await Storage.deleteHorse(id);
    await Pedigree.onHorseUpdated(id);
    await this.renderList();
  },

  _searchHorse(input, type) {
    const q = input.value.trim().toLowerCase();
    const container = document.getElementById('suggest-' + type);
    if (!container || q.length < 2) { if (container) container.innerHTML = ''; return; }
    const horses = (DataLoader.index ? DataLoader.index.horses : [])
      .filter(h => h.name_en.toLowerCase().includes(q))
      .slice(0, 5);
    container.innerHTML = horses.map(h =>
      `<div class="suggest-item" onclick="UIHorse._selectHorse('${h.id}','${type}')">${Utils.displayName(h)}</div>`
    ).join('');
  },

  _selectHorse(id, type) {
    const form = document.getElementById('horse-form');
    if (form) form.querySelector(`[name=${type}_id]`).value = id;
    const container = document.getElementById('suggest-' + type);
    if (container) container.innerHTML = '';
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
