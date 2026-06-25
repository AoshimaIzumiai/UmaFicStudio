/* press-storage.js — 草稿管理 + 模板 + 自动保存 */
const PressStorage = {
  _autoSaveInterval: null,
  _lastSaved: '',

  TEMPLATES: {
    race_report: {
      name: '赛事报道',
      markdown: `# 赛事标题\n\n## 场次 / 日期 / 赛马场\n\n![赛事配图](img:placeholder)\n\n{{result:选择比赛}}\n\n正文报道...\n\n---\n\n{{stats:选择马匹}}`
    },
    horse_bio: {
      name: '马匹传记',
      markdown: `# 马名\n\n![马匹照片](img:placeholder)\n\n{{card:选择马匹}}\n\n{{pedigree:选择马匹}}\n\n{{record:选择马匹}}\n\n## 评述\n\n正文...`
    },
    quote: {
      name: '名言/语录',
      markdown: `> 在这里写一句话...\n>\n> ——某某某\n\n---\n\n正文...`
    }
  },

  createArticle(template, horseId) {
    const tmpl = this.TEMPLATES[template] || this.TEMPLATES.race_report;
    let md = tmpl.markdown;
    // 如果有预选马匹，替换占位符
    if (horseId) {
      md = md.replace(/选择马匹/g, horseId);
    }
    return {
      id: 'press_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '',
      template: template,
      markdown: md,
      images: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      export_size: 'long'
    };
  },

  // === 自动保存 ===

  startAutoSave(editor) {
    this.stopAutoSave();
    this._lastSaved = JSON.stringify(editor.currentArticle);
    this._autoSaveInterval = setInterval(() => this._checkSave(editor), 5000);
    window.addEventListener('beforeunload', this._beforeUnload);
  },

  stopAutoSave() {
    if (this._autoSaveInterval) clearInterval(this._autoSaveInterval);
    window.removeEventListener('beforeunload', this._beforeUnload);
  },

  _beforeUnload() {
    if (PressEditor.currentArticle) {
      PressEditor.currentArticle.updated_at = new Date().toISOString();
      // 提取标题
      const firstLine = (PressEditor.currentArticle.markdown || '').split('\n')[0];
      PressEditor.currentArticle.title = firstLine.replace(/^#+\s*/, '').trim() || '未命名';
      Storage.savePressArticle(PressEditor.currentArticle);
    }
  },

  async _checkSave(editor) {
    if (!editor.currentArticle) return;
    const current = JSON.stringify(editor.currentArticle);
    if (current === this._lastSaved) return;

    editor.currentArticle.updated_at = new Date().toISOString();
    const firstLine = (editor.currentArticle.markdown || '').split('\n')[0];
    editor.currentArticle.title = firstLine.replace(/^#+\s*/, '').trim() || '未命名';

    try {
      await Storage.savePressArticle(editor.currentArticle);
      this._lastSaved = current;
      document.getElementById('save-status').textContent = PressI18N.t('saved');
    } catch (e) {
      document.getElementById('save-status').textContent = PressI18N.t('saveFailed');
    }
  },

  // === 草稿列表 ===

  async renderDraftList() {
    const container = document.getElementById('draft-list');
    const articles = await Storage.getAllPressArticles();
    articles.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

    if (articles.length === 0) {
      container.innerHTML = `<p style="text-align:center;color:#999;margin-top:40px">${PressI18N.t('noArticles')}</p>`;
      return;
    }

    container.innerHTML = articles.map(a => `
      <div class="draft-item">
        <div class="draft-info">
          <span class="draft-title">${a.title || '未命名'}</span>
          <span class="draft-meta">${this.TEMPLATES[a.template]?.name || a.template} · ${this._timeAgo(a.updated_at)}</span>
        </div>
        <div class="draft-actions">
          <button class="btn btn-secondary" onclick="location.hash='edit/${a.id}'">${PressI18N.t('edit')}</button>
          <button class="btn btn-secondary" onclick="PressStorage.exportJSON('${a.id}')">JSON</button>
          <button class="btn btn-secondary" onclick="PressStorage.deleteDraft('${a.id}')" style="color:#d00">${PressI18N.t('delete')}</button>
        </div>
      </div>
    `).join('');
  },

  async deleteDraft(id) {
    if (!confirm(PressI18N.t('confirmDelete'))) return;
    await Storage.deletePressArticle(id);
    this.renderDraftList();
  },

  async exportJSON(id) {
    const article = await Storage.getPressArticle(id);
    if (!article) return;
    const blob = new Blob([JSON.stringify(article, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${article.title || 'article'}.json`; a.click();
    URL.revokeObjectURL(url);
  },

  _timeAgo(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + '分钟前';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + '小时前';
    return Math.floor(hours / 24) + '天前';
  }
};

// 新建按钮绑定
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-new')?.addEventListener('click', () => {
    const template = prompt(PressI18N.t('templatePrompt'), '1');
    const t = template === '2' ? 'horse_bio' : template === '3' ? 'quote' : 'race_report';
    location.hash = `edit/new/${t}`;
  });
});
