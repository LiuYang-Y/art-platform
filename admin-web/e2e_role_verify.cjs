/**
 * 公网前端角色分流验证（真实浏览器）
 * 1) 学生登录 → 应进入「我的创作台」，且不出现管理菜单
 * 2) 管理员登录 → 应进入「工作台」，出现管理菜单
 * 3) 学生手工访问 /dashboard → 应被守卫弹回 /studio
 */
const { chromium } = require('playwright-core')

const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1194/chrome-win/chrome.exe'
const URL = 'https://aaa-d8gj21kc1d09d6414-1480206910.tcloudbaseapp.com/'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 打开页面并自动通过腾讯云测试域名风险提示页 */
async function open(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await sleep(1500)
  const btn = page.locator('button', { hasText: '确定访问' })
  if (await btn.count()) {
    await sleep(1600) // 等倒计时结束
    await btn.first().click().catch(() => {})
    await sleep(2500)
  }
}

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('[PAGEERROR]', String(e).slice(0, 300)))
  page.on('response', (r) => {
    if (r.url().includes('/api/')) console.log('[NET]', r.status(), r.request().method(), r.url().slice(-56))
  })

  // 1) 打开首页 → 未登录应跳登录页
  await open(page, URL)
  await sleep(2500)
  console.log('STEP1 url:', page.url())
  await page.screenshot({ path: 'e2e_1_login.png', fullPage: true })

  // 2) 学生登录
  await page.locator('.el-form input').first().fill('student')
  await page.locator('input[type="password"]').fill('123456')
  await page.locator('button.submit').click()
  await sleep(4000)
  console.log('STEP2 url:', page.url())
  let txt = await page.locator('body').innerText()
  console.log('  含「创作台」:', txt.includes('创作台'))
  console.log('  含「发布新作品」:', txt.includes('发布新作品'))
  console.log('  含「作品审核」(应为 false):', txt.includes('作品审核'))
  console.log('  侧栏标识「学生创作端」:', txt.includes('学生创作端'))
  await page.screenshot({ path: 'e2e_2_student_studio.png', fullPage: true })

  // 3) 学生越权访问 /dashboard → 应被弹回 /studio
  await open(page, URL + 'dashboard')
  await sleep(2500)
  console.log('STEP3 url(应为 /studio):', page.url())

  // 4) 切管理员
  await page.evaluate(() => localStorage.clear())
  await open(page, URL + 'login')
  await sleep(2000)
  await page.locator('.el-form input').first().fill('admin')
  await page.locator('input[type="password"]').fill('admin123')
  await page.locator('button.submit').click()
  await sleep(4000)
  console.log('STEP4 url:', page.url())
  txt = await page.locator('body').innerText()
  console.log('  含「工作台」:', txt.includes('工作台'))
  console.log('  含「作品审核」:', txt.includes('作品审核'))
  console.log('  含「我的创作台」(应为 false):', txt.includes('我的创作台'))
  await page.screenshot({ path: 'e2e_3_admin_dashboard.png', fullPage: true })

  await browser.close()
  console.log('DONE')
})().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
