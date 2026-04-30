import React, { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { motion, AnimatePresence } from 'motion/react';
import { Play, SkipForward, RotateCcw, Plus, Trash2, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { Problem, Variable, Constraint, SolverState, SolverNode, VariableType, PruneReason } from './types';
import { solveLP } from './solverUtils';

// --- Constants & Defaults ---
const DEFAULT_PROBLEM: Problem = {
  type: 'max',
  objective: { x1: 3, x2: 4 },
  variables: [
    { id: 'x1', name: 'x1', type: 'integer' },
    { id: 'x2', name: 'x2', type: 'integer' },
  ],
  constraints: [
    { id: 'c1', coefficients: { x1: 2, x2: 1 }, operator: '<=', rhs: 6 },
    { id: 'c2', coefficients: { x1: 1, x2: 3 }, operator: '<=', rhs: 9 },
  ],
};

// --- Components ---

const TreeVisualizer: React.FC<{ nodes: SolverNode[]; currentNodeId: string | null }> = ({ nodes, currentNodeId }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const width = 800;
    const height = 600;
    const margin = { top: 40, right: 40, bottom: 40, left: 40 };

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Prepare data for D3 tree
    const root = d3.stratify<SolverNode>()
      .id(d => d.id)
      .parentId(d => d.parentId)(nodes);

    const treeLayout = d3.tree<SolverNode>().size([width - margin.left - margin.right, height - margin.top - margin.bottom]);
    const treeData = treeLayout(root);

    // Links
    g.selectAll('.link')
      .data(treeData.links())
      .enter()
      .append('path')
      .attr('class', 'link')
      .attr('fill', 'none')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 2)
      .attr('d', d3.linkVertical<any, any>()
        .x(d => d.x)
        .y(d => d.y)
      );

    // Nodes
    const nodeGroups = g.selectAll('.node')
      .data(treeData.descendants())
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.x},${d.y})`);

    nodeGroups.append('circle')
      .attr('r', 18)
      .attr('fill', d => {
        if (d.data.id === currentNodeId) return '#3b82f6';
        if (d.data.pruneReason === 'integer_optimal') return '#22c55e';
        if (d.data.pruneReason) return '#ef4444';
        if (d.data.result) return '#94a3b8';
        return '#e2e8f0';
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);

    nodeGroups.append('text')
      .attr('dy', '.35em')
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#fff')
      .text(d => d.data.level);

    // Labels for edge constraints
    g.selectAll('.edge-label')
      .data(treeData.links())
      .enter()
      .append('text')
      .attr('class', 'edge-label')
      .attr('font-size', '10px')
      .attr('fill', '#64748b')
      .attr('text-anchor', 'middle')
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2 - 5)
      .text(d => {
        const targetNode = d.target.data;
        if (targetNode.branchVar && targetNode.branchValue !== undefined) {
          return `${targetNode.branchVar} ${targetNode.branchDirection === 'left' ? '<=' : '>='} ${targetNode.branchValue}`;
        }
        return '';
      });

    // Tooltip area for details (objective and reason)
    nodeGroups.append('text')
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-weight', d => d.data.pruneReason === 'integer_optimal' ? '600' : '400')
      .attr('fill', d => d.data.pruneReason === 'integer_optimal' ? '#16a34a' : '#1e293b')
      .text(d => {
        if (d.data.pruneReason === 'integer_optimal') return `可行解 Z: ${d.data.result?.objectiveValue?.toFixed(2)}`;
        if (d.data.pruneReason === 'infeasible') return '无可行解 (剪枝)';
        if (d.data.pruneReason === 'worse_than_best') return '劣于界限 (剪枝)';
        if (d.data.result?.objectiveValue !== null) return `Z: ${d.data.result?.objectiveValue?.toFixed(2)}`;
        return '';
      });

  }, [nodes, currentNodeId]);

  return (
    <div className="w-full h-[600px] bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm relative">
      <div className="absolute top-4 left-4 flex flex-col gap-2 text-xs font-medium">
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-500 rounded-full" /> 当前处理</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-green-500 rounded-full" /> 可行解</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-red-500 rounded-full" /> 已剪枝</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-slate-400 rounded-full" /> 已处理</div>
      </div>
      <svg ref={svgRef} className="w-full h-full" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet" />
    </div>
  );
};

export default function App() {
  const [problem, setProblem] = useState<Problem>(DEFAULT_PROBLEM);
  const [solverState, setSolverState] = useState<SolverState>({
    nodes: [],
    queue: [],
    bestSolution: null,
    status: 'idle',
    currentNodeId: null,
  });
  const [autoSolve, setAutoSolve] = useState(false);
  const [log, setLog] = useState<{ msg: string; time: string }[]>([]);

  const addLog = (msg: string) => {
    setLog(prev => [...prev, { msg, time: new Date().toLocaleTimeString() }]);
  };

  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const startSolving = () => {
    const rootNode: SolverNode = {
      id: 'root',
      parentId: null,
      level: 0,
      constraints: [],
      result: null,
      pruneReason: null,
    };
    setSolverState({
      nodes: [rootNode],
      queue: ['root'],
      bestSolution: null,
      status: 'solving',
      currentNodeId: null,
    });
    setLog([]);
    addLog('开始求解...');
  };

  const resetSolving = () => {
    setSolverState({
      nodes: [],
      queue: [],
      bestSolution: null,
      status: 'idle',
      currentNodeId: null,
    });
    setAutoSolve(false);
    setLog([]);
  };

  const solveNextStep = () => {
    if (solverState.queue.length === 0) {
      setSolverState(prev => ({ ...prev, status: 'finished' }));
      addLog('求解完毕');
      setAutoSolve(false);
      return;
    }

    const nextId = solverState.queue[0];
    const updatedQueue = solverState.queue.slice(1);
    const node = solverState.nodes.find(n => n.id === nextId)!;

    // Process Node
    addLog(`处理节点 ${node.id}...`);
    const lpResult = solveLP(problem, node.constraints);
    
    let pruneReason: PruneReason = null;
    let newNodes: SolverNode[] = [];
    let newQueueItems: string[] = [];
    let updatedBest = solverState.bestSolution;

    if (lpResult.status !== 'optimal') {
      pruneReason = 'infeasible';
      addLog(`节点 ${node.id} 无可行解，剪枝。`);
    } else {
      const zValue = lpResult.objectiveValue!;
      const varValuesStr = Object.entries(lpResult.variableValues!)
        .map(([id, val]) => `${id} = ${val.toFixed(2)}`)
        .join(', ');
      
      addLog(`节点 ${node.id} 得到松弛解: Z = ${zValue.toFixed(2)}, ${varValuesStr}`);
      
      // Bounding
      if (updatedBest !== null && 
          ((problem.type === 'max' && zValue <= updatedBest.value) || 
           (problem.type === 'min' && zValue >= updatedBest.value))) {
        pruneReason = 'worse_than_best';
        addLog(`节点 ${node.id} 的目标值 ${zValue.toFixed(2)} 差于或等于当前最佳值 ${updatedBest.value.toFixed(2)}，剪枝。`);
      } else {
        // Check Integer Feasibility
        const nonIntegerVar = problem.variables.find(v => {
          if (v.type === 'integer') {
            const val = lpResult.variableValues![v.id];
            return Math.abs(val - Math.round(val)) > 0.0001;
          }
          return false;
        });

        if (!nonIntegerVar) {
          // Integer Found!
          pruneReason = 'integer_optimal';
          updatedBest = {
            value: zValue,
            variables: { ...lpResult.variableValues! },
            nodeId: node.id,
          };
          addLog(`节点 ${node.id} 找到可行解！ Z = ${zValue.toFixed(2)} (${varValuesStr})`);
        } else {
          // Branching
          const val = lpResult.variableValues![nonIntegerVar.id];
          const floor = Math.floor(val);
          const ceil = Math.ceil(val);

          addLog(`节点 ${node.id} 对变量 ${nonIntegerVar.name} = ${val.toFixed(2)} 进行分支。`);

          const leftNode: SolverNode = {
            id: `${node.id}_L`,
            parentId: node.id,
            level: node.level + 1,
            constraints: [...node.constraints, { id: 'br_L', coefficients: { [nonIntegerVar.id]: 1 }, operator: '<=', rhs: floor }],
            result: null,
            pruneReason: null,
            branchVar: nonIntegerVar.id,
            branchValue: floor,
            branchDirection: 'left',
          };

          const rightNode: SolverNode = {
            id: `${node.id}_R`,
            parentId: node.id,
            level: node.level + 1,
            constraints: [...node.constraints, { id: 'br_R', coefficients: { [nonIntegerVar.id]: 1 }, operator: '>=', rhs: ceil }],
            result: null,
            pruneReason: null,
            branchVar: nonIntegerVar.id,
            branchValue: ceil,
            branchDirection: 'right',
          };

          newNodes = [leftNode, rightNode];
          newQueueItems = [leftNode.id, rightNode.id];
        }
      }
    }

    setSolverState(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === node.id ? { ...n, result: lpResult, pruneReason } : n).concat(newNodes),
      queue: [...newQueueItems, ...updatedQueue], // DFS: Add to front of stack
      bestSolution: updatedBest,
      currentNodeId: node.id,
    }));
  };

  useEffect(() => {
    let interval: any;
    if (autoSolve && solverState.status === 'solving') {
      interval = setInterval(() => {
        solveNextStep();
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [autoSolve, solverState.status, solverState.queue]);

  const handleUpdateObjective = (varId: string, val: string) => {
    setProblem(prev => ({
      ...prev,
      objective: { ...prev.objective, [varId]: parseFloat(val) || 0 }
    }));
  };

  const handleUpdateConstraint = (cId: string, varId: string, val: string) => {
    setProblem(prev => ({
      ...prev,
      constraints: prev.constraints.map(c => 
        c.id === cId ? { ...c, coefficients: { ...c.coefficients, [varId]: parseFloat(val) || 0 } } : c
      )
    }));
  };

  const handleUpdateRHS = (cId: string, val: string) => {
    setProblem(prev => ({
      ...prev,
      constraints: prev.constraints.map(c => c.id === cId ? { ...c, rhs: parseFloat(val) || 0 } : c)
    }));
  };

  const addVariable = () => {
    const id = `x${problem.variables.length + 1}`;
    setProblem(prev => ({
      ...prev,
      variables: [...prev.variables, { id, name: id, type: 'integer' }],
      objective: { ...prev.objective, [id]: 0 },
      constraints: prev.constraints.map(c => ({ ...c, coefficients: { ...c.coefficients, [id]: 0 } }))
    }));
  };

  const removeVariable = (id: string) => {
    setProblem(prev => {
      const newVars = prev.variables.filter(v => v.id !== id);
      const newObj = { ...prev.objective };
      delete newObj[id];
      const newConstraints = prev.constraints.map(c => {
        const newCoeffs = { ...c.coefficients };
        delete newCoeffs[id];
        return { ...c, coefficients: newCoeffs };
      });
      return { ...prev, variables: newVars, objective: newObj, constraints: newConstraints };
    });
  };

  const addConstraint = () => {
    const id = `c${problem.constraints.length + 1}`;
    const coefficients: Record<string, number> = {};
    problem.variables.forEach(v => { coefficients[v.id] = 0; });
    setProblem(prev => ({
      ...prev,
      constraints: [...prev.constraints, { id, coefficients, operator: '<=', rhs: 0 }]
    }));
  };

  const removeConstraint = (id: string) => {
    setProblem(prev => ({ ...prev, constraints: prev.constraints.filter(c => c.id !== id) }));
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-8 py-6 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-blue-200">
              <span className="font-display font-bold text-xl">B&B</span>
            </div>
            <div>
              <h1 className="font-display font-bold text-2xl text-slate-900">分支定界法教学可视化</h1>
              <p className="text-slate-500 text-sm">线性规划与整数规划学习工具</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Problem Input & Logs */}
        <div className="lg:col-span-4 space-y-8">
          {/* Objective Function */}
          <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display font-bold text-lg text-slate-800 flex items-center gap-2">
                <Info className="w-5 h-5 text-blue-500" /> 目标函数
              </h2>
              <select
                className="bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-sm font-medium"
                value={problem.type}
                onChange={e => setProblem(prev => ({ ...prev, type: e.target.value as 'max' | 'min' }))}
                disabled={solverState.status !== 'idle'}
              >
                <option value="max">Maximize</option>
                <option value="min">Minimize</option>
              </select>
            </div>
            
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-lg font-mono">
                <span className="text-slate-400">Z = </span>
                {problem.variables.map((v, idx) => (
                  <React.Fragment key={v.id}>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        className="w-16 bg-slate-50 border border-slate-200 rounded-lg p-2 text-center focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                        value={problem.objective[v.id]}
                        onChange={e => handleUpdateObjective(v.id, e.target.value)}
                        disabled={solverState.status !== 'idle'}
                      />
                      <span className="text-slate-800">{v.name}</span>
                    </div>
                    {idx < problem.variables.length - 1 && <span className="text-slate-300 font-sans">+</span>}
                  </React.Fragment>
                ))}
                <button
                  onClick={addVariable}
                  className="w-8 h-8 flex items-center justify-center bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors ml-2"
                  disabled={solverState.status !== 'idle'}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>

          {/* Constraints */}
          <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display font-bold text-lg text-slate-800">约束条件</h2>
              <button
                onClick={addConstraint}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 uppercase flex items-center gap-1"
                disabled={solverState.status !== 'idle'}
              >
                <Plus className="w-4 h-4" /> 添加约束
              </button>
            </div>
            
            <div className="space-y-6">
              {problem.constraints.map((c, cIdx) => (
                <div key={c.id} className="group relative bg-slate-50 p-4 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
                  <div className="flex flex-wrap items-center gap-3">
                    {problem.variables.map((v, vIdx) => (
                      <React.Fragment key={v.id}>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            className="w-12 bg-white border border-slate-200 rounded-lg p-1 text-center text-sm outline-none focus:ring-2 focus:ring-blue-100"
                            value={c.coefficients[v.id]}
                            onChange={e => handleUpdateConstraint(c.id, v.id, e.target.value)}
                            disabled={solverState.status !== 'idle'}
                          />
                          <span className="text-xs font-semibold text-slate-500">{v.name}</span>
                        </div>
                        {vIdx < problem.variables.length - 1 && <span className="text-slate-300">+</span>}
                      </React.Fragment>
                    ))}
                    <span className="w-8 text-center text-sm font-bold text-slate-700">
                      {c.operator === '<=' ? '≤' : c.operator === '>=' ? '≥' : '='}
                    </span>
                    <input
                      type="number"
                      className="w-12 bg-white border border-slate-200 rounded-lg p-1 text-center text-sm outline-none focus:ring-2 focus:ring-blue-100 font-bold"
                      value={c.rhs}
                      onChange={e => handleUpdateRHS(c.id, e.target.value)}
                      disabled={solverState.status !== 'idle'}
                    />
                    <button
                      onClick={() => removeConstraint(c.id)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-white shadow-sm border border-slate-100 items-center justify-center rounded-full text-slate-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 flex"
                      disabled={solverState.status !== 'idle'}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Decision Variables */}
          <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-lg text-slate-800">决策变量</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {problem.variables.map(v => (
                <div key={v.id} className="flex items-center bg-slate-50 border border-slate-200 rounded-full pl-3 pr-1 py-1 gap-2">
                  <span className="text-xs font-medium text-slate-600">{v.name}</span>
                  <select
                    className="bg-transparent text-[10px] uppercase font-bold text-blue-600 border-none p-0 outline-none cursor-pointer px-1"
                    value={v.type}
                    onChange={e => setProblem(prev => ({ ...prev, variables: prev.variables.map(x => x.id === v.id ? { ...x, type: e.target.value as VariableType } : x) }))}
                    disabled={solverState.status !== 'idle'}
                  >
                    <option value="integer">整数</option>
                    <option value="continuous">大于等于 0</option>
                  </select>
                  <button
                    onClick={() => removeVariable(v.id)}
                    className="w-5 h-5 flex items-center justify-center text-slate-300 hover:text-red-500 rounded-full transition-colors"
                    disabled={solverState.status !== 'idle' || problem.variables.length <= 1}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Activity Log */}
          <section className="bg-slate-900 p-6 rounded-2xl shadow-xl h-64 flex flex-col">
            <h2 className="text-slate-400 font-bold text-xs uppercase tracking-widest mb-4">执行日志</h2>
            <div className="flex-1 overflow-y-auto font-mono text-xs space-y-2 scrollbar-hide">
              {log.length === 0 ? (
                <p className="text-slate-600 italic">等待开始...</p>
              ) : (
                log.map((entry, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-slate-500 shrink-0">[{entry.time}]</span>
                    <span className="text-slate-200">{entry.msg}</span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </section>
        </div>

        {/* Right Column: Visualization & Controls */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          {/* Solver Controls */}
          <section className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-4">
              {solverState.status === 'idle' ? (
                <button
                  onClick={startSolving}
                  className="bg-blue-600 px-6 py-2 rounded-xl text-white font-bold flex items-center gap-2 hover:bg-blue-700 transition-all active:scale-95 shadow-lg shadow-blue-100"
                >
                  <Play className="w-4 h-4" /> 开始求解
                </button>
              ) : (
                <>
                  <button
                    onClick={solveNextStep}
                    disabled={solverState.status === 'finished' || autoSolve}
                    className="bg-slate-800 px-6 py-2 rounded-xl text-white font-bold flex items-center gap-2 hover:bg-slate-900 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <SkipForward className="w-4 h-4" /> 单步执行
                  </button>
                  <button
                    onClick={() => setAutoSolve(!autoSolve)}
                    disabled={solverState.status === 'finished'}
                    className={`${autoSolve ? 'bg-amber-100 text-amber-700' : 'bg-amber-500 text-white'} px-6 py-2 rounded-xl font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-amber-50`}
                  >
                    <Play className="w-4 h-4" /> {autoSolve ? '暂停演示' : '自动演示'}
                  </button>
                </>
              )}
              <button
                onClick={resetSolving}
                className="text-slate-400 hover:text-slate-600 p-2 transition-colors"
                title="重置"
              >
                <RotateCcw className="w-6 h-6" />
              </button>
            </div>

            {solverState.bestSolution && (
              <div className="flex items-center gap-6 pr-4">
                <div className="text-right">
                  <p className="text-[10px] uppercase font-bold text-slate-400">当前最佳 Z</p>
                  <p className="text-2xl font-display font-bold text-green-600">{solverState.bestSolution.value.toFixed(2)}</p>
                </div>
                <div className="w-px h-10 bg-slate-100" />
                <div className="flex gap-4">
                   {Object.entries(solverState.bestSolution.variables).map(([varId, val]) => (
                     <div key={varId}>
                       <p className="text-[10px] uppercase font-bold text-slate-400">{varId}</p>
                       <p className="text-lg font-display font-bold text-slate-700">{(val as number).toFixed(2)}</p>
                     </div>
                   ))}
                </div>
              </div>
            )}
          </section>

          {/* Tree Visualization */}
          <TreeVisualizer nodes={solverState.nodes} currentNodeId={solverState.currentNodeId} />

          {/* Summary/Legend */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-20 h-20 bg-blue-50 rounded-full translate-x-10 -translate-y-10 transition-transform group-hover:scale-110" />
              <h3 className="text-slate-400 font-bold text-[10px] uppercase tracking-wider mb-1 relative">待探索</h3>
              <p className="text-2xl font-display font-bold text-slate-900 relative">{solverState.queue.length}</p>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
               <div className="absolute top-0 right-0 w-20 h-20 bg-slate-50 rounded-full translate-x-10 -translate-y-10 transition-transform group-hover:scale-110" />
              <h3 className="text-slate-400 font-bold text-[10px] uppercase tracking-wider mb-1 relative">已探索</h3>
              <p className="text-2xl font-display font-bold text-slate-900 relative">{solverState.nodes.filter(n => n.result).length}</p>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
               <div className="absolute top-0 right-0 w-20 h-20 bg-green-50 rounded-full translate-x-10 -translate-y-10 transition-transform group-hover:scale-110" />
              <h3 className="text-slate-400 font-bold text-[10px] uppercase tracking-wider mb-1 relative">可行解</h3>
              <p className="text-2xl font-display font-bold text-green-600 relative">{solverState.nodes.filter(n => n.pruneReason === 'integer_optimal').length}</p>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
               <div className="absolute top-0 right-0 w-20 h-20 bg-red-50 rounded-full translate-x-10 -translate-y-10 transition-transform group-hover:scale-110" />
              <h3 className="text-slate-400 font-bold text-[10px] uppercase tracking-wider mb-1 relative">已剪枝</h3>
              <p className="text-2xl font-display font-bold text-red-500 relative">{solverState.nodes.filter(n => n.pruneReason && n.pruneReason !== 'integer_optimal').length}</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
