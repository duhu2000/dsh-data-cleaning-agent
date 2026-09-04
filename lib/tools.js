/**
 * 模型工具定义：`data_clean_rows` / `data_complete_rows` / `data_profile`。
 * 安全边界：模型工具只回摘要，绝不回传原始行或明细行；明细仅通过 web 下载链路暴露。
 * 手写 definition 与 Spike #5 结论一致：`parameters`/`output.schema` 用对象级
 * `required: [...]`，不得把 `required:true` 写进 property 内部。
 */
import { cleanRows, completeRows, profileRows } from './engine.js';

export const TOOL_CLEAN = 'data_clean_rows';
export const TOOL_COMPLETE = 'data_complete_rows';
export const TOOL_PROFILE = 'data_profile';

function rowsProperty() {
  return {
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  };
}

function summarySchema(extraProps = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      total: { type: 'integer' },
      kept: { type: 'integer' },
      dropped: { type: 'integer' },
      badMissing: { type: 'integer' },
      badAmount: { type: 'integer' },
      badDuplicate: { type: 'integer' },
      ...extraProps,
    },
    required: ['total', 'kept', 'dropped', 'badMissing', 'badAmount', 'badDuplicate'],
  };
}

export function registerTools(tools) {
  const disposers = [];

  disposers.push(tools.register({
    name: TOOL_CLEAN,
    description:
      'Clean one batch of raw data rows: trim values, normalize phone numbers, drop rows missing a required field, drop rows with non-numeric or negative amount, and de-duplicate. Returns a summary only (never raw rows).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { rows: rowsProperty() },
      required: ['rows'],
    },
    output: {
      schema: summarySchema(),
      render: (_args, value) => [{
        type: 'text',
        text: `cleaned ${value.total} rows: kept ${value.kept}, dropped ${value.dropped} (missing ${value.badMissing}, bad-amount ${value.badAmount}, duplicate ${value.badDuplicate})`,
      }],
    },
    async execute(args) {
      const r = cleanRows(Array.isArray(args.rows) ? args.rows : []);
      return {
        total: r.total,
        kept: r.kept,
        dropped: r.dropped,
        badMissing: r.badMissing,
        badAmount: r.badAmount,
        badDuplicate: r.badDuplicate,
      };
    },
  }));

  disposers.push(tools.register({
    name: TOOL_COMPLETE,
    description:
      'Complete one batch of raw data rows with deterministic rules only: fill empty amount with 0, fill empty name with a placeholder, normalize phone numbers. Fields that cannot be deterministically completed are reported as incomplete (by row index + field). Returns a summary only, never raw rows.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { rows: rowsProperty() },
      required: ['rows'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer' },
          completed: { type: 'integer' },
          incompleteCount: { type: 'integer' },
          name: { type: 'integer' },
          amount: { type: 'integer' },
          phoneNormalized: { type: 'integer' },
        },
        required: ['total', 'completed', 'incompleteCount', 'name', 'amount', 'phoneNormalized'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `completed ${value.total} rows: ${value.completed} done, ${value.incompleteCount} still incomplete (filled name ${value.name}, amount ${value.amount}, normalized phone ${value.phoneNormalized})`,
      }],
    },
    async execute(args) {
      const r = completeRows(Array.isArray(args.rows) ? args.rows : []);
      return {
        total: r.total,
        completed: r.completedCount,
        incompleteCount: r.incompleteCount,
        name: r.fillStats.name,
        amount: r.fillStats.amount,
        phoneNormalized: r.fillStats.phoneNormalized,
      };
    },
  }));

  disposers.push(tools.register({
    name: TOOL_PROFILE,
    description:
      'Profile one batch of raw data rows: column presence/missing/distinct counts and amount distribution. Returns a summary only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { rows: rowsProperty() },
      required: ['rows'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rowCount: { type: 'integer' },
          columnCount: { type: 'integer' },
        },
        required: ['rowCount', 'columnCount'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `profiled ${value.rowCount} rows across ${value.columnCount} columns`,
      }],
    },
    async execute(args) {
      const r = profileRows(Array.isArray(args.rows) ? args.rows : []);
      return { rowCount: r.rowCount, columnCount: r.columnCount };
    },
  }));

  return disposers;
}
