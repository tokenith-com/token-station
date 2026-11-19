#!/usr/bin/env bash
# TokenStation B 端静态发布脚本（后端地址在构建期固化进产物）
# 用法: ./deploy/release.sh <ssh目标> <远端根目录> [后端地址] [访问URL]
# 例:   ./deploy/release.sh root@station.example.com /srv/tokenstation/b
# 后端地址省略时取 .env.production 中的值
set -euo pipefail

TARGET=${1:?用法: release.sh <ssh目标> <远端根目录> [后端地址] [访问URL]}
REMOTE_ROOT=${2:?远端根目录，例如 /srv/tokenstation/b}
API_BASE_URL=${3:-}

if [ -z "${API_BASE_URL}" ] && [ -f .env.production ]; then
  API_BASE_URL=$(sed -n 's/^NEXT_PUBLIC_TOKENHUB_API_BASE_URL=//p' .env.production | tail -1 | tr -d '\r"' | xargs)
fi
[ -n "${API_BASE_URL}" ] || { echo "未指定后端地址，且 .env.production 中没有 NEXT_PUBLIC_TOKENHUB_API_BASE_URL" >&2; exit 1; }

CHECK_URL=${4:-}
STAMP=$(date +%Y%m%d-%H%M%S)
PKG="tokenstation-${STAMP}.tar.gz"

echo "==> 安装依赖"
npm ci

echo "==> 构建（后端地址 ${API_BASE_URL} 固化进产物）"
NEXT_PUBLIC_TOKENHUB_API_BASE_URL="${API_BASE_URL}" npm run build

if [ ! -f out/index.html ]; then
  echo "构建产物缺失: out/index.html" >&2
  exit 1
fi

if ! grep -rqsF -- "${API_BASE_URL}" out; then
  echo "产物中没有找到 ${API_BASE_URL}，请确认构建时环境变量已生效" >&2
  exit 1
fi

echo "==> 打包"
tar -czf "/tmp/${PKG}" -C out .

echo "==> 上传 ${TARGET}:/tmp/${PKG}"
scp -q "/tmp/${PKG}" "${TARGET}:/tmp/${PKG}"

echo "==> 解压并切换软链"
ssh "$TARGET" bash -s <<EOF
set -euo pipefail
REL="${REMOTE_ROOT}/releases/${STAMP}"
mkdir -p "\$REL"
tar -xzf "/tmp/${PKG}" -C "\$REL"
chmod -R a+rX "\$REL"
ln -sfn "\$REL" "${REMOTE_ROOT}/current"
rm -f "/tmp/${PKG}"
echo "已切换: \$REL"
EOF

rm -f "/tmp/${PKG}"

if [ -n "${CHECK_URL}" ]; then
  echo "==> 验证 ${CHECK_URL}"
  code=$(curl -s -o /dev/null -w '%{http_code}' "${CHECK_URL}")
  echo "HTTP ${code}"
  [ "${code}" = "200" ] || { echo "首页返回 ${code}，请检查 nginx 配置" >&2; exit 1; }
fi

echo "完成。回滚：ssh ${TARGET} 'ln -sfn ${REMOTE_ROOT}/releases/<上一版本> ${REMOTE_ROOT}/current'"