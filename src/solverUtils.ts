import solver from 'javascript-lp-solver';
import { Problem, Constraint, NodeResult } from './types';

export function solveLP(problem: Problem, nodeConstraints: Constraint[]): NodeResult {
  const model: any = {
    optimize: 'obj',
    opType: problem.type,
    constraints: {},
    variables: {},
  };

  // Add problem constraints
  problem.constraints.forEach((c, idx) => {
    const cId = `c_${idx}`;
    model.constraints[cId] = {};
    if (c.operator === '<=') model.constraints[cId].max = c.rhs;
    else if (c.operator === '>=') model.constraints[cId].min = c.rhs;
    else model.constraints[cId].equal = c.rhs;

    Object.entries(c.coefficients).forEach(([varId, val]) => {
      if (!model.variables[varId]) model.variables[varId] = {};
      model.variables[varId][cId] = val;
    });
  });

  // Add node-specific constraints (branching constraints)
  nodeConstraints.forEach((c, idx) => {
    const cId = `nc_${idx}`;
    model.constraints[cId] = {};
    if (c.operator === '<=') model.constraints[cId].max = c.rhs;
    else if (c.operator === '>=') model.constraints[cId].min = c.rhs;
    else model.constraints[cId].equal = c.rhs;

    Object.entries(c.coefficients).forEach(([varId, val]) => {
      if (!model.variables[varId]) model.variables[varId] = {};
      model.variables[varId][cId] = val;
    });
  });

  // Add objective function
  Object.entries(problem.objective).forEach(([varId, val]) => {
    if (!model.variables[varId]) model.variables[varId] = {};
    model.variables[varId].obj = val;
  });

  const result: any = solver.Solve(model);

  if (result.feasible === false) {
    return { objectiveValue: null, variableValues: null, status: 'infeasible' };
  }

  const variableValues: Record<string, number> = {};
  problem.variables.forEach(v => {
    variableValues[v.id] = result[v.id] || 0;
  });

  return {
    objectiveValue: result.result,
    variableValues,
    status: 'optimal',
  };
}
