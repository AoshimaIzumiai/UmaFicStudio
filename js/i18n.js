/* i18n.js — 中英双语 UI 文本 */
'use strict';

const I18N = {
  _lang: localStorage.getItem('umastudio_lang') || 'zh',

  zh: {
    // 导航
    browse: '浏览', manage: '设定管理', damline: '母系管理', simulate: '血统预览',
    modeStrict: '模式：严谨', modeFree: '模式：架空',
    searchPlaceholder: '搜索种马名...',
    // sidebar
    tabHorse: '马匹', tabHistory: '历史重赏', tabOwner: '马主', tabTrainer: '练马师',
    tabFarm: '牧场', tabJockey: '骑手', tabCountry: '国家',
    // 通用按钮
    create: '创建', save: '保存', cancel: '取消', edit: '编辑', delete: '删除',
    detail: '详情', back: '← 返回', export: '导出数据', import: '导入数据',
    // 马匹
    createHorse: '+ 创建架空马', nameEn: '英文名', nameJa: '日文名', nameCn: '中文名',
    sex: '性别', male: '牡', female: '牝', gelding: '骟',
    role: '角色', active: '现役马', stallion: '种牡马', broodmare: '繁殖牝马', retired: '引退马',
    birthYear: '出生年', country: '产国', color: '毛色',
    bay: '鹿毛', darkBay: '黑鹿毛', brown: '青鹿毛', chestnut: '栗毛',
    darkChestnut: '栃栗毛', grey: '芦毛', black: '青毛', white: '白毛',
    sire: '父亲', dam: '母亲', bms: '母父（快捷）',
    surface: '场地', turf: '草地', dirt: '泥地', distance: '距离',
    sprint: '短途', mile: '一哩', intermediate: '中距离', long: '长途',
    studYearStart: '配种开始年', studYearEnd: '配种结束年', studYears: '配种年份',
    // 扩展
    farm: '出生牧场', trainer: '练马师', owner: '马主',
    nameMeaning: '马名含义', notes: '备注',
    // 血统
    pedigree: '血统表', gens3: '3代', gens4: '4代', gens5: '5代',
    tableView: '表格式', treeView: '树形图',
    pedigreePrint: '📄 血统表打印', profilePrint: '📋 档案打印',
    noCross: '无Cross（纯血外配）', completeness: '血统完整度',
    // 战绩
    raceRecord: '战绩表', addRecord: '+ 添加战绩',
    rentai: '连对率', fukusho: '复胜率', gradeWin: '分级赛', g1Win: 'G1',
    totalPrize: '総獲得賞金',
    // 赛事
    raceTemplate: '赛事模板', gradeRace: '重赏/分级赛', nonGrade: '非重赏（条件/新马等）',
    year: '年份', schedule: '日程', venue: '马场', grade: '等级',
    ageRestriction: '年龄限制', sexRestriction: '性别限制',
    // 搜索
    results: '条结果', allCountry: '全部产国', allSurface: '全部场地', allDistance: '全部距离',
    prevPage: '← 上一页', nextPage: '下一页 →',
    // 欢迎
    welcome: '开始使用',
    stallionDb: '种马数据库', dbNote: '※本站仅收录史实种牡马数据，不含史实牝马或未入种牡马。',
    // 详情页
    basicInfo: '基本信息', extInfo: '扩展信息', changeHistory: '变更历史',
    showHistory: '在详情页显示变更历史', transferHistory: '转厩/转手记录', addTransfer: '+ 添加记录',
    date: '日期', from: '变更前', to: '变更后', type: '类型', refreshCache: '刷新血统缓存',
    // 配种模拟
    simSire: '父亲（种牡马）', simDam: '母亲（繁殖牝马）', simSelected: '已选择', simNotSelected: '未选择', simRun: '模拟配种',
    // 母系管理
    damGroups: '母系分组', newGroup: '+ 新建分组', ungrouped: '未分组', ungroupedMares: '未分组的繁殖牝马',
    noRootMares: '该分组中无根母马', expandProgeny: '展开后代', deleteGroup: '删除分组',
    promptGroupName: '输入分组名称：', promptAddMare: '选择要添加的马（输入序号）：',
    confirmDeleteGroup: '确定删除此分组？（不会删除马匹本身）',
  },

  en: {
    browse: 'Browse', manage: 'Settings', damline: 'Dam Lines', simulate: 'Pedigree Preview',
    modeStrict: 'Mode: Strict', modeFree: 'Mode: Free',
    searchPlaceholder: 'Search stallion...',
    tabHorse: 'Horses', tabHistory: 'Graded History', tabOwner: 'Owners', tabTrainer: 'Trainers',
    tabFarm: 'Farms', tabJockey: 'Jockeys', tabCountry: 'Countries',
    create: 'Create', save: 'Save', cancel: 'Cancel', edit: 'Edit', delete: 'Delete',
    detail: 'Detail', back: '← Back', export: 'Export', import: 'Import',
    createHorse: '+ New Horse', nameEn: 'English Name', nameJa: 'Japanese Name', nameCn: 'Chinese Name',
    sex: 'Sex', male: 'Colt/Horse', female: 'Filly/Mare', gelding: 'Gelding',
    role: 'Role', active: 'Active', stallion: 'Stallion', broodmare: 'Broodmare', retired: 'Retired',
    birthYear: 'Birth Year', country: 'Country', color: 'Color',
    bay: 'Bay', darkBay: 'Dark Bay', brown: 'Brown', chestnut: 'Chestnut',
    darkChestnut: 'Dark Chestnut', grey: 'Grey', black: 'Black', white: 'White',
    sire: 'Sire', dam: 'Dam', bms: 'Broodmare Sire',
    surface: 'Surface', turf: 'Turf', dirt: 'Dirt', distance: 'Distance',
    sprint: 'Sprint', mile: 'Mile', intermediate: 'Middle', long: 'Long',
    studYearStart: 'Stud Start', studYearEnd: 'Stud End', studYears: 'Stud Years',
    farm: 'Farm', trainer: 'Trainer', owner: 'Owner',
    nameMeaning: 'Name Meaning', notes: 'Notes',
    pedigree: 'Pedigree', gens3: '3 Gen', gens4: '4 Gen', gens5: '5 Gen',
    tableView: 'Table', treeView: 'Tree',
    pedigreePrint: '📄 Pedigree', profilePrint: '📋 Profile',
    noCross: 'No Inbreeding (Outcross)', completeness: 'Pedigree Completeness',
    raceRecord: 'Race Record', addRecord: '+ Add Record',
    rentai: 'Top 2 Rate', fukusho: 'Top 3 Rate', gradeWin: 'Graded', g1Win: 'G1',
    totalPrize: 'Total Prize',
    raceTemplate: 'Race Template', gradeRace: 'Graded Race', nonGrade: 'Non-Graded',
    year: 'Year', schedule: 'Schedule', venue: 'Venue', grade: 'Grade',
    ageRestriction: 'Age Limit', sexRestriction: 'Sex Limit',
    results: 'results', allCountry: 'All Countries', allSurface: 'All Surfaces', allDistance: 'All Distances',
    prevPage: '← Prev', nextPage: 'Next →',
    welcome: 'Enter',
    stallionDb: 'Stallion Database', dbNote: '※This site only contains data on historical stallions. No mares or non-stud males are included.',
    basicInfo: 'Basic Info', extInfo: 'Extended Info', changeHistory: 'Transfer History',
    showHistory: 'Show transfer history on detail page', transferHistory: 'Transfer Records', addTransfer: '+ Add Record',
    date: 'Date', from: 'From', to: 'To', type: 'Type', refreshCache: 'Refresh Pedigree Cache',
    simSire: 'Sire (Stallion)', simDam: 'Dam (Broodmare)', simSelected: 'Selected', simNotSelected: 'Not selected', simRun: 'Simulate',
    damGroups: 'Dam Line Groups', newGroup: '+ New Group', ungrouped: 'Ungrouped', ungroupedMares: 'Ungrouped Mares',
    noRootMares: 'No root mares in this group', expandProgeny: 'Expand', deleteGroup: 'Delete Group',
    promptGroupName: 'Enter group name:', promptAddMare: 'Select mare (enter number):',
    confirmDeleteGroup: 'Delete this group? (mares will not be deleted)',
  },

  t(key) { return this[this._lang]?.[key] || this.zh[key] || key; },

  setLang(lang) {
    this._lang = lang;
    localStorage.setItem('umastudio_lang', lang);
  },

  getLang() { return this._lang; }
};
