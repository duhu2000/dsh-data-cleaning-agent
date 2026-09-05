import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';

import {
  extractCompanyEntries,
  ImageIntakeStore,
  providerText,
  registerImageIntakeTool,
  serializeImageExtractionPrompt,
  sniffImage,
  QCC_DOCUMENT_LOCAL_TOOL_PAIRS,
  QCC_DOCUMENT_REMOTE_PARSE,
  TOOL_IMAGE_EXTRACT,
} from '../lib/image-intake.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);

test('图片魔数校验只接受 PNG/JPEG/WebP', () => {
  assert.deepEqual(sniffImage(PNG), { mimeType: 'image/png', extension: 'png' });
  assert.equal(sniffImage(Buffer.from('not-an-image')), null);
});

test('OCR 文本按一企一行提取企业全称与统一社会信用代码并去重', () => {
  const entries = extractCompanyEntries([
    '序号 企业名称 统一社会信用代码',
    '1 深圳奥雅设计股份有限公司 91440300123456789A',
    '2\t星际量子（北京）科技有限公司\t91110108MA01LUR06B',
    '2\t星际量子（北京）科技有限公司\t91110108MA01LUR06B',
  ].join('\n'));
  assert.deepEqual(entries, [
    '深圳奥雅设计股份有限公司 | 91440300123456789A',
    '星际量子（北京）科技有限公司 | 91110108MA01LUR06B',
  ]);
});

test('Provider 结果兼容结构化值与文本 content', () => {
  assert.equal(providerText({ value: { ocr: { full_text: '示例有限公司' } } }), '示例有限公司');
  assert.equal(providerText({ value: { content: [{ type: 'text', text: '{"ocr":{"full_text":"文本企业有限公司"}}' }] } }), '文本企业有限公司');
  assert.equal(providerText({ value: { content: [{ type: 'text', text: '{"status":"success","details":[{"result_md":"企查查文档企业有限公司"}]}' }] } }), '企查查文档企业有限公司');
});

test('兼容官方 document serverName 投射的 DSH 工具名', () => {
  assert.deepEqual(QCC_DOCUMENT_LOCAL_TOOL_PAIRS[0], {
    parse: 'mcp__document__parse_document',
    result: 'mcp__document__get_parse_result',
  });
});

test('Agent-owned 图片工具通过 qcc-document-mcp 提交一次并轮询结果，返回名单后销毁临时原图', async () => {
  const calls = [];
  const registered = new Map();
  const [documentTools] = QCC_DOCUMENT_LOCAL_TOOL_PAIRS;
  const tools = {
    get(name) {
      if (name === documentTools.parse) return { name, parameters: { properties: { file_path: { type: 'string' } } } };
      if (name === documentTools.result) return { name, parameters: { properties: { task_id: { type: 'string' } } } };
      return registered.get(name);
    },
    register(definition) { registered.set(definition.name, definition); return () => registered.delete(definition.name); },
    async execute(input) {
      calls.push(input);
      if (input.name === documentTools.parse) {
        return { isError: false, value: { content: [{ type: 'text', text: '{"task_id":"qcc-image-task","status":"processing"}' }] } };
      }
      return { isError: false, value: { content: [{ type: 'text', text: JSON.stringify({
        task_id: 'qcc-image-task',
        status: 'success',
        details: [{ result_md: '深圳奥雅设计股份有限公司 91440300123456789A\n星际量子（北京）科技有限公司 91110108MA01LUR06B' }],
      }) }] } };
    },
  };
  const store = new ImageIntakeStore({ tools, pollMs: 1 });
  const disposeTool = registerImageIntakeTool(tools, store);
  const command = await store.prepare({
    fileName: '企业名单.png',
    mimeType: 'image/png',
    content: PNG.toString('base64'),
  });
  assert.equal(command.state, 'prepared');
  assert.equal(command.provider, 'qcc-document-mcp');
  assert.equal(command.parseTool, documentTools.parse);
  const prompt = serializeImageExtractionPrompt(command);
  assert.match(prompt, new RegExp(command.commandId));
  assert.match(prompt, new RegExp(TOOL_IMAGE_EXTRACT));
  assert.match(prompt, /企查查 qcc-document-mcp/);

  const tool = registered.get(TOOL_IMAGE_EXTRACT);
  const result = await tool.execute({ commandId: command.commandId }, {
    agent: { id: 'agent-test' }, token: { id: 'parent-test' }, rootCallId: 'root-test', signal: new AbortController().signal,
  });
  assert.equal(result.entryCount, 2);
  assert.equal(store.status(command.commandId).state, 'completed');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, documentTools.parse);
  assert.equal(calls[1].name, documentTools.result);
  assert.equal(calls[0].rootCallId, 'root-test');
  assert.equal(calls[0].parent.id, 'parent-test');
  assert.match(calls[0].arguments.file_path, /dci-.*\.png$/);
  assert.equal(calls[0].arguments.wait, true);
  assert.deepEqual(calls[1].arguments, { task_id: 'qcc-image-task' });
  await assert.rejects(access(calls[0].arguments.file_path), (error) => error?.code === 'ENOENT');

  disposeTool();
  await store.dispose();
});

test('没有企查查本地文档解析 Provider 时 fail closed，不写入临时任务', async () => {
  const store = new ImageIntakeStore({ tools: { get: () => undefined, execute: async () => ({}) } });
  await assert.rejects(
    store.prepare({ fileName: '企业名单.png', content: PNG.toString('base64') }),
    (error) => error?.code === 'DC_IMAGE_PROVIDER_UNAVAILABLE' && error?.status === 503,
  );
  assert.equal(store.records.size, 0);
});

test('只有远端 qcc-document 时明确提示本地连接要求', async () => {
  const store = new ImageIntakeStore({
    tools: { get: (name) => name === QCC_DOCUMENT_REMOTE_PARSE ? { name } : undefined, execute: async () => ({}) },
  });
  await assert.rejects(
    store.prepare({ fileName: '名单.png', content: PNG.toString('base64') }),
    (error) => error?.code === 'DC_IMAGE_LOCAL_DOCUMENT_PROVIDER_REQUIRED' && /qcc-document-mcp/.test(error.message),
  );
  assert.equal(store.records.size, 0);
});

test('同名 document 工具仅有 file_url 时不得误判为本地 Provider', async () => {
  const [documentTools] = QCC_DOCUMENT_LOCAL_TOOL_PAIRS;
  const store = new ImageIntakeStore({
    tools: {
      get: (name) => name === documentTools.parse
        ? { name, parameters: { properties: { file_url: { type: 'string' } } } }
        : name === documentTools.result ? { name } : undefined,
      execute: async () => ({}),
    },
  });
  assert.equal(store.capabilities().ready, false);
  assert.equal(store.capabilities().remoteUrlOnlyConnected, true);
  await assert.rejects(
    store.prepare({ fileName: '名单.png', content: PNG.toString('base64') }),
    (error) => error?.code === 'DC_IMAGE_LOCAL_DOCUMENT_PROVIDER_REQUIRED',
  );
});

test('企查查文档 Provider 运行失败时返回脱敏且可操作的状态', async () => {
  const [documentTools] = QCC_DOCUMENT_LOCAL_TOOL_PAIRS;
  const store = new ImageIntakeStore({
    tools: {
      get: (name) => name === documentTools.parse
        ? { name, parameters: { properties: { file_path: { type: 'string' } } } }
        : name === documentTools.result ? { name } : undefined,
      execute: async () => { throw new Error('provider secret and raw upstream response'); },
    },
  });
  const command = await store.prepare({ fileName: '失败.png', content: PNG.toString('base64') });
  await assert.rejects(
    store.run(command.commandId, {
      agent: { id: 'agent-test' }, token: { id: 'parent-test' }, rootCallId: 'root-test', signal: new AbortController().signal,
    }),
    (error) => error?.code === 'DC_IMAGE_PROVIDER_FAILED'
      && /qcc-document-mcp/.test(error.message)
      && !/secret|upstream/.test(error.message),
  );
  const failed = store.status(command.commandId);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error.code, 'DC_IMAGE_PROVIDER_FAILED');
  assert.match(failed.error.message, /qcc-document-mcp/);
  assert.doesNotMatch(failed.error.message, /secret|upstream/);
  await store.dispose();
});

test('Host 临时图片在 TTL 到期后主动删除', async () => {
  const [documentTools] = QCC_DOCUMENT_LOCAL_TOOL_PAIRS;
  const store = new ImageIntakeStore({
    tools: {
      get: (name) => name === documentTools.parse
        ? { name, parameters: { properties: { file_path: { type: 'string' } } } }
        : name === documentTools.result ? { name } : undefined,
      execute: async () => ({}),
    },
    ttlMs: 15,
  });
  const command = await store.prepare({ fileName: '过期.png', content: PNG.toString('base64') });
  const path = store.records.get(command.commandId).path;
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(store.records.has(command.commandId), false);
  await assert.rejects(access(path), (error) => error?.code === 'ENOENT');
  await store.dispose();
});
