#!/usr/bin/env bash
# =========================================================
#  影视推荐站点 - 服务器环境自动初始化脚本
#  支持：Amazon Linux 2023 / Ubuntu 22.04 / Ubuntu 24.04
#
#  用法（以 root 执行）：
#    sudo bash deploy/setup.sh [项目源码目录]
#
#  说明：本站零第三方依赖，不需要 npm install。
# =========================================================
set -euo pipefail

APP_USER="cine"
APP_GROUP="cine"
APP_DIR="/opt/movie-site"
SRC_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

log()  { printf '\n\033[36m▶ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "请使用 root 权限运行：sudo bash deploy/setup.sh"

# ---------- 识别系统 ----------
if [[ -f /etc/os-release ]]; then . /etc/os-release; else die "无法识别操作系统"; fi
case "${ID:-}" in
  amzn|fedora|centos|rhel) PKG=dnf ;;
  ubuntu|debian)           PKG=apt ;;
  *) die "暂不支持的系统：$ID，请手动按 deploy/DEPLOY.md 操作" ;;
esac
info "检测到系统：$PRETTY_NAME（包管理器：$PKG）"

# ---------- 1. 系统更新 ----------
log "更新系统并安装基础工具"
if [[ "$PKG" == "dnf" ]]; then
  dnf update -y
  dnf install -y curl git tar gzip sqlite rsync policycoreutils
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get upgrade -y
  apt-get install -y curl git tar gzip sqlite3 rsync ca-certificates gnupg
fi

# ---------- 2. 创建运行账号与目录 ----------
log "创建运行账号 $APP_USER 与部署目录 $APP_DIR"
if ! id "$APP_USER" &>/dev/null; then
  groupadd --system "$APP_GROUP"
  useradd --system --gid "$APP_GROUP" --home-dir "$APP_DIR" \
          --shell /sbin/nologin --comment "Cine Site Runner" "$APP_USER"
fi
mkdir -p "$APP_DIR" "$APP_DIR/data" /var/www/html
[[ -d "$SRC_DIR" ]] || die "源码目录不存在：$SRC_DIR"

# ---------- 3. 安装 Node.js 22 LTS ----------
if command -v node &>/dev/null && [[ "$(node -v | cut -d. -f1 | tr -d v)" -ge 22 ]]; then
  info "Node 已安装：$(node -v)"
else
  log "安装 Node.js 22 LTS"
  if [[ "$PKG" == "dnf" ]]; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    dnf install -y nodejs
  else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
fi
node -v || die "Node 安装失败"
# node:sqlite 需要 >= 22.5
NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
NODE_MINOR="$(node -v | sed 's/^v//' | cut -d. -f2)"
[[ "$NODE_MAJOR" -gt 22 || ("$NODE_MAJOR" -eq 22 && "$NODE_MINOR" -ge 5) ]] \
  || die "需要 Node >= 22.5（当前 $(node -v)），无法使用内置 SQLite"

# ---------- 4. 安装 Nginx ----------
if command -v nginx &>/dev/null; then
  info "Nginx 已安装：$(nginx -v 2>&1)"
else
  log "安装 Nginx"
  if [[ "$PKG" == "dnf" ]]; then dnf install -y nginx; else apt-get install -y nginx; fi
fi

# ---------- 5. 部署代码 ----------
log "部署代码到 $APP_DIR（保留已有线上数据）"
rsync -a --delete \
  --exclude 'data/app.db' --exclude 'data/app.db-wal' --exclude 'data/app.db-shm' \
  --exclude '.e2e-cookies*' --exclude 'node_modules' --exclude '.git' \
  "$SRC_DIR/" "$APP_DIR/"

# ---------- 6. 写入环境文件 / 服务单元 / Nginx 配置 ----------
log "写入运行环境配置"
[[ -f "$APP_DIR/deploy/movie-site.env" ]] || die "缺少 deploy/movie-site.env"

# 生成随机管理员密码（仅首次部署）
if grep -q 'ADMIN_PASS=ChangeMe_2026' "$APP_DIR/deploy/movie-site.env" 2>/dev/null; then
  NEWPW="Cine@$(head -c 6 /dev/urandom | base64 | tr -d '/+=' | tr -d '\n')"
  sed -i "s|^ADMIN_PASS=.*|ADMIN_PASS=${NEWPW}|" "$APP_DIR/deploy/movie-site.env"
  info "已生成随机管理员密码：${NEWPW}（同时记录在 $APP_DIR/deploy/movie-site.env）"
fi

log "安装 systemd 服务"
install -m 0644 "$APP_DIR/deploy/movie-site.service" /etc/systemd/system/movie-site.service
systemctl daemon-reload

echo
read -r -p "  是否已准备好域名？（有域名输入域名，没有则直接回车使用 IP 访问）: " DOMAIN
if [[ -n "${DOMAIN:-}" ]]; then
  sed -e "s/your\.domain\.com/${DOMAIN}/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/conf.d/movie-site.conf
  info "已写入 Nginx HTTPS 配置（待签发证书后生效）"
else
  cp "$APP_DIR/deploy/nginx.bootstrap.conf" /etc/nginx/conf.d/movie-site.conf
  sed -i 's/^# Certbot HTTP-01/# Certbot HTTP-01/' /etc/nginx/conf.d/movie-site.conf
  info "已写入 Nginx HTTP 引导配置"
fi

# ---------- 7. 权限 ----------
log "修正目录权限"
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
chmod 0755 "$APP_DIR" "$APP_DIR/data"
chmod 0640 "$APP_DIR/deploy/movie-site.env"
chown root:"$APP_GROUP" "$APP_DIR/deploy/movie-site.env"

# ---------- 8. 防火墙 ----------
log "配置防火墙：放行 80 / 443"
if command -v systemctl &>/dev/null && systemctl list-unit-files firewalld.service &>/dev/null; then
  systemctl enable --now firewalld
  firewall-cmd --permanent --add-service=http
  firewall-cmd --permanent --add-service=https
  firewall-cmd --reload
  info "firewalld 已放行 HTTP/HTTPS（SSH 已在默认策略中）"
elif command -v ufw &>/dev/null; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  echo "y" | ufw enable || true
  info "ufw 已放行 SSH/HTTP/HTTPS"
else
  info "未检测到 firewalld/ufw，请确认 EC2 安全组已放行 80/443"
fi

# ---------- 9. 首次数据导入并启动 ----------
log "初始化数据库并启动服务"
sudo -u "$APP_USER" DATA_DIR="$APP_DIR/data" PORT=3000 HOST=127.0.0.1 \
  timeout 20 node "$APP_DIR/server/index.js" > /tmp/movie-site-init.log 2>&1 &
INIT_PID=$!
sleep 6
kill "$INIT_PID" 2>/dev/null || true
wait "$INIT_PID" 2>/dev/null || true
grep -Ev 'ExperimentalWarning|trace-warnings' /tmp/movie-site-init.log | tail -5 || true

systemctl enable --now movie-site
sleep 2

if systemctl is-active --quiet movie-site; then
  info "服务已启动 ✓"
else
  die "服务启动失败，请查看：journalctl -u movie-site -n 50"
fi
curl -fsS http://127.0.0.1:3000/healthz && echo

# ---------- 10. Nginx 生效 ----------
log "校验并重载 Nginx"
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# SELinux（Amazon Linux 2023）放行本机反向代理
if command -v setsebool &>/dev/null && command -v getenforce &>/dev/null; then
  if [[ "$(getenforce)" == "Enforcing" ]]; then
    setsebool -P httpd_can_network_connect 1 || true
    info "已开启 SELinux httpd_can_network_connect"
  fi
fi

cat <<EOF

══════════════════════════════════════════════════
  部署完成 ✓
──────────────────────────────────────────────────
  应用目录   $APP_DIR
  运行账号   $APP_USER
  监听端口   127.0.0.1:3000（对外由 Nginx 80/443 代理）
  数据库     $APP_DIR/data/app.db
  管理员     $(grep ADMIN_USER "$APP_DIR/deploy/movie-site.env" | cut -d= -f2)
             $(grep ADMIN_PASS "$APP_DIR/deploy/movie-site.env" | cut -d= -f2)

  下一步：
   1) 浏览器打开 http://$(hostname -I 2>/dev/null | awk '{print $1}') 验证
   2) 若有域名：把域名 A 记录解析到本机公网 IP，然后执行
        certbot --nginx -d 你的域名
      证书签发后：
        cp $APP_DIR/deploy/nginx.conf /etc/nginx/conf.d/movie-site.conf
        sed -i 's/your\\.domain\\.com/你的域名/g' /etc/nginx/conf.d/movie-site.conf
        nginx -t && systemctl reload nginx
   3) 登录后立刻在「管理后台」或命令行修改管理员密码
   4) 配置定时备份：
        cp $APP_DIR/deploy/backup.sh /opt/backup-movie-site.sh
        chmod +x /opt/backup-movie-site.sh
        echo "0 4 * * * /opt/backup-movie-site.sh" | crontab -
══════════════════════════════════════════════════
EOF
