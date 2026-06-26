/* press-editor.js — Markdown 编辑器核心 */
const PressEditor = {
  currentArticle: null,
  _debounceTimer: null,

  async open(id, template, horseId) {
    if (id === 'new') {
      this.currentArticle = PressStorage.createArticle(template || 'race_report', horseId);
    } else {
      this.currentArticle = await Storage.getPressArticle(id);
      if (!this.currentArticle) { location.hash = ''; return; }
    }

    document.getElementById('md-input').value = this.currentArticle.markdown || '';
    this._setupSyntaxBar();
    this._bindEvents();
    this._render();
    PressStorage.startAutoSave(this);
  },

  _setupSyntaxBar() {
    const bar = document.getElementById('syntax-bar');
    const items = [
      { label: '# 标题', insert: '# ' },
      { label: '## 副标题', insert: '## ' },
      { label: '**加粗**', insert: '**文字**' },
      { label: '*斜体*', insert: '*文字*' },
      { label: '> 引用', action: 'quote' },
      { label: '---', insert: '\n---\n' },
      { type: 'sep' },
      { label: '🖼 图片', action: 'image' },
      { type: 'sep' },
      { label: '📋 血统表', action: 'data', dataType: 'pedigree' },
      { label: '📊 战绩', action: 'data', dataType: 'record' },
      { label: '🏆 着顺', action: 'data', dataType: 'result' },
      { label: '🏇 出马表', action: 'data', dataType: 'runners' },
      { label: '🪪 信息卡', action: 'data', dataType: 'card' },
      { label: '📈 统计', action: 'data', dataType: 'stats' },
    ];

    bar.innerHTML = items.map(item => {
      if (item.type === 'sep') return '<span class="sep"></span>';
      if (item.action === 'image') return `<code onclick="PressEditor._uploadImage()">${item.label}</code>`;
      if (item.action === 'quote') return `<code onclick="PressEditor._insertText('\\n> 引用文字\\n>\\n> ——出处\\n')">${item.label}</code>`;
      if (item.action === 'data') return `<code onclick="PressEditor._insertDataBlock('${item.dataType}')">${item.label}</code>`;
      return `<code onclick="PressEditor._insertText('${item.insert}')">${item.label}</code>`;
    }).join('');
  },

  _bindEvents() {
    const input = document.getElementById('md-input');
    input.addEventListener('input', () => {
      this.currentArticle.markdown = input.value;
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => this._render(), 300);
    });
  },

  _render() {
    const html = PressRender.render(this.currentArticle.markdown, this.currentArticle.images);
    const preview = document.getElementById('md-preview');
    preview.innerHTML = html;
    // 应用主题
    preview.className = 'preview-area theme-' + (this.currentArticle.template || 'newspaper');
    // 异步填充数据块
    PressRender.fillDataBlocks(preview);
  },

  _insertText(text) {
    const input = document.getElementById('md-input');
    const start = input.selectionStart;
    const before = input.value.substring(0, start);
    const after = input.value.substring(input.selectionEnd);
    input.value = before + text + after;
    input.selectionStart = input.selectionEnd = start + text.length;
    input.focus();
    input.dispatchEvent(new Event('input'));
  },

  _uploadImage() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp';
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { alert(PressI18N.t('imageTooBig')); return; }
      try {
        const compressed = await this._compressImage(file, 1200);
        const imgId = 'img_' + Date.now().toString(36);
        if (!this.currentArticle.images) this.currentArticle.images = {};
        this.currentArticle.images[imgId] = compressed;
        this._insertText(`![](img:${imgId})`);
      } catch (err) {
        alert(PressI18N.t('uploadFailed') + ': ' + err.message);
      }
    };
    fileInput.click();
  },

  _compressImage(file, maxWidth) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  },

  _insertDataBlock(type) {
    this._currentDataType = type;
    const modal = document.getElementById('data-search-modal');
    modal.classList.remove('hidden');
    const input = document.getElementById('data-search-input');
    input.value = '';
    input.placeholder = (type === 'result' || type === 'runners') ? '搜索赛事名...' : PressI18N.t('searchPlaceholder');
    document.getElementById('data-search-results').innerHTML = `<div class="data-search-empty">${input.placeholder}</div>`;
    input.focus();
    input.oninput = () => {
      clearTimeout(this._searchDebounce);
      this._searchDebounce = setTimeout(() => {
        (type === 'result' || type === 'runners') ? this._doRaceSearch(input.value.trim()) : this._doDataSearch(input.value.trim());
      }, 200);
    };
  },

  _currentDataType: null,
  _searchDebounce: null,

  _closeDataSearch() {
    document.getElementById('data-search-modal').classList.add('hidden');
  },

  async _doDataSearch(query) {
    const results = document.getElementById('data-search-results');
    if (!query) { results.innerHTML = `<div class="data-search-empty">${PressI18N.t('searchPlaceholder')}</div>`; return; }
    const matches = [];
    const allHorses = await Storage.getAllHorses();
    const q = query.toLowerCase();
    for (const h of allHorses) {
      if ((h.name_en || '').toLowerCase().includes(q) || (h.name_ja || '').includes(q) || (h.name_cn || '').includes(q)) {
        matches.push({ name: h.name_en || h.name_ja || h.name_cn, sub: [h.name_ja, h.name_cn, h.country].filter(Boolean).join(' · '), id: h.name_en || h.id });
      }
      if (matches.length >= 20) break;
    }
    if (matches.length < 20 && typeof DataLoader !== 'undefined' && DataLoader.index && DataLoader.index.horses) {
      for (const s of DataLoader.index.horses) {
        if ((s.name_en || '').toLowerCase().includes(q) || (s.name_ja || '').includes(q) || (s.name_cn || '').includes(q)) {
          const already = matches.find(m => m.id === s.name_en);
          if (!already) {
            matches.push({ name: s.name_en, sub: [s.name_ja, s.name_cn, s.country].filter(Boolean).join(' · '), id: s.name_en });
          }
        }
        if (matches.length >= 20) break;
      }
    }
    if (matches.length === 0) { results.innerHTML = `<div class="data-search-empty">${PressI18N.t('noResults')}</div>`; return; }
    results.innerHTML = matches.map(m => `<div class="data-search-item" onclick="PressEditor._selectDataResult('${m.id.replace(/'/g, "\\'")}')"><div>${m.name}</div>${m.sub ? `<div class="sub">${m.sub}</div>` : ''}</div>`).join('');
  },

  _selectDataResult(id) {
    this._insertText(`{{${this._currentDataType}:${id}}}`);
    this._closeDataSearch();
  },

  async _doRaceSearch(query) {
    const results = document.getElementById('data-search-results');
    if (!query) { results.innerHTML = `<div class="data-search-empty">搜索赛事名...</div>`; return; }
    const allResults = await Storage.getAllEntities('results');
    const q = query.toLowerCase();
    const matches = allResults.filter(r => (r.race_name || '').toLowerCase().includes(q)).slice(0, 20);
    if (matches.length === 0) { results.innerHTML = `<div class="data-search-empty">${PressI18N.t('noResults')}</div>`; return; }
    results.innerHTML = matches.map(r => `<div class="data-search-item" onclick="PressEditor._selectDataResult('${(r.race_name || r.id).replace(/'/g, "\\'")}')"><div>${r.race_name || r.id}</div><div class="sub">${r.year || ''} · ${r.grade || ''} · ${r.distance || ''}m</div></div>`).join('');
  }
};
