/* ui-races.js — 赛事模板 CRUD */
'use strict';

const UIRaces = {
  currentCountryFilter: null,
  currentPage: 0,
  pageSize: 20,

  async renderList() {
    const container = document.getElementById('manage-content');
    const all = await Storage.getAllEntities('races');
    const countries = await Storage.getAllEntities('countries');
    let filtered = this.currentCountryFilter
      ? all.filter(r => r.country_id === this.currentCountryFilter)
      : all;
    filtered.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

    const totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
    const page = filtered.slice(this.currentPage * this.pageSize, (this.currentPage + 1) * this.pageSize);

    container.innerHTML = `
      <div class="race-filter-bar">
        <select onchange="UIRaces.filterByCountry(this.value)">
          <option value="">全部架空国</option>
          ${countries.map(c => `<option value="${c.id}" ${this.currentCountryFilter === c.id ? 'selected' : ''}>${c.name_cn || c.code}</option>`).join('')}
        </select>
        <button class="btn btn-primary" onclick="UIRaces.renderForm()">+ 新建赛事</button>
        <input type="text" class="search-input" placeholder="搜索赛名..." oninput="UIRaces._filter(this.value)">
      </div>
      <div id="race-list">
        ${page.length === 0 ? '<p class="empty">暂无赛事模板</p>' : ''}
        ${page.map(r => `
          <div class="horse-item" data-name="${r.name.toLowerCase()}">
            <span class="name">${r.name}</span>
            <span class="meta">${r.grade} ${r.surface === 'turf' ? '草地' : r.surface === 'dirt' ? '泥地' : ''} ${r.distance ? r.distance + 'm' : ''}</span>
            <div>
              <button class="btn btn-secondary btn-sm" onclick="UIResults.showForm({raceId:'${r.id}',mode:'template'})">录入</button>
              <button class="btn btn-secondary btn-sm" onclick="UIRaces.renderForm('${r.id}')">编辑</button>
              <button class="btn btn-danger btn-sm" onclick="UIRaces.delete('${r.id}')">删除</button>
            </div>
          </div>
        `).join('')}
      </div>
      ${totalPages > 1 ? `<div class="pagination">
        <button class="btn btn-secondary btn-sm" ${this.currentPage === 0 ? 'disabled' : ''} onclick="UIRaces._page(${this.currentPage - 1})">← 上一页</button>
        <span class="meta">${this.currentPage + 1} / ${totalPages}</span>
        <button class="btn btn-secondary btn-sm" ${this.currentPage >= totalPages - 1 ? 'disabled' : ''} onclick="UIRaces._page(${this.currentPage + 1})">下一页 →</button>
      </div>` : ''}
    `;
  },

  filterByCountry(countryId) { this.currentCountryFilter = countryId || null; this.currentPage = 0; this.renderList(); },
  _page(p) { this.currentPage = p; this.renderList(); },
  _filter(q) {
    const lower = q.trim().toLowerCase();
    document.querySelectorAll('#race-list .horse-item').forEach(el => {
      el.style.display = el.dataset.name.includes(lower) ? '' : 'none';
    });
  },

  async renderForm(raceId, presetCountryId) {
    const container = document.getElementById('manage-content');
    const countries = await Storage.getAllEntities('countries');
    let r = raceId ? await Storage.getEntity('races', raceId) : {};
    if (!r.country_id && presetCountryId) r.country_id = presetCountryId;
    const isEdit = !!r.id;

    container.innerHTML = `
      <div class="card">
        <h3>${isEdit ? '编辑' : '新建'}赛事模板</h3>
        <form id="race-form" class="form-grid">
          <label>所属架空国 *
            <select name="country_id" required onchange="UIRaces._onCountryChange(this.value)">
              <option value="">-- 选择 --</option>
              ${countries.map(c => `<option value="${c.id}" ${r.country_id === c.id ? 'selected' : ''}>${c.name_cn || c.code}</option>`).join('')}
            </select>
          </label>
          <label>赛名 *<input type="text" name="name" value="${r.name || ''}" required></label>
          <label>等级 *
            <select name="grade" id="grade-select" required>
              <option value="">-- 选择 --</option>
            </select>
          </label>
          <label>马场
            <select name="venue" id="venue-select">
              <option value="">-- 选择 --</option>
            </select>
          </label>
          <label>距离(m)<input type="number" name="distance" value="${r.distance || ''}" min="800" max="4000"></label>
          <label>场地
            <select name="surface">
              <option value="">--</option>
              <option value="turf" ${r.surface === 'turf' ? 'selected' : ''}>草地</option>
              <option value="dirt" ${r.surface === 'dirt' ? 'selected' : ''}>泥地</option>
            </select>
          </label>
          <label>固定开催日程
            <div class="schedule-inputs">
              <select name="schedule_month"><option value="">--</option>${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${r._sch_month==i+1?'selected':''}>${i+1}</option>`).join('')}</select>月第
              <input type="number" name="schedule_week" value="${r._sch_week || ''}" min="1" max="5" style="width:50px">周第
              <input type="number" name="schedule_day" value="${r._sch_day || ''}" min="1" max="3" style="width:50px">比赛日
            </div>
          </label>
          <label>年龄限制
            <select name="age_restriction">
              <option value="" ${!r.age_restriction ? 'selected' : ''}>不限</option>
              <option value="2yo" ${r.age_restriction === '2yo' ? 'selected' : ''}>2岁限定</option>
              <option value="2yo+" ${r.age_restriction === '2yo+' ? 'selected' : ''}>2岁以上</option>
              <option value="3yo" ${r.age_restriction === '3yo' ? 'selected' : ''}>3岁限定</option>
              <option value="3yo+" ${r.age_restriction === '3yo+' ? 'selected' : ''}>3岁以上</option>
              <option value="4yo+" ${r.age_restriction === '4yo+' ? 'selected' : ''}>4岁以上</option>
            </select>
          </label>
          <label>性别限制
            <select name="sex_restriction">
              <option value="" ${!r.sex_restriction ? 'selected' : ''}>不限</option>
              <option value="female" ${r.sex_restriction === 'female' ? 'selected' : ''}>牝马限定</option>
            </select>
          </label>
          <label>条件备注<input type="text" name="condition_note" value="${r.condition_note || ''}"></label>
          <label>通用备注<textarea name="notes" rows="2">${r.notes || ''}</textarea></label>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">${isEdit ? '保存' : '创建'}</button>
            <button type="button" class="btn btn-secondary" onclick="UIRaces.renderList()">取消</button>
          </div>
        </form>
      </div>
    `;
    // 解析 schedule
    if (r.schedule) {
      const m = r.schedule.match(/(\d+)月第(\d+)周第(\d+)比赛日/);
      if (m) { r._sch_month = +m[1]; r._sch_week = +m[2]; r._sch_day = +m[3]; }
    }
    // 初始化等级和马场选项
    if (r.country_id) this._onCountryChange(r.country_id, r.grade, r.venue);

    document.getElementById('race-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.save(new FormData(ev.target), isEdit ? r.id : null);
    });
  },

  async _onCountryChange(countryId, currentGrade, currentVenue) {
    const grades = await this._getGradeOptions(countryId);
    const gradeSelect = document.getElementById('grade-select');
    if (gradeSelect) {
      gradeSelect.innerHTML = '<option value="">-- 选择 --</option>' + grades.map(g => `<option value="${g}" ${currentGrade === g ? 'selected' : ''}>${g}</option>`).join('');
    }
    const venues = await this._getVenueOptions(countryId);
    const venueSelect = document.getElementById('venue-select');
    if (venueSelect) {
      venueSelect.innerHTML = '<option value="">-- 选择 --</option>' + venues.map(v => `<option value="${v}" ${currentVenue === v ? 'selected' : ''}>${v}</option>`).join('');
    }
  },

  async _getGradeOptions(countryId) {
    const base = ['G1', 'G2', 'G3', 'L', 'OP'];
    if (countryId) {
      const country = await Storage.getEntity('countries', countryId);
      if (country && country.custom_grades) {
        const custom = country.custom_grades.split('\n').map(s => s.trim()).filter(Boolean);
        return [...base, ...custom];
      }
    }
    return base;
  },

  async _getVenueOptions(countryId) {
    if (!countryId) return [];
    const country = await Storage.getEntity('countries', countryId);
    if (country && country.venues) {
      return country.venues.split('\n').map(s => s.trim()).filter(Boolean);
    }
    return [];
  },

  async save(fd, existingId) {
    const scheduleMonth = fd.get('schedule_month');
    const scheduleWeek = fd.get('schedule_week');
    const scheduleDay = fd.get('schedule_day');
    const schedule = scheduleMonth && scheduleWeek && scheduleDay
      ? `${scheduleMonth}月第${scheduleWeek}周第${scheduleDay}比赛日` : '';

    const data = {
      id: existingId || UIEntities._generateId('race_'),
      name: fd.get('name').trim(),
      country_id: fd.get('country_id'),
      venue: fd.get('venue'),
      distance: fd.get('distance') ? parseInt(fd.get('distance')) : null,
      surface: fd.get('surface'),
      grade: fd.get('grade'),
      schedule,
      age_restriction: fd.get('age_restriction') || null,
      sex_restriction: fd.get('sex_restriction') || null,
      condition_note: fd.get('condition_note').trim(),
      notes: fd.get('notes').trim()
    };
    if (!data.name || !data.country_id || !data.grade) { alert('请填写赛名、架空国和等级'); return; }
    await Storage.saveEntity('races', data);
    UIEntities.renderDetail('country', data.country_id);
  },

  async delete(raceId) {
    const results = await Storage.getAllEntities('results');
    const refs = results.filter(r => r.race_id === raceId);
    if (refs.length > 0) { alert(`该赛事已有 ${refs.length} 条开催记录，无法删除。`); return; }
    if (confirm('确定删除该赛事模板吗？')) {
      const race = await Storage.getEntity('races', raceId);
      await Storage.deleteEntity('races', raceId);
      if (race?.country_id) UIEntities.renderDetail('country', race.country_id);
      else UIEntities.renderList('country');
    }
  }
};
