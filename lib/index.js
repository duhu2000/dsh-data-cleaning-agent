/**
 * 数据清洗补全智能体 · MVP · host 半区。
 *
 * 组成（全部为 Spike #1–#6 已实测同构的 seam）：
 *  1. ctx.tools  —— 注册 data_clean_rows / data_complete_rows / data_profile
 *  2. ctx.skills —— 注册内嵌 Skill `data-cleaning`（正文指引模型调上述工具）
 *  3. webServer/webRuntime —— 挂载上传/解析/同步清洗补全/异步任务/UI 路由
 *  4. ctx.jobs + ctx.storageDomain —— 异步任务状态机（web 组合内可用）
 *  5. ctx.tools.execute —— G5 QCC Host Bridge（程序化批量补全，web 组合内可用）
 *
 * headless 组合无 webServer/webRuntime：用 ctx.get() 存在性守卫跳过 web 半区，
 * 工具与 Skill 照常注册（端到端真实模型路径依赖它们）。
 */
import { mountWebRoutes } from './web.js';
import { registerTools, TOOL_CLEAN } from './tools.js';
import { registerSkill, SKILL_NAME } from './skill.js';
import { registerEnrichSkill, ENRICH_SKILL_NAME } from './skill-enrich.js';

export const name = 'data-cleaning-agent';
export const inject = [];

export function apply(ctx, config) {
  const report = {
    tools: 'not-checked',
    skills: 'not-checked',
    toolRegistered: false,
    skillRegistered: false,
    webMounted: false,
    webSkipped: false,
    qccBridgeMounted: false,
  };
  const disposers = [];

  // 1. 模型工具
  try {
    ctx.inject(['tools'], (tctx) => {
      report.tools = 'present';
      report.toolRegister = typeof tctx.tools?.register === 'function' ? 'ok' : String(typeof tctx.tools?.register);
      disposers.push(...registerTools(tctx.tools));
      report.toolRegistered = true;
    });
  } catch (error) {
    report.tools = `absent: ${error instanceof Error ? error.message : String(error)}`;
  }

  // 2. 内嵌 Skill
  try {
    ctx.inject(['skills'], (sctx) => {
      report.skills = 'present';
      report.skillRegister = typeof sctx.skills?.register === 'function' ? 'ok' : String(typeof sctx.skills?.register);
      disposers.push(registerSkill(sctx.skills));
      disposers.push(registerEnrichSkill(sctx.skills));
      report.skillRegistered = true;
      report.enrichSkillRegistered = true;
    });
  } catch (error) {
    report.skills = `absent: ${error instanceof Error ? error.message : String(error)}`;
  }

  // 3. web 半区（仅 web 组合存在；headless 组合无 webServer/webRuntime，inject 会失败）
  try {
    ctx.inject(['webServer', 'webRuntime', 'tools', 'skills', 'jobs', 'storageDomain', 'fs'], (wctx) => {
      try {
        const dispose = mountWebRoutes(wctx, { logger: ctx.logger, report, TOOL_NAME: TOOL_CLEAN, SKILL_NAME });
        if (typeof dispose === 'function' && typeof ctx.effect === 'function') {
          ctx.effect(() => () => dispose(), 'data-cleaning-agent: web routes');
        }
        report.webMounted = true;
      } catch (error) {
        report.webSkipped = true;
        console.warn(`[dc-agent] web half failed during deferred mount: ${error instanceof Error ? error.stack : String(error)}`);
      }
    });
  } catch (error) {
    report.webSkipped = true;
    console.warn(`[dc-agent] web half not mounted (headless?): ${error instanceof Error ? error.message : String(error)}`);
  }

  // eslint-disable-next-line no-console
  console.log('[dc-agent] host apply() ran');
  ctx.__DC_MVP_REPORT__ = report;
  ctx.__DC_MVP_DISPOSERS__ = disposers;
}
