/**
 * 班级解析（小程序认定、Web 用户管理共用）
 * ------------------------------------------------------------------
 * 平台的「班级」是自由输入的文本，落在 classes.class_name，用户通过 users.class_id 关联。
 * 为避免两处入口（学生自助认定 / 管理员改资料）各写一套逻辑导致班级重复建档或命名不一致，
 * 统一收敛到本模块。
 */

const { queryOne, insertReturningId } = require('./config/db');

/** 班级名长度上限（与 classes.class_name 实际使用长度保持一致） */
const MAX_CLASS_NAME = 100;

/** 规范化班级名：去首尾空白、压缩连续空格 */
function normalizeClassName(input) {
  return String(input == null ? '' : input)
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * 按班级名取 class_id：命中已有班级则复用（忽略大小写与空白差异），未命中则自动建档。
 * @param {string} className 班级名（自由输入）
 * @returns {Promise<{ id: number, name: string, created: boolean }>}
 * @throws {Error} 班级名为空或过长时抛出，message 可直接回传前端
 */
async function findOrCreateClassId(className) {
  const name = normalizeClassName(className);
  if (!name) {
    const err = new Error('班级不能为空');
    err.code = 'EMPTY_CLASS';
    throw err;
  }
  if (name.length > MAX_CLASS_NAME) {
    const err = new Error(`班级名称最长 ${MAX_CLASS_NAME} 个字符`);
    err.code = 'CLASS_TOO_LONG';
    throw err;
  }

  // 精确命中优先（含历史数据里可能存在的多余空白，故先试原样再试 trim 比较）
  let cls = await queryOne('SELECT id, class_name FROM classes WHERE class_name = $1 ORDER BY id LIMIT 1', [
    name
  ]);
  if (!cls) {
    cls = await queryOne(
      'SELECT id, class_name FROM classes WHERE LOWER(TRIM(class_name)) = LOWER($1) ORDER BY id LIMIT 1',
      [name]
    );
  }
  if (cls) return { id: Number(cls.id), name: cls.class_name || name, created: false };

  // 自由输入的班级：自动建档，学院/专业留空，年级不填（与 Web 端行为一致）
  const id = await insertReturningId('classes', ['college_name', 'major_name', 'class_name'], ['', '', name]);
  return { id: Number(id), name, created: true };
}

/** 按用户 ID 查班级名（无班级返回 ''） */
async function classNameOfUser(userId) {
  const row = await queryOne(
    'SELECT c.class_name FROM users u LEFT JOIN classes c ON c.id = u.class_id WHERE u.id = $1',
    [Number(userId)]
  );
  return (row && row.class_name) || '';
}

module.exports = {
  MAX_CLASS_NAME,
  normalizeClassName,
  findOrCreateClassId,
  classNameOfUser
};
