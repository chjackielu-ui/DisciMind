const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const frontend = (...segments) => path.resolve(__dirname, '../../frontend/src', ...segments)
const read = (...segments) => fs.readFileSync(frontend(...segments), 'utf8')

test('all primary and secondary navigation items use SVG arrows hidden when collapsed', () => {
  const source = read('utils', 'dashboard.js')
  const css = read('styles', 'dashboard.css')
  assert.match(source, /menuArrowSvg/)
  assert.match(source, /sidebar-menu-arrow/)
  assert.match(source, /sub-nav-arrow/)
  assert.match(css, /\.student-sidebar\.collapsed \.sidebar-menu-arrow/)
})

test('admin navigation exposes only completed modules and keeps one stable secondary navigation surface', () => {
  const menu = read('utils', 'admin-menu.js')
  const layout = read('utils', 'dashboard.js')
  const adminCss = read('styles', 'admin.css')
  const completedRoutes = [
    '/admin/users?role=student',
    '/admin/courses',
    '/admin/ai-config?tab=providers',
    '/admin/knowledge',
    '/admin/agent-reviews?tab=agents',
    '/admin/permissions',
  ]
  for (const route of completedRoutes) assert.match(menu, new RegExp(route.replace(/[?]/g, '\\?')))
  for (const unfinished of ['/admin/learning-flows', '/admin/evaluations', '/admin/experiments', '/admin/digital-twin']) {
    assert.doesNotMatch(menu, new RegExp(`hash: '#${unfinished}'`))
  }
  assert.match(layout, /admin-module-nav/)
  assert.match(layout, /ADMIN_SIDEBAR_PIN_KEY/)
  assert.match(layout, /aria-current="page"/)
  assert.match(adminCss, /\.role-admin \.admin-module-nav/)

  for (const page of ['admin-courses.js', 'admin-classes.js', 'admin-teaching-classes.js', 'admin-knowledge.js']) {
    assert.doesNotMatch(read('pages', page), /class="(?:sub-nav|admin-tabs)"/)
  }
})

test('admin route transitions reset scroll after asynchronous page rendering', () => {
  const router = read('utils', 'router.js')
  assert.match(router, /app\.innerHTML = buildRouteLoadingHTML\(\)[\s\S]*cleanup = await route\.render\(app, params\)[\s\S]*renderRouteError\(app, error\)[\s\S]*window\.scrollTo\(0, 0\)/)
})

test('admin sidebar pinning preserves the main document scroll position', () => {
  const layout = read('utils', 'dashboard.js')
  const adminCss = read('styles', 'admin.css')
  assert.match(layout, /let settledDocumentScroll = \{ x: window\.scrollX, y: window\.scrollY \}/)
  assert.match(layout, /const preservedScroll = \{ \.\.\.settledDocumentScroll \}/)
  assert.match(layout, /settledDocumentScroll = \{ x: window\.scrollX, y: window\.scrollY \}/)
  assert.match(layout, /focus\(\{ preventScroll: true \}\)/)
  assert.match(layout, /requestAnimationFrame\(\(\) => window\.scrollTo\(preservedScroll\.x, preservedScroll\.y\)\)/)
  assert.match(adminCss, /\.role-admin \.student-sidebar \{[\s\S]{0,100}overflow-anchor: none;/)
})
