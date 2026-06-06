/* search.js — 搜索与筛选 */
'use strict';

const Search = {
  filters: { country: '', surface: '', distance: '' },

  init() {
    const input = document.getElementById('search-input');
    if (input) {
      input.addEventListener('input', (e) => this.onSearch(e.target.value));
    }
    this.showAll();
  },

  onSearch(query) {
    if (!query.trim() && !this._hasFilters()) {
      this.showAll();
      return;
    }
    const results = this.fuzzySearch(query);
    this.renderResults(results);
  },

  fuzzySearch(query, page = 0) {
    const q = query.toLowerCase().trim();
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

    this._lastTotal = horses.length;
    this._currentPage = page;
    const pageSize = 50;
    return horses.slice(page * pageSize, (page + 1) * pageSize);
  },

  _hasFilters() {
    return this.filters.country || this.filters.surface || this.filters.distance;
  },

  setFilter(key, value) {
    this.filters[key] = value;
    const input = document.getElementById('search-input');
    this.onSearch(input ? input.value : '');
  },

  showAll() {
    const horses = DataLoader.index ? DataLoader.index.horses.slice(0, 50) : [];
    this.renderResults(horses);
  },

  renderResults(horses) {
    const container = document.getElementById('search-results');
    if (!container) return;

    // 筛选栏
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
          <option value="turf" ${this.filters.surface === 'turf' ? 'selected' : ''}>芝</option>
          <option value="dirt" ${this.filters.surface === 'dirt' ? 'selected' : ''}>ダート</option>
        </select>
        <select onchange="Search.setFilter('distance', this.value)">
          <option value="">全部距离</option>
          <option value="sprint" ${this.filters.distance === 'sprint' ? 'selected' : ''}>短途</option>
          <option value="mile" ${this.filters.distance === 'mile' ? 'selected' : ''}>一哩</option>
          <option value="intermediate" ${this.filters.distance === 'intermediate' ? 'selected' : ''}>中距离</option>
          <option value="long" ${this.filters.distance === 'long' ? 'selected' : ''}>长途</option>
        </select>
        <span class="meta">${horses.length} 条结果</span>
      </div>
    `;

    const listHtml = horses.map(h => `
      <div class="horse-item" data-id="${h.id}">
        <div>
          <span class="name">${Utils.displayName(h)}</span>
          <span class="meta">${h.name_ja || ''}</span>
        </div>
        <div>
          ${(h.aptitude_surface || []).map(s => `<span class="tag tag-${s}">${s}</span>`).join(' ')}
        </div>
      </div>
    `).join('');

    container.innerHTML = filterHtml + '<div class="horse-list">' + listHtml + '</div>' + this._renderPagination();
  },

  _renderPagination() {
    const total = this._lastTotal || 0;
    const page = this._currentPage || 0;
    const pageSize = 50;
    if (total <= pageSize) return '';
    const totalPages = Math.ceil(total / pageSize);
    return `<div class="pagination">
      ${page > 0 ? `<button class="btn btn-secondary btn-sm" onclick="Search.goPage(${page - 1})">← 上一页</button>` : ''}
      <span class="meta">第 ${page + 1}/${totalPages} 页</span>
      ${(page + 1) < totalPages ? `<button class="btn btn-secondary btn-sm" onclick="Search.goPage(${page + 1})">下一页 →</button>` : ''}
    </div>`;
  },

  goPage(page) {
    const input = document.getElementById('search-input');
    const results = this.fuzzySearch(input ? input.value : '', page);
    this.renderResults(results);
  }
};
