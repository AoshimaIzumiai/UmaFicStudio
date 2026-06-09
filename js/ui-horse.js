/* ui-horse.js — 马匹管理界面 */
'use strict';

const UIHorse = {
  async init() {
    await this.renderList();
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.horse-suggest') && !e.target.matches('input[oninput*="_autocomplete"], input[oninput*="_searchHorse"], #sire-display, #dam-display')) {
        document.querySelectorAll('.horse-suggest').forEach(el => el.innerHTML = '');
      }
    });
  },

  async renderList() {
    const container = document.getElementById('manage-content');
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
      <div class="horse-item">
        <div>
          <span class="name">${horse.name_en}</span>
          <span class="meta">${horse.name_ja || ''} ${horse.country ? '(' + horse.country + ')' : ''}</span>
          <span class="tag">${Utils.roleLabel(horse.role)}</span>
        </div>
        <div>
          <span class="meta">${Utils.sexLabel(horse.sex)} ${horse.birth_year || ''}</span>
          <button class="btn btn-secondary btn-sm" onclick="UIPedigree.showDetail('${horse.id}')">详情</button>
          <button class="btn btn-secondary btn-sm" onclick="UIHorse.showDetail('${horse.id}')">编辑</button>
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
      h._sire_name = sire ? Utils.displayName(sire) : h.sire_id;
    } else { h._sire_name = ''; }
    if (h.dam_id) {
      const dam = DataLoader.getHorseFromIndex(h.dam_id) || await Storage.getHorse(h.dam_id);
      h._dam_name = dam ? Utils.displayName(dam) : h.dam_id;
    } else { h._dam_name = ''; }
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
        <h3>${isEdit ? '编辑马匹' : '创建架空马'}</h3>
        <form id="horse-form" class="form-grid">
          <label>英文名
            <input type="text" name="name_en" value="${h.name_en || ''}">
          </label>
          <label>日文名
            <input type="text" name="name_ja" value="${h.name_ja || ''}">
          </label>
          <label>中文名
            <input type="text" name="name_cn" value="${h.name_cn || ''}">
          </label>
          <label>性别 *
            <select name="sex" required>
              <option value="male" ${h.sex === 'male' ? 'selected' : ''}>牡</option>
              <option value="female" ${h.sex === 'female' ? 'selected' : ''}>牝</option>
              <option value="gelding" ${h.sex === 'gelding' ? 'selected' : ''}>骟</option>
            </select>
          </label>
          <label>角色 *
            <select name="role" required onchange="UIHorse._onRoleChange(this.value)">
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
            <input type="text" name="country" value="${h.country || ''}" placeholder="JPN, USA, GB..." autocomplete="off" oninput="UIHorse._filterCountry(this)">
            <div class="horse-suggest" id="suggest-country"></div>
          </label>
          <label>毛色
            <input type="text" name="color" value="${h.color || ''}" placeholder="鹿毛, 青鹿毛...">
          </label>
          <label>父亲
            <input type="hidden" name="sire_id" value="${h.sire_id || ''}">
            <input type="text" id="sire-display" value="${h._sire_name || ''}" placeholder="输入种马名搜索..." oninput="UIHorse._searchHorse(this, 'sire')">
            <div class="horse-suggest" id="suggest-sire"></div>
          </label>
          <label>母亲
            <input type="hidden" name="dam_id" value="${h.dam_id || ''}">
            <input type="text" id="dam-display" value="${h._dam_name || ''}" placeholder="输入母马名搜索..." oninput="UIHorse._searchHorse(this, 'dam')">
            <div class="horse-suggest" id="suggest-dam"></div>
          </label>
          <label class="stud-field" style="display:${h.role === 'stallion' || h.role === 'broodmare' ? 'flex' : 'none'}">配种开始年
            <input type="number" name="stud_year_start" value="${h.stud_year_start || ''}" min="1900" max="2100">
          </label>
          <label class="stud-field" style="display:${h.role === 'stallion' || h.role === 'broodmare' ? 'flex' : 'none'}">配种结束年
            <input type="number" name="stud_year_end" value="${h.stud_year_end || ''}" min="1900" max="2100" placeholder="空=仍在配种">
          </label>
          <label>场地适性
            <div class="checkbox-group">
              <label><input type="checkbox" name="turf" ${(h.aptitude_surface || []).includes('turf') ? 'checked' : ''}> 草地</label>
              <label><input type="checkbox" name="dirt" ${(h.aptitude_surface || []).includes('dirt') ? 'checked' : ''}> 泥地</label>
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
          ${!isEdit || h.type === 'fictional' ? `
          <fieldset class="form-section">
            <legend>扩展信息</legend>
            <label>出生牧场
              <input type="text" id="farm-input" value="${h._farm_name || ''}" autocomplete="off" oninput="UIHorse._filterEntities(this, 'farm', 'farm')">
              <input type="hidden" name="farm" value="${h.farm || ''}">
              <div class="horse-suggest" id="suggest-farm"></div>
            </label>
            <label>练马师
              <input type="text" id="trainer-input" value="${h._trainer_name || ''}" autocomplete="off" oninput="UIHorse._filterEntities(this, 'trainer', 'trainer')">
              <input type="hidden" name="trainer" value="${h.trainer || ''}">
              <div class="horse-suggest" id="suggest-trainer"></div>
            </label>
            <label>马主
              <input type="text" id="owner-input" value="${h._owner_name || ''}" autocomplete="off" oninput="UIHorse._filterEntities(this, 'owner', 'owner')">
              <input type="hidden" name="owner" value="${h.owner || ''}">
              <div class="horse-suggest" id="suggest-owner"></div>
            </label>
            <label>马名含义
              <input type="text" name="name_meaning" value="${h.name_meaning || ''}">
            </label>
            <label>备注
              <textarea name="notes" rows="3">${h.notes || ''}</textarea>
            </label>
          </fieldset>
          ` : ''}
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
      name_cn: fd.get('name_cn').trim(),
      type: 'fictional',
      sex: fd.get('sex'),
      birth_year: fd.get('birth_year') ? parseInt(fd.get('birth_year')) : null,
      color: fd.get('color').trim(),
      country: fd.get('country').trim().toUpperCase(),
      role: fd.get('role'),
      aptitude_surface: surface,
      aptitude_distance: distance,
      stud_year_start: fd.get('stud_year_start') ? parseInt(fd.get('stud_year_start')) : null,
      stud_year_end: fd.get('stud_year_end') ? parseInt(fd.get('stud_year_end')) : null,
      sire_id: fd.get('sire_id').trim() || null,
      dam_id: fd.get('dam_id').trim() || null,
      farm: null,
      trainer: null,
      owner: null,
      name_meaning: fd.get('name_meaning')?.trim() || '',
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

    // 名字验证：至少填一个
    if (!horse.name_en && !horse.name_ja && !horse.name_cn) {
      alert('英文名、日文名、中文名至少填写一个');
      return;
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
    // 保存后检查 Cross 浓度（需要血统树）
    if (horse.sire_id || horse.dam_id) {
      horse.pedigree_cache = null;
      await Storage.saveHorse(horse);
      const tree = await Pedigree.getPedigreeTree(horse.id);
      if (tree) {
        const crossResult = Cross.calculateCross(tree, 5);
        const intensityWarnings = YearValidator.checkCrossIntensity(crossResult);
        if (intensityWarnings.length > 0) {
          alert('Cross 浓度警告：\n\n' + intensityWarnings.join('\n') + '\n\n（已保存，仅作提示）');
        }
      }
    }
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

  _onRoleChange(role) {
    const show = role === 'stallion' || role === 'broodmare';
    document.querySelectorAll('.stud-field').forEach(el => {
      el.style.display = show ? 'flex' : 'none';
    });
  },

  _searchHorse(input, type) {
    const q = input.value.trim().toLowerCase();
    const container = document.getElementById('suggest-' + type);
    if (!container || q.length < 2) { if (container) container.innerHTML = ''; return; }
    // 父亲只显示牡马，母亲只显示牝马
    const sexFilter = type === 'sire' ? 'male' : 'female';
    // 搜索真实马（真实马默认都是牡马/种牡马）
    const realHorses = (DataLoader.index ? DataLoader.index.horses : [])
      .filter(h => h.name_en.toLowerCase().includes(q) && (type === 'sire' ? h.sex === 'male' : h.sex === 'female'))
      .slice(0, 5);
    // 搜索架空马（按性别过滤）
    Storage.getAllHorses().then(userHorses => {
      const fictional = userHorses
        .filter(h => h.name_en.toLowerCase().includes(q) && h.sex === sexFilter)
        .slice(0, 5);
      const combined = [...fictional, ...realHorses].slice(0, 8);
      container.innerHTML = combined.map(h => {
        const displayName = Utils.displayName(h);
        return `<div class="suggest-item" onclick="UIHorse._selectHorse('${h.id}','${displayName.replace(/'/g, "\\'")}','${type}')">${displayName}</div>`;
      }).join('');
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
      `<div class="suggest-item" onclick="UIHorse._selectEntity('${fieldName}', '${e.id}', '${e.name.replace(/'/g, "\\'")}')">${e.name}</div>`
    ).join('');
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
      `<div class="suggest-item" onclick="document.querySelector('[name=country]').value='${c.code}';document.getElementById('suggest-country').innerHTML=''">${c.code} - ${c.name_cn || c.name_en || ''}</div>`
    ).join('');
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
