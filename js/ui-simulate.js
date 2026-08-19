/* ui-simulate.js — 血统预览（原配种模拟） */
'use strict';

const UISimulate = {
  selectedSireId: null,
  selectedDamId: null,
  selectedBmsId: null,
  mode: 'sire_dam', // 'sire_dam' | 'sire_bms'
  _cachedUserHorses: null,

  init() {
    this._loadUserHorses();
    this.render();
  },

  render() {
    const container = document.getElementById('simulate-content');
    container.innerHTML = `
      <div class="card">
        <div style="margin-bottom:12px;display:flex;gap:8px">
          <button class="btn ${this.mode === 'sire_dam' ? 'btn-primary' : 'btn-secondary'}" onclick="UISimulate.switchMode('sire_dam')">${I18N.t('sire')} × ${I18N.t('dam')}</button>
          <button class="btn ${this.mode === 'sire_bms' ? 'btn-primary' : 'btn-secondary'}" onclick="UISimulate.switchMode('sire_bms')">${I18N.t('sire')} × ${I18N.t('bms')}</button>
        </div>
        ${this.mode === 'sire_dam' ? this._renderSireDamMode() : this._renderSireBmsMode()}
      </div>
      <div id="sim-result"></div>
    `;
  },

  switchMode(mode) { this.mode = mode; this.selectedSireId = null; this.selectedDamId = null; this.selectedBmsId = null; this.render(); },

  // === 父×母 模式（不变） ===
  _renderSireDamMode() {
    return `
      <div class="simulate-form">
        <div class="simulate-pick">
          <label>${I18N.t('simSire')}</label>
          <input type="text" id="sim-sire-search" placeholder="${I18N.t('searchPlaceholder')}" oninput="UISimulate.searchSire(this.value)">
          <div id="sim-sire-results" class="sim-dropdown"></div>
          <div id="sim-sire-selected" class="sim-selected">${this.selectedSireId ? I18N.t('simSelected') : I18N.t('simNotSelected')}</div>
        </div>
        <div class="simulate-cross-symbol">×</div>
        <div class="simulate-pick">
          <label>${I18N.t('simDam')}</label>
          <input type="text" id="sim-dam-search" placeholder="${I18N.t('searchPlaceholder')}" oninput="UISimulate.searchDam(this.value)">
          <div id="sim-dam-results" class="sim-dropdown"></div>
          <div id="sim-dam-selected" class="sim-selected">${this.selectedDamId ? I18N.t('simSelected') : I18N.t('simNotSelected')}</div>
        </div>
      </div>
      <div class="simulate-actions">
        <button class="btn btn-primary" onclick="UISimulate.runSimulation()" ${!this.selectedSireId || !this.selectedDamId ? 'disabled' : ''}>${I18N.t('simRun')}</button>
        <button class="btn btn-secondary" onclick="UISimulate.showRecommend()" ${!this.selectedDamId ? 'disabled' : ''}>${I18N.t('recommendBtn')}</button>
      </div>
    `;
  },

  // === 父×母父 模式 ===
  _renderSireBmsMode() {
    return `
      <div class="simulate-form">
        <div class="simulate-pick">
          <label>${I18N.t('sire')}</label>
          <input type="text" id="sim-sire-search" placeholder="${I18N.t('searchPlaceholder')}" oninput="UISimulate.searchSire(this.value)">
          <div id="sim-sire-results" class="sim-dropdown"></div>
          <div id="sim-sire-selected" class="sim-selected">${this.selectedSireId ? I18N.t('simSelected') : I18N.t('simNotSelected')}</div>
        </div>
        <div class="simulate-cross-symbol">×</div>
        <div class="simulate-pick">
          <label>${I18N.t('bms')}</label>
          <input type="text" id="sim-bms-search" placeholder="${I18N.t('searchPlaceholder')}" oninput="UISimulate.searchBms(this.value)">
          <div id="sim-bms-results" class="sim-dropdown"></div>
          <div id="sim-bms-selected" class="sim-selected">${this.selectedBmsId ? I18N.t('simSelected') : I18N.t('simNotSelected')}</div>
        </div>
      </div>
      <div class="simulate-actions">
        <button class="btn btn-primary" onclick="UISimulate.runBmsSimulation()" ${!this.selectedSireId || !this.selectedBmsId ? 'disabled' : ''}>${I18N.t('simRun')}</button>
      </div>
      <hr style="margin:12px 0">
      <h4>随机 Roll</h4>
      <div class="race-filter-bar">
        <label>父配种年：<input type="number" id="rand-sire-from" value="2015" style="width:60px"> ~ <input type="number" id="rand-sire-to" value="2025" style="width:60px"></label>
        <label>父场地：<select id="rand-sire-surface"><option value="">不限</option><option value="turf">${I18N.t('turf')}</option><option value="dirt">${I18N.t('dirt')}</option></select></label>
        <label>母父配种年：<input type="number" id="rand-bms-from" value="2000" style="width:60px"> ~ <input type="number" id="rand-bms-to" value="2020" style="width:60px"></label>
        <label>母父场地：<select id="rand-bms-surface"><option value="">不限</option><option value="turf">${I18N.t('turf')}</option><option value="dirt">${I18N.t('dirt')}</option></select></label>
      </div>
      <button class="btn btn-secondary" onclick="UISimulate.randomRoll()">🎲 随机</button>
    `;
  },

  // === 搜索 ===
  searchSire(query) {
    const container = document.getElementById('sim-sire-results');
    if (!query.trim()) { container.innerHTML = ''; return; }
    const results = this._searchStallions(query);
    container.innerHTML = results.map(h => `
      <div class="sim-option" data-id="${h.id}" data-name="${Utils.escapeHtml(Utils.displayName(h))}">${Utils.safeDisplayName(h)}</div>
    `).join('');
    container.onclick = (e) => { const el = e.target.closest('.sim-option'); if (el) UISimulate.selectSire(el.dataset.id, el.dataset.name); };
  },

  searchDam(query) {
    const container = document.getElementById('sim-dam-results');
    if (!query.trim()) { container.innerHTML = ''; return; }
    const results = this._searchAll(query, 'female');
    container.innerHTML = results.map(h => `
      <div class="sim-option" data-id="${h.id}" data-name="${Utils.escapeHtml(Utils.displayName(h))}">${Utils.safeDisplayName(h)}</div>
    `).join('');
    container.onclick = (e) => { const el = e.target.closest('.sim-option'); if (el) UISimulate.selectDam(el.dataset.id, el.dataset.name); };
  },

  searchBms(query) {
    const container = document.getElementById('sim-bms-results');
    if (!query.trim()) { container.innerHTML = ''; return; }
    const results = this._searchStallions(query);
    container.innerHTML = results.map(h => `
      <div class="sim-option" data-id="${h.id}" data-name="${Utils.escapeHtml(Utils.displayName(h))}">${Utils.safeDisplayName(h)}</div>
    `).join('');
    container.onclick = (e) => { const el = e.target.closest('.sim-option'); if (el) UISimulate.selectBms(el.dataset.id, el.dataset.name); };
  },

  _searchStallions(query) {
    const q = query.toLowerCase();
    const real = (DataLoader.index?.horses || []).filter(h => h.sex === 'male' && (h.name_en.toLowerCase().includes(q) || (h.name_ja && h.name_ja.includes(q)))).slice(0, 8);
    const user = (this._cachedUserHorses || []).filter(h => h.sex === 'male' && ((h.name_en||'').toLowerCase().includes(q) || (h.name_cn||'').includes(q))).slice(0, 4);
    return [...user, ...real].slice(0, 10);
  },

  _searchAll(query, sex) {
    const q = query.toLowerCase();
    const real = (DataLoader.index?.horses || []).filter(h => (!sex || h.sex === sex) && (h.name_en.toLowerCase().includes(q) || (h.name_ja && h.name_ja.includes(q)))).slice(0, 8);
    const user = (this._cachedUserHorses || []).filter(h => (!sex || h.sex === sex) && ((h.name_en||'').toLowerCase().includes(q) || (h.name_cn||'').includes(q))).slice(0, 4);
    return [...user, ...real].slice(0, 10);
  },

  async _loadUserHorses() { this._cachedUserHorses = await Storage.getAllHorses(); },

  selectSire(id, name) {
    this.selectedSireId = id;
    const el = document.getElementById('sim-sire-selected');
    if (el) el.textContent = name;
    const res = document.getElementById('sim-sire-results');
    if (res) res.innerHTML = '';
    const input = document.getElementById('sim-sire-search');
    if (input) input.value = name;
    this._updateButtons();
  },

  selectDam(id, name) {
    this.selectedDamId = id;
    const el = document.getElementById('sim-dam-selected');
    if (el) el.textContent = name;
    const res = document.getElementById('sim-dam-results');
    if (res) res.innerHTML = '';
    const input = document.getElementById('sim-dam-search');
    if (input) input.value = name;
    this._updateButtons();
  },

  selectBms(id, name) {
    this.selectedBmsId = id;
    const el = document.getElementById('sim-bms-selected');
    if (el) el.textContent = name;
    const res = document.getElementById('sim-bms-results');
    if (res) res.innerHTML = '';
    const input = document.getElementById('sim-bms-search');
    if (input) input.value = name;
    this._updateButtons();
  },

  _updateButtons() {
    document.querySelectorAll('.simulate-actions .btn-primary').forEach(btn => {
      if (this.mode === 'sire_dam') btn.disabled = !(this.selectedSireId && this.selectedDamId);
      else btn.disabled = !(this.selectedSireId && this.selectedBmsId);
    });
    const recBtn = document.querySelector('.simulate-actions .btn-secondary[onclick*="showRecommend"]');
    if (recBtn) recBtn.disabled = !this.selectedDamId;
  },

  // === 父×母 模拟 ===
  async runSimulation() {
    const resultContainer = document.getElementById('sim-result');
    resultContainer.innerHTML = '<p>计算中...</p>';
    const { tree, crossResult } = await Cross.simulateMating(this.selectedSireId, this.selectedDamId);
    const tableHtml = UIPedigree._renderTable(tree, crossResult, null);
    const crossHtml = UIPedigree._renderCrossPanel(crossResult);
    // 特征推测
    const traits = await SireTraits.predictFromMating(this.selectedSireId, this.selectedDamId);
    const traitsHtml = SireTraits.renderPanel(traits);
    resultContainer.innerHTML = `<div class="card"><h3>虚拟后代血统表</h3>${tableHtml}</div>${crossHtml}${traitsHtml}`;
  },

  // === 父×母父 模拟 ===
  async runBmsSimulation() {
    const resultContainer = document.getElementById('sim-result');
    resultContainer.innerHTML = '<p>计算中...</p>';
    const { tree, crossResult } = await this._buildBmsTree(this.selectedSireId, this.selectedBmsId);
    const tableHtml = UIPedigree._renderTable(tree, crossResult, null);
    const crossHtml = UIPedigree._renderCrossPanel(crossResult);
    const sire = DataLoader.getHorseFromIndex(this.selectedSireId) || await Storage.getHorse(this.selectedSireId);
    const bms = DataLoader.getHorseFromIndex(this.selectedBmsId) || await Storage.getHorse(this.selectedBmsId);
    // 特征推测（父×母父模式直接用 sireId 和 bmsId）
    const traits = await SireTraits.predict(this.selectedSireId, this.selectedBmsId);
    const traitsHtml = SireTraits.renderPanel(traits);
    resultContainer.innerHTML = `
      <div class="card">
        <h3>${Utils.safeDisplayName(sire)} × ${Utils.safeDisplayName(bms)}</h3>
        ${tableHtml}
      </div>
      ${crossHtml}
      ${traitsHtml}
      <div style="margin-top:12px">
        <button class="btn btn-secondary" onclick="UISimulate.randomRoll()">🎲 再随机一次</button>
        <button class="btn btn-primary" onclick="UISimulate.saveAsHorse()">保存为架空马</button>
      </div>
    `;
  },

  async _buildBmsTree(sireId, bmsId) {
    const sireTree = await Pedigree.getPedigreeTree(sireId);
    const bmsTree = await Pedigree.getPedigreeTree(bmsId);
    const sireInfo = DataLoader.getHorseFromIndex(sireId) || await Storage.getHorse(sireId);
    const bmsInfo = DataLoader.getHorseFromIndex(bmsId) || await Storage.getHorse(bmsId);

    const tree = {
      sire: {
        id: sireId,
        name_en: sireInfo?.name_en || '???',
        country: sireInfo?.country || '',
        sire: sireTree?.sire || null,
        dam: sireTree?.dam || null
      },
      dam: {
        name_en: null,
        sire: {
          id: bmsId,
          name_en: bmsInfo?.name_en || '???',
          country: bmsInfo?.country || '',
          sire: bmsTree?.sire || null,
          dam: bmsTree?.dam || null
        },
        dam: null
      }
    };
    const crossResult = Cross.calculateCross(tree, 5);
    return { tree, crossResult };
  },

  // === 随机 Roll ===
  async randomRoll() {
    const sireFrom = parseInt(document.getElementById('rand-sire-from')?.value) || 2015;
    const sireTo = parseInt(document.getElementById('rand-sire-to')?.value) || 2025;
    const sireSurface = document.getElementById('rand-sire-surface')?.value || '';
    const bmsFrom = parseInt(document.getElementById('rand-bms-from')?.value) || 2000;
    const bmsTo = parseInt(document.getElementById('rand-bms-to')?.value) || 2020;
    const bmsSurface = document.getElementById('rand-bms-surface')?.value || '';

    const horses = DataLoader.index?.horses || [];

    // 筛选父候选
    const sireCandidates = horses.filter(h =>
      h.sex === 'male' && h.stud_year_start &&
      h.stud_year_start >= sireFrom && h.stud_year_start <= sireTo &&
      (!sireSurface || (h.aptitude_surface || []).includes(sireSurface))
    );

    // 筛选母父候选
    const bmsCandidates = horses.filter(h =>
      h.sex === 'male' && h.stud_year_start &&
      h.stud_year_start >= bmsFrom && h.stud_year_start <= bmsTo &&
      (!bmsSurface || (h.aptitude_surface || []).includes(bmsSurface))
    );

    if (sireCandidates.length === 0 || bmsCandidates.length === 0) {
      alert('当前条件下无合适候选马匹，请放宽条件');
      return;
    }

    // 随机选一对，约束母父配种年 ≤ 父配种年且差值 ≤ 20
    let sire, bms, attempts = 0;
    while (attempts < 200) {
      sire = sireCandidates[Math.floor(Math.random() * sireCandidates.length)];
      const validBms = bmsCandidates.filter(b =>
        b.stud_year_start <= sire.stud_year_start &&
        sire.stud_year_start - b.stud_year_start <= 20 &&
        b.id !== sire.id
      );
      if (validBms.length === 0) { attempts++; continue; }
      bms = validBms[Math.floor(Math.random() * validBms.length)];
      break;
    }

    if (!sire || !bms) {
      alert('当前条件下无合适组合，请放宽条件');
      return;
    }

    // 选中并展示
    this.selectedSireId = sire.id;
    this.selectedBmsId = bms.id;
    // 更新搜索框显示
    const sireInput = document.getElementById('sim-sire-search');
    const bmsInput = document.getElementById('sim-bms-search');
    if (sireInput) sireInput.value = Utils.displayName(sire);
    if (bmsInput) bmsInput.value = Utils.displayName(bms);
    const sireSelected = document.getElementById('sim-sire-selected');
    const bmsSelected = document.getElementById('sim-bms-selected');
    if (sireSelected) sireSelected.textContent = Utils.displayName(sire);
    if (bmsSelected) bmsSelected.textContent = Utils.displayName(bms);

    // 计算 Cross
    const { tree, crossResult } = await this._buildBmsTree(sire.id, bms.id);

    // 检查是否有 3×3 或更近
    const tooClose = (crossResult?.crosses || []).some(c => {
      const minS = Math.min(...c.positions.sire_side);
      const minM = Math.min(...c.positions.dam_side);
      return minS + minM <= 6;
    });

    if (tooClose) {
      const notation = crossResult.crosses.filter(c => {
        const minS = Math.min(...c.positions.sire_side);
        const minM = Math.min(...c.positions.dam_side);
        return minS + minM <= 6;
      }).map(c => c.notation).join(', ');
      if (!confirm(`Cross 过近: ${notation}\n再随机一次？`)) {
        // 用户选择保留，继续展示
      } else {
        return this.randomRoll();
      }
    }

    await this.runBmsSimulation();
  },

  // === 配种推荐 ===

  async showRecommend() {
    if (!this.selectedDamId) return;
    const resultContainer = document.getElementById('sim-result');
    resultContainer.innerHTML = '<p>正在计算推荐...</p>';

    const stallions = (this._cachedUserHorses || []).filter(h => h.sex === 'male' && h.role === 'stallion' && h.id !== this.selectedDamId);
    if (stallions.length === 0) {
      resultContainer.innerHTML = `<div class="card"><p>${I18N.t('noStallionsForRecommend')}</p></div>`;
      return;
    }

    const results = [];
    for (const s of stallions) {
      try {
        const { crossResult } = await Cross.simulateMating(s.id, this.selectedDamId);
        const score = this._scoreCross(crossResult);
        results.push({ horse: s, crossResult, score });
      } catch (e) { /* skip */ }
    }

    results.sort((a, b) => b.score.total - a.score.total);
    resultContainer.innerHTML = this._renderRecommendList(results, null);
  },

  _scoreCross(crossResult) {
    const crosses = crossResult?.crosses || [];
    let total = 0;
    let hasRisk = false;
    const details = [];

    for (const c of crosses) {
      const sGens = c.positions.sire_side;
      const mGens = c.positions.dam_side;
      // 对每对 sire_gen × dam_gen 组合评分
      for (const sg of sGens) {
        for (const mg of mGens) {
          const minG = Math.min(sg, mg);
          const maxG = Math.max(sg, mg);
          const diff = maxG - minG;

          if (minG <= 3 && maxG <= 3) {
            // 3×3 或更近：风险
            hasRisk = true;
            total -= 10;
          } else if (minG >= 4) {
            // 4×4, 4×5, 5×5 等：优质范围
            const balanceBonus = diff <= 1 ? 5 : (diff === 2 ? 2 : 1);
            total += balanceBonus;
          } else if (minG === 3 && maxG >= 4) {
            // 3×4, 3×5：轻度风险但可接受
            const balanceBonus = diff <= 1 ? 3 : 1;
            total += balanceBonus;
          }
        }
      }
    }

    // Outcross（无 cross）得一个基础分，排在有优质 cross 后面
    if (crosses.length === 0) total = 0;

    return { total, hasRisk, crossCount: crosses.length };
  },

  _renderRecommendList(results, realResults) {
    let html = `<div class="card"><h4>${I18N.t('recommendTitle')}</h4><p style="font-size:12px;color:#888;margin-bottom:12px">${I18N.t('recommendNote')}</p>`;

    // 架空种马
    html += `<h5 style="margin:12px 0 6px">架空种马</h5>`;
    if (results.length === 0) {
      html += `<p class="empty">${I18N.t('noStallionsForRecommend')}</p>`;
    } else {
      html += this._renderRecommendTable(results.slice(0, 20));
    }

    // 史实种马
    html += `<h5 style="margin:16px 0 6px">史实种马</h5>`;
    html += `<div class="race-filter-bar" style="margin-bottom:8px">
      <label>配种年：<input type="number" id="rec-year-from" value="2015" style="width:60px"> ~ <input type="number" id="rec-year-to" value="2025" style="width:60px"></label>
      <label>产国：<select id="rec-country"><option value="">全部</option><option value="JPN">JPN</option><option value="USA">USA</option><option value="GB">GB</option><option value="IRE">IRE</option><option value="AUS">AUS</option><option value="FR">FR</option></select></label>
      <button class="btn btn-secondary btn-sm" onclick="UISimulate._searchRealRecommend()">搜索</button>
    </div>`;
    html += `<div id="rec-real-results">`;
    if (realResults && realResults.length > 0) {
      html += this._renderRecommendTable(realResults.slice(0, 20));
    } else if (realResults) {
      html += `<p class="empty">无匹配结果</p>`;
    } else {
      html += `<p style="font-size:13px;color:#999">设定条件后点击搜索</p>`;
    }
    html += `</div></div>`;
    return html;
  },

  _renderRecommendTable(list) {
    let html = '<table class="race-record-table"><thead><tr><th>种马</th><th>产国</th><th>Cross</th><th>评分</th></tr></thead><tbody>';
    for (const r of list) {
      const h = r.horse;
      const crosses = r.crossResult?.crosses || [];
      const crossText = crosses.length === 0 ? 'Outcross' : crosses.map(c => c.notation).join('; ');
      const riskClass = r.score.hasRisk ? ' style="color:#d00"' : '';
      const name = h.name_en || h.name_ja || Utils.displayName(h);
      html += `<tr${riskClass}><td><a class="ped-link recommend-pick" data-id="${h.id}" data-name="${Utils.escapeHtml(name)}">${Utils.escapeHtml(name)}</a></td><td>${Utils.escapeHtml(h.country) || ''}</td><td style="font-size:12px;max-width:300px">${Utils.escapeHtml(crossText)}</td><td>${r.score.hasRisk ? '⚠️ ' : ''}${r.score.total}</td></tr>`;
    }
    html += '</tbody></table>';
    return html;
  },

  async _searchRealRecommend() {
    const yearFrom = parseInt(document.getElementById('rec-year-from')?.value) || 2015;
    const yearTo = parseInt(document.getElementById('rec-year-to')?.value) || 2025;
    const country = document.getElementById('rec-country')?.value || '';
    const container = document.getElementById('rec-real-results');
    container.innerHTML = '<p>计算中...</p>';

    const horses = (DataLoader.index?.horses || []).filter(h =>
      h.sex === 'male' && h.stud_year_start &&
      h.stud_year_start >= yearFrom && (h.stud_year_end ? h.stud_year_end <= yearTo : h.stud_year_start <= yearTo) &&
      (!country || h.country === country)
    );

    if (horses.length === 0) {
      container.innerHTML = '<p class="empty">无符合条件的种马</p>';
      return;
    }

    container.innerHTML = `<p>正在计算 ${horses.length} 匹种马...</p>`;
    await new Promise(r => setTimeout(r, 50));

    const results = [];
    for (let i = 0; i < horses.length; i++) {
      try {
        const { crossResult } = await Cross.simulateMating(horses[i].id, this.selectedDamId);
        const score = this._scoreCross(crossResult);
        results.push({ horse: horses[i], crossResult, score });
      } catch (e) { /* skip */ }
      if (i % 50 === 49) {
        container.querySelector('p').textContent = `正在计算... ${i + 1}/${horses.length}`;
        await new Promise(r => setTimeout(r, 10));
      }
    }

    results.sort((a, b) => b.score.total - a.score.total);
    container.innerHTML = results.length > 0 ? this._renderRecommendTable(results.slice(0, 20)) : '<p class="empty">无匹配结果</p>';
    container.querySelectorAll('.recommend-pick').forEach(el => {
      el.addEventListener('click', () => UISimulate.selectSire(el.dataset.id, el.dataset.name));
    });
  },

  // === 保存为架空马 ===
  async saveAsHorse() {
    if (!this.selectedSireId || !this.selectedBmsId) return;
    // 创建无名母马
    const damId = Utils.generateId();
    await Storage.saveHorse({
      id: damId, name_en: '', name_ja: '', name_cn: '', type: 'fictional',
      sex: 'female', role: 'broodmare', birth_year: null, country: '',
      color: '', sire_id: this.selectedBmsId, dam_id: null, pedigree_cache: null
    });
    // 创建架空马
    const horseId = Utils.generateId();
    await Storage.saveHorse({
      id: horseId, name_en: '', name_ja: '', name_cn: '', type: 'fictional',
      sex: 'male', role: 'active', birth_year: null, country: '',
      color: '', sire_id: this.selectedSireId, dam_id: damId, pedigree_cache: null
    });
    // 跳转编辑
    UIHorse.showDetail(horseId);
    App.showView('manage');
  }
};
