# 首次贡献路径 / First Contribution

## 前提

- Node.js 20+、git、npm（DSH 运行期 peer 由 Host 提供，本地无需安装 DSH）。
- 一个 GitHub 账号。

## 从 Fork 到 PR

```bash
# 1. Fork 仓库：https://github.com/duhu2000/dsh-data-cleaning-agent
# 2. 克隆你的 fork
git clone https://github.com/<你>/dsh-data-cleaning-agent.git
cd dsh-data-cleaning-agent

# 3. 从最新 main 开单目的分支
git switch main
git pull --ff-only
git switch -c feat/<short-purpose>

# 4. 安装与自检
npm install --legacy-peer-deps
npm run check
```

## 适合首次贡献的改动

- 补充或修正 README / 使用指南中的示例与措辞。
- 增加无凭据、已脱敏的引擎测试夹具（`test/` 下新增 `node:test` 用例）。
- 改进 `lib/engine.js` 的清洗规则（如新增规范化函数）并补测试。
- 完善 `docs/USER-GUIDE.md` 或 `docs/COMPATIBILITY.md`。

## 提交 PR

1. 提交说明：用户问题 / 解决方案 / 测试结果 / 手工验收步骤。
2. 确认 `npm run check` 全绿。
3. Push 分支并在 GitHub 发起 PR，描述变更与验收截图（如涉及 UI）。
4. 等待 CI 通过与维护者评审；评审意见会以 review 或 comment 形式给出。

## 注意

- 不要把 Token / API Key / Cookie / OAuth 凭据 / 真实业务数据写进任何提交。
- 中英文文档需同步更新；README 中的版本号必须与 `package.json` 一致。
