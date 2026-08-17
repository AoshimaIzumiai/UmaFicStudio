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
    this.updateNameLangBtn();
    this._applyI18n();
    this._initHistoryGuard();
  },

  bindNav() {
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
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

  showView(viewName, fromPopState) {
    this.currentView = viewName;
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const target = document.getElementById('view-' + viewName);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    if (!fromPopState) {
      history.pushState({ view: viewName }, '');
    }

    // 初始化对应视图
    switch (viewName) {
      case 'manage': this._initManage(); break;
      case 'damline': UIDamline.init(); break;
      case 'simulate': UISimulate.init(); break;
      case 'timeline': UITimeline.init(); break;
    }
  },

  _initManage() {
    UIHorse.renderList();
  },

  switchTab(tab) {
    document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.sidebar-btn[data-tab="${tab}"]`)?.classList.add('active');
    if (tab === 'horse') UIHorse.renderList();
    else if (tab === 'race') UIRaces.renderList();
    else if (tab === 'history') UIResults.renderHistory();
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
      btn.textContent = mode === 'strict' ? I18N.t('modeStrict') : I18N.t('modeFree');
      btn.classList.toggle('mode-strict', mode === 'strict');
    }
  },

  cycleNameLang() {
    const order = ['en', 'ja', 'cn'];
    const cur = localStorage.getItem('uma_name_lang') || 'en';
    const next = order[(order.indexOf(cur) + 1) % 3];
    localStorage.setItem('uma_name_lang', next);
    this.updateNameLangBtn();
    // 刷新当前显示
    if (this.currentView === 'search') Search.init();
    else if (this.currentView === 'manage') UIHorse.renderList();
  },

  updateNameLangBtn() {
    const btn = document.getElementById('name-lang-btn');
    if (btn) {
      const lang = localStorage.getItem('uma_name_lang') || 'en';
      btn.textContent = '名:' + lang.toUpperCase();
    }
  },

  _applyI18n() {
    // 导航按钮
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
      const map = { search: 'browse', manage: 'manage', damline: 'damline', simulate: 'simulate', timeline: 'timeline' };
      const key = map[btn.dataset.view];
      if (key) btn.textContent = I18N.t(key);
    });
    // sidebar
    document.querySelectorAll('.sidebar-btn[data-tab]').forEach(btn => {
      const map = { horse:'tabHorse', history:'tabHistory', owner:'tabOwner', trainer:'tabTrainer', farm:'tabFarm', jockey:'tabJockey', country:'tabCountry' };
      const key = map[btn.dataset.tab];
      if (key) btn.textContent = I18N.t(key);
    });
    // 搜索框
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.placeholder = I18N.t('searchPlaceholder');
    // 搜索页标题
    const searchTitle = document.getElementById('search-title');
    if (searchTitle) searchTitle.textContent = I18N.t('stallionDb');
    const dbNote = document.getElementById('db-note');
    if (dbNote) dbNote.textContent = I18N.t('dbNote');
  },

  showHelp() {
    const isZh = I18N.getLang() === 'zh';
    const version = 'v1.9.0';
    const versionDate = '2026-08-17';
    const changelogZh = `
<div style="background:#f0f7ff;border:1px solid #c8dff7;border-radius:8px;padding:12px 16px;margin-bottom:16px">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <strong style="font-size:15px">UmaFicStudio ${version}</strong>
    <span style="font-size:12px;color:#666">${versionDate}</span>
  </div>
  <p style="margin:6px 0 0;font-size:13px;color:#444">🚀 名片码 gzip 压缩（体积缩减 60-96%）/ 截断检测与错误提示 / 数据自动备份与丢失恢复</p>
</div>`;
    const changelogEn = `
<div style="background:#f0f7ff;border:1px solid #c8dff7;border-radius:8px;padding:12px 16px;margin-bottom:16px">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <strong style="font-size:15px">UmaFicStudio ${version}</strong>
    <span style="font-size:12px;color:#666">${versionDate}</span>
  </div>
  <p style="margin:6px 0 0;font-size:13px;color:#444">🚀 Share card gzip compression (60-96% smaller) / truncation detection / auto-backup & data loss recovery</p>
</div>`;
    const content = isZh ? changelogZh + `
<h3>使用说明</h3>
<h4>📖 基本功能</h4>
<ul>
<li><b>浏览</b>：搜索并查看 3000+ 匹真实种马的五代血统表</li>
<li><b>设定管理</b>：创建架空马、马主、练马师、骑手、牧场等</li>
<li><b>母系管理</b>：将牝马按族群分组，展示家族树</li>
<li><b>配种模拟</b>：预览后代血统与 Cross（近亲交配）</li>
</ul>
<h4>🏇 赛事系统</h4>
<ul>
<li>架空国可创建自定义赛事模板并录入比赛结果</li>
<li>日本预置 JRA 140 场 + NAR 40 场交流重赏</li>
<li>赛事数据可独立导入/导出（JSON 格式）</li>
</ul>
<h4>⚙️ 模式说明</h4>
<ul>
<li><b>架空模式</b>：不做年份限制，自由创作</li>
<li><b>严谨模式</b>：校验配种年份、年龄限制等</li>
</ul>
<h4>💡 小技巧</h4>
<ul>
<li>点击血统表中蓝色马名可跳转查看该马详情</li>
<li>创建架空马时可只填父亲/母父，系统自动创建无名母马</li>
<li>如遇血统显示异常，可在马匹管理中点击「刷新血统缓存」</li>
<li>数据存储在浏览器本地，建议定期导出备份</li>
</ul>
` : changelogEn + `
<h3>User Guide</h3>
<h4>📖 Basic Features</h4>
<ul>
<li><b>Browse</b>: Search 3000+ real stallions with 5-generation pedigree tables</li>
<li><b>Settings</b>: Create fictional horses, owners, trainers, jockeys, farms</li>
<li><b>Dam Lines</b>: Group mares by family, display family trees</li>
<li><b>Pedigree Preview</b>: Simulate mating and preview offspring Cross</li>
</ul>
<h4>🏇 Race System</h4>
<ul>
<li>Create custom race templates and record results for fictional countries</li>
<li>Preset: JRA 140 races + NAR 40 dirt grade races</li>
<li>Race data can be imported/exported independently (JSON)</li>
</ul>
<h4>⚙️ Modes</h4>
<ul>
<li><b>Free Mode</b>: No year restrictions, full creative freedom</li>
<li><b>Strict Mode</b>: Validates stud years, age restrictions, etc.</li>
</ul>
<h4>💡 Tips</h4>
<ul>
<li>Click blue horse names in pedigree tables to view details</li>
<li>You can specify only sire/BMS — the system auto-creates an unnamed dam</li>
<li>If pedigree display looks wrong, use "Refresh Pedigree Cache" button</li>
<li>Data is stored locally in browser — export regularly for backup</li>
</ul>
`;
    // 创建弹窗
    let overlay = document.getElementById('help-overlay');
    if (overlay) { overlay.remove(); return; }
    overlay = document.createElement('div');
    overlay.id = 'help-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;padding:24px 32px;max-width:600px;max-height:80vh;overflow-y:auto;font-size:14px;line-height:1.8;color:#333';
    box.innerHTML = content + '<div style="text-align:center;margin-top:16px"><button class="btn btn-primary" onclick="document.getElementById(\'help-overlay\').remove()">OK</button></div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  },
  _initHistoryGuard() {
    // 初始推入一个状态，防止返回键退出网站
    history.replaceState({ view: this.currentView }, '');
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.view) {
        this.showView(e.state.view, true);
      } else {
        // 没有更早的状态了，推回一个防止退出
        history.pushState({ view: this.currentView }, '');
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
