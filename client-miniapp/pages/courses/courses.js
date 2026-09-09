const api = require('../../utils/api');
const util = require('../../utils/util');

/** 分类色条颜色（图 5-5：每类课程左侧一条彩色边） */
const CAT_COLORS = {
  calligraphy: '#C84B31',
  painting: '#E8853D',
  photography: '#4E7A6A',
  handcraft: '#B5713F',
  other: '#5C6B8A'
};

/** '14:00' → 分钟数，用于排序 */
function minutesOf(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

Page({
  data: {
    fontMode: 'normal',

    weeks: [],        // 上周 / 本周 / 下周
    activeOffset: 0,
    todayText: '',

    courses: [],
    loading: true,
    empty: false
  },

  onLoad() {
    this.buildWeeks();
    this.loadCourses();
  },

  onShow() {
    this.setData({
      fontMode: wx.getStorageSync('fontMode') || 'normal'
    });
  },

  /** 生成 上周/本周/下周 切换器（周一为一周起点，动态计算日期区间） */
  buildWeeks() {
    const names = { '-1': '上周', '0': '本周', '1': '下周' };
    const weeks = [-1, 0, 1].map((offset) => {
      const r = util.weekRange(offset);
      return {
        offset,
        name: names[String(offset)],
        range: r.label,
        active: offset === this.data.activeOffset
      };
    });

    const t = new Date();
    const todayText =
      util.DAY_NAMES[(t.getDay() + 6) % 7] + ' ' + util.pad(t.getMonth() + 1) + '.' + util.pad(t.getDate());

    this.setData({ weeks, todayText });
  },

  switchWeek(e) {
    const offset = Number(e.currentTarget.dataset.offset);
    if (offset === this.data.activeOffset) return;
    this.setData({ activeOffset: offset });
    this.buildWeeks();
    this.loadCourses();
  },

  async loadCourses() {
    this.setData({ loading: true });
    try {
      const res = await api.getCourses();
      const list = (res && res.list) || [];

      const catMap = {};
      api.CATEGORIES.forEach((c) => { catMap[c.key] = c.name; });

      const courses = list
        .map((c) => {
          const p = util.parseClassTime(c.classTime);
          return Object.assign({}, c, {
            color: CAT_COLORS[c.category] || CAT_COLORS.other,
            catName: catMap[c.category] || '美育课程',
            dayName: p.dayName || c.classTime,
            timeText: p.start ? p.start + (p.end ? ' - ' + p.end : '') : '',
            sortKey: p.dayIndex * 1000 + minutesOf(p.start)
          });
        })
        .sort((a, b) => a.sortKey - b.sortKey);

      this.setData({ courses, empty: courses.length === 0, loading: false });
    } catch (err) {
      console.warn('[courses] 课程加载失败:', err && err.message);
      this.setData({ loading: false, empty: true });
    }
  },

  /** 点击课程卡片 → 弹窗查看详情（Z-08） */
  showDetail(e) {
    const id = e.currentTarget.dataset.id;
    const c = this.data.courses.find((item) => String(item.id) === String(id));
    if (!c) return;
    wx.showModal({
      title: c.courseName,
      content:
        (c.dayName || '') + ' ' + (c.timeText || '') + '\n' +
        (c.teacherName || '') + ' · ' + (c.location || '') + '\n\n' +
        (c.description || ''),
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
