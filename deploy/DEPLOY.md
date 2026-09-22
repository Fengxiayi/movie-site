# 影视推荐站点 · AWS EC2 部署上线完整指南

本文把一台闲置的 **AWS EC2 免费套餐实例**，从零配置到站点 HTTPS 上线，每一步都给出可直接复制执行的命令。
适用系统：**Amazon Linux 2023** 或 **Ubuntu Server 22.04 / 24.04**（两条命令分叉处均已标注）。

---

## 0. 部署后的最终架构

```
                      ┌─────────────────────────── AWS EC2 ──────────────────────────┐
  用户浏览器 ──HTTPS──▶ │ Nginx (80/443)  ──反代──▶  Node 服务 (127.0.0.1:3000)      │
                      │   · TLS 终结               · 零第三方依赖                    │
                      │   · 静态资源直出           · HTTP API (/api/*)               │
                      │   · gzip / 缓存头          · SQLite (data/app.db)            │
                      └─────────────────────────────────────────────────────────────┘
                                                    ↑ systemd 守护：movie-site.service
```

关键点：

- Node 进程**只监听 127.0.0.1:3000**，公网无法直连 3000 端口，一切流量经过 Nginx。
- 数据落在单个 SQLite 文件 `data/app.db`，备份就是备份一个文件。
- 应用**没有任何 npm 依赖**（使用 Node 22 内置的 `node:sqlite` 与 `node:http`），服务器上不需要 `npm install`，大幅降低部署失败率。

---

## 1. AWS 控制台侧配置

### 1.1 实例规格

| 项目 | 推荐值 | 说明 |
|---|---|---|
| AMI | Amazon Linux 2023 或 Ubuntu Server 22.04 LTS | 两者脚本均支持 |
| 实例类型 | `t2.micro` / `t3.micro` | 1 vCPU / 1GB 内存，本站足够（常驻内存约 60–100MB） |
| 存储 | 20–30 GB gp3 | 免费套餐通常含 30GB EBS |
| 密钥对 | 新建并**下载 .pem** | 丢失后无法再 SSH 登录 |

> **免费额度提醒**：AWS Free Tier 通常在账号首年提供每月 750 小时的 `t2.micro`/`t3.micro` 实例时长和一定额度的 EBS、公网出流量。请以控制台 **Billing → Free Tier** 页面显示的实时额度为准。**务必设置账单告警**（见 §9.4），避免超出额度产生费用。

### 1.2 安全组（最关键的一步）

创建名为 `movie-site-sg` 的安全组，入站规则按下表配置：

| 类型 | 端口 | 来源 | 用途 | 是否必须 |
|---|---|---|---|---|
| SSH | 22 | **仅你的公网 IP**（`你的IP/32`） | 远程管理 | 必须 |
| HTTP | 80 | `0.0.0.0/0` 与 `::/0` | 站点访问 + Let's Encrypt 验证 | 必须 |
| HTTPS | 443 | `0.0.0.0/0` 与 `::/0` | 加密访问 | 必须（启用 HTTPS 后） |
| 自定义 TCP | 3000 | **不要添加** | Node 服务仅本机可达 | ❌ 禁止 |

出站规则保持默认 **允许全部**（需要 yum/apt 下载软件）。

> ⚠️ 不要把 SSH(22) 开放给 `0.0.0.0/0`，免费机常年被全网扫描爆破。若你的家庭宽带 IP 会变，可在需要时在控制台临时改安全组，或改用 AWS Systems Manager Session Manager 登录（无需开 22 端口）。

### 1.3 弹性 IP（建议）

实例重启后公网 IP 会变。到 **EC2 → Elastic IPs → Allocate → Associate**，绑定一个弹性 IP 到本实例（实例运行时免费）。
绑定后把你的域名 A 记录指向这个 IP。

### 1.4 登录服务器

本机（Windows PowerShell / macOS Terminal）：

```bash
# 修正私钥权限（仅首次）
chmod 400 ~/Downloads/your-key.pem

# 连接（Amazon Linux 默认用户名 ec2-user；Ubuntu 为 ubuntu）
ssh -i ~/Downloads/your-key.pem ec2-user@你的弹性IP
```

也可以直接用 EC2 控制台的 **Session Manager / EC2 Instance Connect** 网页终端登录。

---

## 2. 服务器系统初始化

登录成功后执行（`#` 表示在服务器上运行）：

```bash
# 切到 root
sudo -i

# 主机名与时区
hostnamectl set-hostname cine-site
timedatectl set-timezone Asia/Shanghai
timedatectl set-ntp true
```

**Amazon Linux 2023：**

```bash
dnf update -y
dnf install -y curl git tar gzip sqlite rsync policycoreutils
```

**Ubuntu 22.04 / 24.04：**

```bash
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git tar gzip sqlite3 rsync ca-certificates gnupg
```

**1GB 内存机器建议加一点 swap**（防止峰值时被 OOM 杀掉）：

```bash
fallocate -l 1G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.d/99-custom.conf
```

**开启自动安全更新：**

```bash
# Amazon Linux
dnf install -y dnf-automatic && systemctl enable --now dnf-automatic-install.timer
# Ubuntu
apt-get install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
```

---

## 3. 运行环境安装

### 3.1 Node.js 22 LTS

> 必须使用 **≥ 22.5**，因为 `node:sqlite` 内置模块是这个版本引入的。

```bash
# Amazon Linux 2023
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf install -y nodejs

# Ubuntu 22.04 / 24.04
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 验证
node -v     # 需 >= v22.5.0
```

### 3.2 Nginx

```bash
# Amazon Linux
dnf install -y nginx
# Ubuntu
apt-get install -y nginx
```

### 3.3 Certbot（免费 HTTPS 证书）

```bash
# Amazon Linux 2023（官方脚本）
dnf install -y python3-pip augeas-libs
python3 -m pip install --upgrade pip
python3 -m pip install certbot certbot-nginx

# Ubuntu
apt-get install -y certbot python3-certbot-nginx
```

### 3.4 创建运行账号与目录

不要用 root 跑 Web 服务：

```bash
groupadd --system cine
useradd --system --gid cine --home-dir /opt/movie-site \
        --shell /sbin/nologin --comment "Cine Site Runner" cine
mkdir -p /opt/movie-site/data /var/www/html
```

---

## 4. 上传代码并部署应用

### 4.1 方式 A：从本机打包上传（推荐首次部署）

在本机（`movie-site/` 目录的**上一级**）执行：

```bash
# Windows PowerShell 示例
tar -a -c -f movie-site.zip movie-site --exclude=movie-site/data/app.db*

scp -i 你的密钥.pem movie-site.zip ec2-user@你的IP:/tmp/
```

服务器上：

```bash
sudo -i
dnf install -y unzip tar -y || true
cd /tmp && tar -xf movie-site.zip
rsync -a --delete /tmp/movie-site/ /opt/movie-site/ \
  --exclude 'data/app.db' --exclude 'data/app.db-wal' --exclude 'data/app.db-shm'
```

### 4.2 方式 B：Git 拉取（后续迭代推荐）

把项目推到 GitHub/GitLab 私有仓库，服务器上 `git clone` 到 `/opt/movie-site`，之后更新只需 `git pull`。

### 4.3 方式 C：一键脚本（把 3–4 步自动化）

```bash
cd /tmp/movie-site        # 或你的源码目录
sudo bash deploy/setup.sh /tmp/movie-site
```

脚本会自动完成：装包 → 建账号 → 装 Node/Nginx → 拷贝代码 → 写 systemd / Nginx 配置 → 配防火墙 → 导入数据并启动。

### 4.4 手动安装（不跑脚本时必须执行）

```bash
# 环境配置文件已在 /opt/movie-site/deploy/movie-site.env，收紧权限并确保 owner 正确
chown root:cine /opt/movie-site/deploy/movie-site.env
chmod 0640 /opt/movie-site/deploy/movie-site.env

# 务必改成强密码（首次启动会自动创建这个管理员）
sed -i 's|^ADMIN_PASS=.*|ADMIN_PASS=改成你的强密码|' /opt/movie-site/deploy/movie-site.env

# systemd 单元
install -m 0644 /opt/movie-site/deploy/movie-site.service /etc/systemd/system/movie-site.service
systemctl daemon-reload
systemctl enable --now movie-site

# 权限
chown -R cine:cine /opt/movie-site
chmod 0755 /opt/movie-site /opt/movie-site/data
```

### 4.5 首次数据导入

应用首次启动会自动把 `data/movies.json`（130 条观影记录）导入 SQLite 并创建管理员：

```bash
systemctl restart movie-site
sleep 2
journalctl -u movie-site -n 20 --no-pager
# 应看到：[db] 已导入影视数据 130 条 / [sys] 已创建管理员账号

curl -s http://127.0.0.1:3000/healthz
# {"ok":true,"uptime":...,"movies":130}
```

---

## 5. Nginx 反向代理上线

### 5.1 先用 HTTP 引导配置验证连通

```bash
cp /opt/movie-site/deploy/nginx.bootstrap.conf /etc/nginx/conf.d/movie-site.conf
rm -f /etc/nginx/conf.d/default.conf       # Ubuntu 需要，移除默认站点
nginx -t                                    # 必须出现 syntax is ok
systemctl enable --now nginx
systemctl reload nginx
```

浏览器访问 `http://你的弹性IP` 应能看到站点首页。

> **Amazon Linux 2023 若 SELinux 处于 Enforcing**，还需放行本机转发：
> `setsebool -P httpd_can_network_connect 1`
> 若 Nginx 报 502，执行 `getenforce` 确认并用 `audit2allow` 排错。

### 5.2 域名解析（有域名的话）

在你的 DNS 服务商添加一条记录：

| 类型 | 名称 | 值 |
|---|---|---|
| A | `cine`（或 `@`） | 你的弹性 IP |

等待生效：`dig +short 你的域名` 应返回弹性 IP。

### 5.3 签发免费 HTTPS 证书

```bash
certbot --nginx -d 你的域名 \
  --non-interactive --agree-tos -m 你的邮箱@example.com --redirect
```

Certbot 会自动修改 Nginx 配置并写入自动续期任务。验证自动续期：

```bash
systemctl status certbot.timer         # Ubuntu 22.04+
certbot renew --dry-run                # 试跑一次续期
```

### 5.4 切换为完整 HTTPS 配置（推荐）

Certbot 改写的配置通常够用，但如果你想用本项目调优过的版本（含 HSTS、OCSP Stapling、静态资源长缓存、gzip）：

```bash
cp /opt/movie-site/deploy/nginx.conf /etc/nginx/conf.d/movie-site.conf
sed -i 's/your\.domain\.com/你的域名/g' /etc/nginx/conf.d/movie-site.conf
nginx -t && systemctl reload nginx
```

此时确认 `/opt/movie-site/deploy/movie-site.env` 里 `COOKIE_SECURE=1` 已启用，然后：

```bash
systemctl restart movie-site
```

---

## 6. 放通 HTTP/HTTPS（再次确认）

云上有**两层**防火墙，都要开：

1. **AWS 安全组**（§1.2）——不开则数据包根本到不了机器。
2. **系统防火墙**：

```bash
# Amazon Linux（firewalld）
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
firewall-cmd --list-services        # 应含 ssh http https

# Ubuntu（ufw）
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable && ufw status
```

---

## 7. 备份与恢复

一键脚本已经提示过，手动执行：

```bash
install -m 0755 /opt/movie-site/deploy/backup.sh /opt/backup-movie-site.sh
echo 'APP_DIR=/opt/movie-site'  > /etc/backup-movie-site.conf
echo 'BACKUP_DIR=/opt/backups/cine' >> /etc/backup-movie-site.conf
echo 'KEEP_DAYS=14' >> /etc/backup-movie-site.conf

# 每天凌晨 4 点备份
echo "0 4 * * * . /etc/backup-movie-site.conf && /opt/backup-movie-site.sh >> /var/log/cine-backup.log 2>&1" | crontab -
/opt/backup-movie-site.sh       # 立即验证一次
```

脚本用 SQLite 官方 backup API 生成一致性快照，并自动清理 14 天前的归档。

**异地备份**：把 `/opt/backups/cine/*.tar.gz` 同步到 S3 更安全（免费套餐含 5GB 标准存储）：

```bash
aws s3 sync /opt/backups/cine s3://你的桶名/cine-backup/
```

**恢复**：

```bash
systemctl stop movie-site
tar -xzf /opt/backups/cine/app-20260922-040000.db.tar.gz -C /tmp
cp /tmp/app-20260922-040000.db /opt/movie-site/data/app.db
chown cine:cine /opt/movie-site/data/app.db
rm -f /opt/movie-site/data/app.db-wal /opt/movie-site/data/app.db-shm
systemctl start movie-site
```

---

## 8. 运维速查

```bash
# 服务状态 / 重启 / 停止
systemctl status  movie-site
systemctl restart movie-site
systemctl stop    movie-site

# 实时日志（Ctrl+C 退出）
journalctl -u movie-site -f

# 最近 100 行日志
journalctl -u movie-site -n 100 --no-pager

# Nginx 日志
tail -f /var/log/nginx/movie-site.access.log
tail -f /var/log/nginx/movie-site.error.log

# 健康检查
curl -s localhost:3000/healthz

# 资源占用（1GB 机器建议关注）
free -h && systemctl show movie-site -p MemoryCurrent

# 代码更新（Git 方式）
cd /opt/movie-site && git pull
chown -R cine:cine /opt/movie-site && chmod -R go-w /opt/movie-site
systemctl restart movie-site
```

### 常见故障排查

| 现象 | 排查 |
|---|---|
| 打不开、超时 | 先看安全组 80/443 是否放行（最常见）；再 `systemctl status nginx` |
| 502 Bad Gateway | Node 没起来：`journalctl -u movie-site -n 50`；确认端口 3000 未被占用 |
| 502 且集中在 Amazon Linux | SELinux 拦截：`setsebool -P httpd_can_network_connect 1` |
| 启动即退出 | 检查 `deploy/movie-site.env` 路径与权限；确认 `NODE_ENV` 未被设为其他值 |
| `Please install/upgrade Node >= 22.5` | apt/dnf 源里装成了 Node 18，重装 Node 22（见 §3.1） |
| 站点显示但没有 130 条数据 | 删掉 `data/app.db*` 后重启，让它重新从 `movies.json` 导入 |
| 502 但本机 `curl localhost:3000/healthz` 正常 | Nginx 的 `proxy_pass` 端口与 Node 实际监听端口不一致，或 SELinux 拦截 |

---

## 9. 上线后必做的安全项

1. **改掉默认管理员密码**：用初始管理员登录后，立刻在系统里创建新管理员，或直接改 `deploy/movie-site.env` 里的 `ADMIN_PASS` 然后 `systemctl restart movie-site`（只在库里没有该用户时生效）。
2. **SSH 加固**：禁用密码登录 + 只允许密钥。
   ```bash
   sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
   sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
   systemctl restart sshd
   ```
3. **安装 fail2ban** 防 SSH 爆破：
   ```bash
   dnf install -y fail2ban || apt-get install -y fail2ban
   systemctl enable --now fail2ban
   ```
4. **设置账单告警**：AWS CloudWatch → Billing → Create alarm，在预计费用超过阈值（如 $1）时发邮件；同时到 **Billing → Budgets** 创建预算。
5. **定期检查**：`dnf update -y` / `apt upgrade -y`；每周看一次 `journalctl -u movie-site` 有无异常报错。
6. **不要在仓库里提交** `deploy/movie-site.env`（含管理员密码）和 `data/app.db`。

---

## 10. 成本与控制

- 实例：免费额度内 1 台 t2.micro/t3.micro，长期运行约 730 小时/月，正好落在 750 小时额度内。
- 弹性 IP：**实例运行时**免费，停止实例会收取少量闲置费。
- EBS：20–30GB gp3 在免费额度内。
- 出流量：免费额度有限，站点图片资源走浏览器本地缓存 + Nginx gzip，130 部作品的文本数据量很小，正常访问量远不会触发费用。
- 如果不确定，随时在 **Cost Explorer** 里确认当前账单，或不用时 Stop 实例。
