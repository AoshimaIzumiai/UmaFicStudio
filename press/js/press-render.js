/* press-render.js — Markdown 渲染 + 数据块扩展 */
const PressRender = {
  md: null,

  init() {
    this.md = window.markdownit({ html: false, breaks: true, linkify: false });
    this._registerDataBlockPlugin();
    this._registerImagePlugin();
  },

  render(markdown, images) {
    if (!this.md) this.init();
    this._currentImages = images || {};
    return this.md.render(markdown || '');
  },

  _registerImagePlugin() {
    // 自定义 img:xxx 引用替换
    const defaultRender = this.md.renderer.rules.image;
    this.md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const src = token.attrGet('src') || '';
      if (src.startsWith('img:')) {
        const imgId = src.replace('img:', '');
        const data = PressRender._currentImages[imgId];
        if (data) {
          const alt = token.content || '';
          return `<img src="${data}" alt="${alt}" style="max-width:100%;display:block;margin:12px auto">`;
        }
        return `<div class="data-placeholder">🖼 图片未找到 (${imgId})</div>`;
      }
      return defaultRender ? defaultRender(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    };
  },

  _registerDataBlockPlugin() {
    // 解析 {{type:id}} 语法
    this.md.block.ruler.before('paragraph', 'data_block', (state, startLine, endLine, silent) => {
      const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).trim();
      const match = line.match(/^\{\{(pedigree|record|result|card|stats|runners):(.+)\}\}$/);
      if (!match) return false;
      if (silent) return true;

      const token = state.push('data_block', '', 0);
      token.meta = { type: match[1], id: match[2].trim() };
      token.map = [startLine, startLine + 1];
      state.line = startLine + 1;
      return true;
    });

    this.md.renderer.rules.data_block = (tokens, idx) => {
      const { type, id } = tokens[idx].meta;
      // 异步数据渲染：先返回占位符，后续由 _renderDataBlocks 填充
      return `<div class="data-block" data-type="${type}" data-id="${id}"><div class="data-loading">加载中...</div></div>`;
    };
  },

  /** 渲染完成后异步填充数据块 */
  async fillDataBlocks(container) {
    const blocks = container.querySelectorAll('.data-block');
    for (const el of blocks) {
      const type = el.dataset.type;
      const id = el.dataset.id;
      try {
        const html = await this._renderDataContent(type, id);
        el.innerHTML = html;
      } catch (e) {
        el.innerHTML = `<div class="data-placeholder">⚠️ 数据不可用</div>`;
      }
    }
  },

  async _renderDataContent(type, id) {
    // 先按 ID 查，找不到则按名字搜索
    let horse = await Storage.getHorse(id);
    if (!horse) {
      const all = await Storage.getAllHorses();
      horse = all.find(h => h.name_en === id || h.name_ja === id || h.name_cn === id);
    }

    switch (type) {
      case 'pedigree': return this._renderPedigree(horse);
      case 'record': return this._renderRecord(horse);
      case 'card': return this._renderCard(horse);
      case 'stats': return this._renderStats(horse);
      case 'result': return this._renderResult(id);
      case 'runners': return this._renderRunners(id);
      default: return '<div class="data-placeholder">未知类型</div>';
    }
  },

  async _renderPedigree(horse) {
    if (!horse) return '<div class="data-placeholder">⚠️ 马匹未找到</div>';
    const tree = await Pedigree.getPedigreeTree(horse.id);
    if (!tree) return '<div class="data-placeholder">⚠️ 无血统数据</div>';
    const n = (node) => node ? `${node.name_en || '?'}${node.country ? '(' + node.country + ')' : ''}` : '—';
    const s = tree.sire, d = tree.dam;
    const ss = s?.sire, sd = s?.dam, ds = d?.sire, dd = d?.dam;
    const cell = (name, cls) => `<div class="ped-cell ${cls}">${name}</div>`;
    const html = `<div class="ped-grid">
      <div class="ped-col1">
        ${cell(n(s), 'ped-m ped-span4')}
        ${cell(n(d), 'ped-f ped-span4')}
      </div>
      <div class="ped-col2">
        ${cell(n(ss), 'ped-m ped-span2')}
        ${cell(n(sd), 'ped-f ped-span2')}
        ${cell(n(ds), 'ped-m ped-span2')}
        ${cell(n(dd), 'ped-f ped-span2')}
      </div>
      <div class="ped-col3">
        ${cell(n(ss?.sire), 'ped-m')}
        ${cell(n(ss?.dam), 'ped-f')}
        ${cell(n(sd?.sire), 'ped-m')}
        ${cell(n(sd?.dam), 'ped-f')}
        ${cell(n(ds?.sire), 'ped-m')}
        ${cell(n(ds?.dam), 'ped-f')}
        ${cell(n(dd?.sire), 'ped-m')}
        ${cell(n(dd?.dam), 'ped-f')}
      </div>
    </div><p style="font-size:11px;color:#999;margin-top:4px">（3代血统表）</p>`;
    return html;
  },

  async _renderRecord(horse) {
    if (!horse) return '<div class="data-placeholder">⚠️ 马匹未找到</div>';
    const allResults = await Storage.getAllEntities('results');
    const records = allResults.filter(r => (r.entries || []).some(e => e.horse_id === horse.id));
    if (!records.length) return '<p>暂无出赛记录</p>';
    records.sort((a, b) => (a.year || 0) - (b.year || 0));
    let html = '<table class="record-table"><thead><tr><th>年</th><th>赛名</th><th>等级</th><th>距离</th><th>名次</th></tr></thead><tbody>';
    for (const r of records) {
      const e = r.entries.find(e => e.horse_id === horse.id);
      html += `<tr><td>${r.year || ''}</td><td>${r.race_name || ''}</td><td>${r.grade || ''}</td><td>${r.distance || ''}m</td><td>${e.finish || ''}</td></tr>`;
    }
    html += '</tbody></table>';
    return html;
  },

  _renderCard(horse) {
    if (!horse) return '<div class="data-placeholder">⚠️ 马匹未找到</div>';
    return `<div class="info-card">
      <h3>${horse.name_en || ''}${horse.country ? ' (' + horse.country + ')' : ''}</h3>
      <p>${horse.name_ja || ''} ${horse.name_cn || ''}</p>
      <p>${Utils.sexLabel(horse.sex)} / ${horse.birth_year || '?'}年生 / ${I18N.t(horse.color) || ''}</p>
    </div>`;
  },

  async _renderStats(horse) {
    if (!horse) return '<div class="data-placeholder">⚠️ 马匹未找到</div>';
    const allResults = await Storage.getAllEntities('results');
    let total = 0, wins = 0, seconds = 0, thirds = 0;
    for (const r of allResults) {
      const e = (r.entries || []).find(e => e.horse_id === horse.id);
      if (!e || e.status === 'scratched') continue;
      total++;
      if (e.finish === 1) wins++;
      else if (e.finish === 2) seconds++;
      else if (e.finish === 3) thirds++;
    }
    const rest = total - wins - seconds - thirds;
    const name = horse.name_en || horse.name_ja || horse.name_cn || '';
    return `<div class="stats-block"><strong>${name}</strong>　${total}战${wins}胜 [${wins}-${seconds}-${thirds}-${rest}]</div>`;
  },

  async _renderResult(id) {
    const result = await Storage.get('results', id);
    if (!result) {
      const all = await Storage.getAllEntities('results');
      const found = all.find(r => r.race_name === id);
      if (!found) return '<div class="data-placeholder">⚠️ 赛事未找到</div>';
      return await this._renderResultTable(found);
    }
    return await this._renderResultTable(result);
  },

  async _renderResultTable(result) {
    let html = `<h4>${result.race_name || ''} (${result.year || ''})</h4>`;
    html += '<table class="result-table"><thead><tr><th>名次</th><th>马名</th></tr></thead><tbody>';
    const sorted = (result.entries || []).filter(e => e.finish).sort((a, b) => a.finish - b.finish);
    for (const e of sorted) {
      let name = e._horse_name || '';
      if (!name && e.horse_id) {
        const h = await Storage.getHorse(e.horse_id);
        name = h ? (h.name_en || h.name_ja || h.name_cn || e.horse_id) : e.horse_id;
      }
      html += `<tr><td>${e.finish}</td><td>${name}</td></tr>`;
    }
    html += '</tbody></table>';
    return html;
  },

  async _renderRunners(id) {
    let result = await Storage.get('results', id);
    if (!result) {
      const all = await Storage.getAllEntities('results');
      result = all.find(r => r.race_name === id);
    }
    if (!result) return '<div class="data-placeholder">⚠️ 赛事未找到</div>';

    const grade = result.grade ? `(${result.grade})` : '';
    let html = `<h4>🏇 ${result.race_name || ''} ${grade}</h4>`;
    html += `<p class="runners-meta">${result.venue || ''} ${result.surface || ''} ${result.distance || ''}m ${result.year || ''} ${result.schedule || ''}</p>`;
    html += '<table class="runners-table"><thead><tr><th>枠</th><th>馬名</th><th>父</th><th>母父</th><th>騎手</th><th>人気</th><th>着</th></tr></thead><tbody>';

    const entries = (result.entries || []).sort((a, b) => (a.gate || 99) - (b.gate || 99));
    for (const e of entries) {
      let name = '', sireName = '', bmsName = '';
      if (e.horse_id) {
        const h = await Storage.getHorse(e.horse_id);
        if (h) {
          name = h.name_en || h.name_ja || h.name_cn || '';
          // 查父
          if (h.sire_id) {
            const sire = await Storage.getHorse(h.sire_id) || DataLoader.getHorseFromIndex(h.sire_id);
            sireName = sire ? (sire.name_en || sire.name_ja || '') : '';
          }
          // 查母父
          if (h.dam_id) {
            const dam = await Storage.getHorse(h.dam_id);
            if (dam && dam.sire_id) {
              const bms = await Storage.getHorse(dam.sire_id) || DataLoader.getHorseFromIndex(dam.sire_id);
              bmsName = bms ? (bms.name_en || bms.name_ja || '') : '';
            }
          }
        }
      }
      if (!name) name = e._horse_name || e.horse_id || '';
      const posClass = e.finish === 1 ? 'pos-1' : e.finish === 2 ? 'pos-2' : e.finish === 3 ? 'pos-3' : '';
      html += `<tr class="${posClass}"><td>${e.gate || ''}</td><td><strong>${name}</strong></td><td>${sireName}</td><td>${bmsName}</td><td>${e.jockey_name || ''}</td><td>${e.popularity || ''}</td><td>${e.finish || ''}</td></tr>`;
    }
    html += '</tbody></table>';
    return html;
  }
};
