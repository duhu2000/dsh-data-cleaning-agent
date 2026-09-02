#!/usr/bin/env bash
# verify-mvp.sh — 「数据清洗补全智能体」插件 MVP 双基线 Web 冒烟验证
#
# 用法:
#   bash verify-mvp.sh            # 依次验证 rc.2(43136) 与 alpha.2(43137)
#   bash verify-mvp.sh rc2        # 只验证 rc.2
#   bash verify-mvp.sh alpha2     # 只验证 alpha.2
#
# 说明:
#   - bash shebang + 显式内联 header，彻底规避 zsh 变量不词分裂问题。
#   - 脚本会自动: 清理目标端口残留监听 → 启动 web → 等待就绪 → 逐项 curl → 杀进程。
#   - 只动 43136 / 43137 两个隔离端口，绝不触碰生产 GUI 端口 43120。
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RC2_CLI="/opt/homebrew/bin/dsh"
ALPHA2_CLI="$ROOT/spike1/cli-alpha2/node_modules/@deepseek-ai/dsh/lib/bin.js"
RC2_HOME="$ROOT/mvp/home-rc2"
ALPHA2_HOME="$ROOT/mvp/home-alpha2"
LOG_DIR="$(mktemp -d)"
PASS=0
FAIL=0

log()  { printf '\033[1;34m[verify]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  PASS\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '\033[1;31m  FAIL\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }

free_port() { # free_port <port>
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    log "端口 $port 有残留监听，清理 PID: $(echo "$pids" | tr '\n' ' ')"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

wait_ready() { # wait_ready <base> <logfile> <max_sec>
  local base="$1" logfile="$2" max="${3:-30}" i
  for i in $(seq 1 "$max"); do
    if curl -s -m 2 -o /dev/null "$base/data-cleaning/" 2>/dev/null; then
      return 0
    fi
    if ! kill -0 "$WEB_PID" 2>/dev/null; then
      echo "---- $logfile ----" >&2
      cat "$logfile" >&2 2>/dev/null || true
      return 1
    fi
    sleep 1
  done
  return 1
}

check() { # check <label> <expected_http> <curl_args...>
  local label="$1" expected="$2"; shift 2
  local code
  code="$(curl -s -m 10 -o /tmp/verify-mvp-body.json -w '%{http_code}' "$@")"
  if [ "$code" = "$expected" ]; then
    ok "$label → HTTP $code"
  else
    bad "$label → 期望 HTTP $expected 实际 HTTP $code"
    head -c 300 /tmp/verify-mvp-body.json 2>/dev/null | sed 's/^/      body: /' || true
  fi
}

run_baseline() { # run_baseline <name> <cli> <home> <port>
  local name="$1" cli="$2" home="$3" port="$4"
  local base="http://127.0.0.1:$port" logfile="$LOG_DIR/$name.log"
  local cmd
  log "== 基线 $name ($base) =="
  free_port "$port"

  if [ "$name" = "rc2" ]; then
    cmd=("$cli" web --port "$port" --no-open)
  else
    cmd=(node "$cli" web --port "$port" --no-open)
  fi

  DSH_HOME="$home" "${cmd[@]}" >"$logfile" 2>&1 &
  WEB_PID=$!

  if ! wait_ready "$base" "$logfile" 40; then
    bad "$name web 启动失败（日志见 $logfile）"
    return
  fi
  ok "$name web 启动成功 (PID $WEB_PID)"

  local h1='-H' sso='sec-fetch-site: same-origin' h2='-H' ct='content-type: application/json'

  # 1) seam
  check "seam" 200 -s "$h1" "$sso" "$base/data-cleaning/api/mvp/seam"

  # 2) parse
  check "parse" 200 -s "$h1" "$sso" "$h2" "$ct" \
    -d '{"filename":"demo.csv","content":"name,phone,amount\n张三,13800000001,100\n李四,13800000002,200"}' \
    "$base/data-cleaning/api/mvp/parse"

  # 3) clean
  check "clean" 200 -s "$h1" "$sso" "$h2" "$ct" \
    -d '{"headers":["name","phone","amount"],"rows":[{"name":"张三","phone":"13800000001","amount":"100"},{"name":"","phone":"13800000002","amount":"200"}]}' \
    "$base/data-cleaning/api/mvp/clean"

  # 4) complete
  check "complete" 200 -s "$h1" "$sso" "$h2" "$ct" \
    -d '{"headers":["name","phone","amount"],"rows":[{"name":"","phone":"13800000001","amount":""}]}' \
    "$base/data-cleaning/api/mvp/complete"

  # 5) profile
  check "profile" 200 -s "$h1" "$sso" "$h2" "$ct" \
    -d '{"headers":["name","phone","amount"],"rows":[{"name":"张三","phone":"13800000001","amount":"100"}]}' \
    "$base/data-cleaning/api/mvp/profile"

  # 6) jobs 启动（202）+ 详情
  check "jobs-start" 202 -s "$h1" "$sso" "$h2" "$ct" \
    -d '{"kind":"clean","headers":["name","phone","amount"],"rows":[{"name":"张三","phone":"13800000001","amount":"100"}]}' \
    "$base/data-cleaning/api/mvp/jobs"

  local job_id
  job_id="$(curl -s -m 10 "$h1" "$sso" "$base/data-cleaning/api/mvp/jobs" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.jobs?.[0]?.id??"")}catch{console.log("")}})' 2>/dev/null)"
  if [ -n "$job_id" ]; then
    check "job-detail" 200 -s "$h1" "$sso" "$base/data-cleaning/api/mvp/job/$job_id"
  else
    bad "job-detail → 未能从列表取到任务 id"
  fi

  # 7) UI 页面
  check "ui" 200 -s "$h1" "$sso" "$base/data-cleaning/"

  # 8) 0.5.0 三域能力与零调用估算（不需要 OAuth，不产生计费调用）
  check "phase3-capabilities" 200 -s "$h1" "$sso" \
    "$base/data-cleaning/api/phase3/capabilities"
  check "phase3-estimate" 200 -s "$h1" "$sso" "$h2" "$ct" \
    -d '{"rows":[{"name":"contract-probe"}],"tools":["get_company_risk_scan"],"maxCalls":2}' \
    "$base/data-cleaning/api/phase3/estimate"

  # 9) 未确认计费必须在任何 ToolRuntime execute 前阻断
  check "phase3-unconfirmed" 409 -s "$h1" "$sso" "$h2" "$ct" \
    -d '{"rows":[{"name":"contract-probe"}],"tools":["get_company_risk_scan"],"maxCalls":2}' \
    "$base/data-cleaning/api/phase3/enrich"

  kill -9 "$WEB_PID" 2>/dev/null || true
  wait "$WEB_PID" 2>/dev/null || true
  free_port "$port"
  log "== 基线 $name 结束 =="
  echo
}

mkdir -p /tmp

case "${1:-all}" in
  rc2)    run_baseline rc2    "$RC2_CLI"    "$RC2_HOME"    43136 ;;
  alpha2) run_baseline alpha2 "$ALPHA2_CLI" "$ALPHA2_HOME" 43137 ;;
  all)    run_baseline rc2    "$RC2_CLI"    "$RC2_HOME"    43136
          run_baseline alpha2 "$ALPHA2_CLI" "$ALPHA2_HOME" 43137 ;;
  *)      echo "用法: bash verify-mvp.sh [rc2|alpha2|all]" >&2; exit 2 ;;
esac

log "完成: PASS=$PASS FAIL=$FAIL (临时日志目录: $LOG_DIR)"
[ "$FAIL" -eq 0 ]
