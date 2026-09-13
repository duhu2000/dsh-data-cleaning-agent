import { WorkflowError } from './workflow.js';

// The wizard binds its confirmed revision. Execution reuses the original Agent token.
export function createImageWorkflow({ getWorkflow, execution, commands }) {
  return async (record, result, exec) => {
    const store = await getWorkflow();
    let task = await store.require(record.workflow.taskId);
    if (task.revision !== record.workflow.revision || task.state !== 'draft') {
      throw new WorkflowError('DC_WORKFLOW_REVISION_CONFLICT', '图片任务配置已变更，请重新生成说明；未执行企业查询。', 409);
    }
    const rows = result.entries.map(value => ({ 主体标识: value }));
    const mappings = [{ sourceField: '主体标识', targetField: 'company_name' }];
    task = await store.recordUpload(task.id, { expectedRevision: task.revision,
      source: { type: 'image', fileName: record.fileName, sizeBytes: record.sizeBytes,
        rowCount: rows.length, columnCount: 1, headers: ['主体标识'] } });
    task = await store.updateDraft(task.id, { expectedRevision: task.revision, mappings });
    if (result.truncated || result.needsReview || rows.length > 100) {
      return { taskId: task.id, deliveryState: 'review_required', artifacts: [],
        reviewReason: rows.length > 100 || result.truncated ? '识别名单超出单批范围，请核验并拆分。' : '识别文本含模糊字符或待确认提示，请核验名单。' };
    }
    task = await store.confirmRules(task.id, { expectedRevision: task.revision, mappings });
    task = await store.recordQuality(task.id, { expectedRevision: task.revision,
      summary: { total: rows.length, valid: rows.length, missingAnchor: 0,
        duplicates: rows.length - new Set(result.entries).size } });
    const payload = await execution.prepare({ taskId: task.id, expectedRevision: task.revision,
      originSessionId: task.originSessionId, originWorkspaceId: task.originWorkspaceId,
      kind: 'enrich', rows, headers: ['主体标识'], nameField: '主体标识' });
    const command = commands.prepare(payload, { artifactOrigin: record.workflow.artifactOrigin });
    record.qccCommand = { commandId: command.commandId, taskId: task.id };
    return commands.run(command.commandId, exec);
  };
}
