/**
 * 美育课程模块控制器（PostgreSQL 版）
 * ------------------------------------------------------------
 * 课程是平台「美育教育」属性的内容板块，courses 表已随 schema.sql 建好。
 *
 * 公开（无需鉴权）：
 *   GET /api/course/list    课程列表（按状态筛选，默认 active）
 *   GET /api/course/detail  课程详情
 * 管理（需 teacher / admin 角色）：
 *   POST /api/course/create  创建课程
 *   POST /api/course/update  更新课程
 *   POST /api/course/delete  删除课程
 */

const { query, queryOne, insertReturningId } = require('../utils/config/db');
const { success, fail } = require('../utils/response');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function toItem(r) {
  return {
    id: r.id,
    courseName: r.course_name,
    teacherName: r.teacher_name,
    location: r.location,
    classTime: r.class_time,
    weeklyInfo: r.weekly_info,
    category: r.category || 'other',
    description: r.description,
    status: r.status,
    createTime: r.created_at
  };
}

/** GET /api/course/list?status=active|closed|all */
async function listCourses(req, res) {
  const { status } = req.query;
  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);

  try {
    const params = [status && status !== 'all' ? status : '', limit];
    const sql = `
      SELECT * FROM courses
      WHERE ($1 = '' OR status = $1)
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const list = (await query(sql, params)).rows.map(toItem);
    return success(res, { list }, '查询成功');
  } catch (err) {
    console.error('[course] 课程列表查询异常:', err.message);
    return fail(res, '课程查询失败', 500);
  }
}

/** GET /api/course/detail?id= */
async function getDetail(req, res) {
  const { id } = req.query;
  if (!id) return fail(res, '缺少课程 ID', 400);

  try {
    const row = await queryOne('SELECT * FROM courses WHERE id = $1', [Number(id)]);
    if (!row) return fail(res, '课程不存在', 404);
    return success(res, toItem(row), '查询成功');
  } catch (err) {
    console.error('[course] 课程详情查询异常:', err.message);
    return fail(res, '课程详情查询失败', 500);
  }
}

/** POST /api/course/create（teacher / admin） */
async function createCourse(req, res) {
  const { courseName, teacherName, location, classTime, weeklyInfo, category, description } = req.body || {};
  if (!courseName || !courseName.trim()) return fail(res, '课程名称不能为空', 400);
  if (!teacherName || !teacherName.trim()) return fail(res, '授课教师不能为空', 400);

  try {
    const id = await insertReturningId(
      'courses',
      ['course_name', 'teacher_name', 'location', 'class_time', 'weekly_info', 'category', 'description', 'status', 'created_at'],
      [
        courseName.trim(),
        teacherName.trim(),
        location || '',
        classTime || '',
        weeklyInfo || '',
        category || 'other',
        description || '',
        'active',
        new Date()
      ]
    );
    return success(res, { courseId: id, status: 'active' }, '创建成功');
  } catch (err) {
    console.error('[course] 课程创建异常:', err.message);
    return fail(res, '课程创建失败', 500);
  }
}

/** POST /api/course/update（teacher / admin） */
async function updateCourse(req, res) {
  const { id } = req.body || {};
  if (!id) return fail(res, '缺少课程 ID', 400);

  // 可更新字段映射（驼峰 → 蛇形）
  const FIELDS = {
    courseName: 'course_name',
    teacherName: 'teacher_name',
    location: 'location',
    classTime: 'class_time',
    weeklyInfo: 'weekly_info',
    category: 'category',
    description: 'description',
    status: 'status'
  };

  const sets = [];
  const values = [];
  let idx = 1;
  for (const [key, col] of Object.entries(FIELDS)) {
    if (req.body[key] !== undefined) {
      sets.push(`${col} = $${idx++}`);
      values.push(req.body[key]);
    }
  }
  if (sets.length === 0) return fail(res, '没有可更新的字段', 400);

  try {
    const exists = await queryOne('SELECT id FROM courses WHERE id = $1', [Number(id)]);
    if (!exists) return fail(res, '课程不存在', 404);

    values.push(Number(id));
    await query(`UPDATE courses SET ${sets.join(', ')} WHERE id = $${idx}`, values);
    const row = await queryOne('SELECT * FROM courses WHERE id = $1', [Number(id)]);
    return success(res, toItem(row), '更新成功');
  } catch (err) {
    console.error('[course] 课程更新异常:', err.message);
    return fail(res, '课程更新失败', 500);
  }
}

/** POST /api/course/delete（teacher / admin） */
async function deleteCourse(req, res) {
  const { id } = req.body || {};
  if (!id) return fail(res, '缺少课程 ID', 400);

  try {
    const exists = await queryOne('SELECT id FROM courses WHERE id = $1', [Number(id)]);
    if (!exists) return fail(res, '课程不存在', 404);

    await query('DELETE FROM courses WHERE id = $1', [Number(id)]);
    return success(res, { deleted: true }, '删除成功');
  } catch (err) {
    console.error('[course] 课程删除异常:', err.message);
    return fail(res, '课程删除失败', 500);
  }
}

module.exports = { listCourses, getDetail, createCourse, updateCourse, deleteCourse };
