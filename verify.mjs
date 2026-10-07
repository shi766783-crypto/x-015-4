import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { seed } from './src/data.js'

// ---- localStorage shim ----
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
}
store.set('family-recipe-keeper-v1', JSON.stringify(structuredClone(seed)))

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

let ssrPage = 'overview'
const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  logLevel: 'error',
  plugins: [{
    name: 'test-set-active',
    enforce: 'pre',
    transform(code, id) {
      if (id.replace(/\\/g, '/').endsWith('/src/App.vue')) {
        return { code: code.replace("const active = ref('overview')", `const active = ref('${ssrPage}')`) }
      }
    }
  }]
})

// ---------- 1. Logic tests via real component setup() ----------
const AppMod = await server.ssrLoadModule('/src/App.vue')
let bindings
const Harness = { setup: (__props, ctx) => { bindings = AppMod.default.setup({}, ctx); return () => null }, render: () => null }
await renderToString(createSSRApp(Harness))
const { state, openMenuForm, saveMenu, applyRecipe, menuDraft, showMenuForm, togglePurchased, openCreate, save, draft, showForm, menuList, metrics } = bindings

console.log('逻辑验证（真实 setup() + localStorage 持久化）：')

ok('初始采购完成率指标为 1/2（基于真实菜单 done 字段）', () => {
  assert.equal(metrics.value.find((x) => x.label === '采购完成率').value, '1/2')
})

ok('初始菜单列表按周几排序（menu-1 周一在前，menu-2 周三在后）', () => {
  assert.equal(menuList.value[0].id, 'menu-1')
  assert.equal(menuList.value[1].id, 'menu-2')
})

ok('两条演示菜单的 type / expires / done 结构兼容', () => {
  assert.equal(menuList.value[0].type, '周一 · 番茄牛腩')
  assert.equal(menuList.value[0].expires, '周一')
  assert.equal(menuList.value[0].done, false)
  assert.equal(menuList.value[1].done, true)
})

ok('安排菜谱弹窗与菜谱表单弹窗是两个独立开关', () => {
  assert.equal(showMenuForm.value, false)
  assert.equal(showForm.value, false)
  openMenuForm()
  assert.equal(showMenuForm.value, true)
  assert.equal(showForm.value, false)
})

ok('从菜谱库选择「番茄牛腩」会自动带入菜名与采购清单（食材清单 location）', () => {
  menuDraft.value.recipeId = 'recipe-1'
  applyRecipe()
  assert.equal(menuDraft.value.type, '番茄牛腩')
  assert.equal(menuDraft.value.number, '牛腩 500g、番茄 2 个、洋葱')
})

ok('保存安排 → 写入 policies 菜单（唯一 id），菜谱库 documents 不增加', () => {
  menuDraft.value.expires = '周五'
  const docCount = state.documents.length
  saveMenu()
  assert.equal(state.documents.length, docCount, '菜谱库数量不变')
  const added = state.policies[0]
  assert.equal(added.type, '周五 · 番茄牛腩')
  assert.equal(added.expires, '周五')
  assert.equal(added.done, false)
  assert.equal(added.payment, '未采购')
  assert.equal(added.company, '采购清单')
  assert.equal(added.insured, '家庭晚餐')
})

ok('保存后采购完成率随真实菜单变化为 1/3', () => {
  assert.equal(metrics.value.find((x) => x.label === '采购完成率').value, '1/3')
})

ok('保存「已采购」的安排 → done=true 且完成率变 2/4', () => {
  openMenuForm()
  menuDraft.value.type = '  抹茶巴斯克  '
  menuDraft.value.expires = '周日'
  menuDraft.value.number = '奶油奶酪'
  menuDraft.value.payment = '已采购'
  saveMenu()
  const added = state.policies[0]
  assert.equal(added.type, '周日 · 抹茶巴斯克')
  assert.equal(added.done, true)
  assert.equal(added.payment, '已采购')
  assert.equal(metrics.value.find((x) => x.label === '采购完成率').value, '2/4')
})

ok('连续快速添加的两条安排拥有不同 id', () => {
  const ids = state.policies.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
})

ok('菜名为空时不保存（弹窗保持打开）', () => {
  const count = state.policies.length
  openMenuForm()
  menuDraft.value.type = '   '
  saveMenu()
  assert.equal(state.policies.length, count)
  assert.equal(showMenuForm.value, true)
  showMenuForm.value = false
})

ok('标记采购状态切换会同步 done 与 payment，完成率变 3/4', () => {
  const target = state.policies.find((x) => x.type === '周五 · 番茄牛腩')
  togglePurchased(target)
  assert.equal(target.done, true)
  assert.equal(target.payment, '已采购')
  togglePurchased(target)
  assert.equal(target.done, false)
  assert.equal(target.payment, '未采购')
  togglePurchased(target) // 最终置为已采购
  assert.equal(metrics.value.find((x) => x.label === '采购完成率').value, '3/4')
})

ok('总览「添加菜谱」原能力未破坏：保存仍写入 documents，policies 不变', () => {
  const policyCount = state.policies.length
  openCreate()
  assert.equal(showForm.value, true)
  assert.equal(showMenuForm.value, false)
  draft.value.name = '测试新菜'
  save()
  assert.equal(state.documents.some((x) => x.name === '测试新菜'), true)
  assert.equal(state.policies.length, policyCount)
})

ok('数据已持久化到 localStorage', () => {
  const raw = JSON.parse(store.get('family-recipe-keeper-v1'))
  assert.equal(raw.policies.length, 4)
  assert.ok(raw.documents.some((x) => x.name === '测试新菜'))
})

// ---------- 2. SSR template rendering ----------
async function render(page) {
  ssrPage = page
  store.clear()
  store.set('family-recipe-keeper-v1', JSON.stringify(structuredClone(seed)))
  server.moduleGraph.invalidateAll()
  const mod = await server.ssrLoadModule('/src/App.vue')
  const app = createSSRApp(mod.default)
  return renderToString(app)
}

console.log('模板渲染验证（SSR 真实模板）：')

const overview = await render('overview')
ok('总览页：顶部按钮是「添加菜谱」', () => assert.match(overview, /添加菜谱/))
ok('总览页：采购完成率指标显示 1/2', () => assert.match(overview, /1\/2/))

const menuPage = await render('insurance')
ok('菜单页：顶部主按钮文案为「安排菜谱」', () => assert.match(menuPage, /安排菜谱/))
ok('菜单页：渲染两条演示菜（周一 番茄牛腩 / 周三 葱油拌面）', () => {
  assert.match(menuPage, /周一 · 番茄牛腩/)
  assert.match(menuPage, /周三 · 葱油拌面/)
})
ok('菜单页：日期只显示「周一/周三」，不再出现「周 周一」式前缀重复', () => {
  assert.doesNotMatch(menuPage, /周\s*周一/)
  assert.doesNotMatch(menuPage, /周\s*周三/)
})
ok('菜单页：已采购/未采购状态与切换按钮均渲染', () => {
  assert.match(menuPage, /已采购/)
  assert.match(menuPage, /未采购/)
  assert.match(menuPage, /标记已采购/)
})
ok('菜单页：采购清单与用餐场景正常展示', () => {
  assert.match(menuPage, /牛腩 500g \/ 番茄 2 个/)
  assert.match(menuPage, /家庭晚餐/)
})

await server.close()
console.log(`\n全部 ${passed} 项验证通过 ✅`)
process.exit(0)
