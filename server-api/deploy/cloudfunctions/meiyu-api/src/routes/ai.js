/**
 * AI 文本润色接口（Z-04）
 * ------------------------------------------------------------
 * POST /api/ai/polish
 * Body: { keyword?, category?, text? }
 * Return: success(res, { text, wordCount, source: 'art-ai-engine' })
 *
 * 设计原则（对齐需求文档 Z-04 与前端 8 秒超时降级）：
 *   1) 默认使用「离线美育语料模板」合成优美文段（80~150 字），无需外网大模型
 *      Key 也能稳定演示，保证发布主链路永不因 AI 服务卡死；
 *   2) 若 .env 配置了 LLM_API_KEY / LLM_API_URL，则优先代理调用外部大模型，
 *      并带 8 秒超时；超时/失败时回落到模板合成（不会 reject 阻塞前端）。
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();
const { success } = require('../utils/response');

/** 内置美育艺术语料模板库（每段 80~150 字） */
const POLISH_TEMPLATES = [
  '本作品立足于传统笔墨精神与现代审美视角的交融。创作者以灵动的线条勾勒与细腻的层次晕染，寄托了对自然生机与人文意蕴的深切感悟。整体气韵通达、温润典雅，呈现出高校美育浸润下青年学子独树一帜的艺术构思与扎实的造型功底。',
  '作品以工致入微的技法与极具张力的构图展开叙事。层叠的色彩与起伏的肌理相互映衬，静穆之中见灵动、方寸之间显匠心，将创作者对生活诗意的追寻转化为纯粹而富有感染力的视觉表达，观之令人回味悠长。',
  '此作融合写意神韵与具象造型，用笔松弛而富有骨力。光影交织间凸显空间纵深，墨色浓淡自如、收放有度，既恪守传统法度，又洋溢着鲜活的青春探索精神，生动诠释了美育实践课所沉淀的艺术体察与创作灵光。',
  '创作者以克制的观察与饱满的情感描绘寻常景致，让平凡之物在笔下焕发新的神采。构图疏密有致，设色明快而不失沉静，细节处尤见用心。整件作品既是对技法的温习，更是一次与自我、与时光安静对话的诚意之作。'
];

/** 拼接关键词开头，使结果贴合创作主题 */
function composeText(keyword) {
  const randIdx = Math.floor(Math.random() * POLISH_TEMPLATES.length);
  let body = POLISH_TEMPLATES[randIdx];
  if (keyword) {
    body = `围绕「${keyword}」这一主题，` + body;
  }
  return body;
}

/** 外部大模型代理（可选）：命中超时或异常即回落到模板 */
async function polishViaLLM({ keyword, category, text }) {
  const url = process.env.LLM_API_URL;
  const key = process.env.LLM_API_KEY;
  if (!url || !key) return null;

  const prompt =
    `请根据下面这段创作关键词/草稿，润色成一段 80～150 字、优美通顺的中文作品简介（美育作品：${category || '未指定'}）。只输出简介正文，不要任何解释或前缀。\n` +
    `关键词：${keyword || ''}\n草稿：${text || ''}`;

  const { data } = await axios.post(
    url,
    { prompt, max_tokens: 300, temperature: 0.7 },
    {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 8000
    }
  );

  // 兼容常见大模型返回结构（openai 式 / 自定义式）
  const out =
    (data && data.choices && data.choices[0] && data.choices[0].message &&
      data.choices[0].message.content) ||
    (data && data.output) ||
    (data && data.text) ||
    '';
  return out.trim() ? out : null;
}

/** POST /api/ai/polish */
router.post('/polish', async (req, res) => {
  const { keyword = '', category = '', text = '' } = req.body || {};

  try {
    // 1) 优先外部大模型
    const llmText = await polishViaLLM({ keyword, category, text });
    if (llmText) {
      return success(
        res,
        { text: llmText, wordCount: llmText.length, source: 'llm' },
        '润色生成成功'
      );
    }

    // 2) 回落到离线美育语料合成（毫秒级，稳定演示）
    const polished = composeText(String(keyword || category).trim());
    return success(
      res,
      { text: polished, wordCount: polished.length, source: 'art-ai-engine' },
      '润色生成成功（离线引擎）'
    );
  } catch (err) {
    // 任何异常都回落到模板，绝不阻断前端发布主链路
    const polished = composeText(String(keyword || category).trim());
    console.warn('[ai/polish] 外部引擎异常，已降级到离线模板:', err.message);
    return success(
      res,
      { text: polished, wordCount: polished.length, source: 'art-ai-engine' },
      '润色生成成功（已降级离线）'
    );
  }
});

module.exports = router;
