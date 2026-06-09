/* ui-results.js — 比赛记录录入 */
'use strict';

const UIResults = {
  currentEntries: [],
  currentRace: null,
  currentMode: null,
  prefilledHorseId: null,

  async showForm(options = {}) {
    const container = document.getElementById('manage-content');
    this.currentEntries = [];
    this.currentMode = options.mode || (options.raceId ? 'template' : 'adhoc');
    this.prefilledHorseId = options.horseId || null;

    if (this.currentMode === 'template' && options.raceId) {
      this.currentRace = await Storage.getEntity('races', options.raceId);
    } else {
      this.currentRace = null;
    }

    App.showView('manage');
    container.innerHTML = '<p>加载中...</p>';
    await this._render();
  },

  async _render() {
    const container = document.getElementById('manage-content');
    const r = this.currentRace || {};
    const races = await Storage.getAllEntities('races');

    container.innerHTML = `
      <div class="card">
        <h3>录入比赛记录</h3>
        <form id="result-form" class="form-grid">
          ${this.currentMode === 'template' ? `
            <label>赛事模板
              <select name="race_id" onchange="UIResults._onTemplateChange(this.value)">
                <option value="">-- 选择赛事 --</option>
                ${races.map(rc => `<option value="${rc.id}" ${r.id === rc.id ? 'selected' : ''}>${rc.name} (${rc.grade})</option>`).join('')}
              </select>
            </label>
          ` : `
            <label>等级
              <select name="grade">
                <option value="条件">条件</option>
                <option value="新马">新马</option>
                <option value="未胜利">未胜利</option>
              </select>
            </label>
          `}
          <label>赛名 ${this.currentMode === 'template' ? '' : '(可空)'}
            <input type="text" name="race_name" value="${r.name || ''}">
          </label>
          <label>年份 *<input type="number" name="year" required min="1900" max="2100"></label>
          <label>日程
            <div class="schedule-inputs">
              <select name="schedule_month"><option value="">--</option>${Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select>月第
              <input type="number" name="schedule_week" min="1" max="5" style="width:50px">周第
              <input type="number" name="schedule_day" min="1" max="3" style="width:50px">比赛日
            </div>
          </label>
          <label>距离(m)<input type="number" name="distance" value="${r.distance || ''}" min="800" max="4000"></label>
          <label>场地
            <select name="surface">
              <option value="">--</option>
              <option value="turf" ${r.surface==='turf'?'selected':''}>草地</option>
              <option value="dirt" ${r.surface==='dirt'?'selected':''}>泥地</option>
            </select>
          </label>
          <label>马场<input type="text" name="venue" value="${r.venue || ''}"></label>
          <label>条件备注<input type="text" name="condition_note" value="${r.condition_note || ''}"></label>
        </form>
        <h4 style="margin:16px 0 8px">参赛马匹</h4>
        ${this._renderEntriesTable()}
        <button class="btn btn-secondary" onclick="UIResults._addEntry()" style="margin:8px 0">+ 添加参赛马</button>
        <div class="form-actions" style="margin-top:16px">
          <button class="btn btn-primary" onclick="UIResults.save()">保存记录</button>
          <button class="btn btn-secondary" onclick="UIRaces.renderList()">取消</button>
        </div>
      </div>
    `;

    // 预填模板的 schedule
    if (r.schedule) {
      const m = r.schedule.match(/(\d+)月第(\d+)周第(\d+)比赛日/);
      if (m) {
        const form = document.getElementById('result-form');
        if (form) {
          form.querySelector('[name=schedule_month]').value = m[1];
          form.querySelector('[name=schedule_week]').value = m[2];
          form.querySelector('[name=schedule_day]').value = m[3];
        }
      }
    }

    // 如果有预填 horse，自动添加一行
    if (this.prefilledHorseId && this.currentEntries.length === 0) {
      this.currentEntries.push({ horse_id: this.prefilledHorseId, finish: '', jockey_id: '', weight: '', popularity: '', prize: '', notes: '' });
      this._refreshEntries();
    }
  },

  _renderEntriesTable() {
    if (this.currentEntries.length === 0) return '<p class="empty">暂无参赛马，点击下方按钮添加</p>';
    return `
      <table class="entries-table">
        <thead><tr><th>马匹</th><th>名次</th><th>骑手</th><th>负重</th><th>人气</th><th>奖金</th><th></th></tr></thead>
        <tbody>${this.currentEntries.map((e, i) => `
          <tr>
            <td><input type="text" id="entry-horse-${i}" value="${e._horse_name || ''}" placeholder="搜索马匹..." oninput="UIResults._searchHorse(${i}, this.value)"><input type="hidden" id="entry-horse-id-${i}" value="${e.horse_id || ''}"><div class="horse-suggest" id="entry-suggest-${i}"></div></td>
            <td><input type="number" value="${e.finish || ''}" min="1" onchange="UIResults.currentEntries[${i}].finish=+this.value"></td>
            <td><input type="text" id="entry-jockey-${i}" value="${e._jockey_name || ''}" placeholder="骑手..." oninput="UIResults._searchJockey(${i}, this.value)"><input type="hidden" id="entry-jockey-id-${i}" value="${e.jockey_id || ''}"><div class="horse-suggest" id="jockey-suggest-${i}"></div></td>
            <td><input type="number" value="${e.weight || ''}" min="40" max="70" onchange="UIResults.currentEntries[${i}].weight=+this.value"></td>
            <td><input type="number" value="${e.popularity || ''}" min="1" placeholder="人气" onchange="UIResults.currentEntries[${i}].popularity=+this.value"></td>
            <td><input type="number" value="${e.prize || ''}" min="0" onchange="UIResults.currentEntries[${i}].prize=+this.value"></td>
            <td><button class="btn btn-danger btn-sm" onclick="UIResults._removeEntry(${i})">×</button></td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;
  },

  _addEntry() {
    this.currentEntries.push({ horse_id: '', finish: '', jockey_id: '', weight: '', popularity: '', prize: '' });
    this._refreshEntries();
  },

  _removeEntry(i) {
    this.currentEntries.splice(i, 1);
    this._refreshEntries();
  },

  _refreshEntries() {
    const el = document.querySelector('.entries-table')?.parentNode || document.querySelector('.empty')?.parentNode;
    if (!el) return;
    const table = this._renderEntriesTable();
    const placeholder = document.querySelector('.entries-table') || document.querySelector('.card .empty');
    if (placeholder) {
      const temp = document.createElement('div');
      temp.innerHTML = table;
      placeholder.replaceWith(temp.firstElementChild || temp);
    }
  },

  async _searchHorse(index, q) {
    const container = document.getElementById(`entry-suggest-${index}`);
    if (!container || q.length < 2) { if (container) container.innerHTML = ''; return; }
    const horses = await Storage.getAllHorses();
    const matches = horses.filter(h => (h.name_en || '').toLowerCase().includes(q.toLowerCase()) || (h.name_cn || '').includes(q)).slice(0, 5);
    container.innerHTML = matches.map(h => {
      const name = Utils.displayName(h);
      return `<div class="suggest-item" onclick="UIResults._selectHorse(${index},'${h.id}','${name.replace(/'/g,"\\'")}')"> ${name}</div>`;
    }).join('');
  },

  _selectHorse(index, id, name) {
    this.currentEntries[index].horse_id = id;
    this.currentEntries[index]._horse_name = name;
    document.getElementById(`entry-horse-${index}`).value = name;
    document.getElementById(`entry-horse-id-${index}`).value = id;
    document.getElementById(`entry-suggest-${index}`).innerHTML = '';
  },

  async _searchJockey(index, q) {
    const container = document.getElementById(`jockey-suggest-${index}`);
    if (!container || q.length < 1) { if (container) container.innerHTML = ''; return; }
    const jockeys = await Storage.getAllEntities('jockeys');
    const matches = jockeys.filter(j => j.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
    container.innerHTML = matches.map(j =>
      `<div class="suggest-item" onclick="UIResults._selectJockey(${index},'${j.id}','${j.name.replace(/'/g,"\\'")}')"> ${j.name}</div>`
    ).join('');
  },

  _selectJockey(index, id, name) {
    this.currentEntries[index].jockey_id = id;
    this.currentEntries[index]._jockey_name = name;
    document.getElementById(`entry-jockey-${index}`).value = name;
    document.getElementById(`entry-jockey-id-${index}`).value = id;
    document.getElementById(`jockey-suggest-${index}`).innerHTML = '';
  },

  async _onTemplateChange(raceId) {
    if (raceId) {
      this.currentRace = await Storage.getEntity('races', raceId);
    } else {
      this.currentRace = null;
    }
    await this._render();
  },

  async save() {
    const form = document.getElementById('result-form');
    if (!form) return;
    const fd = new FormData(form);
    const year = parseInt(fd.get('year'));
    if (!year) { alert('请填写年份'); return; }

    const schM = fd.get('schedule_month'), schW = fd.get('schedule_week'), schD = fd.get('schedule_day');
    const schedule = schM && schW && schD ? `${schM}月第${schW}周第${schD}比赛日` : '';

    // 收集 entries
    const entries = [];
    for (let i = 0; i < this.currentEntries.length; i++) {
      const horseId = document.getElementById(`entry-horse-id-${i}`)?.value;
      if (!horseId) continue;
      const e = this.currentEntries[i];
      // 校验
      if (this.currentRace) {
        const ok = await this._validateRestrictions(horseId, year, this.currentRace);
        if (!ok) return;
      }
      entries.push({
        horse_id: horseId,
        finish: e.finish || parseInt(document.querySelector(`#entry-horse-${i}`)?.closest('tr')?.querySelector('input[type=number]')?.value) || i + 1,
        jockey_id: document.getElementById(`entry-jockey-id-${i}`)?.value || '',
        weight: e.weight || null,
        popularity: e.popularity || null,
        prize: e.prize || null
      });
    }

    if (entries.length === 0) { alert('请至少添加一匹参赛马'); return; }

    const result = {
      id: this._editingResultId || UIEntities._generateId('res_'),
      race_id: this.currentMode === 'template' ? (this.currentRace?.id || null) : null,
      race_name: fd.get('race_name')?.trim() || (this.currentRace?.name || ''),
      country_id: this.currentRace?.country_id || '',
      venue: fd.get('venue')?.trim() || '',
      distance: fd.get('distance') ? parseInt(fd.get('distance')) : null,
      surface: fd.get('surface') || '',
      grade: this.currentMode === 'template' ? (this.currentRace?.grade || '') : fd.get('grade'),
      year,
      schedule,
      condition_note: fd.get('condition_note')?.trim() || '',
      notes: '',
      entries
    };

    await Storage.saveEntity('results', result);
    this._editingResultId = null;
    alert('比赛记录已保存');
    UIRaces.renderList();
  },

  async _validateRestrictions(horseId, year, race) {
    const mode = await YearValidator.getMode();
    if (mode !== 'strict') return true;
    const horse = await Storage.getHorse(horseId);
    if (!horse) return true;

    if (race.sex_restriction === 'female' && horse.sex !== 'female') {
      alert(`赛事为牝马限定，${horse.name_en || horse.name_cn}不符合条件`);
      return false;
    }

    if (race.age_restriction && horse.birth_year && year) {
      const age = year - horse.birth_year + 1;
      const r = race.age_restriction;
      let valid = true;
      if (r === '2yo') valid = (age === 2);
      else if (r === '2yo+') valid = (age >= 2);
      else if (r === '3yo') valid = (age === 3);
      else if (r === '3yo+') valid = (age >= 3);
      else if (r === '4yo+') valid = (age >= 4);
      if (!valid) {
        alert(`赛事限制"${r}"，${horse.name_en || horse.name_cn}当前${age}岁不符合`);
        return false;
      }
    }
    return true;
  },

  // 历届开催记录列表
  async renderList(raceId) {
    const container = document.getElementById('manage-content');
    const all = await Storage.getAllEntities('results');
    const records = all.filter(r => r.race_id === raceId).sort((a, b) => (b.year || 0) - (a.year || 0));
    const race = await Storage.getEntity('races', raceId);

    container.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="UIRaces.renderList()">← 返回</button>
      <h3 style="display:inline;margin-left:12px">${race ? race.name : '赛事'}历届记录</h3>
      <div style="margin-top:12px">
        ${records.length === 0 ? '<p class="empty">暂无开催记录</p>' : records.map(r => `
          <div class="horse-item">
            <span class="name">${r.year}年 ${r.schedule || ''}</span>
            <span class="meta">${r.entries.length}匹参赛</span>
            <button class="btn btn-danger btn-sm" onclick="UIResults._deleteResult('${r.id}','${raceId}')">删除</button>
          </div>
        `).join('')}
      </div>
    `;
  },

  async _deleteResult(resultId, raceId) {
    if (confirm('确定删除该条开催记录吗？')) {
      await Storage.deleteEntity('results', resultId);
      this.renderList(raceId);
    }
  },

  async _deleteResultFromDetail(resultId, horseId) {
    if (confirm('确定删除该条比赛记录吗？')) {
      await Storage.deleteEntity('results', resultId);
      UIPedigree.showDetail(horseId);
    }
  },

  async _editResult(resultId) {
    const result = await Storage.getEntity('results', resultId);
    if (!result) return;
    // 加载为编辑模式
    this.currentMode = result.race_id ? 'template' : 'adhoc';
    this.currentRace = result.race_id ? await Storage.getEntity('races', result.race_id) : null;
    this.currentEntries = (result.entries || []).map(e => ({...e, _horse_name: '', _jockey_name: ''}));
    this._editingResultId = resultId;

    // 预加载马匹和骑手名
    for (const e of this.currentEntries) {
      if (e.horse_id) {
        const h = await Storage.getHorse(e.horse_id);
        if (h) e._horse_name = Utils.displayName(h);
      }
      if (e.jockey_id) {
        const j = await Storage.getEntity('jockeys', e.jockey_id);
        if (j) e._jockey_name = j.name;
      }
    }

    App.showView('manage');
    await this._render();
    // 填入已有数据
    const form = document.getElementById('result-form');
    if (form) {
      if (result.year) form.querySelector('[name=year]').value = result.year;
      if (result.race_name) form.querySelector('[name=race_name]').value = result.race_name;
      if (result.distance) form.querySelector('[name=distance]').value = result.distance;
      if (result.surface) form.querySelector('[name=surface]').value = result.surface;
      if (result.venue) form.querySelector('[name=venue]').value = result.venue;
    }
  }
};
