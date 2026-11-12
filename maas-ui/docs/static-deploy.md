# TokenStation B 端 · 纯静态部署手册

> 适用：当前分支的 B 端产物（门户固定为 `b`：平台超管 / 团队管理者 / 团队普通用户）。
> 产物：一份纯静态文件（`out/`），由 nginx 直接托管，**运行时不依赖 Node**。
> 后端地址在**构建时**固化进产物，部署动作就是「把新包放上去」。

---

## 1. 架构

```
浏览器 ──静态资源──> nginx (station.centlt.com)
   └─────API (CORS)──> hub.centlt.com
```

- 没有 BFF、没有 Node 进程、没有 `/api/backend` 转发。
- 后端必须放行本站 Origin 的 CORS（见第 8 节）。
- 前端只保存 token（localStorage），不使用 Cookie。
- B 端门户在构建期固定为 `b`，不会出现 C 端的短信注册、散客计费等入口。

---

## 2. 构建

要求：Node ≥ 20.9（推荐 22 LTS）、npm。

后端地址写在仓库根目录的 `.env.production` 里（随分支提交），`next build` 会自动加载，命令行不用再传：

```bash
npm ci
npm run build
# 产物：out/
```

| 变量 | 位置 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_TOKENHUB_API_BASE_URL` | `.env.production` | 后端地址，带 `https://`，不能带路径。**改地址必须重新构建** |
| `NEXT_PUBLIC_TOKENHUB_CAPTCHA_ID` | `.env.production` | B 端不使用，留空 |

加载优先级（Next.js 规则）：`.env.production.local` > `.env.local` > `.env.production` > `.env`。
所以**临时构建测试环境不要改 `.env.production`**，用被 git 忽略的 `.env.production.local` 覆盖：

```bash
echo 'NEXT_PUBLIC_TOKENHUB_API_BASE_URL=http://47.103.69.109:8080' > .env.production.local
npm run build
rm .env.production.local
```

> 构建时读不到地址，页面会直接显示「构建时缺少 …」的提示，不会静默请求到错误地址。

产物结构：

```
out/
├── index.html                 # 登录页
├── overview/index.html        # 各控制台视图，一个路由一个目录
├── users/index.html
├── _next/static/**            # 带 hash 的 JS/CSS，可长缓存
├── icons/ brand/ model-icons/ # 图片资源
├── __next.*.txt               # 客户端跳转用的数据，别按扩展名过滤
└── 404.html
```

本地预览（模拟 nginx 的 try_files）：

```bash
npm start        # http://127.0.0.1:3000
```

---

## 3. 服务器目录规划

```
/srv/tokenstation/b/
├── releases/
│   ├── 20261021-1/
│   └── 20261022-1/
└── current -> releases/20261022-1
```

nginx 的 `root` 指向 `current`；**部署 = 新版本解压成一个新目录 + 换软链**，回滚就是换回去。
如果只保留单版本，也可以直接把 `out/` 覆盖到 nginx 的 root，省掉软链（见第 5 节末尾）。

---

## 4. 首次部署

### 4.1 构建并打包

```bash
npm ci
npm run build
tar -czf tokenstation-b.tar.gz -C out .
scp tokenstation-b.tar.gz root@station.centlt.com:/root/
```

### 4.2 解压到版本目录并切换

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
REL=/srv/tokenstation/b/releases/$STAMP
mkdir -p "$REL"
tar -xzf /root/tokenstation-b.tar.gz -C "$REL"
chmod -R a+rX "$REL"
ln -sfn "$REL" /srv/tokenstation/b/current
```

### 4.3 配置 nginx

把仓库里的 `deploy/nginx.conf` 复制为 `/etc/nginx/conf.d/tokenstation.conf`（域名、证书、root、CSP 中的后端域名按实际改），然后：

```bash
nginx -t && systemctl reload nginx
```

关键只有两行：

```nginx
root /srv/tokenstation/b/current;
location / { try_files $uri $uri/ /index.html; }
```

### 4.4 停掉旧容器

```bash
docker rm -f tokenstation-b 2>/dev/null || true
```

### 4.5 验证

```bash
curl -sI https://station.centlt.com/ | head -12          # 200 + 安全响应头
curl -sI https://station.centlt.com/overview/ | head -1  # 200
```

浏览器：打开首页 → 登录 → F12 Network 确认**没有 `/api/backend`**，全部是 `hub.centlt.com`。

---

## 5. 日常发布与回滚

### 发布（替换新包）

```bash
npm ci
npm run build
tar -czf tokenstation-b.tar.gz -C out .

scp tokenstation-b.tar.gz root@station.centlt.com:/root/
ssh root@station.centlt.com '
  set -e
  REL=/srv/tokenstation/b/releases/$(date +%Y%m%d-%H%M%S)
  mkdir -p "$REL"
  tar -xzf /root/tokenstation-b.tar.gz -C "$REL"
  chmod -R a+rX "$REL"
  ln -sfn "$REL" /srv/tokenstation/b/current
'
```

或者用脚本一条命令：

```bash
./deploy/release.sh root@station.centlt.com /srv/tokenstation/b
```

脚本会依次：`npm ci` → 构建（后端地址取自 `.env.production`）→ 校验产物里确实包含该地址 → 打包上传 → 解压并切软链 → 探活。
临时指向别的后端：`./deploy/release.sh <目标> <远端目录> http://47.103.69.109:8080`。

### 单版本覆盖（不用软链）

```bash
rsync -av --delete out/ root@station.centlt.com:/usr/share/nginx/html/
```

nginx 的 `root` 指向 `/usr/share/nginx/html` 即可。缺点是没有版本目录，回滚要重新上传旧包。

### 回滚

```bash
ls -1dt /srv/tokenstation/b/releases/* | head -3
ln -sfn /srv/tokenstation/b/releases/<上一版本> /srv/tokenstation/b/current
```

秒级生效，nginx 不需要 reload（软链每次请求重新解析）。

### 清理旧版本

```bash
ls -1dt /srv/tokenstation/b/releases/* | tail -n +4 | xargs -r rm -rf
```

---

## 6. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面提示「构建时缺少 NEXT_PUBLIC_TOKENHUB_API_BASE_URL」 | `.env.production` 缺失或变量名写错 | 检查该文件后重新构建 |
| 页面全白 | 静态资源没上传全 | 确认 `_next/` 完整上传 |
| 刷新 404 | nginx 缺 `try_files ... /index.html` | 对照 `deploy/nginx.conf` |
| 静态资源 404 | root 指错，或部署在子路径 | root 必须是域名根；子路径需要 `basePath` |
| 登录报「无法连接后端（网络异常或 CORS 未放行）」 | 后端未放行 Origin | 看 Console 的 CORS 报错；按第 8 节配置 |
| 改了后端地址不生效 | 地址在构建期固化 | 必须重新构建并重新发布 |
| 旧链接 `/plugins/xxx` 404 | 静态化后无动态路由 | nginx 已 301 到 `/plugins/` |

---

## 7. 产物自检

发布前可以本地确认后端地址确实打进了产物：

```bash
grep -rl "hub.centlt.com" out | head -3
```

---

## 8. 后端要求（CORS）

浏览器现在直接请求后端，后端必须放行本站 Origin，并允许 `authorization`、`content-type`、`accept` 请求头，暴露 `content-disposition`、`x-request-id` 响应头。本仓库后端通过环境变量配置（与 `e2e/start-stack.mjs` 一致）：

```bash
# 多个 Origin 用逗号分隔；只填静态站点域名，不要带路径
TOKENHUB_CORS_ALLOWED_ORIGINS=https://station.centlt.com
```

```bash
# 修改后重启后端进程
```

前端不使用 Cookie（token 存在 localStorage），后端无需开启 credentials。

自检：

```bash
curl -i -X OPTIONS https://hub.centlt.com/api/admin/users \
  -H 'Origin: https://station.centlt.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
# 期望 204 + access-control-allow-origin
```

---

## 9. 与旧部署的差异

| | 旧（Node 容器 + 代理） | 新（纯静态） |
|---|---|---|
| 进程 | Node 常驻 | 无 |
| 转发 | `/api/backend` 经 Node | 浏览器直连后端 |
| 路由 | 动态 SSR | 每个视图一个预渲染 HTML |
| 配置 | 容器环境变量 | 构建期环境变量（固化进产物） |
| 发布 | 换镜像 / 重启容器 | 换软链（或覆盖目录） |
| CSP nonce | middleware 每次生成 | 无 nonce，`script-src 'unsafe-inline'` |
| 门户校验 | 服务端 `portal-proxy` | 仅客户端过滤，需后端兜底 |

### 已知取舍

1. **后端地址与产物绑定**：测试/生产各一份产物，改地址要重新构建。这是「部署只替换包」的代价与前提。
2. **CSP 无法使用 nonce**：静态 HTML 无法逐请求生成 nonce，`script-src` 只能退到 `'unsafe-inline'`。
3. **门户隔离**：原来由 `lib/portal-proxy.ts` 在服务端强制，静态化后不再存在。前端仍通过 `scopePortalData` 过滤列表与角色下拉，但**这不是安全边界**；跨门户越权需要后端按 token 中的门户信息拦截。
4. **`/api/health` 不存在**：健康检查改为 `curl -fsS https://站点/`。
5. **旧深链**：`/plugins/{id}`、`/api-keys/{id}/usage` 已无对应页面，nginx 301 回列表页。