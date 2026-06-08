/* search.js — 搜索与筛选（含翻页） */
'use strict';

const Search = {
  filters: { country: '', surface: '', distance: '', studYearFrom: '', studYearTo: '' },
  currentPage: 0,
  pageSize: 50,
  lastResults: [],

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

    return horses;
  },

  setFilter(key, value) {
    this.filters[key] = value;
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
          <option value="">全部产国</option>
          <option value="JPN" ${this.filters.country === 'JPN' ? 'selected' : ''}>JPN</option>
          <option value="USA" ${this.filters.country === 'USA' ? 'selected' : ''}>USA</option>
          <option value="GB" ${this.filters.country === 'GB' ? 'selected' : ''}>GB</option>
          <option value="IRE" ${this.filters.country === 'IRE' ? 'selected' : ''}>IRE</option>
          <option value="FR" ${this.filters.country === 'FR' ? 'selected' : ''}>FR</option>
          <option value="AUS" ${this.filters.country === 'AUS' ? 'selected' : ''}>AUS</option>
        </select>
        <select onchange="Search.setFilter('surface', this.value)">
          <option value="">全部场地</option>
          <option value="turf" ${this.filters.surface === 'turf' ? 'selected' : ''}>草地</option>
          <option value="dirt" ${this.filters.surface === 'dirt' ? 'selected' : ''}>泥地</option>
        </select>
        <select onchange="Search.setFilter('distance', this.value)">
          <option value="">全部距离</option>
          <option value="sprint" ${this.filters.distance === 'sprint' ? 'selected' : ''}>短途</option>
          <option value="mile" ${this.filters.distance === 'mile' ? 'selected' : ''}>一哩</option>
          <option value="intermediate" ${this.filters.distance === 'intermediate' ? 'selected' : ''}>中距离</option>
          <option value="long" ${this.filters.distance === 'long' ? 'selected' : ''}>长途</option>
        </select>
        <input type="number" placeholder="配种起始" value="${this.filters.studYearFrom || ''}" style="width:75px" onchange="Search.setFilter('studYearFrom', this.value)">
        <span>~</span>
        <input type="number" placeholder="配种结束" value="${this.filters.studYearTo || ''}" style="width:75px" onchange="Search.setFilter('studYearTo', this.value)">
        <span class="meta">${total} 条结果</span>
      </div>
    `;

    const listHtml = pageHorses.map(h => `
      <div class="horse-item" data-id="${h.id}">
        <div>
          <span class="name">${Utils.displayName(h)}</span>
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
  }
};
