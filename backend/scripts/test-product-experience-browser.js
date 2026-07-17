const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:5176';
const TEST_ACCOUNT = process.env.DISCIMIND_TEST_STUDENT_ACCOUNT;
const TEST_PASSWORD = process.env.DISCIMIND_TEST_PASSWORD;
if (!TEST_ACCOUNT || !TEST_PASSWORD) throw new Error('DISCIMIND_TEST_STUDENT_ACCOUNT and DISCIMIND_TEST_PASSWORD are required');
const output = path.resolve(__dirname, '../test-output/product-experience');

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = []; const pageErrors = []; const apiCounts = new Map();
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/')) apiCounts.set(request.url(), (apiCounts.get(request.url()) || 0) + 1); });
  const result = {};
  try {
    await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
    await page.click('#btn-show-login'); await page.fill('#login-account', TEST_ACCOUNT); await page.fill('#login-password', TEST_PASSWORD); await page.click('#login-submit');
    await page.waitForURL(/#\/student\//, { timeout: 15000 });

    await page.goto(`${BASE}/#/student/agents?agentType=FILE_GENERATOR&source=generated-files`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.agent-market-toolbar');
    result.fileGeneratorUrl = page.url().includes('agentType=FILE_GENERATOR');
    result.fileGeneratorOnly = await page.locator('.agent-market-card').count() > 0 && await page.locator('.agent-filter-summary em').filter({ hasText: '文件生成智能体' }).count() === 1;
    const gridColumns = await page.locator('.agent-card-grid').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    result.desktopColumns = gridColumns;
    await page.locator('.agent-more-trigger').first().click(); await page.waitForSelector('.agent-card-menu-portal');
    result.portalFixed = await page.locator('.agent-card-menu-portal').evaluate(element => getComputedStyle(element).position === 'fixed' && element.parentElement === document.body);
    await page.keyboard.press('Escape'); result.portalEscClose = await page.locator('.agent-card-menu-portal').count() === 0;
    await page.click('#agent-filter-open'); await page.selectOption('[data-filter="agentType"]', 'FILE_GENERATOR'); await page.check('[data-capability="PDF 导出"]'); await page.click('[data-filter-apply]');
    await page.waitForLoadState('networkidle'); result.filterUrl = page.url().includes('capabilities=PDF') && page.url().includes('agentType=FILE_GENERATOR');
    await page.screenshot({ path: path.join(output, 'agent-market.png'), fullPage: true });

    await page.goto(`${BASE}/#/student/agents?source=system`, { waitUntil: 'networkidle' });
    result.systemHandoutVisible = await page.getByText('学习讲义生成助手', { exact: true }).count() > 0;
    result.systemExamVisible = await page.getByText('考试试卷生成助手', { exact: true }).count() > 0;

    await page.goto(`${BASE}/#/student/generated-artifacts`, { waitUntil: 'networkidle' });
    result.generatorLinkFiltered = (await page.locator('a[href*="agentType=FILE_GENERATOR"]').count()) > 0;
    const detailLink = page.locator('.artifact-card a').first(); if (await detailLink.count()) { await detailLink.click(); await page.waitForSelector('.artifact-export-panel'); result.docxOption = await page.getByText('DOCX', { exact: true }).count() > 0; result.pdfOption = await page.getByText('PDF', { exact: true }).count() > 0; }

    await page.goto(`${BASE}/#/student/learning-context`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#learning-context-form');
    result.contextBlocks = await page.locator('.learning-context-block').count(); result.contextRoute = page.url().includes('/student/learning-context');
    result.navArrows = await page.locator('.sidebar-menu-item .sidebar-menu-arrow svg').count(); result.navItems = await page.locator('.sidebar-menu-item').count();
    await page.screenshot({ path: path.join(output, 'learning-context.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${BASE}/#/student/agents?agentType=FILE_GENERATOR`, { waitUntil: 'networkidle' });
    result.mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    result.mobileColumns = await page.locator('.agent-card-grid').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    await page.screenshot({ path: path.join(output, 'agent-market-mobile.png'), fullPage: true });
    result.consoleErrors = consoleErrors; result.pageErrors = pageErrors;
    result.requestLoop = [...apiCounts.values()].some(count => count > 12);
    const ok = result.fileGeneratorUrl && result.fileGeneratorOnly && result.desktopColumns === 3 && result.portalFixed && result.portalEscClose && result.filterUrl && result.systemHandoutVisible && result.systemExamVisible && result.generatorLinkFiltered && result.docxOption && result.pdfOption && result.contextBlocks >= 3 && result.contextRoute && result.navArrows === result.navItems && !result.mobileOverflow && result.mobileColumns === 1 && !result.consoleErrors.length && !result.pageErrors.length && !result.requestLoop;
    console.log(JSON.stringify({ ok, ...result }, null, 2)); if (!ok) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
