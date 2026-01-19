const workflow = require('../workflows/cvr_drop.json');
const mergeContext = require('./MergeContext');
const validationNode = require('../nodes/ValidationNode');
const metricCompareNode = require('../nodes/MetricCompareNode');
const recursiveDimensionBreakdownNode = require('../nodes/RecursiveDimensionBreakdownNode');
const compositeNode = require('../nodes/CompositeNode');
const branchNode = require('../nodes/BranchNode');
const insightNode = require('../nodes/InsightNode');

const NodeRegistry = {
  validation: validationNode,
  metric_compare: metricCompareNode,
  recursive_dimension_breakdown: recursiveDimensionBreakdownNode,
  composite: compositeNode,
  branch: branchNode,
  insight: insightNode
};

class WorkflowRunner {
  constructor(workflow, options = {}) {
    this.workflow = workflow;
    this.nodeMap = this.buildNodeMap(workflow.nodes);
    this.options = options;
  }

  buildNodeMap(nodes) {
    const map = {};
    nodes.forEach(node => {
      if (!node.id) {
        throw new Error('Each node must have a unique id');
      }
      map[node.id] = node;
    });
    return map;
  }

  async executeWorkflow(context) {
    if (!context || Object.keys(context).length === 0) {
      throw new Error('Execution context is required to run the workflow');
    }

    let currentNodeId = this.workflow.nodes[0].id;
    let stepCount = 0;
    const visited = new Set();

    // --- execution trace ---
    context.executionTrace = context.executionTrace || [];

    while (currentNodeId) {
      stepCount++;

      // --- infinite loop guard ---
      if (stepCount > 100) {
        throw new Error('Workflow exceeded maximum execution steps');
      }

      // --- cycle detection ---
      if (visited.has(currentNodeId)) {
        throw new Error(`Workflow cycle detected at node: ${currentNodeId}`);
      }
      visited.add(currentNodeId);

      const nodeDef = this.nodeMap[currentNodeId];
      if (!nodeDef) {
        throw new Error(`Node not found: ${currentNodeId}`);
      }

      const executor = NodeRegistry[nodeDef.type];
      if (!executor) {
        throw new Error(`Unsupported node type: ${nodeDef.type}`);
      }

      // --- trace ---
      context.executionTrace.push({
        nodeId: currentNodeId,
        type: nodeDef.type,
        timestamp: new Date().toISOString()
      });

      const result = nodeDef.type === 'composite'
        ? await executor(nodeDef, context, this.nodeMap)
        : await executor(nodeDef, context);

      if (this.options.onNodeResult) {
        this.options.onNodeResult({
          nodeId: currentNodeId,
          type: nodeDef.type,
          result
        });
      }

      if (!result || typeof result !== 'object') {
        throw new Error(`Invalid result returned from node ${currentNodeId}`);
      }

      // --- failure handling with on_fail policy ---
      if (result.status === 'fail') {
        const onFail = nodeDef.on_fail;

        if (onFail?.action === 'terminate') {
          return {
            status: 'terminated',
            reason: onFail.reason || result.reason,
            context
          };
        }

        throw new Error(result.reason || `Node ${currentNodeId} failed`);
      }

      // --- merge analytical delta ---
      if (result.delta) {
        mergeContext(context, result.delta);
      }

      // --- move execution pointer ---
      currentNodeId = result.next || null;
    }

    return {
      status: 'completed',
      context
    };
  }
}

// Example usage
if (require.main === module) {
  (async () => {
    const runner = new WorkflowRunner(workflow);
    const context = require('./ExecutionContext');
    const finalContext = await runner.executeWorkflow(context);

    console.log('Final Execution Context:', JSON.stringify(finalContext, null, 2));
  })();
}

module.exports = WorkflowRunner;
