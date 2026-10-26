#!/usr/bin/env bash
# 备份 / 恢复 SQLite 数据库（在服务器 deploy 目录下使用）
#   bash backup.sh backup   → 生成 backup-日期.db
#   bash backup.sh restore backup-2026-01-01.db
set -euo pipefail
cd "$(dirname "$0")"

ACTION="${1:-backup}"
FILE="${2:-}"

case "$ACTION" in
  backup)
    OUT="backup-$(date +%F-%H%M).db"
    # SQLite 处于 WAL 模式，用 .backup 才能拿到一致快照
    docker exec esim-app node -e "
      const { DatabaseSync } = require('node:sqlite')
      const db = new DatabaseSync('/app/server/data/app.db')
      db.exec(\"VACUUM INTO '/tmp/backup.db'\")
      console.log('ok')
    " >/dev/null
    docker cp esim-app:/tmp/backup.db "./$OUT"
    echo "已备份到 ./$OUT （$(du -h "$OUT" | cut -f1)）"
    ;;
  restore)
    if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
      echo "用法： bash backup.sh restore <备份文件>"
      exit 1
    fi
    docker cp "$FILE" esim-app:/tmp/restore.db
    docker exec esim-app node -e "
      const fs = require('node:fs')
      fs.copyFileSync('/tmp/restore.db', '/app/server/data/app.db')
      for (const f of ['-wal','-shm']) {
        try { fs.unlinkSync('/app/server/data/app.db' + f) } catch {}
      }
      console.log('restored')
    "
    docker restart esim-app >/dev/null
    echo "已恢复 $FILE 并重启服务"
    ;;
  *)
    echo "用法： bash backup.sh [backup|restore <文件>]"
    exit 1
    ;;
esac
