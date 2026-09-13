import { WorkflowError } from './workflow.js';

// Execution owns finalization: closing a browser must not interrupt result delivery.
export function createWorkflowExecution({ getWorkflow, artifacts }) {
  const requireStore = async () => {
    const store = await getWorkflow();
    if (!store || !artifacts) throw new WorkflowError('DC_DELIVERY_UNAVAILABLE', 'Host 任务存储或下载服务不可用，请升级 DSH。', 503);
    return store;
  };
  return {
    async prepare(payload) {
      const store = await requireStore();
      const task = await store.assertRequestOrigin(payload.taskId, payload);
      if (!['rules_confirmed', 'diagnosed', 'review_required', 'partial'].includes(task.state)) {
        throw new WorkflowError('DC_EXECUTION_STATE', '请先在工作台确认规则；进行中或已完成任务不能重复启动。', 409);
      }
      if (Number(payload.expectedRevision) !== task.revision) throw new WorkflowError('DC_WORKFLOW_REVISION_CONFLICT', '任务已更新，请重新生成说明。', 409);
      if ((!payload.kind || payload.kind === 'enrich') && !['rules_confirmed', 'diagnosed'].includes(task.state)) {
        throw new WorkflowError('DC_EXECUTION_STATE', '请通过候选确认或失败重试继续当前任务。', 409);
      }
      if (payload.kind && payload.kind !== 'enrich' && payload.runId !== task.qccRunId) throw new WorkflowError('DC_RUN_MISMATCH', '执行结果不属于当前任务。', 409);
      if (!payload.kind || payload.kind === 'enrich') {
        if (!Array.isArray(payload.rows) || payload.rows.length !== task.source?.rowCount) throw new WorkflowError('DC_SOURCE_MISMATCH', '任务名单数量不一致，请重新载入。', 409);
      }
      if (!task.fieldSelection.length) throw new WorkflowError('DC_FIELDS_REQUIRED', '未选择外部补全字段，请使用本地清洗与导出。', 400);
      const primary = task.mappings.find((m) => m.targetField === 'company_name')
        ?? task.mappings.find((m) => m.targetField === 'credit_no')
        ?? task.mappings.find((m) => m.targetField === 'reg_no');
      return { ...payload, workflowOwned: true, workflowRevision: task.revision,
        fieldSelection: task.fieldSelection, headers: task.source?.headers || [],
        nameField: primary?.sourceField || payload.nameField };
    },
    async beforeRun(record) {
      if (!record.input.workflowOwned) return;
      const store = await requireStore();
      const task = await store.require(record.taskId);
      if (task.revision !== record.input.workflowRevision) throw new WorkflowError('DC_WORKFLOW_REVISION_CONFLICT', '说明已失效，请返回工作台重新生成；未执行查询。', 409);
      await store.startMatch(task.id, { expectedRevision: task.revision });
      record.workflowStarted = true;
    },
    async failed(record, error) {
      if (!record.input.workflowOwned || !record.workflowStarted) return;
      const store = await requireStore();
      const task = await store.require(record.taskId);
      if (['completed', 'cancelled', 'failed'].includes(task.state)) return;
      if (['QCC_AUTH_REQUIRED', 'QCC_NOT_CONNECTED', 'QCC_TOOL_UNAVAILABLE'].includes(error.code)) {
        await store.requireAuthorization(task.id, { expectedRevision: task.revision });
      } else {
        await store.recordFailure(task.id, { expectedRevision: task.revision, code: error.code || 'DC_DELIVERY_FAILED' });
      }
    },
    async complete(record, run) {
      if (!record.input.workflowOwned) return;
      const store = await requireStore();
      let task = await store.require(record.taskId);
      const s = run.summary || {};
      const total = Number(s.totalRows ?? run.rows.length);
      const review = Number(s.ambiguous ?? 0);
      task = await store.recordMatch(task.id, { expectedRevision: task.revision, qccRunId: run.runId,
        summary: { total, exact: Number(s.enriched || 0) + Number(s.fieldReview || 0), candidate: review,
          unresolved: Number(s.unresolved || 0) + Number(s.missingName || 0), failed: Number(s.failed || 0), reviewRequired: review } });
      if (review) return { state: task.state, artifacts: [], taskId: task.id };
      task = await store.startEnrichment(task.id, { expectedRevision: task.revision });
      task = await store.recordEnrichment(task.id, { expectedRevision: task.revision, qccRunId: run.runId,
        summary: { total, completed: Number(s.enriched || 0), unchanged: Number(s.unresolved || 0) + Number(s.missingName || 0),
          failed: Number(s.failed || 0), reviewRequired: Number(s.fieldReview || 0), callsUsed: run.audit?.length || 0 } });
      const bundle = await artifacts.createBundle(task.id, { rows: run.rows, headers: task.source?.headers || run.headers,
        mappings: task.mappings, fieldSelection: task.fieldSelection,
        baseName: (task.source?.fileName || task.title).replace(/\.[^.]+$/, '') + '-清洗补全结果' });
      task = await store.recordExport(task.id, { expectedRevision: task.revision, artifacts: bundle, preservePartial: true });
      return { state: task.state, artifacts: task.artifacts, taskId: task.id };
    },
  };
}
