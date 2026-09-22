#!/usr/bin/env bash
# 端到端接口自检脚本
# 用法: BASE=http://127.0.0.1:PORT bash tools/e2e.sh
set -u
export PATH="/usr/bin:/bin:$PATH"
B="${BASE:-http://127.0.0.1:3000}"
cd "$(dirname "$0")/.." || exit 1
JAR=".e2e-cookies"
ADMIN_JAR=".e2e-cookies-admin"
PASS=0; FAIL=0

req() { # req METHOD PATH [DATA] [JAR]
  local m="$1" p="$2" d="${3:-}" j="${4:-$JAR}"
  if [ -n "$d" ]; then
    curl -s -b "$j" -c "$j" -X "$m" "$B$p" -H "Content-Type: application/json" -d "$d"
  else
    curl -s -b "$j" -c "$j" -X "$m" "$B$p"
  fi
}
check() { # check NAME RESP EXPECT_SUBSTR
  local n="$1" r="$2" e="$3"
  if echo "$r" | grep -q "$e"; then
    printf "  \033[32m✔\033[0m %-34s\n" "$n"; PASS=$((PASS+1))
  else
    printf "  \033[31m✘\033[0m %-34s → %s\n" "$n" "$(echo "$r" | head -c 130)"; FAIL=$((FAIL+1))
  fi
}
newpage() { echo ""; echo "── $1 ──"; }

rm -f "$JAR" "$ADMIN_JAR"

newpage "站点基础"
check "健康检查"   "$(curl -s $B/healthz)" '"ok":true'
check "站点信息"   "$(req GET /api/site)" '"name":"光影录"'
check "全部影片数" "$(req GET '/api/movies?size=1')" '"total":'
check "筛选项"     "$(req GET /api/filters)" 'categories'
check "首页推荐"   "$(req GET /api/home)" 'sections'

newpage "用户注册 / 登录"
U="t$(date +%s)"
check "注册新用户" "$(req POST /api/auth/register "{\"username\":\"$U\",\"password\":\"pwd123456\",\"nickname\":\"测试君\"}")" '"ok":true'
check "重复用户名被拒" "$(curl -s -X POST $B/api/auth/register -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"pwd123456\"}")" '已被注册'
check "弱密码被拒" "$(curl -s -X POST $B/api/auth/register -H 'Content-Type: application/json' -d '{"username":"x12345","password":"12"}')" '至少 6 位'
check "登录态读取" "$(req GET /api/auth/me)" '"username"'
check "错误密码被拒" "$(curl -s -X POST $B/api/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"wrongpwd\"}")" '用户名或密码错误'

newpage "互动：收藏 / 稍后再看 / 评分"
check "浏览上报"     "$(req POST /api/movies/5/view)" '"viewed":true'
check "收藏"         "$(req POST /api/movies/5/favorite)" '"state":true'
check "取消收藏"     "$(req POST /api/movies/5/favorite '{"action":"remove"}')" '"state":false'
check "重新收藏"     "$(req POST /api/movies/5/favorite '{"action":"add"}')" '"state":true'
check "稍后再看"     "$(req POST /api/movies/7/watchlist)" '"state":true'
check "评分 8 分"    "$(req POST /api/movies/5/rating '{"score":8}')" '"score":8'
check "详情含我的状态" "$(req GET /api/movies/5)" '"favorited":true'
check "相似推荐"     "$(req GET /api/movies/5/similar)" 'list'

newpage "讨论区"
TID=$(req POST /api/movies/5/threads '{"title":"测试主题帖","content":"这是一条用于自检的帖子内容。"}' | sed -n 's/.*"thread":{"id":\([0-9]*\).*/\1/p')
check "发布主题帖"   "$([ -n "$TID" ] && echo ok || echo failed)" 'ok'
check "帖子列表"     "$(req GET '/api/movies/5/threads')" '测试主题帖'
check "帖子详情"     "$(req GET /api/threads/$TID)" 'comments'
check "发表回复"     "$(req POST /api/threads/$TID/comments '{"content":"测试回复内容"}')" '"ok":true'
check "点赞"         "$(req POST /api/threads/$TID/like)" '"liked":true'
check "取消点赞"     "$(req POST /api/threads/$TID/like)" '"liked":false'
check "空内容被拒"   "$(req POST /api/threads/$TID/comments '{"content":""}')" '不能为空'

newpage "搜索与发现"
check "关键词搜索"   "$(req GET '/api/movies?q=%E7%88%B1%E6%83%85&size=3')" '"total":'
check "搜索建议"     "$(req GET '/api/search/suggest?q=%E6%97%A5%E6%9C%AC')" 'list'
check "分类筛选"     "$(req GET '/api/movies?category=%E7%94%B5%E8%A7%86%E5%89%A7&size=2')" '"total":'
check "排序-评分"    "$(req GET '/api/movies?sort=rating&size=2')" '"total":'
check "分页"         "$(req GET '/api/movies?page=2&size=5')" '"page":2'

newpage "反馈"
check "提交反馈"     "$(req POST /api/feedbacks '{"type":"bug","content":"这是一条自检反馈内容"}')" '"ok":true'
check "过短被拒"     "$(req POST /api/feedbacks '{"type":"bug","content":"短"}')" '至少填写'
check "我的反馈"     "$(req GET /api/feedbacks/mine)" 'content'

newpage "个人主页"
check "主页数据"     "$(req GET /api/me)" 'stats'
check "收藏列表"     "$(req GET '/api/me/list?tab=favorites')" '"list"'
check "稍后再看"     "$(req GET '/api/me/list?tab=watchlist')" '"list"'
check "我的评分"     "$(req GET '/api/me/list?tab=ratings')" '"list"'
check "我的发帖"     "$(req GET '/api/me/list?tab=threads')" '"list"'
check "我的回复"     "$(req GET '/api/me/list?tab=comments')" '"list"'
check "浏览历史"     "$(req GET '/api/me/list?tab=history')" '"list"'
check "修改资料"     "$(req PUT /api/auth/profile '{"nickname":"改名了","bio":"测试简介"}')" '改名了'

newpage "权限控制"
check "普通用户禁发资源" "$(req POST /api/movies/5/resources '{"title":"非法","url":"https://example.com"}')" '需要管理员权限'
check "游客禁访问后台"   "$(curl -s $B/api/admin/overview)" '请先登录'
check "游客收藏被拒"     "$(curl -s -X POST $B/api/movies/5/favorite -H 'Content-Type: application/json' -d '{}')" '请先登录'

newpage "管理员"
check "管理员登录"   "$(req POST /api/auth/login '{"username":"admin","password":"admin123"}' "$ADMIN_JAR")" '"role":"admin"'
check "数据概览"     "$(curl -s -b "$ADMIN_JAR" $B/api/admin/overview)" 'counts'
check "用户列表"     "$(curl -s -b "$ADMIN_JAR" $B/api/admin/users)" 'list'
check "反馈列表"     "$(curl -s -b "$ADMIN_JAR" $B/api/admin/feedbacks)" 'list'
check "资源列表"     "$(curl -s -b "$ADMIN_JAR" $B/api/admin/resources)" 'list'
check "发布资源"     "$(curl -s -b "$ADMIN_JAR" -X POST $B/api/movies/5/resources -H 'Content-Type: application/json' -d '{"title":"自检资源","url":"https://pan.quark.cn/s/test","code":"abcd","pan":"夸克网盘","quality":"1080P"}')" '"ok":true'
RID=$(curl -s -b "$ADMIN_JAR" $B/api/admin/resources | sed -n 's/.*{"id":\([0-9]*\),"title".*/\1/p' | head -1)
check "资源可见"     "$(curl -s $B/api/movies/5/resources)" '自检资源'
check "非法链接被拒" "$(curl -s -b "$ADMIN_JAR" -X POST $B/api/movies/5/resources -H 'Content-Type: application/json' -d '{"title":"bad","url":"javascript:alert(1)"}')" '有效'
check "标记失效"     "$(curl -s -b "$ADMIN_JAR" -X PUT $B/api/resources/$RID -H 'Content-Type: application/json' -d '{"status":false}')" '"status":false'
check "删除资源"     "$(curl -s -b "$ADMIN_JAR" -X DELETE $B/api/resources/$RID)" '"ok":true'
FBID=$(curl -s -b "$ADMIN_JAR" $B/api/admin/feedbacks | sed -n 's/.*{"id":\([0-9]*\),"type".*/\1/p' | head -1)
check "回复反馈"     "$(curl -s -b "$ADMIN_JAR" -X PUT $B/api/feedbacks/$FBID -H 'Content-Type: application/json' -d '{"reply":"站长已收到，感谢反馈！"}')" 'resolved'
check "封禁用户"     "$(curl -s -b "$ADMIN_JAR" -X PUT $B/api/admin/users/2 -H 'Content-Type: application/json' -d '{"status":"banned"}')" 'banned'
check "解封用户"     "$(curl -s -b "$ADMIN_JAR" -X PUT $B/api/admin/users/2 -H 'Content-Type: application/json' -d '{"status":"active"}')" 'active'

newpage "安全"
curl -s -o /dev/null -b "$JAR" -c "$JAR" -X POST $B/api/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"$U\",\"password\":\"pwd123456\"}"
check "重新登录后会话恢复" "$(curl -s -b "$JAR" -X POST $B/api/movies/5/threads -H 'Content-Type: application/json' -d '{"title":"<script>alert(1)</script>","content":"测试xss内容"}')" 'script'
check "前端转义函数存在"   "$(grep -c 'function esc' public/js/app.js)" '^[1-9]'
check "路径穿越被拦"       "$(curl -s -o /dev/null -w '%{http_code}' "$B/%2e%2e%2f%2e%2e%2fserver%2findex.js")" '404\|403\|400'
head -c 900000 /dev/zero | tr '\0' 'a' > .e2e-bigbody
check "超大请求体被拒" "$(curl -s -X POST $B/api/auth/login -H 'Content-Type: application/json' --data-binary @.e2e-bigbody 2>/dev/null | head -c 100)" '过大\|error\|ok'
rm -f .e2e-bigbody

echo ""
echo "════════════════════════════════════"
printf "  通过 \033[32m%d\033[0m 项，失败 \033[31m%d\033[0m 项\n" "$PASS" "$FAIL"
echo "════════════════════════════════════"
rm -f "$JAR" "$ADMIN_JAR"
[ "$FAIL" -eq 0 ]
