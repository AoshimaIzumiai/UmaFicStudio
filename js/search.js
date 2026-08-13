/* search.js — 搜索与筛选（含翻页） */
'use strict';

const Search = {
  filters: { country: '', surface: '', distance: '', studYearFrom: '', studYearTo: '', sireLine: '' },
  currentPage: 0,
  pageSize: 50,
  lastResults: [],
  _sireLineDescendants: null, // 缓存谱系后代集合

  init() {
    const input = document.getElementById('search-input');
    if (input) {
      input.addEventListener('input', (e) => { this.currentPage = 0; this.onSearch(e.target.value); });
    }
    this.showAll();
  },

  onSearch(query) {
    this.lastResults = this.fuzzySearch(query);
    this.renderResults(this.lastResults);
  },

  fuzzySearch(query) {
    const q = (query || '').toLowerCase().trim();
    let horses = DataLoader.index ? DataLoader.index.horses : [];

    if (q) {
      horses = horses.filter(h =>
        h.name_en.toLowerCase().includes(q) ||
        (h.name_ja && h.name_ja.includes(q))
      );
    }

    if (this.filters.country) {
      horses = horses.filter(h => h.country === this.filters.country);
    }
    if (this.filters.surface) {
      horses = horses.filter(h => h.aptitude_surface && h.aptitude_surface.includes(this.filters.surface));
    }
    if (this.filters.distance) {
      horses = horses.filter(h => h.aptitude_distance && h.aptitude_distance.includes(this.filters.distance));
    }
    if (this.filters.studYearFrom || this.filters.studYearTo) {
      const from = parseInt(this.filters.studYearFrom) || 0;
      const to = parseInt(this.filters.studYearTo) || 9999;
      horses = horses.filter(h => {
        if (!h.stud_year_start) return false;
        const end = h.stud_year_end || 9999;
        // 种马的配种区间和查询区间有交集
        return h.stud_year_start <= to && end >= from;
      });
    }
    if (this.filters.sireLine && this._sireLineDescendants) {
      horses = horses.filter(h => this._sireLineDescendants.has(h.id));
    }

    return horses;
  },

  setFilter(key, value) {
    this.filters[key] = value;
    this.currentPage = 0;
    const input = document.getElementById('search-input');
    this.onSearch(input ? input.value : '');
  },

  async setSireLineFilter(rootId) {
    this.filters.sireLine = rootId;
    if (rootId) {
      // 构建该始祖的所有后代 ID 集合
      const allHorses = DataLoader.index ? DataLoader.index.horses : [];
      const childMap = {};
      for (const h of allHorses) {
        if (h.sire_id && allHorses.some(s => s.id === h.sire_id)) {
          if (!childMap[h.sire_id]) childMap[h.sire_id] = [];
          childMap[h.sire_id].push(h.id);
        }
      }
      const descendants = new Set([rootId]);
      const queue = [rootId];
      while (queue.length) {
        const id = queue.shift();
        for (const childId of (childMap[id] || [])) {
          if (!descendants.has(childId)) {
            descendants.add(childId);
            queue.push(childId);
          }
        }
      }
      this._sireLineDescendants = descendants;
    } else {
      this._sireLineDescendants = null;
    }
    this.currentPage = 0;
    const input = document.getElementById('search-input');
    this.onSearch(input ? input.value : '');
  },

  showAll() {
    this.lastResults = DataLoader.index ? DataLoader.index.horses : [];
    this.renderResults(this.lastResults);
  },

  prevPage() {
    if (this.currentPage > 0) { this.currentPage--; this.renderResults(this.lastResults); }
  },

  nextPage() {
    const maxPage = Math.ceil(this.lastResults.length / this.pageSize) - 1;
    if (this.currentPage < maxPage) { this.currentPage++; this.renderResults(this.lastResults); }
  },

  renderResults(horses) {
    const container = document.getElementById('search-results');
    if (!container) return;

    const total = horses.length;
    const maxPage = Math.max(0, Math.ceil(total / this.pageSize) - 1);
    const start = this.currentPage * this.pageSize;
    const pageHorses = horses.slice(start, start + this.pageSize);

    const filterHtml = `
      <div class="filter-bar">
        <select onchange="Search.setFilter('country', this.value)">
          <option value="">${I18N.t("allCountry")}</option>
          <option value="JPN" ${this.filters.country === 'JPN' ? 'selected' : ''}>JPN</option>
          <option value="USA" ${this.filters.country === 'USA' ? 'selected' : ''}>USA</option>
          <option value="GB" ${this.filters.country === 'GB' ? 'selected' : ''}>GB</option>
          <option value="IRE" ${this.filters.country === 'IRE' ? 'selected' : ''}>IRE</option>
          <option value="FR" ${this.filters.country === 'FR' ? 'selected' : ''}>FR</option>
          <option value="AUS" ${this.filters.country === 'AUS' ? 'selected' : ''}>AUS</option>
        </select>
        <select onchange="Search.setFilter('surface', this.value)">
          <option value="">${I18N.t("allSurface")}</option>
          <option value="turf" ${this.filters.surface === 'turf' ? 'selected' : ''}>${I18N.t("turf")}</option>
          <option value="dirt" ${this.filters.surface === 'dirt' ? 'selected' : ''}>${I18N.t("dirt")}</option>
        </select>
        <select onchange="Search.setFilter('distance', this.value)">
          <option value="">${I18N.t("allDistance")}</option>
          <option value="sprint" ${this.filters.distance === 'sprint' ? 'selected' : ''}>${I18N.t('sprint')}</option>
          <option value="mile" ${this.filters.distance === 'mile' ? 'selected' : ''}>${I18N.t('mile')}</option>
          <option value="intermediate" ${this.filters.distance === 'intermediate' ? 'selected' : ''}>${I18N.t('intermediate')}</option>
          <option value="long" ${this.filters.distance === 'long' ? 'selected' : ''}>${I18N.t('long')}</option>
        </select>
        <input type="number" placeholder="${I18N.t('studYearStart')}" value="${this.filters.studYearFrom || ''}" style="width:75px" onchange="Search.setFilter('studYearFrom', this.value)">
        <span>~</span>
        <input type="number" placeholder="${I18N.t('studYearEnd')}" value="${this.filters.studYearTo || ''}" style="width:75px" onchange="Search.setFilter('studYearTo', this.value)">
        <select id="sireline-filter" onchange="Search.setSireLineFilter(this.value)">
          <option value="">全部谱系</option>
        </select>
        <span class="meta">${total} ${I18N.t('results')}</span>
      </div>
    `;

    const listHtml = pageHorses.map(h => `
      <div class="horse-item" data-id="${h.id}">
        <div>
          <span class="name">${Utils.safeDisplayName(h)}</span>
          <span class="meta">${h.name_ja || ''}</span>
        </div>
        <div>
          ${(h.aptitude_surface || []).map(s => `<span class="tag tag-${s}">${Utils.surfaceLabel(s)}</span>`).join(' ')}
          ${h.stud_year_start ? `<span class="meta${h.stud_year_source === 'jbis_unverified' ? ' unverified' : ''}">${h.stud_year_start}-${h.stud_year_end || '?'}${h.stud_year_source === 'jbis_unverified' ? '?' : ''}</span>` : ''}
        </div>
      </div>
    `).join('');

    const paginationHtml = total > this.pageSize ? `
      <div class="pagination">
        <button class="btn btn-secondary btn-sm" onclick="Search.prevPage()" ${this.currentPage === 0 ? 'disabled' : ''}>← 上一页</button>
        <span class="meta">${this.currentPage + 1} / ${maxPage + 1}</span>
        <button class="btn btn-secondary btn-sm" onclick="Search.nextPage()" ${this.currentPage >= maxPage ? 'disabled' : ''}>下一页 →</button>
      </div>
    ` : '';

    container.innerHTML = filterHtml + '<div class="horse-list">' + listHtml + '</div>' + paginationHtml;

    // 填充谱系下拉（只做一次）
    this._populateSireLineFilter();
  },

  _populateSireLineFilter() {
    const select = document.getElementById('sireline-filter');
    if (!select || select.options.length > 1) return;
    const allHorses = DataLoader.index ? DataLoader.index.horses : [];
    // 构建父子关系
    const stallionIds = new Set(allHorses.map(h => h.id));
    const childMap = {};
    for (const h of allHorses) {
      if (h.sire_id && stallionIds.has(h.sire_id)) {
        if (!childMap[h.sire_id]) childMap[h.sire_id] = [];
        childMap[h.sire_id].push(h.id);
      }
    }
    // 始祖 = 无父（或父不在种马库中）且有子代
    const roots = allHorses.filter(h => {
      const hasSireInDb = h.sire_id && stallionIds.has(h.sire_id);
      return !hasSireInDb && childMap[h.id];
    });
    // 按后代数排序
    const countDesc = (id) => {
      const ch = childMap[id] || [];
      return ch.length + ch.reduce((s, c) => s + countDesc(c), 0);
    };
    roots.sort((a, b) => countDesc(b.id) - countDesc(a.id));
    // 只显示后代数 >= 3 的始祖
    for (const h of roots) {
      const desc = countDesc(h.id);
      if (desc < 3) continue;
      const opt = document.createElement('option');
      opt.value = h.id;
      opt.textContent = `${h.name_en} (${desc})`;
      if (h.id === this.filters.sireLine) opt.selected = true;
      select.appendChild(opt);
    }
  }
};
