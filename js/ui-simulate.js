/* ui-simulate.js — 配种模拟界面 */
'use strict';

const UISimulate = {
  selectedSireId: null,
  selectedDamId: null,

  init() {
    this._loadUserHorses();
    this.render();
  },

  render() {
    const container = document.getElementById('simulate-content');
    container.innerHTML = `
      <div class="card">
        <div class="simulate-form">
          <div class="simulate-pick">
            <label>父亲（种牡马）</label>
            <input type="text" id="sim-sire-search" placeholder="搜索种马名..." oninput="UISimulate.searchSire(this.value)">
            <div id="sim-sire-results" class="sim-dropdown"></div>
            <div id="sim-sire-selected" class="sim-selected">${this.selectedSireId ? '已选择' : '未选择'}</div>
          </div>
          <div class="simulate-cross-symbol">×</div>
          <div class="simulate-pick">
            <label>母亲（繁殖牝马）</label>
            <input type="text" id="sim-dam-search" placeholder="搜索母马名..." oninput="UISimulate.searchDam(this.value)">
            <div id="sim-dam-results" class="sim-dropdown"></div>
            <div id="sim-dam-selected" class="sim-selected">${this.selectedDamId ? '已选择' : '未选择'}</div>
          </div>
        </div>
        <div class="simulate-actions">
          <button class="btn btn-primary" onclick="UISimulate.runSimulation()" ${!this.selectedSireId || !this.selectedDamId ? 'disabled' : ''}>模拟配种</button>
        </div>
      </div>
      <div id="sim-result"></div>
    `;
  },

  searchSire(query) {
    const container = document.getElementById('sim-sire-results');
    if (!query.trim()) { container.innerHTML = ''; return; }
    const results = this._searchAll(query, 'stallion');
    container.innerHTML = results.map(h => `
      <div class="sim-option" onclick="UISimulate.selectSire('${h.id}', '${h.name_en}')">${Utils.displayName(h)}</div>
    `).join('');
  },

  searchDam(query) {
    const container = document.getElementById('sim-dam-results');
    if (!query.trim()) { container.innerHTML = ''; return; }
    const results = this._searchAll(query, 'broodmare');
    container.innerHTML = results.map(h => `
      <div class="sim-option" onclick="UISimulate.selectDam('${h.id}', '${h.name_en}')">${Utils.displayName(h)}</div>
    `).join('');
  },

  _searchAll(query, preferRole) {
    const q = query.toLowerCase();
    // 搜索真实马
    const realResults = (DataLoader.index ? DataLoader.index.horses : [])
      .filter(h => h.name_en.toLowerCase().includes(q) || (h.name_ja && h.name_ja.includes(q)));
    // 搜索架空马（同步获取缓存的列表）
    const fictionalResults = this._cachedUserHorses
      ? this._cachedUserHorses.filter(h =>
          (h.name_en.toLowerCase().includes(q) || (h.name_ja && h.name_ja.includes(q)))
        )
      : [];
    return [...fictionalResults, ...realResults].slice(0, 10);
  },

  async _loadUserHorses() {
    this._cachedUserHorses = await Storage.getAllHorses();
  },

  selectSire(id, name) {
    this.selectedSireId = id;
    document.getElementById('sim-sire-selected').textContent = name;
    document.getElementById('sim-sire-results').innerHTML = '';
    document.getElementById('sim-sire-search').value = name;
    this._updateButton();
  },

  selectDam(id, name) {
    this.selectedDamId = id;
    document.getElementById('sim-dam-selected').textContent = name;
    document.getElementById('sim-dam-results').innerHTML = '';
    document.getElementById('sim-dam-search').value = name;
    this._updateButton();
  },

  _updateButton() {
    const btn = document.querySelector('.simulate-actions .btn-primary');
    if (btn) btn.disabled = !(this.selectedSireId && this.selectedDamId);
  },

  async runSimulation() {
    const resultContainer = document.getElementById('sim-result');
    resultContainer.innerHTML = '<p>计算中...</p>';

    const { tree, crossResult } = await Cross.simulateMating(this.selectedSireId, this.selectedDamId);

    // 渲染血统表
    const tableHtml = UIPedigree._renderTable(tree, crossResult, null);
    const crossHtml = UIPedigree._renderCrossPanel(crossResult);

    resultContainer.innerHTML = `
      <div class="card">
        <h3>虚拟后代血统表</h3>
        ${tableHtml}
      </div>
      ${crossHtml}
    `;
  }
};
