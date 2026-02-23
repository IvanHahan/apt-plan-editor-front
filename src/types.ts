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
 * Geometry polygon for an edge
 */
export interface EdgeGeometry {
  id: string;
  polygon_coords: [number, number][];
}

/**
 * Represents a connection between two nodes (wall, door, or window)
 */
export interface Edge {
  id: string;
  source: string; // Node ID
  target: string; // Node ID
  type: EdgeType;
  thickness?: number;
  shift?: number;   // Lateral offset perpendicular to wall direction
  is_inner?: boolean;
  properties?: Record<string, any>;
  geometries?: EdgeGeometry[];
}

/**
 * Represents a room with polygon coordinates
 */
export interface Room {
  id: string;
  polygon_coords: [number, number][];
  tags: string[];
  locked?: boolean; // For redesign mode
}

/**
 * Represents a fixture (door, window, furniture) with polygon coordinates
 */
export interface Fixture {
  id: string;
  polygon_coords: [number, number][];
  fixture_type: string;
  properties?: Record<string, any>;
}

/**
 * Complete floor plan data structure
 */
export interface FloorPlan {
  nodes: Node[];
  edges: Edge[];
  rooms?: Room[];
  fixtures?: Fixture[];
  /** false = uncalibrated (pixel coords); true = coordinates are in metres */
  is_calibrated?: boolean;
}

/**
 * Available editor tools
 */
export type EditorTool = 'cursor' | 'selection' | 'wall' | 'assets';

/**
 * Asset type for the assets tool
 */
export type AssetType = 'door' | 'window';

/**
 * Describes a resolved snap position for placing an asset onto a wall
 */
export interface AssetPlacement {
  wallEdge: Edge;
  wallSourceNode: Node;
  wallTargetNode: Node;
  assetStartPt: { x: number; y: number };
  assetEndPt: { x: number; y: number };
}

/**
 * Props for WallToolOptions panel
 */
export interface WallToolOptionsProps {
  thickness: number;          // in data-space units
  onThicknessChange: (v: number) => void;
  isCalibrated: boolean;
}

/**
 * Props for AssetToolOptions panel
 */
export interface AssetToolOptionsProps {
  assetType: AssetType;
  /** Width in metres when calibrated, pixels when uncalibrated */
  widthM: number;
  onAssetTypeChange: (t: AssetType) => void;
  onWidthChange: (m: number) => void;
  isCalibrated: boolean;
}

/**
 * Tool metadata for UI rendering
 */
export interface ToolDefinition {
  id: EditorTool;
  label: string;
  icon: string;
  description: string;
}
