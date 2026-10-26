/**
 * create-teacher.mjs —— 命令行创建教师账号
 * ------------------------------------------------------------
 * 用法：
 *   node server/create-teacher.mjs <用户名> <密码> [显示名]
 *   npm run teacher -- wanglaoshi 123456 王老师
 *
 * 说明：注册接口只会建学生账号（防止有人自己注册成教师）。
 *       教师账号通过这个脚本在服务器本地创建。
 */

import { register, validatePassword, validateUsername } from './auth.js'
import { findUserByName } from './db.js'

const [, , username, password, displayName] = process.argv

if (!username || !password) {
  console.log('用法： node server/create-teacher.mjs <用户名> <密码> [显示名]')
  process.exit(1)
}

const eu = validateUsername(username)
const ep = validatePassword(password)
if (eu || ep) {
  console.error(`参数不合法：${eu || ep}`)
  process.exit(1)
}

if (findUserByName(username.trim())) {
  console.error(`用户 ${username} 已存在`)
  process.exit(1)
}

const user = register({
  username,
  password,
  displayName: displayName || username,
  role: 'teacher',
})

console.log('已创建教师账号：')
console.log(`  id       ${user.id}`)
console.log(`  用户名   ${user.username}`)
console.log(`  显示名   ${user.displayName}`)
console.log(`  角色     ${user.role}`)
