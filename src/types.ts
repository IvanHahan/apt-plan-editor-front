/**
 * Represents a junction point in the floor plan
 */
export interface Node {
  id: string;
  x: number;
  y: number;
}

/**
 * Type of edge/wall element
 */
export type EdgeType = "wall" | "door" | "window";

/**
 * Represents a connection between two nodes (wall, door, or window)
 */
export interface Edge {
  id: string;
  source: string; // Node ID
  target: string; // Node ID
  type: EdgeType;
}

/**
 * Complete floor plan data structure
 */
export interface FloorPlan {
  nodes: Node[];
  edges: Edge[];
}
