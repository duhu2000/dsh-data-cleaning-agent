import { WorkflowError } from './workflow.js';
import { WORKFLOW_ACTIONS, allowedWorkflowActions } from './workflow-contract.js';

function summariesFor(run) {
  const summary = run.summary || {};
  const total = Number(summary.totalRows ?? run.rows.length);
  const reviewRequired = Number(summary.ambiguous ?? 0);
  return {
    reviewRequired,
    matchSummary: {
      total,
      exact: Number(summary.enriched || 0) + Number(summary.fieldReview || 0),
      candidate: reviewRequired,
      confirmed: 0,
      unresolved: Number(summary.unresolved || 0) + Number(summary.missingName || 0),
      failed: Number(summary.failed || 0),
      reviewRequired,
    },
    enrichmentSummary: {
      total,
      completed: Number(summary.enriched || 0),
      unchanged: Number(summary.unresolved || 0) + Number(summary.missingName || 0),
      failed: Number(summary.failed || 0),
      reviewRequired: Number(summary.fieldReview || 0),
      callsUsed: run.audit?.length || 0,
    },
  };
}

// Execution owns finalization: closing a browser must not interrupt result delivery.
export function createWorkflowExecution({ getWorkflow, artifacts, getRun }) {
  const requireStore = async () => {
    const store = await getWorkflow();
    if (!store || !artifacts) throw new WorkflowError('DC_DELIVERY_UNAVAILABLE', 'Host 任务存储或下载服务不可用，请升级 DSH。', 503);
    return store;
  };
  return {
    async prepare(payload) {
      const store = await requireStore();
      const task = await store.assertRequestOrigin(payload.taskId, payload);
      const kind = String(payload.kind || 'enrich');
      const expectedState = kind === 'resolve' ? 'review_required' : kind === 'retry' ? 'partial' : 'diagnosed';
      if (task.state !== expectedState) {
        throw new WorkflowError('DC_EXECUTION_STATE', '请先在工作台确认规则；进行中或已完成任务不能重复启动。', 409);
      }
      const action = kind === 'resolve'
        ? WORKFLOW_ACTIONS.RESOLVE_CANDIDATE
        : kind === 'retry'
          ? WORKFLOW_ACTIONS.RETRY_FAILED
          : WORKFLOW_ACTIONS.PREPARE_QCC_COMMAND;
      if (!allowedWorkflowActions(task).includes(action)) {
        throw new WorkflowError('DC_WORKFLOW_ACTION_LOCKED', '当前任务状态不允许生成该执行命令。', 409);
      }
      if (Number(payload.expectedRevision) !== task.revision) throw new WorkflowError('DC_WORKFLOW_REVISION_CONFLICT', '任务已更新，请重新生成说明。', 409);
      if (kind !== 'enrich' && payload.runId !== task.qccRunId) throw new WorkflowError('DC_RUN_MISMATCH', '执行结果不属于当前任务。', 409);
      if (kind === 'enrich') {
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
      if (record.kind !== 'retry') {
        await store.startMatch(task.id, { expectedRevision: task.revision });
      }
      record.workflowStarted = true;
    },
    async failed(record, error) {
      if (!record.input.workflowOwned || !record.workflowStarted) return;
      const store = await requireStore();
      const task = await store.require(record.taskId);
      if (['completed', 'cancelled', 'failed'].includes(task.state)) return;
      if (record.kind === 'retry' && task.state === 'partial') {
        await store.recordRetryFailure(task.id, {
          expectedRevision: task.revision,
          code: record.deliveryDraft ? 'DC_DELIVERY_FAILED' : error.code,
        });
        return;
      }
      if (record.deliveryDraft) {
        await store.recordDeliveryFailure(task.id, {
          expectedRevision: task.revision,
          qccRunId: record.deliveryDraft.qccRunId,
          matchSummary: record.deliveryDraft.matchSummary,
          enrichmentSummary: record.deliveryDraft.enrichmentSummary,
        });
        return;
      }
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
      const summaries = summariesFor(run);
      if (summaries.reviewRequired) {
        task = record.kind === 'retry'
          ? await store.recordRetryReview(task.id, {
              expectedRevision: task.revision,
              qccRunId: run.runId,
              summary: summaries.matchSummary,
            })
          : await store.recordMatch(task.id, {
              expectedRevision: task.revision,
              qccRunId: run.runId,
              summary: summaries.matchSummary,
            });
        return { state: task.state, artifacts: task.artifacts, taskId: task.id };
      }
      record.deliveryDraft = { ...summaries, qccRunId: run.runId };
      const bundle = await artifacts.createBundle(task.id, { rows: run.rows, headers: task.source?.headers || run.headers,
        mappings: task.mappings, fieldSelection: task.fieldSelection,
        baseName: (task.source?.fileName || task.title).replace(/\.[^.]+$/, '') + '-清洗补全结果' });
      task = record.kind === 'retry'
        ? await store.completeRetryDelivery(task.id, {
            expectedRevision: task.revision,
            qccRunId: run.runId,
            matchSummary: summaries.matchSummary,
            enrichmentSummary: summaries.enrichmentSummary,
            artifacts: bundle,
          })
        : await store.completeQccDelivery(task.id, {
            expectedRevision: task.revision,
            qccRunId: run.runId,
            matchSummary: summaries.matchSummary,
            enrichmentSummary: summaries.enrichmentSummary,
            artifacts: bundle,
          });
      return { state: task.state, artifacts: task.artifacts, taskId: task.id };
    },
    async retryDelivery(payload) {
      const store = await requireStore();
      const task = await store.require(payload.taskId);
      if (Number(payload.expectedRevision) !== task.revision) {
        throw new WorkflowError('DC_WORKFLOW_REVISION_CONFLICT', '任务已更新，请刷新后重试交付。', 409);
      }
      if (!task.qccRunId || typeof getRun !== 'function') {
        throw new WorkflowError('DC_DELIVERY_RUNTIME_EXPIRED', '企查查运行结果已失效，无法仅重试文件交付。', 409);
      }
      const run = getRun(task.qccRunId);
      const summaries = summariesFor(run);
      if (summaries.reviewRequired) {
        throw new WorkflowError('DC_WORKFLOW_REVIEW_REQUIRED', '请先完成企业主体候选核验。', 409);
      }
      const bundle = await artifacts.createBundle(task.id, {
        rows: run.rows,
        headers: task.source?.headers || run.headers,
        mappings: task.mappings,
        fieldSelection: task.fieldSelection,
        baseName: (task.source?.fileName || task.title).replace(/\.[^.]+$/, '') + '-清洗补全结果',
      });
      const completed = await store.completeRetryDelivery(task.id, {
        expectedRevision: task.revision,
        qccRunId: run.runId,
        matchSummary: summaries.matchSummary,
        enrichmentSummary: summaries.enrichmentSummary,
        artifacts: bundle,
      });
      return { task: completed, artifacts: completed.artifacts };
    },
  };
}
