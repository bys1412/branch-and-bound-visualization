export type VariableType = 'integer' | 'continuous';

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
}

export interface Constraint {
  id: string;
  coefficients: Record<string, number>;
  operator: '<=' | '>=' | '='; // Constraints are inequalities or equalities
  rhs: number;
}

export interface Problem {
  type: 'max' | 'min';
  objective: Record<string, number>;
  variables: Variable[];
  constraints: Constraint[];
}

export interface NodeResult {
  objectiveValue: number | null;
  variableValues: Record<string, number> | null;
  status: 'optimal' | 'infeasible' | 'unbounded';
}

export type PruneReason = 'infeasible' | 'worse_than_best' | 'integer_optimal' | null;

export interface SolverNode {
  id: string;
  parentId: string | null;
  level: number;
  constraints: Constraint[]; // Specific constraints for this branch
  result: NodeResult | null;
  pruneReason: PruneReason;
  branchVar?: string;
  branchValue?: number;
  branchDirection?: 'left' | 'right';
}

export interface SolverState {
  nodes: SolverNode[];
  queue: string[]; // IDs of nodes to be explored
  bestSolution: {
    value: number;
    variables: Record<string, number>;
    nodeId: string;
  } | null;
  status: 'idle' | 'solving' | 'finished';
  currentNodeId: string | null;
}
