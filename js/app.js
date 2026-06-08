/* app.js — 应用入口，导航路由，全局事件 */
'use strict';

const App = {
  currentView: 'search',

  async init() {
    await Storage.init();
    await DataLoader.loadIndex();
    this.bindNav();
    this.bindSearch();
    this.showView('search');
    Search.init();
    this.updateModeButton();
  },

  bindNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.showView(btn.dataset.view);
      });
    });
  },

  bindSearch() {
    const input = document.getElementById('search-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
        }
      });
    }

    // 搜索结果点击 → 区分架空马/真实马
    document.getElementById('search-results')?.addEventListener('click', async (e) => {
      const item = e.target.closest('.horse-item');
      if (item && item.dataset.id) {
        const id = item.dataset.id;
        const horse = await Storage.getHorse(id);
        if (horse && horse.type === 'fictional') {
          UIPedigree.showDetail(id);
        } else {
          UIPedigree.show(id);
        }
      }
    });
  },

  showView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const target = document.getElementById('view-' + viewName);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // 初始化对应视图
    switch (viewName) {
      case 'manage': this._initManage(); break;
      case 'damline': UIDamline.init(); break;
      case 'simulate': UISimulate.init(); break;
    }
  },

  _initManage() {
    UIHorse.renderList();
  },

  switchTab(tab) {
    document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.sidebar-btn[data-tab="${tab}"]`)?.classList.add('active');
    if (tab === 'horse') UIHorse.renderList();
    else UIEntities.renderList(tab);
  },

  async toggleMode() {
    const current = await YearValidator.getMode();
    const next = current === 'strict' ? 'free' : 'strict';
    await YearValidator.setMode(next);
    this.updateModeButton();
  },

  async updateModeButton() {
    const mode = await YearValidator.getMode();
    const btn = document.getElementById('mode-toggle');
    if (btn) {
      btn.textContent = mode === 'strict' ? '模式：严谨' : '模式：架空';
      btn.classList.toggle('mode-strict', mode === 'strict');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
