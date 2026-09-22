#!/usr/bin/env bash
# =========================================================
#  SQLite 数据库备份脚本
#  建议加入 crontab 每天执行一次：
#    0 4 * * * /opt/backup-movie-site.sh
# =========================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/movie-site}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/cine}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB_FILE="$APP_DIR/data/app.db"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
[[ -f "$DB_FILE" ]] || { echo "数据库不存在：$DB_FILE"; exit 1; }

# node:sqlite 的 backup() 会生成一致性快照，比直接 cp 更安全
node --no-warnings -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('$DB_FILE');
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.backup('$BACKUP_DIR/app-$STAMP.db');
db.close();
"

tar -czf "$BACKUP_DIR/app-$STAMP.db.tar.gz" -C "$BACKUP_DIR" "app-$STAMP.db" \
  && rm -f "$BACKUP_DIR/app-$STAMP.db"

find "$BACKUP_DIR" -name 'app-*.db.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "[$(date '+%F %T')] 备份完成：$BACKUP_DIR/app-$STAMP.db.tar.gz"
ls -lh "$BACKUP_DIR" | tail -5
