/* ui-entities.js — 通用实体管理模块 */
'use strict';

const UIEntities = {
  configs: {
    farm: {
      store: 'farms', prefix: 'farm_', label: '牧场', selectLabel: '出生牧场',
      fields: [
        { name: 'name', label: '名称', required: true },
        { name: 'country_id', label: '所属架空国', type: 'entity_select', entityType: 'country' },
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
        { name: 'country_id', label: '所属架空国', type: 'entity_select', entityType: 'country' },
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
        { name: 'country_id', label: '所属架空国', type: 'entity_select', entityType: 'country' },
        { name: 'prefix', label: '冠名', placeholder: '多个用逗号分隔' },
        { name: 'notes', label: '备注', type: 'textarea' }
      ],
      statsLabel: { active: '现役赛驹', total: '全部赛驹' },
      horseField: 'owner'
    },
    country: {
      store: 'countries', prefix: 'cty_', label: '国家', selectLabel: '国家',
      fields: [
        { name: 'name_cn', label: '中文名', required: true },
        { name: 'name_en', label: '英文名' },
        { name: 'name_ja', label: '日文名' },
        { name: 'code', label: '国家缩写（2-3字母）', required: true },
        { name: 'description', label: '简介', type: 'textarea' },
        { name: 'custom_grades', label: '自定义赛事分级（每行一个）', type: 'textarea', placeholder: '如 S1\nS2\nJPN1' },
        { name: 'venues', label: '马场列表（每行一个）', type: 'textarea', placeholder: '如 翡翠竞马场\n碧海竞马场' },
        { name: 'has_regional_split', label: '有中央/地方之分', type: 'checkbox' }
      ],
      horseField: null,
      hasRaces: true,
      hasSeries: true
    },
    jockey: {
      store: 'jockeys', prefix: 'jky_', label: '骑手', selectLabel: '骑手',
      fields: [
        { name: 'name', label: '姓名', required: true },
        { name: 'country_id', label: '所属国家', type: 'entity_select', entityType: 'country' },
        { name: 'region', label: '中央/地方', type: 'select', options: ['', '中央', '地方'] },
        { name: 'sex', label: '性别', type: 'select', options: ['', '男', '女'] },
        { name: 'birthday', label: '生日（月/日）', placeholder: '如 3/15' },
        { name: 'age', label: '年龄' },
        { name: 'notes', label: '备注', type: 'textarea' }
      ],
      horseField: null
    }
  },

  _generateId(prefix) {
    return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  },

  async renderList(type) {
    const config = this.configs[type];
    const container = document.getElementById('manage-content');
    const all = await Storage.getAllEntities(config.store);
    all.sort((a, b) => Utils.entityName(a).localeCompare(Utils.entityName(b), 'ja'));

    container.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" onclick="UIEntities.renderForm('${type}')">+ ${I18N.t('create')} ${config.label}</button>
        <input type="text" class="search-input" placeholder="${I18N.t('searchPlaceholder')}" oninput="UIEntities._filterList('${type}', this.value)">
      </div>
      <div class="entity-list" id="entity-list">
        ${all.length === 0 ? `<p class="empty">—</p>` : ''}
        ${all.map(e => this._renderItem(type, e)).join('')}
      </div>
    `;
  },

  _renderItem(type, entity) {
    const displayName = Utils.entityName(entity);
    const isFictional = type === 'country' && entity.id?.startsWith('cty_');
    const isRealCountry = type === 'country' && !entity.id?.startsWith('cty_');
    return `
      <div class="horse-item" data-name="${displayName.toLowerCase()}">
        <span class="name">${displayName}${isFictional ? '*' : ''}</span>
        <div>
          <button class="btn btn-secondary btn-sm" onclick="UIEntities.renderDetail('${type}','${entity.id}')">详情</button>
          ${isRealCountry ? '' : `<button class="btn btn-secondary btn-sm" onclick="UIEntities.renderForm('${type}',null,'${entity.id}')">编辑</button>
          <button class="btn btn-danger btn-sm" onclick="UIEntities.delete('${type}','${entity.id}')">删除</button>`}
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

    // 预加载 entity_select 选项
    const entityOptions = {};
    for (const f of config.fields) {
      if (f.type === 'entity_select') {
        const items = await Storage.getAllEntities(this.configs[f.entityType].store);
        entityOptions[f.name] = items;
      }
    }

    container.innerHTML = `
      <div class="card">
        <h3>${isEdit ? I18N.t('edit') : I18N.t('create')} ${config.label}</h3>
        <form id="entity-form" class="form-grid">
          ${config.fields.map(f => `
            <label>${f.label}${f.required ? ' *' : ''}
              ${f.type === 'textarea'
                ? `<textarea name="${f.name}" rows="3">${e[f.name] || ''}</textarea>`
                : f.type === 'checkbox'
                ? `<input type="checkbox" name="${f.name}" ${e[f.name] ? 'checked' : ''}>`
                : f.type === 'entity_select'
                ? `<select name="${f.name}"><option value="">-- 选择 --</option>${(entityOptions[f.name] || []).map(item => `<option value="${item.id}" ${e[f.name] === item.id ? 'selected' : ''}>${Utils.entityName(item)}</option>`).join('')}</select>`
                : f.type === 'select'
                ? `<select name="${f.name}">${(f.options || []).map(opt => `<option value="${opt}" ${e[f.name] === opt ? 'selected' : ''}>${opt || '-- 选择 --'}</option>`).join('')}</select>`
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
      if (f.type === 'checkbox') {
        data[f.name] = fd.has(f.name);
      } else {
        data[f.name] = fd.get(f.name)?.trim() || '';
      }
    }
    // 名称必填校验（name 或 name_cn）
    const nameField = config.fields.find(f => f.required && (f.name === 'name' || f.name === 'name_cn'));
    if (nameField && !data[nameField.name]) { alert(`${nameField.label}不能为空`); return; }
    // 架空国 code + 国名 唯一性校验
    if (type === 'country') {
      const all = await Storage.getAllEntities(config.store);
      if (data.code) {
        const dupCode = all.find(c => c.code === data.code && c.id !== data.id);
        if (dupCode) { alert(`国家缩写"${data.code}"已被使用`); return; }
      }
      if (data.name_cn) {
        const dupName = all.find(c => c.name_cn === data.name_cn && c.id !== data.id);
        if (dupName) { alert(`国家名"${data.name_cn}"已存在`); return; }
      }
    }
    await Storage.saveEntity(config.store, data);
    this.renderList(type);
  },

  async renderDetail(type, id) {
    // 确保在设定管理视图（不触发 _initManage）
    const manageSection = document.getElementById('view-manage');
    if (manageSection?.classList.contains('hidden')) {
      document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
      manageSection.classList.remove('hidden');
    }
    document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.sidebar-btn[data-tab="${type}"]`)?.classList.add('active');

    const config = this.configs[type];
    const entity = await Storage.getEntity(config.store, id);
    if (!entity) return;
    const horses = config.horseField ? await Storage.getAllHorses() : [];
    const related = config.horseField ? horses.filter(h => h[config.horseField] === id) : [];
    const active = related.filter(h => h.role === 'active');
    const container = document.getElementById('manage-content');

    container.innerHTML = `
      <div>
        <button class="btn btn-secondary btn-sm" onclick="UIEntities.renderList('${type}')">← 返回</button>
        <h3 style="display:inline;margin-left:12px">${Utils.entityName(entity)}</h3>
      </div>
      <div class="detail-info-grid" style="margin:12px 0">
        ${(await Promise.all(config.fields.filter(f => f.name !== 'name' && f.name !== 'name_cn' && entity[f.name]).map(async f => {
          let displayVal = entity[f.name];
          if (f.type === 'entity_select' && displayVal) {
            const ref = await Storage.getEntity(this.configs[f.entityType]?.store, displayVal);
            displayVal = ref ? Utils.entityName(ref) : displayVal;
          }
          if (f.type === 'checkbox') displayVal = displayVal ? '是' : '否';
          return `<table class="detail-table"><tr><td class="dt">${f.label}</td><td class="dd">${displayVal}</td></tr></table>`;
        }))).join('')}
      </div>
      ${config.statsLabel ? `
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
      ` : ''}
      ${config.hasRaces ? await this._renderCountryRaces(id) : ''}
      ${config.hasSeries ? await this._renderCountrySeries(id) : ''}
      ${type === 'jockey' ? await this._renderJockeyRecord(id) : ''}
    `;
  },

  async _renderCountryRaces(countryId) {
    const allRaces = await Storage.getAllEntities('races');
    const races = allRaces.filter(r => r.country_id === countryId);
    const country = await Storage.getEntity('countries', countryId);
    const isFictional = countryId?.startsWith('cty_');

    // 按 schedule 排序（月份→周→比赛日）
    races.sort((a, b) => {
      const parseSchedule = (s) => {
        const m = s?.match(/(\d+)月第(\d+)周第(\d+)比赛日/);
        return m ? [+m[1], +m[2], +m[3]] : [99, 99, 99];
      };
      const [am, aw, ad] = parseSchedule(a.schedule);
      const [bm, bw, bd] = parseSchedule(b.schedule);
      return am - bm || aw - bw || ad - bd;
    });

    return `
      <div style="margin-top:16px">
        <h4>赛事 (${races.length})</h4>
        <div style="margin-bottom:8px;display:flex;gap:8px">
          ${isFictional ? `<button class="btn btn-primary btn-sm" onclick="UIRaces.renderForm(null,'${countryId}')">+ 新建赛事</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="UIEntities._exportCountryRaces('${countryId}')">导出赛事</button>
          ${isFictional ? `<label class="btn btn-secondary btn-sm" style="cursor:pointer">导入赛事<input type="file" accept=".json" style="display:none" onchange="UIEntities._importCountryRaces('${countryId}',event)"></label>` : ''}
        </div>
        ${races.length === 0 ? '<p class="empty">暂无赛事</p>' : `
        <table class="race-record-table">
          <thead><tr><th>举办日</th><th>分级</th><th>赛事名</th><th>英文名</th><th>距离</th><th>限定</th>${isFictional ? '<th>操作</th>' : ''}</tr></thead>
          <tbody>${races.map(r => {
            const scheduleShort = r.schedule ? r.schedule.replace('月第', '-').replace('周第', '-').replace('比赛日', '') : '';
            const restriction = [r.age_restriction ? r.age_restriction.replace('yo+', '岁+').replace('yo', '岁') : '', r.sex_restriction === 'female' ? '牝马' : ''].filter(Boolean).join(' ') || '不限';
            return `<tr>
              <td>${scheduleShort}</td>
              <td>${r.grade}</td>
              <td>${r.name_cn || ''}</td>
              <td>${r.name || ''}</td>
              <td>${r.surface === 'turf' ? 'T' : r.surface === 'dirt' ? 'D' : 'J'}${r.distance || ''}</td>
              <td>${restriction}</td>
              ${isFictional ? `<td><button class="btn btn-secondary btn-sm" onclick="UIResults.showForm({raceId:'${r.id}',mode:'template'})">录入</button> <button class="btn btn-secondary btn-sm" onclick="UIRaces.renderForm('${r.id}','${countryId}')">编辑</button> <button class="btn btn-danger btn-sm" onclick="UIRaces.delete('${r.id}')">×</button></td>` : `<td><button class="btn btn-secondary btn-sm" onclick="UIResults.showForm({raceId:'${r.id}',mode:'template'})">录入</button></td>`}
            </tr>`;
          }).join('')}</tbody>
        </table>`}
      </div>
    `;
  },

  async _renderCountrySeries(countryId) {
    const country = await Storage.getEntity('countries', countryId);
    const series = country?.series || [];
    const allRaces = await Storage.getAllEntities('races');
    const countryRaces = allRaces.filter(r => r.country_id === countryId);
    const isFictional = countryId?.startsWith('cty_');

    const seriesHtml = series.map((s, idx) => {
      const raceNames = s.race_ids.map(rid => {
        const race = countryRaces.find(r => r.id === rid);
        return race ? Utils.entityName(race) : '—';
      }).join(' → ');
      return `<div class="horse-item">
        <span class="name">${s.name}</span>
        <span class="meta">${raceNames}</span>
        ${isFictional ? `<button class="btn btn-danger btn-sm" onclick="UIEntities._deleteSeries('${countryId}',${idx})">×</button>` : ''}
      </div>`;
    }).join('');

    return `
      <div style="margin-top:16px">
        <h4>系列赛事 (${series.length})</h4>
        ${isFictional ? `<button class="btn btn-primary btn-sm" onclick="UIEntities._showSeriesForm('${countryId}')" style="margin-bottom:8px">+ 新建系列</button>` : ''}
        ${series.length === 0 ? '<p class="empty">暂无系列赛事</p>' : `<div class="entity-list">${seriesHtml}</div>`}
      </div>
    `;
  },

  async _showSeriesForm(countryId) {
    const allRaces = await Storage.getAllEntities('races');
    const countryRaces = allRaces.filter(r => r.country_id === countryId);
    // 按日程排序
    countryRaces.sort((a, b) => {
      const p = (s) => { const m = s?.match(/(\d+)月第(\d+)周第(\d+)比赛日/); return m ? [+m[1], +m[2], +m[3]] : [99,99,99]; };
      const [am,aw,ad] = p(a.schedule); const [bm,bw,bd] = p(b.schedule);
      return am-bm || aw-bw || ad-bd;
    });
    const container = document.getElementById('manage-content');

    // 在详情页末尾追加表单
    const formHtml = `
      <div class="card" id="series-form-card" style="margin-top:12px">
        <h4>新建系列赛事</h4>
        <label>系列名称 *<input type="text" id="series-name" required placeholder="如 经典三冠"></label>
        <label>选择赛事（按住 Ctrl/Cmd 多选）
          <select id="series-races" multiple size="${Math.min(countryRaces.length, 10)}" style="width:100%">
            ${countryRaces.map(r => `<option value="${r.id}">${Utils.entityName(r)} (${r.grade})</option>`).join('')}
          </select>
        </label>
        <div class="form-actions" style="margin-top:8px">
          <button class="btn btn-primary btn-sm" onclick="UIEntities._saveSeries('${countryId}')">保存</button>
          <button class="btn btn-secondary btn-sm" onclick="document.getElementById('series-form-card').remove()">取消</button>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', formHtml);
  },

  async _saveSeries(countryId) {
    const name = document.getElementById('series-name')?.value.trim();
    const select = document.getElementById('series-races');
    const raceIds = Array.from(select?.selectedOptions || []).map(o => o.value);

    if (!name) { alert('请填写系列名称'); return; }
    if (raceIds.length < 2) { alert('请至少选择2场赛事'); return; }

    const country = await Storage.getEntity('countries', countryId);
    if (!country.series) country.series = [];
    country.series.push({ name, race_ids: raceIds });
    await Storage.saveEntity('countries', country);
    this.renderDetail('country', countryId);
  },

  async _deleteSeries(countryId, index) {
    if (!confirm('确定删除该系列？')) return;
    const country = await Storage.getEntity('countries', countryId);
    if (country.series) {
      country.series.splice(index, 1);
      await Storage.saveEntity('countries', country);
    }
    this.renderDetail('country', countryId);
  },

  async _exportCountryRaces(countryId) {
    const country = await Storage.getEntity('countries', countryId);
    const allRaces = await Storage.getAllEntities('races');
    const allResults = await Storage.getAllEntities('results');
    const races = allRaces.filter(r => r.country_id === countryId);
    const raceIds = new Set(races.map(r => r.id));
    const results = allResults.filter(r => raceIds.has(r.race_id) || r.country_id === countryId);

    const data = { export_type: 'country_races', country, races, results };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${country?.code || 'country'}_races.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async _importCountryRaces(countryId, event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.export_type !== 'country_races') { alert('文件格式不正确'); return; }
      let raceCount = 0, resultCount = 0;
      for (const race of (data.races || [])) {
        race.country_id = countryId; // 强制归属当前国家
        await Storage.saveEntity('races', race);
        raceCount++;
      }
      for (const result of (data.results || [])) {
        result.country_id = countryId;
        await Storage.saveEntity('results', result);
        resultCount++;
      }
      alert(`导入完成：${raceCount} 场赛事，${resultCount} 条记录`);
      this.renderDetail('country', countryId);
    } catch (e) {
      alert('导入失败：' + e.message);
    }
  },

  async _renderJockeyRecord(jockeyId) {
    const allResults = await Storage.getAllEntities('results');
    const records = [];
    for (const r of allResults) {
      const entry = (r.entries || []).find(e => e.jockey_id === jockeyId);
      if (entry) records.push({ ...r, _entry: entry });
    }
    if (records.length === 0) return '<div style="margin-top:16px"><h4>骑乘战绩</h4><p class="empty">暂无出赛记录</p></div>';

    // 按 year 倒序，同年按 schedule 倒序
    records.sort((a, b) => {
      if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
      const p = (s) => { const m = s?.match(/(\d+)月第(\d+)周第(\d+)/); return m ? [+m[1],+m[2],+m[3]] : [0,0,0]; };
      const [am,aw,ad] = p(a.schedule); const [bm,bw,bd] = p(b.schedule);
      return bm-am || bw-aw || bd-ad;
    });

    // 统计
    const entries = records.map(r => r._entry);
    const total = entries.length;
    const wins = entries.filter(e => e.finish === 1).length;
    const seconds = entries.filter(e => e.finish === 2).length;
    const thirds = entries.filter(e => e.finish === 3).length;
    const g1Wins = records.filter(r => (r.grade === 'G1' || r.grade === 'JG1') && r._entry.finish === 1).length;
    const g2Wins = records.filter(r => (r.grade === 'G2' || r.grade === 'JG2') && r._entry.finish === 1).length;
    const g3Wins = records.filter(r => (r.grade === 'G3' || r.grade === 'JG3') && r._entry.finish === 1).length;
    const gradedWins = g1Wins + g2Wins + g3Wins;
    const totalPrize = entries.reduce((s, e) => s + (e.prize || 0), 0);
    const winRate = total > 0 ? (wins / total * 100).toFixed(1) : 0;

    // 只显示获胜的重赏/自定义比赛（finish === 1）
    const winRecords = records.filter(r => r._entry.finish === 1);

    const rows = await Promise.all(winRecords.map(async r => {
      const e = r._entry;
      const horse = e.horse_id ? (DataLoader.getHorseFromIndex(e.horse_id) || await Storage.getHorse(e.horse_id)) : null;
      const horseName = horse ? Utils.displayName(horse) : '';
      const scheduleDisplay = r.schedule ? r.schedule.replace('比赛日', '日') : '';
      const dateCol = (r.year ? `${r.year}年` : '') + (scheduleDisplay ? ' ' + scheduleDisplay : '');
      return `<tr>
        <td>${dateCol}</td>
        <td>${r.race_name || ''}</td>
        <td>${r.grade || ''}</td>
        <td>${horseName}</td>
        <td>${r.distance ? r.distance + 'm' : ''}</td>
        <td>${r.surface === 'turf' ? '草地' : r.surface === 'dirt' ? '泥地' : ''}</td>
      </tr>`;
    }));

    return `
      <div style="margin-top:16px">
        <h4>骑乘战绩</h4>
        <div class="race-stats">${total}战${wins}胜 [${wins}-${seconds}-${thirds}-${total-wins-seconds-thirds}]　　勝率${winRate}%${g1Wins ? `　　GI ${g1Wins}勝` : ''}${g2Wins ? `　　GII ${g2Wins}勝` : ''}${g3Wins ? `　　GIII ${g3Wins}勝` : ''}${gradedWins ? `　　分级赛合計${gradedWins}勝` : ''}${totalPrize ? `　　総獲得賞金:¥${totalPrize.toLocaleString()}` : ''}</div>
        ${winRecords.length > 0 ? `
        <h5 style="margin-top:12px">重赏胜利一覧 (${winRecords.length})</h5>
        <table class="race-record-table">
          <thead><tr><th>日程</th><th>赛事名</th><th>等级</th><th>骑乘马</th><th>距离</th><th>场地</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>` : ''}
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
