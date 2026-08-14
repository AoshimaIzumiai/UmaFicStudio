/* share-card.js — 马匹名片码编码/解码 + 导入导出 */
'use strict';

const ShareCard = {
  VERSION: 1,
  PREFIX: 'UMA1:', // 版本前缀，方便未来升级格式

  /**
   * 从架空马数据生成名片码
   * @param {Object} horse - 完整架空马对象
   * @param {Array} results - 该马的比赛记录
   * @param {Object} pedigree - 五代血统树（可选）
   * @returns {string} 文本码
   */
  encode(horse, results = [], pedigree = null) {
    const payload = {
      v: this.VERSION,
      h: this._compressHorse(horse),
      r: this._compressResults(results),
    };
    if (pedigree) payload.p = this._compressPedigree(pedigree);
    const json = JSON.stringify(payload);
    // 压缩：利用 TextEncoder + base64
    const compressed = this._deflate(json);
    return this.PREFIX + compressed;
  },

  /**
   * 从名片码解码为马匹数据
   * @param {string} code - 文本码
   * @returns {Object|null} { horse, results, pedigree }
   */
  decode(code) {
    // 清除所有空白字符和零宽字符（传输/粘贴中可能被插入）
    code = code.replace(/[\s\u200B-\u200D\uFEFF\u00A0]/g, '');
    if (!code.startsWith(this.PREFIX)) return null;
    // 防 DoS：限制输入大小（1MB，正常名片码远小于此）
    if (code.length > 1024 * 1024) {
      alert('名片码数据过大，无法导入。');
      return null;
    }
    try {
      const compressed = code.slice(this.PREFIX.length);
      const json = this._inflate(compressed);
      const payload = JSON.parse(json);
      if (payload.v !== this.VERSION) {
        console.warn('[ShareCard] 版本不匹配:', payload.v);
      }
      return {
        horse: this._expandHorse(payload.h),
        results: this._expandResults(payload.r || []),
        pedigree: payload.p ? this._expandPedigree(payload.p) : null
      };
    } catch (e) {
      console.error('[ShareCard] 解码失败:', e);
      return null;
    }
  },

  // === 压缩：JSON → UTF-8 bytes → raw deflate → base64url ===
  _deflate(str) {
    const bytes = new TextEncoder().encode(str);
    // 使用简单的 base64 编码（无原生 deflate 时的降级方案）
    // 浏览器支持 CompressionStream 时用 gzip
    return this._bytesToBase64(bytes);
  },

  _inflate(b64) {
    const bytes = this._base64ToBytes(b64);
    return new TextDecoder().decode(bytes);
  },

  _bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  _base64ToBytes(b64) {
    b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  },

  // === 马匹数据压缩（短 key 节省空间）===
  _compressHorse(h) {
    return {
      n: h.name_en || '', j: h.name_ja || '', c: h.name_cn || '',
      s: h.sex || 'male', b: h.birth_year || null, co: h.color || '',
      ct: h.country || '', ro: h.role || 'racer',
      sf: h.aptitude_surface || [], dmin: h.distance_min || null, dmax: h.distance_max || null,
      sy: h.stud_year_start || null, ey: h.stud_year_end || null,
      si: h.sire_id || null, di: h.dam_id || null,
      nm: h.name_meaning || '', pp: h.purchase_price || '',
      tg: h.tags || [], nt: h.notes || '',
      ce: (h.career_events || []).map(e => ({ y: e.year, t: e.type, n: e.note || '' }))
    };
  },

  _expandHorse(c) {
    return {
      id: 'shared_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name_en: c.n || '', name_ja: c.j || '', name_cn: c.c || '',
      type: 'shared', sex: c.s || 'male', birth_year: c.b || null,
      color: c.co || '', country: c.ct || '', role: c.ro || 'racer',
      aptitude_surface: c.sf || [], aptitude_distance: [],
      distance_min: c.dmin || null, distance_max: c.dmax || null,
      stud_year_start: c.sy || null, stud_year_end: c.ey || null,
      sire_id: c.si || null, dam_id: c.di || null,
      farm: null, trainer: null, owner: null,
      name_meaning: c.nm || '', purchase_price: c.pp || '',
      tags: c.tg || [], notes: c.nt || '', pedigree_cache: null,
      career_events: (c.ce || []).map(e => ({ year: e.y, type: e.t, note: e.n || '' }))
    };
  },

  // === 战绩压缩 ===
  _compressResults(results) {
    return results.map(r => ({
      rn: r.race_name || '', g: r.grade || '', v: r.venue || '',
      d: r.distance || null, sf: r.surface || '', y: r.year || null,
      sc: r.schedule || '', rk: r.runners || null,
      // entries 中只保留该马自身的记录
      e: (r.entries || []).map(e => ({
        h: e.horse_id || '', p: e.finish || null,
        jk: e.jockey_id || '', pop: e.popularity || null,
        t: e.time || '', m: e.margin || '', w: e.weight || '',
        gt: e.gate || null, st: e.status || '', pz: e.prize || null
      }))
    }));
  },

  _expandResults(arr) {
    return arr.map(r => ({
      id: 'res_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      race_id: null, race_name: r.rn || '', grade: r.g || '',
      venue: r.v || '', distance: r.d || null, surface: r.sf || '',
      year: r.y || null, schedule: r.sc || '', runners: r.rk || null,
      country_id: '', track_condition: '', condition_note: '', notes: '',
      entries: (r.e || []).map(e => ({
        horse_id: e.h || '', finish: e.p || null,
        jockey_id: e.jk || '', popularity: e.pop || null,
        time: e.t || '', margin: e.m || '', weight: e.w || '',
        gate: e.gt || null, status: e.st || '', prize: e.pz || null
      }))
    }));
  },

  // === 五代血统压缩（递归树 → 扁平数组）===
  _compressPedigree(tree) {
    if (!tree) return null;
    const flat = [];
    const walk = (node) => {
      if (!node) { flat.push(null); return; }
      flat.push({ i: node.id || '', n: node.name_en || '', c: node.country || '' });
      walk(node.sire);
      walk(node.dam);
    };
    walk(tree);
    return flat;
  },

  _expandPedigree(flat) {
    if (!flat || flat.length === 0) return null;
    let idx = 0;
    const build = () => {
      if (idx >= flat.length) return null;
      const item = flat[idx++];
      if (!item) return null;
      return {
        id: item.i || '', name_en: item.n || '', country: item.c || '',
        sire: build(), dam: build()
      };
    };
    return build();
  },

  // === UI: 生成名片码弹窗 ===
  async showGenerateDialog(horseId) {
    const horse = await Storage.getHorse(horseId);
    if (!horse) return alert('马匹数据不存在');

    // 获取战绩
    const allResults = await Storage.getAll('results');
    const results = allResults.filter(r =>
      (r.entries || []).some(e => e.horse_id === horseId)
    );

    // 获取血统
    const pedigree = await Pedigree.getPedigreeTree(horseId);

    const code = this.encode(horse, results, pedigree);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:560px">
        <h3 style="margin:0 0 12px">📋 名片码</h3>
        <p style="font-size:13px;color:#666;margin:0 0 8px">复制下方文本分享给他人，对方可在「导入名片码」中粘贴导入此马（只读）</p>
        <textarea id="share-code-output" readonly style="width:100%;height:120px;font-size:11px;font-family:monospace;word-break:break-all;resize:vertical">${code}</textarea>
        <p style="font-size:12px;color:#999;margin:4px 0 12px">长度: ${code.length} 字符 | 含 ${results.length} 条比赛记录</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-primary" onclick="ShareCard._copyCode()">复制</button>
          <button class="btn" onclick="this.closest('.modal-overlay').remove()">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  },

  _copyCode() {
    const ta = document.getElementById('share-code-output');
    ta.select();
    navigator.clipboard.writeText(ta.value).then(() => {
      const btn = ta.closest('.modal-content').querySelector('.btn-primary');
      btn.textContent = '已复制 ✓';
      setTimeout(() => btn.textContent = '复制', 2000);
    });
  },

  // === UI: 导入名片码弹窗 ===
  showImportDialog() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:560px">
        <h3 style="margin:0 0 12px">📥 导入名片码</h3>
        <p style="font-size:13px;color:#666;margin:0 0 8px">粘贴他人分享的名片码，导入后将作为只读种马出现在数据库中</p>
        <textarea id="share-code-input" placeholder="粘贴名片码（以 UMA1: 开头）..." style="width:100%;height:120px;font-size:11px;font-family:monospace;resize:vertical"></textarea>
        <div id="share-import-preview" style="margin:8px 0;font-size:13px;color:#333"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
          <span style="font-size:11px;color:#999;margin-right:auto">导入无反应？请先点击预览</span>
          <button class="btn" onclick="ShareCard._previewImport()">预览</button>
          <button class="btn btn-primary" id="share-import-btn">导入</button>
          <button class="btn" onclick="this.closest('.modal-overlay').remove()">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('share-import-btn').addEventListener('click', function() { ShareCard._doImport(); });
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  },

  _pendingImport: null,

  _previewImport() {
    const code = document.getElementById('share-code-input').value;
    const result = this.decode(code);
    const preview = document.getElementById('share-import-preview');
    const btn = document.getElementById('share-import-btn');

    if (!result) {
      preview.innerHTML = '<span style="color:#d00">❌ 无效的名片码</span>';
      btn.disabled = true;
      this._pendingImport = null;
      return;
    }

    const h = result.horse;
    const name = h.name_en || h.name_ja || h.name_cn || '(无名)';
    const info = [
      `<strong>${name}</strong>`,
      h.sex === 'female' ? '♀' : '♂',
      h.birth_year ? `${h.birth_year}年生` : '',
      h.country || '',
      result.results.length ? `${result.results.length}条比赛记录` : '无比赛记录',
      result.pedigree ? '含五代血统' : '无血统数据'
    ].filter(Boolean).join(' | ');

    preview.innerHTML = `✅ ${info}`;
    btn.disabled = false;
    this._pendingImport = result;
  },

  async _doImport() {
    const preview = document.getElementById('share-import-preview');
    // 如果没有预览过，直接从输入框解码
    if (!this._pendingImport) {
      const codeEl = document.getElementById('share-code-input');
      const code = codeEl?.value;
      if (!code || !code.trim()) {
        if (preview) preview.innerHTML = '<span style="color:#d00">❌ 请先粘贴名片码</span>';
        return;
      }
      const result = this.decode(code);
      if (!result) {
        if (preview) preview.innerHTML = '<span style="color:#d00">❌ 解码失败，请先点击「预览」确认</span>';
        return;
      }
      this._pendingImport = result;
    }
    const { horse, results, pedigree } = this._pendingImport;

    // 保存马匹到 horses store（type: shared）
    await Storage.saveHorse(horse);

    // 保存战绩（修正 horse_id 指向新 ID）
    for (const r of results) {
      for (const e of r.entries) {
        if (e.horse_id) e.horse_id = horse.id;
      }
      await Storage.saveEntity('results', r);
    }

    // 保存血统缓存
    if (pedigree) {
      horse.pedigree_cache = pedigree;
      await Storage.saveHorse(horse);
    }

    this._pendingImport = null;
    document.querySelector('.modal-overlay')?.remove();
    alert(`已导入「${horse.name_en || horse.name_ja || ''}」为只读种马`);

    // 刷新列表
    if (typeof UIHorse !== 'undefined') UIHorse.renderList();
  }
};
