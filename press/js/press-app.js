/* press-app.js — 主应用逻辑 */
const PressApp = {
  async init() {
    await Storage.init();
    if (typeof DataLoader !== 'undefined') {
      DataLoader._baseUrl = '../';
      await DataLoader.loadIndex();
    }
    this._applyI18n();
    window.addEventListener('hashchange', () => this.route());
    document.getElementById('btn-back').addEventListener('click', () => { location.hash = ''; });
    this.route();
  },

  _applyI18n() {
    document.getElementById('press-title').textContent = '📰 ' + PressI18N.t('title');
    document.getElementById('btn-new').textContent = PressI18N.t('newArticle');
    document.getElementById('btn-back-main').textContent = PressI18N.t('backToMain');
    document.getElementById('btn-export').textContent = PressI18N.t('export');
    document.getElementById('btn-export-pdf').textContent = PressI18N.t('exportPDF');
    document.getElementById('btn-export-json').textContent = PressI18N.t('exportJSON');
    document.getElementById('btn-back').textContent = PressI18N.t('backToList');
    document.getElementById('save-status').textContent = PressI18N.t('unsaved');
    document.getElementById('data-search-title').textContent = PressI18N.t('insertData');
    document.getElementById('data-search-input').placeholder = PressI18N.t('searchPlaceholder');
  },

  route() {
    const hash = location.hash.slice(1);
    if (hash.startsWith('edit/')) {
      const parts = hash.slice(5).split('/'); // parts[0]=id, parts[1]=template, parts[2]=horseId
      const id = parts[0] || 'new';
      document.getElementById('view-list').classList.add('hidden');
      document.getElementById('view-editor').classList.remove('hidden');
      PressEditor.open(id, parts[1], parts[2]);
    } else {
      document.getElementById('view-list').classList.remove('hidden');
      document.getElementById('view-editor').classList.add('hidden');
      PressStorage.renderDraftList();
    }
  }
};

document.addEventListener('DOMContentLoaded', () => PressApp.init());
