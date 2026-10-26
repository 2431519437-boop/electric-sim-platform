/**
 * smoke.mjs —— 后端自测（账号 + 多用户 + 数据库）
 * ------------------------------------------------------------
 * 用法：
 *   npm run server            # 另开终端启动服务
 *   node server/smoke.mjs     # 跑自测
 *
 * 注意：会注册随机用户名的测试账号，并在结束时清理该账号产生的数据
 *       （账号本身保留，SQLite 没有对外暴露删除接口，避免误删真实数据）。
 */

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3001'
const stamp = Date.now().toString(36)
const PASS = 'test123456'

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`)
  }
}

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text.slice(0, 120) }
  }
  return { status: res.status, data, headers: res.headers }
}

const seriesPayload = {
  boards: [
    {
      id: 'B1',
      holeGroups: [
        ['a1', 'a2', 'a3', 'a4', 'a5'],
        ['b1', 'b2', 'b3', 'b4', 'b5'],
        ['c1', 'c2', 'c3', 'c4', 'c5'],
      ],
    },
  ],
  placements: [
    { compId: 'VS1', pins: [{ name: '+', holeId: 'a1', boardId: 'B1' }, { name: '-', holeId: 'c1', boardId: 'B1' }] },
    { compId: 'R2', pins: [{ name: '1', holeId: 'a5', boardId: 'B1' }, { name: '2', holeId: 'b1', boardId: 'B1' }] },
    { compId: 'RP3', pins: [{ name: '1', holeId: 'b5', boardId: 'B1' }, { name: '2', holeId: 'c3', boardId: 'B1' }] },
  ],
  wires: [],
  components: [
    { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: '+' }, { name: '-' }] },
    { id: 'R2', type: 'RES', value: 200, pins: [{ name: '1' }, { name: '2' }] },
    { id: 'RP3', type: 'RHEO', value: 470, pins: [{ name: '1' }, { name: '2' }] },
  ],
  sourceCompId: 'VS1',
}

const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n

async function main() {
  console.log(`\n后端自测（账号 + 多用户） → ${BASE}\n`)

  let health
  try {
    health = await req('GET', '/api/health')
  } catch (e) {
    console.error(`  连不上服务：${e.message}\n  请先启动： npm run server\n`)
    process.exit(2)
  }

  console.log('[1] 服务与数据库')
  check('健康检查 200', health.status === 200, `HTTP ${health.status}`)
  check('版本与能力标记', health.data?.version?.startsWith('2.') && health.data?.auth === true, `v${health.data?.version}`)

  console.log('\n[2] 注册')
  const u1 = `t_${stamp}`
  const u2 = `s_${stamp}`
  const r1 = await req('POST', '/api/auth/register', { username: u1, password: PASS, displayName: '测试教师' })
  check('注册返回 201', r1.status === 201, `HTTP ${r1.status}`)
  check('返回 token', typeof r1.data?.token === 'string' && r1.data.token.length > 20)
  check('中文昵称正确', r1.data?.user?.displayName === '测试教师', r1.data?.user?.displayName)
  const teacherToken = r1.data?.token
  const isTeacher = r1.data?.user?.role === 'teacher'

  const r2 = await req('POST', '/api/auth/register', { username: u2, password: PASS, displayName: '学生甲' })
  check('第二个用户注册成功', r2.status === 201)
  check('第二个用户是学生', r2.data?.user?.role === 'student', r2.data?.user?.role)
  const studentToken = r2.data?.token

  // 第三个用户：用来验证数据隔离（不能看到别人的记录）
  const u3 = `o_${stamp}`
  const r3 = await req('POST', '/api/auth/register', { username: u3, password: PASS, displayName: '学生乙' })
  check('第三个用户注册成功', r3.status === 201)
  const otherToken = r3.data?.token

  const dup = await req('POST', '/api/auth/register', { username: u1, password: PASS })
  check('重复用户名被拒（409）', dup.status === 409, dup.data?.error)

  const weak = await req('POST', '/api/auth/register', { username: `w_${stamp}`, password: '123' })
  check('弱密码被拒（400）', weak.status === 400, weak.data?.error)

  const badName = await req('POST', '/api/auth/register', { username: 'a', password: PASS })
  check('非法用户名被拒', badName.status === 400, badName.data?.error)

  console.log('\n[3] 登录 / 会话')
  const login = await req('POST', '/api/auth/login', { username: u2, password: PASS })
  check('正确密码登录成功', login.status === 200 && !!login.data?.token)
  check('下发 HttpOnly Cookie', /esim_token=/.test(login.headers.get('set-cookie') || ''))

  const wrong = await req('POST', '/api/auth/login', { username: u2, password: 'nope123' })
  check('错误密码被拒（401）', wrong.status === 401, wrong.data?.error)

  const me = await req('GET', '/api/auth/me', null, studentToken)
  check('/api/auth/me 返回当前用户', me.data?.user?.username === u2)

  const anon = await req('GET', '/api/auth/me')
  check('未登录时 user 为 null', anon.data?.user === null)

  console.log('\n[4] 未授权访问')
  const noAuthRecords = await req('GET', '/api/records')
  check('未登录访问记录被拒（401）', noAuthRecords.status === 401, noAuthRecords.data?.error)

  const forbidden = await req('GET', '/api/admin/overview', null, studentToken)
  check('学生访问教师接口被拒（403）', forbidden.status === 403, forbidden.data?.error)

  console.log('\n[5] 电路分析（公开接口）')
  const an = await req('POST', '/api/analyze', seriesPayload)
  const a = an.data?.analysis
  check('无需登录即可分析', an.status === 200 && a?.solution?.ok === true)
  check('节点数 = 3', a?.nodeCount === 3)
  check('电流符合 I=U/(R1+R2)', Math.abs(a.readings.i - 6 / 670) < 1e-6, `${round(a.readings.i * 1000, 3)} mA`)
  check('分压符合理论', Math.abs(a.readings.u - (6 * 470) / 670) < 1e-6, `${round(a.readings.u, 3)} V`)
  check('标准串联判定通过', a?.wiring?.ok === true, a?.wiring?.message)

  console.log('\n[6] 多用户数据隔离')
  await req('DELETE', '/api/records', null, studentToken)
  const add1 = await req('POST', '/api/records', { record: { r2: 470, u: 4.209, i: 8.955 } }, studentToken)
  check('学生写入记录', add1.data?.ok === true && add1.data?.count === 1)
  const add2 = await req('POST', '/api/records', { record: { r2: 220, u: 3.143, i: 14.286 } }, studentToken)
  check('追加第二条', add2.data?.count === 2)

  const mine = await req('GET', '/api/records', null, studentToken)
  check('学生只看到自己的 2 条', mine.data?.records?.length === 2)
  check('记录里带 seq 排序字段', mine.data?.records?.[0]?.seq === 1)

  const other = await req('GET', '/api/records', null, otherToken)
  check('另一个学生看不到这些记录', Array.isArray(other.data?.records) && other.data.records.length === 0)

  console.log('\n[7] 报告')
  const rep = await req(
    'POST',
    '/api/reports',
    { report: { score: 95, stars: 3, grade: '优秀', circuitOk: true, wiringOk: true, records: mine.data.records } },
    studentToken
  )
  check('保存报告', rep.data?.ok === true && typeof rep.data?.id === 'number')

  const reps = await req('GET', '/api/reports', null, studentToken)
  check('读取报告', reps.data?.reports?.length === 1)
  check('报告中文正常', reps.data?.reports?.[0]?.grade === '优秀', reps.data?.reports?.[0]?.grade)
  check('报告 JSON 完整', reps.data?.reports?.[0]?.payload?.records?.length === 2)

  console.log('\n[8] 实验快照')
  const exp = await req('POST', '/api/experiments', { name: '串联分压实验', state: seriesPayload }, studentToken)
  check('保存实验快照', exp.data?.ok === true && typeof exp.data?.id === 'number')
  const expList = await req('GET', '/api/experiments', null, studentToken)
  check('实验列表含名称', expList.data?.experiments?.[0]?.name === '串联分压实验', expList.data?.experiments?.[0]?.name)
  const expGet = await req('GET', `/api/experiments/${exp.data.id}`, null, studentToken)
  check('快照内容可还原', expGet.data?.experiment?.state?.components?.length === 3)
  const expOther = await req('GET', `/api/experiments/${exp.data.id}`, null, otherToken)
  check('别人的快照取不到（404）', expOther.status === 404)

  console.log('\n[9] 教师视角')
  if (!isTeacher) {
    console.log('  ⋯ 跳过：本次注册的第一个账号不是教师（库里已有用户）')
    console.log('    想跑教师用例： npm run db:reset 后重跑，或用 npm run teacher 建教师账号')
  } else {
    const ov = await req('GET', '/api/admin/overview', null, teacherToken)
    check('教师可看总览', ov.status === 200 && ov.data?.stats?.users >= 3, `用户 ${ov.data?.stats?.users}`)
    check('总览里有最近报告', Array.isArray(ov.data?.recentReports) && ov.data.recentReports.length >= 1)
    check('最近报告带学生姓名', ov.data?.recentReports?.[0]?.username?.length > 0, ov.data?.recentReports?.[0]?.username)

    const users = await req('GET', '/api/admin/users', null, teacherToken)
    check('教师可列用户', Array.isArray(users.data?.users) && users.data.users.length >= 3)
  }

  console.log('\n[10] 登出')
  const out = await req('POST', '/api/auth/logout', null, studentToken)
  check('登出成功', out.data?.ok === true)
  const afterLogout = await req('GET', '/api/records', null, studentToken)
  check('登出后 token 失效（401）', afterLogout.status === 401, afterLogout.data?.error)

  console.log(`\n首个注册账号是否为教师：${isTeacher ? '是（引导规则生效）' : '否（库中已有教师）'}`)
  console.log(`\n结果：${passed} 项通过，${failed} 项失败\n`)
  process.exitCode = failed === 0 ? 0 : 1
  setTimeout(() => process.exit(process.exitCode), 150)
}

main().catch((e) => {
  console.error('\n自测异常：', e)
  process.exit(1)
})
