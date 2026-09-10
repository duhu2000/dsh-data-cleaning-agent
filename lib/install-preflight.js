/** Read-only combination check. Never installs packages or reads profile secrets. */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export function assessCombination({ host, sidebar, context, workbench = false }) {
  const errors = [], warnings = [];
  if (host === '0.1.2-rc.1' && sidebar === '0.17.1') errors.push('DSH 0.1.2-rc.1 与 Better Sidebar 0.17.1 不兼容：缺少 settingsNamespace；请升级侧边栏到 0.18.1。');
  if (!host) errors.push('无法识别实际 DSH CLI 版本；请先安装完整 DSH，再重新预检。');
  if (sidebar === '0.18.1' && host && host !== '0.1.2-rc.1') {
    if (['0.1.1-rc.2', '0.1.2-alpha.2'].includes(host)) {
      errors.push('Better Sidebar 0.18.1 不兼容此旧宿主。备份后由宿主管理者升级完整 @deepseek-ai/dsh@0.1.2-rc.1；不要只升级 Session 子包。');
    } else warnings.push('此宿主与 Better Sidebar 0.18.1 组合未验证。');
  }
  if (!sidebar) (workbench ? errors : warnings).push('未安装可选 dsh-better-sidebar：基础引擎、工具与原生会话可用；交互工作台不可用。如需工作台，请配套安装 0.18.1 与完整 DSH 0.1.2-rc.1。');
  else if (sidebar !== '0.18.1' && !(host === '0.1.2-rc.1' && sidebar === '0.17.1')) warnings.push('此侧边栏版本未验证；仍需 targetedOpen 和 stateSubscription 能力。');
  if (host === '0.1.2-rc.1' && context === '0.36.0') errors.push('已安装的 dsh-context 0.36.0 使用旧 settingsNamespace；先升级该插件到 0.48.0。context 并非本产品必装依赖。');
  else if (context && context !== '0.48.0') warnings.push('已安装的 context 版本尚未做共存验证。');
  if (host && host !== '0.1.2-rc.1' && !warnings.length && !errors.length) warnings.push('此宿主组合未验证。');
  return { host, sidebar, context, mode: workbench ? 'workbench' : 'base', errors, warnings, ok: errors.length === 0 };
}

export function inspectProfile(profile, host, workbench = false) {
  const req = createRequire(resolve(profile, 'package.json'));
  const version = name => {
    let path;
    try { path = req.resolve(`${name}/package.json`); }
    catch { try { path = req.resolve(name); } catch { return null; } }
    for (let dir = dirname(path); ; dir = dirname(dir)) {
      try { const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')); if (pkg.name === name) return pkg.version; } catch { /* no manifest here */ }
      if (dirname(dir) === dir) return null;
    }
  };
  return assessCombination({ host, sidebar: version('dsh-better-sidebar'), context: version('dsh-context'), workbench });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const positional = process.argv.slice(2).filter(arg => arg !== '--workbench');
  const profile = positional[0];
  if (!profile) { console.error('Usage: node lib/install-preflight.js <profile-directory> [dsh-executable] [--workbench]'); process.exitCode = 2; }
  else {
    let host = null;
    try { host = execFileSync(positional[1] || 'dsh', ['--version'], { encoding: 'utf8', timeout: 15000 }).match(/\b\d+\.\d+\.\d+(?:-[\w.]+)?\b/)?.[0] ?? null; } catch { /* reported below */ }
    const report = inspectProfile(profile, host, process.argv.includes('--workbench'));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  }
}
