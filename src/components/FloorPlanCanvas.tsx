import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { FloorPlan, Node, Edge, Room, Fixture, EditorTool, AssetType, AssetPlacement } from '../types';
import './FloorPlanCanvas.css';

interface FloorPlanCanvasProps {
  floorPlan: FloorPlan;
  onEdgeClick?: (edgeId: string) => void;
  onRoomClick?: (roomId: string) => void;
  measureMode?: boolean;
  onMeasure?: (pixelDistance: number) => void;
  isEditMode?: boolean;
  onNodePositionsChange?: (nodes: Node[]) => void;
  selectedEdgeIds?: Set<string>;
  onSelectedEdgesChange?: (edgeIds: string[]) => void;
  onEdgeDelete?: (edgeId: string) => void;
  activeTool?: EditorTool;
  wallThickness?: number;
  /** splits: map of nodeId → edgeId that should be split at that node's position */
  onWallAdd?: (edge: Edge, newNodes: Node[], splits?: { [nodeId: string]: string }) => void;
  /** Asset tool: type of asset to place */
  assetType?: AssetType;
  /** Asset tool: desired asset width in metres (or pixels when uncalibrated) */
  assetWidthM?: number;
  /** Asset tool: called when user places an asset on a wall */
  onAssetPlace?: (placement: AssetPlacement) => void;
}

// ============================================
// Wall Geometry Types & Utilities
// ============================================

interface Point {
  x: number;
  y: number;
}

interface WallPolygon {
  edge: Edge;
  polygon: Point[];
}

// ─── Guideline descriptors ────────────────────────────────────────────────────
type GuidelineOrientation = 'horizontal' | 'vertical' | 'along';

interface Guideline {
  orientation: GuidelineOrientation;
  /** Fixed coordinate value in data-space ('horizontal' / 'vertical') */
  value?: number;
  /** Anchor point in data-space ('along') */
  anchor?: Point;
  /** Unit direction vector in data-space ('along') */
  direction?: Point;
  color?: string;
  label?: string;
}
// ─────────────────────────────────────────────────────────────────────────────

function vecSub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Format a data-space length as metres (calibrated) or pixels (uncalibrated). */
function formatDataLen(dataLen: number, isCalibrated: boolean): string {
  return isCalibrated
    ? `${dataLen.toFixed(2)} m`
    : `${Math.round(dataLen)} px`;
}

function vecAdd(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function vecScale(v: Point, s: number): Point {
  return { x: v.x * s, y: v.y * s };
}

function vecLen(v: Point): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function vecNorm(v: Point): Point {
  const len = vecLen(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function vecPerp(v: Point): Point {
  return { x: -v.y, y: v.x };
}

function vecAngle(v: Point): number {
  return Math.atan2(v.y, v.x);
}

function vecCross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

/**
 * Calculate polygon area using Shoelace formula
 */
function calculatePolygonArea(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[(i + 1) % coords.length];
    area += x1 * y2 - x2 * y1;
  }
  
  return Math.abs(area) / 2;
}

/**
 * Calculate centroid of a polygon
 */
function calculateCentroid(coords: [number, number][]): { x: number; y: number } {
  if (coords.length === 0) return { x: 0, y: 0 };
  
  // Calculate geometric centroid using signed area formula
  let area = 0;
  let cx = 0;
  let cy = 0;
  
  for (let i = 0; i < coords.length; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[(i + 1) % coords.length];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  
  area /= 2;
  
  // Avoid division by zero for degenerate polygons
  if (Math.abs(area) < 1e-10) {
    // Fallback to arithmetic mean
    let sumX = 0, sumY = 0;
    coords.forEach(([x, y]) => {
      sumX += x;
      sumY += y;
    });
    return { x: sumX / coords.length, y: sumY / coords.length };
  }
  
  cx /= (6 * area);
  cy /= (6 * area);
  
  // Check if centroid is inside the polygon
  if (isPointInPolygon({ x: cx, y: cy }, coords)) {
    return { x: cx, y: cy };
  }
  
  // If centroid is outside (non-convex polygon), find a point inside
  // Use the center of the bounding box as fallback
  const xs = coords.map(c => c[0]);
  const ys = coords.map(c => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const bboxCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  
  if (isPointInPolygon(bboxCenter, coords)) {
    return bboxCenter;
  }
  
  // Last resort: use first vertex
  return { x: coords[0][0], y: coords[0][1] };
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 */
function isPointInPolygon(point: { x: number; y: number }, coords: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][0], yi = coords[i][1];
    const xj = coords[j][0], yj = coords[j][1];
    
    const intersect = ((yi > point.y) !== (yj > point.y))
      && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Line intersection: find where line (p1 + t*d1) meets line (p2 + s*d2)
 */
function lineIntersect(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const cross = vecCross(d1, d2);
  if (Math.abs(cross) < 1e-10) return null;
  const t = vecCross(vecSub(p2, p1), d2) / cross;
  return vecAdd(p1, vecScale(d1, t));
}

/**
 * Build node adjacency map for walls
 */
function buildWallAdjacency(walls: Edge[]): Map<string, Edge[]> {
  const adj = new Map<string, Edge[]>();
  for (const w of walls) {
    if (!adj.has(w.source)) adj.set(w.source, []);
    if (!adj.has(w.target)) adj.set(w.target, []);
    adj.get(w.source)!.push(w);
    adj.get(w.target)!.push(w);
  }
  return adj;
}

/**
 * Get outward direction from a node along an edge
 */
function getEdgeDir(edge: Edge, fromNode: string, nodeMap: Map<string, Node>): Point {
  const from = nodeMap.get(fromNode)!;
  const toId = edge.source === fromNode ? edge.target : edge.source;
  const to = nodeMap.get(toId)!;
  return vecNorm(vecSub({ x: to.x, y: to.y }, { x: from.x, y: from.y }));
}

/**
 * Compute corner points at a junction for proper miter joins
 */
function computeJunctionCorners(
  nodeId: string,
  nodePos: Point,
  edge: Edge,
  adjEdges: Edge[],
  nodeMap: Map<string, Node>,
  halfThick: number
): { left: Point; right: Point } {
  const dir = getEdgeDir(edge, nodeId, nodeMap);
  const perpDir = vecPerp(dir);
  
  // Default simple perpendicular corners
  const defaultLeft = vecAdd(nodePos, vecScale(perpDir, halfThick));
  const defaultRight = vecAdd(nodePos, vecScale(perpDir, -halfThick));
  
  if (adjEdges.length <= 1) {
    return { left: defaultLeft, right: defaultRight };
  }
  
  // Sort edges by angle around the node
  const sorted = adjEdges.map(e => ({
    edge: e,
    dir: getEdgeDir(e, nodeId, nodeMap),
    angle: vecAngle(getEdgeDir(e, nodeId, nodeMap))
  })).sort((a, b) => a.angle - b.angle);
  
  // Find index of current edge
  const idx = sorted.findIndex(s => s.edge.id === edge.id);
  if (idx === -1) return { left: defaultLeft, right: defaultRight };
  
  const n = sorted.length;
  const prev = sorted[(idx - 1 + n) % n]; // CCW neighbor
  const next = sorted[(idx + 1) % n];      // CW neighbor
  
  // For LEFT corner: intersect our left edge with CCW neighbor's RIGHT edge
  let left = defaultLeft;
  if (prev.edge.id !== edge.id) {
    const prevPerp = vecPerp(prev.dir);
    const prevHalf = (prev.edge.thickness || halfThick * 2) / 2;
    
    // Our left edge: starts at nodePos + perpDir * halfThick, goes along dir
    const p1 = vecAdd(nodePos, vecScale(perpDir, halfThick));
    // Neighbor's RIGHT edge: starts at nodePos - prevPerp * prevHalf, goes along prev.dir
    const p2 = vecAdd(nodePos, vecScale(prevPerp, -prevHalf));
    
    const inter = lineIntersect(p1, dir, p2, prev.dir);
    if (inter) {
      const dist = vecLen(vecSub(inter, nodePos));
      // Limit miter to avoid extreme spikes at very acute angles
      if (dist < Math.max(halfThick, prevHalf) * 4) {
        left = inter;
      }
    }
  }
  
  // For RIGHT corner: intersect our right edge with CW neighbor's LEFT edge
  let right = defaultRight;
  if (next.edge.id !== edge.id) {
    const nextPerp = vecPerp(next.dir);
    const nextHalf = (next.edge.thickness || halfThick * 2) / 2;
    
    // Our right edge: starts at nodePos - perpDir * halfThick, goes along dir
    const p1 = vecAdd(nodePos, vecScale(perpDir, -halfThick));
    // Neighbor's LEFT edge: starts at nodePos + nextPerp * nextHalf, goes along next.dir
    const p2 = vecAdd(nodePos, vecScale(nextPerp, nextHalf));
    
    const inter = lineIntersect(p1, dir, p2, next.dir);
    if (inter) {
      const dist = vecLen(vecSub(inter, nodePos));
      if (dist < Math.max(halfThick, nextHalf) * 4) {
        right = inter;
      }
    }
  }
  
  return { left, right };
}

/**
 * Compute wall polygons with proper corner joints
 */
function computeWallPolygons(walls: Edge[], nodeMap: Map<string, Node>, defaultThickness = 0.2): WallPolygon[] {
  const adj = buildWallAdjacency(walls);
  const result: WallPolygon[] = [];
  
  for (const wall of walls) {
    const srcNode = nodeMap.get(wall.source);
    const tgtNode = nodeMap.get(wall.target);
    if (!srcNode || !tgtNode) continue;
    
    const thick = wall.thickness || defaultThickness;
    const half = thick / 2;
    
    const srcPos: Point = { x: srcNode.x, y: srcNode.y };
    const tgtPos: Point = { x: tgtNode.x, y: tgtNode.y };
    
    const srcAdj = adj.get(wall.source) || [wall];
    const tgtAdj = adj.get(wall.target) || [wall];
    
    const srcCorners = computeJunctionCorners(wall.source, srcPos, wall, srcAdj, nodeMap, half);
    const tgtCorners = computeJunctionCorners(wall.target, tgtPos, wall, tgtAdj, nodeMap, half);
    
    // Note: target corners are computed with reversed direction, so swap left/right
    let polygon: Point[] = [srcCorners.left, tgtCorners.right, tgtCorners.left, srcCorners.right];

    // Apply lateral shift: offset all polygon points perpendicularly to the wall axis
    const wallShift = wall.shift ?? 0;
    if (wallShift !== 0) {
      const dx = tgtPos.x - srcPos.x;
      const dy = tgtPos.y - srcPos.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const perpX = (-dy / len) * wallShift;
        const perpY = (dx / len) * wallShift;
        polygon = polygon.map(pt => ({ x: pt.x + perpX, y: pt.y + perpY }));
      }
    }

    result.push({ edge: wall, polygon });
  }
  
  return result;
}

/**
 * Snap `end` so the direction start→end is parallel to an existing wall.
 *
 * Computes the perpendicular screen-pixel distance from `end` to the line
 * through `start` in each reference wall's direction.  Returns the snap with
 * the smallest deviation when it falls within `snapPx`, or null.
 *
 * `excludeNodeId` — skip walls already connected to the draw start-node to
 * avoid self-referential snapping.
 */
function snapToParallel(
  start: Point,
  end: Point,
  edges: Edge[],
  nodes: Node[],
  excludeNodeId: string | null,
  k: number,
  snapPx = AXIS_SNAP_PX,
  minLenPx = AXIS_SNAP_MIN_LEN_PX,
): { point: Point; guidelines: Guideline[] } | null {
  const currentDx = end.x - start.x;
  const currentDy = end.y - start.y;
  if (Math.hypot(currentDx, currentDy) * k < minLenPx) return null;
  const currentLen = Math.hypot(currentDx, currentDy);
  const currentNormX = currentDx / currentLen;
  const currentNormY = currentDy / currentLen;

  let bestDev = snapPx;
  let bestResult: { point: Point; guidelines: Guideline[] } | null = null;

  for (const edge of edges) {
    if (excludeNodeId && (edge.source === excludeNodeId || edge.target === excludeNodeId)) continue;
    const fromNode = nodes.find(n => n.id === edge.source);
    const toNode   = nodes.find(n => n.id === edge.target);
    if (!fromNode || !toNode) continue;
    const refDx = toNode.x - fromNode.x;
    const refDy = toNode.y - fromNode.y;
    const refLen = Math.hypot(refDx, refDy);
    if (refLen < 1e-6) continue;
    const refDirX = refDx / refLen;
    const refDirY = refDy / refLen;

    // Must be roughly parallel (|dot| > 0.5 ≈ within 60° of each other)
    const dot = Math.abs(currentNormX * refDirX + currentNormY * refDirY);
    if (dot < 0.5) continue;

    // Perpendicular dist (screen px) from `end` to line through `start` in refDir
    const perpPx = Math.abs(currentDx * refDirY - currentDy * refDirX) * k;
    if (perpPx >= bestDev) continue;

    // Project `end` onto the parallel line through `start`
    const t = currentDx * refDirX + currentDy * refDirY;
    bestDev = perpPx;
    bestResult = {
      point: { x: start.x + t * refDirX, y: start.y + t * refDirY },
      guidelines: [{ orientation: 'along', anchor: start, direction: { x: refDirX, y: refDirY }, color: '#FF9800' }],
    };
  }
  return bestResult;
}

/**
 * Screen-pixel perpendicular distance at which axis snap engages/releases.
 * Because it's pixel-based (not angle-based) it feels consistent regardless
 * of wall length or zoom level — you always need to move ~AXIS_SNAP_PX screen
 * pixels away from the axis to break free.
 */
const AXIS_SNAP_PX = 8;
/** Minimum wall length in screen pixels before axis snap activates. */
const AXIS_SNAP_MIN_LEN_PX = 20;

/**
 * Snap `end` toward the horizontal or vertical axis through `start`.
 *
 * Uses screen-pixel perpendicular distance (requires zoom scale `k`) so
 * engagement and release feel the same regardless of wall length or zoom.
 * The primary axis (H vs V) is chosen by whichever component is dominant.
 *
 * Returns the snapped point + Guideline descriptor(s), or null when the
 * perpendicular deviation exceeds `snapPx` or the wall is too short.
 */
function snapToAxis(
  start: Point,
  end: Point,
  k: number,
  snapPx = AXIS_SNAP_PX,
  minLenPx = AXIS_SNAP_MIN_LEN_PX,
): { point: Point; guidelines: Guideline[] } | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenPx = Math.hypot(dx, dy) * k;
  if (lenPx < minLenPx) return null;
  if (Math.abs(dy) <= Math.abs(dx)) {
    // Primarily horizontal — perpendicular deviation is vertical
    if (Math.abs(dy) * k < snapPx) {
      return {
        point: { x: end.x, y: start.y },
        guidelines: [{ orientation: 'horizontal', value: start.y }],
      };
    }
  } else {
    // Primarily vertical — perpendicular deviation is horizontal
    if (Math.abs(dx) * k < snapPx) {
      return {
        point: { x: start.x, y: end.y },
        guidelines: [{ orientation: 'vertical', value: start.x }],
      };
    }
  }
  return null;
}

/**
 * Create simple rectangle polygon (for doors/windows)
 */
function createRectPolygon(p1: Point, p2: Point, thickness: number): Point[] {
  const dir = vecNorm(vecSub(p2, p1));
  const perpDir = vecPerp(dir);
  const half = thickness / 2;
  return [
    vecAdd(p1, vecScale(perpDir, half)),
    vecAdd(p2, vecScale(perpDir, half)),
    vecAdd(p2, vecScale(perpDir, -half)),
    vecAdd(p1, vecScale(perpDir, -half))
  ];
}

/**
 * Create door arc SVG path
 */
function createDoorArc(x1: number, y1: number, x2: number, y2: number, radius: number): string {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return '';
  const px = -dy / len, py = dx / len;
  const endX = x1 + px * radius, endY = y1 + py * radius;
  return `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${endX} ${endY}`;
}

// ============================================
// Geometry Annotation Helpers
// ============================================

/**
 * Render a dimension label along a segment p1→p2, offset perpendicularly.
 * Uses orange (#FF9800) colour for lengths.
 */
function renderLengthLabel(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  p1: Point, p2: Point,
  text: string,
  k: number,
): void {
  const dir = vecNorm(vecSub(p2, p1));
  const perp = vecPerp(dir);
  const offset = 18 / k;
  const tickLen = 6 / k;
  const fontSize = 11 / k;
  const pad = 3 / k;

  // Extension lines from each endpoint to the dimension line
  for (const pt of [p1, p2]) {
    g.append('line')
      .attr('x1', pt.x).attr('y1', pt.y)
      .attr('x2', pt.x + perp.x * offset).attr('y2', pt.y + perp.y * offset)
      .attr('stroke', '#FF9800').attr('stroke-width', 0.8 / k)
      .attr('stroke-dasharray', `${4 / k},${2 / k}`)
      .attr('pointer-events', 'none');
  }
  // Dimension line parallel to the segment
  g.append('line')
    .attr('x1', p1.x + perp.x * offset).attr('y1', p1.y + perp.y * offset)
    .attr('x2', p2.x + perp.x * offset).attr('y2', p2.y + perp.y * offset)
    .attr('stroke', '#FF9800').attr('stroke-width', 1.2 / k)
    .attr('pointer-events', 'none');
  // Tick caps at each end of the dimension line
  for (const pt of [p1, p2]) {
    const tx = pt.x + perp.x * offset;
    const ty = pt.y + perp.y * offset;
    g.append('line')
      .attr('x1', tx - dir.x * tickLen / 2).attr('y1', ty - dir.y * tickLen / 2)
      .attr('x2', tx + dir.x * tickLen / 2).attr('y2', ty + dir.y * tickLen / 2)
      .attr('stroke', '#FF9800').attr('stroke-width', 1.2 / k)
      .attr('pointer-events', 'none');
  }
  // Label
  const dmx = (p1.x + p2.x) / 2 + perp.x * offset;
  const dmy = (p1.y + p2.y) / 2 + perp.y * offset;
  const bgRect = g.append('rect')
    .attr('fill', 'rgba(0,0,0,0.72)').attr('rx', 2 / k).attr('pointer-events', 'none');
  const textEl = g.append('text')
    .attr('x', dmx).attr('y', dmy)
    .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
    .attr('font-size', `${fontSize}px`).attr('fill', '#FF9800')
    .attr('font-family', 'monospace').attr('font-weight', 'bold')
    .attr('pointer-events', 'none')
    .text(text);
  try {
    const bbox = (textEl.node() as SVGGraphicsElement).getBBox();
    bgRect
      .attr('x', bbox.x - pad).attr('y', bbox.y - pad)
      .attr('width', bbox.width + 2 * pad).attr('height', bbox.height + 2 * pad);
  } catch (_) { /* getBBox unavailable outside live DOM */ }
}

/**
 * Render angle arcs between consecutive sorted direction angles at a node.
 * Uses cyan (#00BCD4) colour for angles.
 * dirAngles must be sorted ascending (radians).
 */
function renderAngleArcs(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  center: Point,
  dirAngles: number[],
  k: number,
): void {
  const n = dirAngles.length;
  if (n < 2) return;
  const arcRadius = 20 / k;
  const fontSize = 11 / k;
  const pad = 2 / k;
  for (let i = 0; i < n; i++) {
    const a1 = dirAngles[i];
    const a2 = dirAngles[(i + 1) % n];
    let sweep = a2 - a1;
    if (sweep <= 0) sweep += Math.PI * 2;
    const deg = (sweep * 180 / Math.PI).toFixed(1);
    const startX = center.x + arcRadius * Math.cos(a1);
    const startY = center.y + arcRadius * Math.sin(a1);
    const endX   = center.x + arcRadius * Math.cos(a2);
    const endY   = center.y + arcRadius * Math.sin(a2);
    const largeArc = sweep > Math.PI ? 1 : 0;
    g.append('path')
      .attr('d', `M ${startX} ${startY} A ${arcRadius} ${arcRadius} 0 ${largeArc} 1 ${endX} ${endY}`)
      .attr('fill', 'none')
      .attr('stroke', '#00BCD4').attr('stroke-width', 1.2 / k)
      .attr('pointer-events', 'none');
    const midAngle = a1 + sweep / 2;
    const labelRadius = arcRadius + 14 / k;
    const lx = center.x + labelRadius * Math.cos(midAngle);
    const ly = center.y + labelRadius * Math.sin(midAngle);
    const bgRect = g.append('rect')
      .attr('fill', 'rgba(0,0,0,0.72)').attr('rx', 2 / k).attr('pointer-events', 'none');
    const textEl = g.append('text')
      .attr('x', lx).attr('y', ly)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('font-size', `${fontSize}px`).attr('fill', '#00BCD4')
      .attr('font-family', 'monospace').attr('font-weight', 'bold')
      .attr('pointer-events', 'none')
      .text(`${deg}°`);
    try {
      const bbox = (textEl.node() as SVGGraphicsElement).getBBox();
      bgRect
        .attr('x', bbox.x - pad).attr('y', bbox.y - pad)
        .attr('width', bbox.width + 2 * pad).attr('height', bbox.height + 2 * pad);
    } catch (_) { /* getBBox unavailable outside live DOM */ }
  }
}

export const FloorPlanCanvas: React.FC<FloorPlanCanvasProps> = ({
  floorPlan,
  onEdgeClick,
  onRoomClick,
  measureMode,
  onMeasure,
  isEditMode,
  onNodePositionsChange,
  selectedEdgeIds = new Set(),
  onSelectedEdgesChange,
  onEdgeDelete,
  activeTool,
  wallThickness = 16,
  onWallAdd,
  assetType = 'door',
  assetWidthM = 0.8,
  onAssetPlace,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const drawGRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const measureGRef = useRef<SVGGElement>(null);
  const wallPreviewGRef = useRef<SVGGElement | null>(null);
  const dragGhostGRef = useRef<SVGGElement | null>(null);
  const guidelineGRef = useRef<SVGGElement | null>(null);
  const annotationGRef = useRef<SVGGElement | null>(null);

  // Track calibration state to reset zoom when it changes
  const prevIsCalibrated = useRef<boolean | undefined>(undefined);

  // Wall drawing state — kept in refs to avoid re-renders on every mouse move
  const wallDrawRef = useRef<{ startPoint: Point; startNodeId?: string; startSplitEdgeId?: string } | null>(null);
  const wallSnapNodeRef = useRef<string | null>(null);
  const wallSnapEdgeRef = useRef<string | null>(null); // edge ID currently highlighted for snap
  // Always-current refs so wall handlers never get stale closures
  const wallThicknessRef = useRef(wallThickness);
  wallThicknessRef.current = wallThickness;
  const onWallAddRef = useRef(onWallAdd);
  onWallAddRef.current = onWallAdd;
  const wallFloorPlanNodesRef = useRef(floorPlan.nodes);
  wallFloorPlanNodesRef.current = floorPlan.nodes;
  const wallFloorPlanEdgesRef = useRef(floorPlan.edges);
  wallFloorPlanEdgesRef.current = floorPlan.edges;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const selectedEdgeIdsRef = useRef(selectedEdgeIds);
  selectedEdgeIdsRef.current = selectedEdgeIds;

  // Asset tool state — kept in refs to avoid re-renders on every mouse move
  interface AssetSnap {
    edge: Edge;
    sourceNode: Node;
    targetNode: Node;
    assetStartPt: Point;
    assetEndPt: Point;
  }
  const assetSnapRef = useRef<AssetSnap | null>(null);
  const assetTypeRef = useRef(assetType);
  assetTypeRef.current = assetType;
  const assetWidthMRef = useRef(assetWidthM);
  assetWidthMRef.current = assetWidthM;
  const onAssetPlaceRef = useRef(onAssetPlace);
  onAssetPlaceRef.current = onAssetPlace;
  const isCalibratedRef = useRef<boolean>(floorPlan.is_calibrated ?? false);
  isCalibratedRef.current = floorPlan.is_calibrated ?? false;

  const [measurePoint1, setMeasurePoint1] = useState<Point | null>(null);
  const [measurePoint2, setMeasurePoint2] = useState<Point | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [draggedEdge, setDraggedEdge] = useState<Edge | null>(null);
  const [isShiftPressed, setIsShiftPressed] = useState<boolean>(false);
  const [selectionBox, setSelectionBox] = useState<{x1: number; y1: number; x2: number; y2: number} | null>(null);
  const [contextMenu, setContextMenu] = useState<{x: number; y: number; edgeId: string} | null>(null);

  // Close context menu on any click (with delay to avoid immediate closing)
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      // Delay adding the listener to avoid catching the same click that opened the menu
      const timeoutId = setTimeout(() => {
        window.addEventListener('click', handleClick);
      }, 100);
      return () => {
        clearTimeout(timeoutId);
        window.removeEventListener('click', handleClick);
      };
    }
  }, [contextMenu]);

  // Track Shift key state for multiselect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Reset measurement when mode changes
  useEffect(() => {
    if (!measureMode) {
      setMeasurePoint1(null);
      setMeasurePoint2(null);
      if (measureGRef.current) {
        d3.select(measureGRef.current).selectAll('*').remove();
      }
    }
  }, [measureMode]);

  // Draw measurement line when points change
  useEffect(() => {
    if (!measureGRef.current) return;
    const mg = d3.select(measureGRef.current);
    mg.selectAll('*').remove();

    // Compute data-space unit for proportional sizing
    let mDataExtent = 1;
    if (floorPlan.nodes.length > 0) {
      const xs = floorPlan.nodes.map((n: Node) => n.x);
      const ys = floorPlan.nodes.map((n: Node) => n.y);
      const dx = Math.max(...xs) - Math.min(...xs);
      const dy = Math.max(...ys) - Math.min(...ys);
      mDataExtent = Math.max(dx, dy, 1);
    }
    const mu = mDataExtent / 500;

    if (measurePoint1) {
      // Draw first point marker
      mg.append('circle')
        .attr('cx', measurePoint1.x)
        .attr('cy', measurePoint1.y)
        .attr('r', 1.5 * mu)
        .attr('fill', '#e53935')
        .attr('stroke', '#fff')
        .attr('stroke-width', 0.5 * mu);
    }

    if (measurePoint1 && measurePoint2) {
      const dist = vecLen(vecSub(measurePoint2, measurePoint1));

      // Draw second point marker
      mg.append('circle')
        .attr('cx', measurePoint2.x)
        .attr('cy', measurePoint2.y)
        .attr('r', 1.5 * mu)
        .attr('fill', '#e53935')
        .attr('stroke', '#fff')
        .attr('stroke-width', 0.5 * mu);

      // Draw dashed measurement line
      mg.append('line')
        .attr('x1', measurePoint1.x)
        .attr('y1', measurePoint1.y)
        .attr('x2', measurePoint2.x)
        .attr('y2', measurePoint2.y)
        .attr('stroke', '#e53935')
        .attr('stroke-width', 1 * mu)
        .attr('stroke-dasharray', `${3 * mu},${2 * mu}`);

      // Draw distance label at midpoint
      const midX = (measurePoint1.x + measurePoint2.x) / 2;
      const midY = (measurePoint1.y + measurePoint2.y) / 2;

      mg.append('rect')
        .attr('x', midX - 20 * mu)
        .attr('y', midY - 8 * mu)
        .attr('width', 40 * mu)
        .attr('height', 16 * mu)
        .attr('rx', 3 * mu)
        .attr('fill', 'rgba(229, 57, 53, 0.9)');

      mg.append('text')
        .attr('x', midX)
        .attr('y', midY + 4 * mu)
        .attr('text-anchor', 'middle')
        .attr('fill', '#fff')
        .attr('font-size', `${8 * mu}px`)
        .attr('font-weight', 'bold')
        .text(`${dist.toFixed(1)} px`);

      onMeasure?.(dist);
    }
  }, [measurePoint1, measurePoint2, onMeasure, floorPlan.nodes]);

  // Handle measurement clicks via capturing listener so it fires
  // before child elements' stopPropagation can block it
  const measureStateRef = useRef({ measurePoint1, measurePoint2 });
  measureStateRef.current = { measurePoint1, measurePoint2 };

  useEffect(() => {
    if (!measureMode || !svgRef.current || !gRef.current) return;

    const svg = svgRef.current;
    const gElement = gRef.current;

    const handleMeasureClick = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();

      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;

      const ctm = gElement.getScreenCTM();
      if (!ctm) return;
      const transformedPoint = point.matrixTransform(ctm.inverse());
      const dataPoint: Point = { x: transformedPoint.x, y: transformedPoint.y };

      const { measurePoint1: p1, measurePoint2: p2 } = measureStateRef.current;
      if (!p1 || p2) {
        setMeasurePoint1(dataPoint);
        setMeasurePoint2(null);
      } else {
        setMeasurePoint2(dataPoint);
      }
    };

    // Use capture phase so this fires before any child stopPropagation
    svg.addEventListener('click', handleMeasureClick, true);
    return () => svg.removeEventListener('click', handleMeasureClick, true);
  }, [measureMode]);

  // ============================================
  // Remap wallDrawRef.startNodeId when server replaces floor plan node IDs
  // ============================================
  useEffect(() => {
    if (!wallDrawRef.current?.startNodeId) return;
    const nodeId = wallDrawRef.current.startNodeId;
    // If the node still exists in the updated plan, nothing to do
    if (floorPlan.nodes.some(n => n.id === nodeId)) return;
    // Server replaced node IDs — find the nearest node to startPoint
    const sp = wallDrawRef.current.startPoint;
    let best: Node | null = null;
    let bestDist = Infinity;
    for (const n of floorPlan.nodes) {
      const dist = Math.hypot(n.x - sp.x, n.y - sp.y);
      if (dist < bestDist) { bestDist = dist; best = n; }
    }
    if (best) {
      wallDrawRef.current = { ...wallDrawRef.current, startNodeId: best.id, startPoint: { x: best.x, y: best.y } };
    }
  }, [floorPlan.nodes]);

  // ─── Shared guideline rendering helpers ──────────────────────────────────────────────────
  //
  // Each caller builds an array of Guideline descriptors and calls
  // renderGuidelines(descriptors).  Future guideline sources (parallel walls,
  // extension lines, …) just push more items into the array — zero changes here.
  const renderGuidelines = (guidelines: Guideline[]) => {
    if (!guidelineGRef.current || !svgRef.current || !gRef.current) return;
    const gl = d3.select(guidelineGRef.current);
    gl.selectAll('*').remove();
    if (guidelines.length === 0) return;
    const svgEl = svgRef.current as SVGSVGElement;
    const gEl = gRef.current;
    const k = d3.zoomTransform(svgEl).k;
    // Compute viewport corners in data-space so lines always span the visible area.
    const toData = (cx: number, cy: number) => {
      const p = svgEl.createSVGPoint();
      p.x = cx; p.y = cy;
      const ctm = gEl.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const tp = p.matrixTransform(ctm.inverse());
      return { x: tp.x, y: tp.y };
    };
    const rect = svgEl.getBoundingClientRect();
    const tl = toData(rect.left, rect.top);
    const br = toData(rect.right, rect.bottom);
    const pad = 9999; // extra padding to cover panning during draw
    for (const g of guidelines) {
      const color = g.color ?? '#4CAF50';
      const sw = 1 / k;
      const da = `${8 / k},${4 / k}`;
      if (g.orientation === 'horizontal' && g.value !== undefined) {
        gl.append('line')
          .attr('x1', tl.x - pad).attr('y1', g.value)
          .attr('x2', br.x + pad).attr('y2', g.value)
          .attr('stroke', color).attr('stroke-width', sw)
          .attr('stroke-dasharray', da).attr('opacity', 0.75)
          .attr('pointer-events', 'none');
      } else if (g.orientation === 'vertical' && g.value !== undefined) {
        gl.append('line')
          .attr('x1', g.value).attr('y1', tl.y - pad)
          .attr('x2', g.value).attr('y2', br.y + pad)
          .attr('stroke', color).attr('stroke-width', sw)
          .attr('stroke-dasharray', da).attr('opacity', 0.75)
          .attr('pointer-events', 'none');
      } else if (g.orientation === 'along' && g.anchor && g.direction) {
        // Arbitrary-angle guide: extend from anchor in both directions by `pad`
        gl.append('line')
          .attr('x1', g.anchor.x - g.direction.x * pad)
          .attr('y1', g.anchor.y - g.direction.y * pad)
          .attr('x2', g.anchor.x + g.direction.x * pad)
          .attr('y2', g.anchor.y + g.direction.y * pad)
          .attr('stroke', color).attr('stroke-width', sw)
          .attr('stroke-dasharray', da).attr('opacity', 0.75)
          .attr('pointer-events', 'none');
      }
    }
  };
  const clearGuidelines = () => {
    if (guidelineGRef.current) d3.select(guidelineGRef.current).selectAll('*').remove();
  };
  const clearAnnotations = () => {
    if (annotationGRef.current) d3.select(annotationGRef.current).selectAll('*').remove();
  };
  // ─────────────────────────────────────────────────────────────────────────────

  // ============================================
  // Wall Drawing Tool interaction
  // ============================================
  useEffect(() => {
    // When switching away from wall tool, abort any in-progress drawing
    if (activeTool !== 'wall') {
      wallDrawRef.current = null;
      if (wallPreviewGRef.current) {
        d3.select(wallPreviewGRef.current).selectAll('*').remove();
      }
      clearGuidelines();
      clearAnnotations();
      // Clear any lingering snap highlight
      if (wallSnapNodeRef.current && drawGRef.current) {
        d3.select(drawGRef.current)
          .selectAll('.node-group')
          .filter((d: any) => d.id === wallSnapNodeRef.current)
          .select('.node-point')
          .attr('fill', '#FF6B6B')
          .attr('stroke', null)
          .attr('stroke-width', null);
        wallSnapNodeRef.current = null;
      }
      return;
    }

    const svg = svgRef.current;
    const gElement = gRef.current;
    if (!svg || !gElement) return;

    /** Convert screen coords → data-space coords */
    const toDataPoint = (clientX: number, clientY: number): Point => {
      const p = (svg as SVGSVGElement).createSVGPoint();
      p.x = clientX;
      p.y = clientY;
      const ctm = gElement.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const tp = p.matrixTransform(ctm.inverse());
      return { x: tp.x, y: tp.y };
    };

    /** Find nearest node within 12 screen-pixels */
    const findSnapNode = (clientX: number, clientY: number): Node | null => {
      const k = d3.zoomTransform(svg as SVGSVGElement).k;
      const threshold = 12 / k; // convert screen px → data units
      const dp = toDataPoint(clientX, clientY);
      let best: Node | null = null;
      let bestDist = threshold;
      wallFloorPlanNodesRef.current.forEach((node) => {
        const dist = Math.hypot(node.x - dp.x, node.y - dp.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = node;
        }
      });
      return best;
    };

    /** Find nearest wall edge within 10 screen-pixels (node snap takes priority). */
    const findSnapEdge = (clientX: number, clientY: number): { edge: Edge; point: Point } | null => {
      const k = d3.zoomTransform(svg as SVGSVGElement).k;
      const snapThreshold = 10 / k;
      const nodeThreshold = 12 / k; // node snap exclusion zone
      const dp = toDataPoint(clientX, clientY);
      let best: { edge: Edge; point: Point } | null = null;
      let bestDist = snapThreshold;
      for (const edge of wallFloorPlanEdgesRef.current) {
        const fromNode = wallFloorPlanNodesRef.current.find(n => n.id === edge.source);
        const toNode = wallFloorPlanNodesRef.current.find(n => n.id === edge.target);
        if (!fromNode || !toNode) continue;
        // Project dp onto the segment
        const dx = toNode.x - fromNode.x;
        const dy = toNode.y - fromNode.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) continue;
        const t = Math.max(0, Math.min(1, ((dp.x - fromNode.x) * dx + (dp.y - fromNode.y) * dy) / lenSq));
        const projX = fromNode.x + t * dx;
        const projY = fromNode.y + t * dy;
        const dist = Math.hypot(dp.x - projX, dp.y - projY);
        if (dist >= bestDist) continue;
        // Skip if we're within the node-snap exclusion zone of an endpoint
        const distToFrom = Math.hypot(dp.x - fromNode.x, dp.y - fromNode.y);
        const distToTo = Math.hypot(dp.x - toNode.x, dp.y - toNode.y);
        if (distToFrom < nodeThreshold || distToTo < nodeThreshold) continue;
        bestDist = dist;
        best = { edge, point: { x: projX, y: projY } };
      }
      return best;
    };

    /** Show/hide edge-snap indicator dot on the wall preview layer */
    const updateEdgeSnapHighlight = (snap: { edge: Edge; point: Point } | null) => {
      if (!wallPreviewGRef.current) return;
      const pg = d3.select(wallPreviewGRef.current);
      pg.selectAll('.edge-snap-dot').remove();
      wallSnapEdgeRef.current = snap?.edge.id ?? null;
      if (!snap) return;
      const k = d3.zoomTransform(svg as SVGSVGElement).k;
      pg.append('circle')
        .attr('class', 'edge-snap-dot')
        .attr('cx', snap.point.x)
        .attr('cy', snap.point.y)
        .attr('r', 6 / k)
        .attr('fill', '#4CAF50')
        .attr('stroke', '#fff')
        .attr('stroke-width', 2 / k)
        .attr('pointer-events', 'none');
    };

    /** Highlight / un-highlight snap candidate node */
    const updateSnapHighlight = (snapNode: Node | null) => {
      if (!drawGRef.current) return;
      const dg = d3.select(drawGRef.current);
      // Clear old highlight
      if (wallSnapNodeRef.current) {
        dg.selectAll('.node-group')
          .filter((d: any) => d.id === wallSnapNodeRef.current)
          .select('.node-point')
          .attr('fill', '#FF6B6B')
          .attr('stroke', null)
          .attr('stroke-width', null);
      }
      // Apply new highlight
      if (snapNode) {
        const k = d3.zoomTransform(svg as SVGSVGElement).k;
        dg.selectAll('.node-group')
          .filter((d: any) => d.id === snapNode.id)
          .select('.node-point')
          .attr('fill', '#4CAF50')
          .attr('stroke', '#fff')
          .attr('stroke-width', 2 / k);
      }
      wallSnapNodeRef.current = snapNode?.id ?? null;
    };

    const handleWallClick = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();

      const snapNode = findSnapNode(event.clientX, event.clientY);
      const snapEdge = snapNode ? null : findSnapEdge(event.clientX, event.clientY);
      const dp = toDataPoint(event.clientX, event.clientY);
      const effectivePoint = snapNode
        ? { x: snapNode.x, y: snapNode.y }
        : snapEdge
        ? snapEdge.point
        : dp;

      if (!wallDrawRef.current) {
        // Phase 1 — record start point
        wallDrawRef.current = {
          startPoint: effectivePoint,
          startNodeId: snapNode?.id,
          startSplitEdgeId: snapEdge?.edge.id,
        };
      } else {
        // Phase 2 — finish wall
        const { startPoint, startNodeId, startSplitEdgeId } = wallDrawRef.current;
        const newNodes: Node[] = [];
        const splits: { [nodeId: string]: string } = {};

        // Apply axis / parallel snap to the endpoint when no node/edge snap is active.
        const kClick = d3.zoomTransform(svg as SVGSVGElement).k;
        const finalPoint = (!snapNode && !snapEdge)
          ? (
              snapToAxis(startPoint, effectivePoint, kClick)?.point ??
              snapToParallel(startPoint, effectivePoint, wallFloorPlanEdgesRef.current, wallFloorPlanNodesRef.current, startNodeId ?? null, kClick)?.point ??
              effectivePoint
            )
          : effectivePoint;

        let sourceId: string;
        if (startNodeId) {
          sourceId = startNodeId;
        } else {
          sourceId = crypto.randomUUID();
          newNodes.push({ id: sourceId, x: startPoint.x, y: startPoint.y });
          if (startSplitEdgeId) splits[sourceId] = startSplitEdgeId;
        }

        let targetId: string;
        if (snapNode) {
          targetId = snapNode.id;
        } else {
          targetId = crypto.randomUUID();
          newNodes.push({ id: targetId, x: finalPoint.x, y: finalPoint.y });
          if (snapEdge) splits[targetId] = snapEdge.edge.id;
        }

        // Guard: reject zero-length walls
        if (sourceId === targetId) {
          wallDrawRef.current = null;
          if (wallPreviewGRef.current) d3.select(wallPreviewGRef.current).selectAll('*').remove();
          return;
        }

        const newEdge: Edge = {
          id: crypto.randomUUID(),
          source: sourceId,
          target: targetId,
          type: 'wall',
          thickness: wallThicknessRef.current,
        };

        onWallAddRef.current?.(newEdge, newNodes, Object.keys(splits).length > 0 ? splits : undefined);

        // Auto-continue: immediately start next wall from the end of this one.
        // The user can break the chain by pressing Escape.
        wallDrawRef.current = {
          startPoint: finalPoint,
          startNodeId: targetId,
          startSplitEdgeId: undefined,
        };
        if (wallPreviewGRef.current) d3.select(wallPreviewGRef.current).selectAll('*').remove();
        clearGuidelines();
        updateSnapHighlight(null);
        updateEdgeSnapHighlight(null);
      }
    };

    const handleWallMouseMove = (event: MouseEvent) => {
      const snapNode = findSnapNode(event.clientX, event.clientY);
      updateSnapHighlight(snapNode);
      const snapEdge = snapNode ? null : findSnapEdge(event.clientX, event.clientY);

      if (!wallDrawRef.current || !wallPreviewGRef.current) {
        // No drawing in progress — just show/hide the snap indicator
        updateEdgeSnapHighlight(snapEdge);
        return;
      }

      const { startPoint } = wallDrawRef.current;
      const dp = toDataPoint(event.clientX, event.clientY);
      const k = d3.zoomTransform(svg as SVGSVGElement).k;

      // Axis snap: when no node/edge snap active, snap near-H/V walls to exact axis.
      // Build a guidelines array so any caller can extend it (e.g. parallel walls).
      const activeGuidelines: Guideline[] = [];
      let endPoint: Point;
      if (snapNode) {
        endPoint = { x: snapNode.x, y: snapNode.y };
      } else if (snapEdge) {
        endPoint = snapEdge.point;
      } else {
        const axisSnap = snapToAxis(startPoint, dp, k);
        if (axisSnap) {
          endPoint = axisSnap.point;
          activeGuidelines.push(...axisSnap.guidelines);
        } else {
          // Parallel snap: only fires when no axis snap is active
          const parallelSnap = snapToParallel(
            startPoint, dp,
            wallFloorPlanEdgesRef.current,
            wallFloorPlanNodesRef.current,
            wallDrawRef.current.startNodeId ?? null,
            k,
          );
          if (parallelSnap) {
            endPoint = parallelSnap.point;
            activeGuidelines.push(...parallelSnap.guidelines);
          } else {
            endPoint = dp;
          }
        }
      }
      renderGuidelines(activeGuidelines);
      const thick = wallThicknessRef.current;

      const pg = d3.select(wallPreviewGRef.current);
      pg.selectAll('*').remove();

      // Transparent wall body (shows thickness)
      pg.append('line')
        .attr('x1', startPoint.x)
        .attr('y1', startPoint.y)
        .attr('x2', endPoint.x)
        .attr('y2', endPoint.y)
        .attr('stroke', '#2196F3')
        .attr('stroke-width', thick)
        .attr('stroke-opacity', 0.25)
        .attr('pointer-events', 'none');

      // Dashed centre-line
      pg.append('line')
        .attr('x1', startPoint.x)
        .attr('y1', startPoint.y)
        .attr('x2', endPoint.x)
        .attr('y2', endPoint.y)
        .attr('stroke', '#2196F3')
        .attr('stroke-width', 2 / k)
        .attr('stroke-dasharray', `${8 / k},${4 / k}`)
        .attr('pointer-events', 'none');

      // Start-point marker
      pg.append('circle')
        .attr('cx', startPoint.x)
        .attr('cy', startPoint.y)
        .attr('r', 5 / k)
        .attr('fill', '#2196F3')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5 / k)
        .attr('pointer-events', 'none');

      // Annotation overlay: length + angles at snapped nodes
      if (annotationGRef.current) {
        const ag = d3.select(annotationGRef.current as SVGGElement);
        ag.selectAll('*').remove();
        const isCalibrated = isCalibratedRef.current;
        const wallLen = vecLen(vecSub(endPoint, startPoint));
        // Length label along the preview wall
        if (wallLen > 1e-6) {
          renderLengthLabel(ag, startPoint, endPoint, formatDataLen(wallLen, isCalibrated), k);
        }
        // Angles at start node (if snapped to an existing node)
        const startNodeId = wallDrawRef.current.startNodeId;
        if (startNodeId) {
          const connectedAtStart = wallFloorPlanEdgesRef.current.filter(
            e => e.type === 'wall' && (e.source === startNodeId || e.target === startNodeId)
          );
          // Include the new wall direction toward endPoint
          const newWallAngle = Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x);
          const existingAngles = connectedAtStart.map(e => {
            const otherId = e.source === startNodeId ? e.target : e.source;
            const other = wallFloorPlanNodesRef.current.find(n => n.id === otherId);
            return other ? Math.atan2(other.y - startPoint.y, other.x - startPoint.x) : null;
          }).filter((a): a is number => a !== null);
          const allAnglesAtStart = [...existingAngles, newWallAngle].sort((a, b) => a - b);
          if (allAnglesAtStart.length >= 2) {
            renderAngleArcs(ag, startPoint, allAnglesAtStart, k);
          }
        }
        // Angles at end node (if snapped to an existing node)
        if (snapNode) {
          const connectedAtEnd = wallFloorPlanEdgesRef.current.filter(
            e => e.type === 'wall' && (e.source === snapNode.id || e.target === snapNode.id)
          );
          // Include the new wall direction toward startPoint
          const newWallAngleAtEnd = Math.atan2(startPoint.y - endPoint.y, startPoint.x - endPoint.x);
          const existingAnglesAtEnd = connectedAtEnd.map(e => {
            const otherId = e.source === snapNode.id ? e.target : e.source;
            const other = wallFloorPlanNodesRef.current.find(n => n.id === otherId);
            return other ? Math.atan2(other.y - endPoint.y, other.x - endPoint.x) : null;
          }).filter((a): a is number => a !== null);
          const allAnglesAtEnd = [...existingAnglesAtEnd, newWallAngleAtEnd].sort((a, b) => a - b);
          if (allAnglesAtEnd.length >= 2) {
            renderAngleArcs(ag, endPoint, allAnglesAtEnd, k);
          }
        }
      }

      // Edge-snap dot drawn last so it renders on top of the preview line
      updateEdgeSnapHighlight(snapEdge);
    };

    const handleWallKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && wallDrawRef.current) {
        wallDrawRef.current = null;
        if (wallPreviewGRef.current) d3.select(wallPreviewGRef.current).selectAll('*').remove();
        clearGuidelines();
        clearAnnotations();
        updateSnapHighlight(null);
        updateEdgeSnapHighlight(null);
      }
    };

    svg.addEventListener('click', handleWallClick, true);
    svg.addEventListener('mousemove', handleWallMouseMove);
    window.addEventListener('keydown', handleWallKeyDown);

    return () => {
      svg.removeEventListener('click', handleWallClick, true);
      svg.removeEventListener('mousemove', handleWallMouseMove);
      window.removeEventListener('keydown', handleWallKeyDown);
    };
  }, [activeTool]);

  // ============================================
  // Asset Placement Tool interaction
  // ============================================
  useEffect(() => {
    // When switching away from asset tool, clear any ghost
    if (activeTool !== 'assets') {
      assetSnapRef.current = null;
      if (wallPreviewGRef.current) {
        d3.select(wallPreviewGRef.current).selectAll('.asset-ghost').remove();
      }
      return;
    }

    const svg = svgRef.current;
    const gElement = gRef.current;
    if (!svg || !gElement) return;

    /** Convert screen coords → data-space coords */
    const toDataPoint = (clientX: number, clientY: number): Point => {
      const p = (svg as SVGSVGElement).createSVGPoint();
      p.x = clientX;
      p.y = clientY;
      const ctm = gElement.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const tp = p.matrixTransform(ctm.inverse());
      return { x: tp.x, y: tp.y };
    };

    /**
     * Find the nearest WALL edge within 15 screen-pixels of the cursor and
     * compute where on that wall the asset would snap.
     * Returns null when no wall is close enough or the asset doesn't fit.
     */
    const findAssetSnap = (clientX: number, clientY: number): {
      edge: Edge; sourceNode: Node; targetNode: Node;
      assetStartPt: Point; assetEndPt: Point;
    } | null => {
      const k = d3.zoomTransform(svg as SVGSVGElement).k;
      const hitThreshold = 15 / k;
      const dp = toDataPoint(clientX, clientY);
      // 1 data-unit == 1 metre when calibrated, so widthM IS the data-space width.
      const assetWidthData = assetWidthMRef.current;

      let best: { edge: Edge; sourceNode: Node; targetNode: Node; t: number; dist: number } | null = null;

      for (const edge of wallFloorPlanEdgesRef.current) {
        if (edge.type !== 'wall') continue;
        const fromNode = wallFloorPlanNodesRef.current.find(n => n.id === edge.source);
        const toNode = wallFloorPlanNodesRef.current.find(n => n.id === edge.target);
        if (!fromNode || !toNode) continue;

        const edx = toNode.x - fromNode.x;
        const edy = toNode.y - fromNode.y;
        const lenSq = edx * edx + edy * edy;
        if (lenSq === 0) continue;

        const t = ((dp.x - fromNode.x) * edx + (dp.y - fromNode.y) * edy) / lenSq;
        const tClamped = Math.max(0, Math.min(1, t));
        const projX = fromNode.x + tClamped * edx;
        const projY = fromNode.y + tClamped * edy;
        const dist = Math.hypot(dp.x - projX, dp.y - projY);

        if (dist >= hitThreshold) continue;
        if (!best || dist < best.dist) {
          best = { edge, sourceNode: fromNode, targetNode: toNode, t: tClamped, dist };
        }
      }

      if (!best) return null;

      const { edge, sourceNode, targetNode, t } = best;
      const edx = targetNode.x - sourceNode.x;
      const edy = targetNode.y - sourceNode.y;
      const wallLen = Math.sqrt(edx * edx + edy * edy);

      if (assetWidthData >= wallLen) return null; // asset doesn't fit

      const assetHalf = assetWidthData / 2;
      const tCenterMin = assetHalf / wallLen;
      const tCenterMax = 1 - assetHalf / wallLen;
      const tCenter = Math.max(tCenterMin, Math.min(tCenterMax, t));
      const tStart = tCenter - assetHalf / wallLen;
      const tEnd = tCenter + assetHalf / wallLen;

      return {
        edge,
        sourceNode,
        targetNode,
        assetStartPt: {
          x: sourceNode.x + tStart * edx,
          y: sourceNode.y + tStart * edy,
        },
        assetEndPt: {
          x: sourceNode.x + tEnd * edx,
          y: sourceNode.y + tEnd * edy,
        },
      };
    };

    /** Render (or clear) the asset ghost on the preview layer */
    const renderAssetGhost = (snap: typeof assetSnapRef.current) => {
      if (!wallPreviewGRef.current) return;
      const pg = d3.select(wallPreviewGRef.current);
      pg.selectAll('.asset-ghost').remove();
      if (!snap) return;

      const k = d3.zoomTransform(svg as SVGSVGElement).k;
      const { edge, assetStartPt, assetEndPt } = snap;
      const type = assetTypeRef.current;
      // Doors/windows have a fixed depth independent of the host wall's thickness
      const thickness = type === 'door'
        ? (isCalibratedRef.current ? 0.1 : 8)
        : (type === 'window' ? (isCalibratedRef.current ? 0.1 : 8) : (edge.thickness ?? 16));

      const poly = createRectPolygon(assetStartPt, assetEndPt, thickness);
      const polyStr = poly.map(p => `${p.x},${p.y}`).join(' ');

      const ghost = pg.append('g')
        .attr('class', 'asset-ghost')
        .attr('pointer-events', 'none');

      // Ghost rectangle
      const fillColor = type === 'door' ? 'rgba(210,105,30,0.45)' : 'rgba(135,206,235,0.45)';
      const strokeColor = type === 'door' ? '#8B4513' : '#4682B4';

      ghost.append('polygon')
        .attr('points', polyStr)
        .attr('fill', fillColor)
        .attr('stroke', strokeColor)
        .attr('stroke-width', 1.5 / k);

      // Door: swing arc from assetStartPt
      if (type === 'door') {
        const radius = Math.hypot(
          assetEndPt.x - assetStartPt.x,
          assetEndPt.y - assetStartPt.y
        );
        const arcPath = createDoorArc(assetStartPt.x, assetStartPt.y, assetEndPt.x, assetEndPt.y, radius);
        if (arcPath) {
          ghost.append('path')
            .attr('d', arcPath)
            .attr('fill', 'none')
            .attr('stroke', strokeColor)
            .attr('stroke-width', 1 / k)
            .attr('stroke-dasharray', `${4 / k},${2 / k}`);
        }
      }

      // Window: center line
      if (type === 'window') {
        const midX = (assetStartPt.x + assetEndPt.x) / 2;
        const midY = (assetStartPt.y + assetEndPt.y) / 2;
        const dir = vecNorm(vecSub(assetEndPt, assetStartPt));
        const perp = vecPerp(dir);
        const halfT = thickness / 2;
        ghost.append('line')
          .attr('x1', midX - perp.x * halfT)
          .attr('y1', midY - perp.y * halfT)
          .attr('x2', midX + perp.x * halfT)
          .attr('y2', midY + perp.y * halfT)
          .attr('stroke', strokeColor)
          .attr('stroke-width', 1.5 / k);
      }

      // Snap endpoints
      ghost.append('circle')
        .attr('cx', assetStartPt.x).attr('cy', assetStartPt.y)
        .attr('r', 3 / k).attr('fill', strokeColor);
      ghost.append('circle')
        .attr('cx', assetEndPt.x).attr('cy', assetEndPt.y)
        .attr('r', 3 / k).attr('fill', strokeColor);
    };

    const handleAssetMouseMove = (event: MouseEvent) => {
      const snap = findAssetSnap(event.clientX, event.clientY);
      assetSnapRef.current = snap;
      renderAssetGhost(snap);
      // Update cursor
      if (svgRef.current) {
        svgRef.current.style.cursor = snap ? 'crosshair' : 'default';
      }
    };

    const handleAssetClick = (event: MouseEvent) => {
      const snap = assetSnapRef.current;
      if (!snap) return;
      event.stopPropagation();
      event.preventDefault();

      onAssetPlaceRef.current?.({
        wallEdge: snap.edge,
        wallSourceNode: snap.sourceNode,
        wallTargetNode: snap.targetNode,
        assetStartPt: snap.assetStartPt,
        assetEndPt: snap.assetEndPt,
      });

      // Clear ghost after placement
      assetSnapRef.current = null;
      renderAssetGhost(null);
    };

    const handleAssetKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        assetSnapRef.current = null;
        renderAssetGhost(null);
      }
    };

    svg.addEventListener('mousemove', handleAssetMouseMove);
    svg.addEventListener('click', handleAssetClick, true);
    window.addEventListener('keydown', handleAssetKeyDown);

    return () => {
      svg.removeEventListener('mousemove', handleAssetMouseMove);
      svg.removeEventListener('click', handleAssetClick, true);
      window.removeEventListener('keydown', handleAssetKeyDown);
      // Clear ghost and cursor on cleanup
      if (wallPreviewGRef.current) {
        d3.select(wallPreviewGRef.current).selectAll('.asset-ghost').remove();
      }
      if (svgRef.current) svgRef.current.style.cursor = '';
    };
  }, [activeTool]);

  useEffect(() => {
    if (!svgRef.current || !gRef.current || !drawGRef.current) return;

    const container = svgRef.current.parentElement;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear previous drawing content (not measurement overlay)
    d3.select(drawGRef.current).selectAll('*').remove();

    // Setup SVG
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const g = d3.select(gRef.current); // zoom container
    const drawG = d3.select(drawGRef.current); // drawing container

    // Setup zoom (recreate to capture latest drawGRef for node scaling)
    zoomRef.current = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 500])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString());
        // Keep node indicators at fixed screen-pixel size
        const k = event.transform.k;
        d3.select(drawGRef.current).selectAll('.node-point')
          .attr('r', 3 / k);
      });

    svg.call(zoomRef.current);

    // Build node map for efficient lookup
    const nodeMap = new Map<string, Node>();
    floorPlan.nodes.forEach(node => nodeMap.set(node.id, node));

    // Compute a data-space unit for proportional sizing
    // This ensures stroke widths, node radii, etc. look correct regardless of coordinate scale
    let dataExtent = 1;
    if (floorPlan.nodes.length > 0) {
      const xs = floorPlan.nodes.map((n: Node) => n.x);
      const ys = floorPlan.nodes.map((n: Node) => n.y);
      const dx = Math.max(...xs) - Math.min(...xs);
      const dy = Math.max(...ys) - Math.min(...ys);
      // For calibrated plans use at least 15 m as a floor so dataUnit stays
      // sensible (≈ 0.03 m) even when only a few nearby nodes exist.
      dataExtent = Math.max(dx, dy, floorPlan.is_calibrated ? 15 : 1);
    } else if (floorPlan.is_calibrated) {
      dataExtent = 15; // typical apartment width in metres
    }
    const dataUnit = dataExtent / 500;

    // Background rect for click-to-deselect (placed first so it's beneath all elements)
    drawG.append('rect')
      .attr('class', 'canvas-bg')
      .attr('x', -1e6)
      .attr('y', -1e6)
      .attr('width', 2e6)
      .attr('height', 2e6)
      .attr('fill', 'transparent')
      .on('click', function(event) {
        if (activeToolRef.current !== 'cursor') return;
        event.stopPropagation();
        onSelectedEdgesChange?.([]);
      });

    // Draw rooms (if available)
    if (floorPlan.rooms && floorPlan.rooms.length > 0) {
      const roomGroups = drawG.selectAll('.room-group')
        .data(floorPlan.rooms, (d: any) => d.id)
        .enter()
        .append('g')
        .attr('class', 'room-group');

      // Room polygons
      roomGroups
        .append('polygon')
        .attr('class', 'room')
        .attr('points', (d: Room) => 
          d.polygon_coords.map(([x, y]) => `${x},${y}`).join(' ')
        )
        .attr('fill', (d: Room) => {
          // Locked rooms get green overlay, unlocked get orange (in redesign mode)
          if (d.locked) {
            return 'rgba(76, 175, 80, 0.4)'; // Green for locked
          } else if (onRoomClick) {
            return 'rgba(255, 152, 0, 0.3)'; // Orange for unlocked in redesign mode
          } else {
            // Generate consistent random color based on room ID (normal mode)
            const hash = d.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const hue = (hash % 360);
            const saturation = 60 + (hash % 30);
            const lightness = 60 + (hash % 20);
            return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
          }
        })
        .attr('stroke', (d: Room) => {
          if (d.locked) return '#4CAF50';
          if (onRoomClick) return '#ff9800';
          return '#ccc';
        })
        .attr('stroke-width', (d: Room) => (d.locked || onRoomClick) ? 2 * dataUnit : 1 * dataUnit)
        .attr('cursor', onRoomClick ? 'pointer' : 'default')
        .on('mouseenter', function(_event, d: Room) {
          if (onRoomClick) {
            d3.select(this)
              .attr('fill', d.locked ? 'rgba(76, 175, 80, 0.6)' : 'rgba(255, 152, 0, 0.5)')
              .attr('stroke', d.locked ? '#2E7D32' : '#F57C00')
              .attr('stroke-width', 3 * dataUnit);
          } else {
            const hash = d.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const hue = (hash % 360);
            const saturation = 60 + (hash % 30);
            d3.select(this)
              .attr('fill', `hsl(${hue}, ${saturation}%, 85%)`)
              .attr('stroke', '#000')
              .attr('stroke-width', 3 * dataUnit);
          }
        })
        .on('mouseleave', function(_event, d: Room) {
          if (onRoomClick) {
            d3.select(this)
              .attr('fill', d.locked ? 'rgba(76, 175, 80, 0.4)' : 'rgba(255, 152, 0, 0.3)')
              .attr('stroke', d.locked ? '#4CAF50' : '#ff9800')
              .attr('stroke-width', 2 * dataUnit);
          } else {
            const hash = d.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const hue = (hash % 360);
            const saturation = 60 + (hash % 30);
            const lightness = 60 + (hash % 20);
            d3.select(this)
              .attr('fill', `hsl(${hue}, ${saturation}%, ${lightness}%)`)
              .attr('stroke', '#ccc')
              .attr('stroke-width', 1 * dataUnit);
          }
        })
        .on('click', function(event, d: Room) {
          event.stopPropagation();
          if (onRoomClick) {
            onRoomClick(d.id);
          } else {
            // In cursor mode, a room click should clear edge selection
            onSelectedEdgesChange?.([]);
          }
        });

      // Add lock icon for locked rooms
      roomGroups
        .filter((d: Room) => !!(d.locked && onRoomClick))
        .each(function(d: Room) {
          const polygon = d.polygon_coords;
          if (polygon.length === 0) return;
          
          const centroid = calculateCentroid(polygon);

          // Add lock emoji as text
          d3.select(this)
            .append('text')
            .attr('x', centroid.x)
            .attr('y', centroid.y)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', `${8 * dataUnit}px`)
            .attr('pointer-events', 'none')
            .text('🔒');
        });

      // Add area labels for all rooms
      roomGroups.each(function(d: Room) {
        const polygon = d.polygon_coords;
        if (polygon.length === 0) return;
        
        // Calculate area
        const area = calculatePolygonArea(polygon);
        const centroid = calculateCentroid(polygon);
        
        // Compute area label depending on calibration state.
        const isCalibrated = floorPlan.is_calibrated ?? false;
        let areaLabel: string;
        if (isCalibrated) {
          areaLabel = `${area.toFixed(1)} m\u00b2`;
        } else {
          areaLabel = `${Math.round(area).toLocaleString()} px\u00b2`;
        }
        
        // Determine vertical offset based on whether lock icon is present
        const hasLock = d.locked && onRoomClick;
        const yOffset = hasLock ? 10 * dataUnit : 0;
        
        // Add area text
        d3.select(this)
          .append('text')
          .attr('class', 'room-area-label')
          .attr('x', centroid.x)
          .attr('y', centroid.y + yOffset)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', `${6 * dataUnit}px`)
          .attr('font-weight', '600')
          .attr('fill', '#333')
          .attr('pointer-events', 'none')
          .text(areaLabel);
        
        // Add semi-transparent background for better readability
        const textNode = d3.select(this).select('.room-area-label').node() as SVGGraphicsElement | null;
        const bbox = textNode?.getBBox();
        if (bbox) {
          d3.select(this)
            .insert('rect', '.room-area-label')
            .attr('x', bbox.x - 2 * dataUnit)
            .attr('y', bbox.y - dataUnit)
            .attr('width', bbox.width + 4 * dataUnit)
            .attr('height', bbox.height + 2 * dataUnit)
            .attr('fill', 'white')
            .attr('opacity', 0.8)
            .attr('rx', 2 * dataUnit)
            .attr('pointer-events', 'none');
        }
      });
    }

    // Render edges with geometries
    // Group edges by type
    const walls = floorPlan.edges.filter((e: Edge) => e.type === 'wall');
    const doors = floorPlan.edges.filter((e: Edge) => e.type === 'door');
    const windows = floorPlan.edges.filter((e: Edge) => e.type === 'window');

    // Compute wall polygons with proper corners and junctions
    const defaultWallThickness = isCalibratedRef.current ? 0.2 : 10;
    const wallPolygons = computeWallPolygons(walls, nodeMap, defaultWallThickness);

    // Render walls with computed geometries
    wallPolygons.forEach((wallPoly: WallPolygon) => {
      const edge = wallPoly.edge;
      // Use computed polygon with proper corners
      const pointsStr = wallPoly.polygon
        .map(p => `${p.x},${p.y}`)
        .join(' ');

      const wallElement = drawG.append('polygon')
        .attr('class', selectedEdgeIdsRef.current.has(edge.id) ? 'wall selected' : 'wall')
        .attr('data-edge-id', edge.id)
        .attr('data-base-class', 'wall')
        .attr('data-default-fill', '#333')
        .attr('points', pointsStr)
        .attr('fill', draggedEdge?.id === edge.id ? '#0066cc' : (selectedEdgeIdsRef.current.has(edge.id) ? '#2196F3' : '#333'))
        .attr('cursor', (isEditMode && !measureMode && activeTool !== 'assets') ? 'move' : (activeTool === 'assets' ? 'crosshair' : 'default'))
        .attr('pointer-events', activeTool === 'assets' ? 'none' : 'auto')
        .on('mouseenter', function() {
          if (activeToolRef.current === 'assets') return;
          d3.select(this)
            .transition()
            .duration(150)
            .attr('fill', '#0066cc')
            .attr('opacity', 0.9);
          // Show 4 miter-correct polygon-side lengths on hover
          // Use the already-computed wallPolygons (includes all adjacent walls for proper miter)
          if (annotationGRef.current) {
            const miterPoly = wallPolygons.find(wp => wp.edge.id === edge.id);
            if (miterPoly) {
              const poly = miterPoly.polygon;
              const kHov = d3.zoomTransform(svgRef.current!).k;
              const ag = d3.select(annotationGRef.current as SVGGElement);
              ag.selectAll('*').remove();
              const isCalibrated = isCalibratedRef.current;
              for (let si = 0; si < poly.length; si++) {
                const pa = poly[si];
                const pb = poly[(si + 1) % poly.length];
                const sideLen = vecLen(vecSub(pb, pa));
                if (sideLen < 1e-6) continue;
                renderLengthLabel(ag, pa, pb, formatDataLen(sideLen, isCalibrated), kHov);
              }
            }
          }
        })
        .on('mouseleave', function() {
          if (activeToolRef.current === 'assets') return;
          const isDragged = draggedEdge?.id === edge.id;
          const isSelected = selectedEdgeIdsRef.current.has(edge.id);
          d3.select(this)
            .transition()
            .duration(150)
            .attr('fill', isDragged ? '#0066cc' : (isSelected ? '#2196F3' : '#333'))
            .attr('opacity', 1);
          clearAnnotations();
        })
        .on('click', function(event) {
          if (activeToolRef.current === 'assets') return;
          event.stopPropagation();
          if (isShiftPressed && onSelectedEdgesChange) {
            // Toggle selection
            const newSelection = new Set(selectedEdgeIdsRef.current);
            if (newSelection.has(edge.id)) {
              newSelection.delete(edge.id);
            } else {
              newSelection.add(edge.id);
            }
            onSelectedEdgesChange(Array.from(newSelection));
          } else {
            onSelectedEdgesChange?.([edge.id]);
          }
        })
        .on('contextmenu', function(event) {
          event.preventDefault();
          event.stopPropagation();
          if (onEdgeDelete) {
            setContextMenu({
              x: event.pageX,
              y: event.pageY,
              edgeId: edge.id
            });
          }
        });

      // Add drag behavior to walls in edit mode
      if (isEditMode && !measureMode && onNodePositionsChange) {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        
        if (sourceNode && targetNode) {
          let dragStartX = 0, dragStartY = 0;
          let startSourceX = 0, startSourceY = 0;
          let startTargetX = 0, startTargetY = 0;
          let didDrag = false;

          const wallDrag = d3.drag<SVGPolygonElement, WallPolygon>()
            .filter(function() {
              // Disable drag when Shift is pressed (for selection mode), wall tool or assets tool active
              return !isShiftPressed && activeToolRef.current !== 'wall' && activeToolRef.current !== 'assets';
            })
            .on('start', function(_event) {
              setDraggedEdge(edge);
              d3.select(this).attr('fill', '#0066cc');
              didDrag = false;
              
              // Store initial positions
              startSourceX = sourceNode.x;
              startSourceY = sourceNode.y;
              startTargetX = targetNode.x;
              startTargetY = targetNode.y;
              dragStartX = 0;
              dragStartY = 0;
            })
            .on('drag', function(event) {
              didDrag = true;
              // Accumulate drag deltas
              dragStartX += event.dx;
              dragStartY += event.dy;
              
              // Update both node positions (move wall as a whole)
              sourceNode.x = startSourceX + dragStartX;
              sourceNode.y = startSourceY + dragStartY;
              targetNode.x = startTargetX + dragStartX;
              targetNode.y = startTargetY + dragStartY;
              
              // Update node visuals
              drawG.selectAll('.node-group')
                .filter((n: any) => n.id === edge.source || n.id === edge.target)
                .attr('transform', (n: any) => `translate(${n.x},${n.y})`);
              
              // Recompute and update wall polygon
              const updatedWallPolygons = computeWallPolygons([edge], nodeMap, isCalibratedRef.current ? 0.2 : 10);
              if (updatedWallPolygons.length > 0) {
                const newPointsStr = updatedWallPolygons[0].polygon
                  .map(p => `${p.x},${p.y}`)
                  .join(' ');
                d3.select(this).attr('points', newPointsStr);
              }

              // Show ghost lines for adjacent walls (sharing one endpoint with this edge)
              const overrides = new Map<string, Point>([
                [edge.source, { x: sourceNode.x, y: sourceNode.y }],
                [edge.target, { x: targetNode.x, y: targetNode.y }],
              ]);
              renderDragGhosts(overrides, new Set([edge.id]));
              // Show length labels for all edges sharing the moved nodes
              if (annotationGRef.current) {
                const kEdgeDrag = d3.zoomTransform(svgRef.current!).k;
                const ag = d3.select(annotationGRef.current as SVGGElement);
                ag.selectAll('*').remove();
                const isCalibrated = isCalibratedRef.current;
                const sharedEdges = wallFloorPlanEdgesRef.current.filter(e =>
                  e.source === edge.source || e.target === edge.source ||
                  e.source === edge.target || e.target === edge.target
                );
                for (const se of sharedEdges) {
                  const srcPt = overrides.get(se.source) ?? (nodeMap.get(se.source) ? { x: nodeMap.get(se.source)!.x, y: nodeMap.get(se.source)!.y } : null);
                  const tgtPt = overrides.get(se.target) ?? (nodeMap.get(se.target) ? { x: nodeMap.get(se.target)!.x, y: nodeMap.get(se.target)!.y } : null);
                  if (!srcPt || !tgtPt) continue;
                  const segLen = vecLen(vecSub(tgtPt, srcPt));
                  if (segLen < 1e-6) continue;
                  renderLengthLabel(ag, srcPt, tgtPt, formatDataLen(segLen, isCalibrated), kEdgeDrag);
                }
              }
            })
            .on('end', function() {
              setDraggedEdge(null);
              clearDragGhosts();
              clearAnnotations();

              if (!didDrag) {
                // Treat as a click — d3 drag suppresses the native click event
                const isSelected = selectedEdgeIdsRef.current.has(edge.id);
                if (isShiftPressed && onSelectedEdgesChange) {
                  const newSelection = new Set(selectedEdgeIdsRef.current);
                  if (isSelected) {
                    newSelection.delete(edge.id);
                  } else {
                    newSelection.add(edge.id);
                  }
                  onSelectedEdgesChange(Array.from(newSelection));
                } else {
                  onSelectedEdgesChange?.([edge.id]);
                }
                return;
              }

              // Restore fill respecting current selection
              const isSelected = selectedEdgeIdsRef.current.has(edge.id);
              d3.select(this).attr('fill', isSelected ? '#2196F3' : '#333');
              
              // Notify parent of both node position changes
              onNodePositionsChange([
                { id: edge.source, x: sourceNode.x, y: sourceNode.y },
                { id: edge.target, x: targetNode.x, y: targetNode.y }
              ]);
            });
          
          wallElement.call(wallDrag as any);
        }
      }
    });

    // Render doors with geometries
    doors.forEach((edge: Edge) => {
      if (edge.geometries && edge.geometries.length > 0) {
        // Render using polygon geometries from backend
        edge.geometries.forEach((geom) => {
          drawG.append('polygon')
            .attr('class', selectedEdgeIdsRef.current.has(edge.id) ? 'door selected' : 'door')
            .attr('data-edge-id', edge.id)
            .attr('data-base-class', 'door')
            .attr('data-default-fill', '#8B4513')
            .attr('points', geom.polygon_coords.map(([x, y]) => `${x},${y}`).join(' '))
            .attr('fill', selectedEdgeIdsRef.current.has(edge.id) ? '#2196F3' : '#8B4513')
            .attr('stroke', '#5C3317')
            .attr('stroke-width', 0.5 * dataUnit)
            .attr('cursor', 'pointer')
            .on('click', function(event) {
              event.stopPropagation();
              if (isShiftPressed && onSelectedEdgesChange) {
                const newSelection = new Set(selectedEdgeIdsRef.current);
                if (newSelection.has(edge.id)) {
                  newSelection.delete(edge.id);
                } else {
                  newSelection.add(edge.id);
                }
                onSelectedEdgesChange(Array.from(newSelection));
              } else {
                onSelectedEdgesChange?.([edge.id]);
              }
            });
        });
      } else {
        // Render door as a polygon with proper thickness
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        
        if (!sourceNode || !targetNode) return;

        const thickness = edge.thickness || (isCalibratedRef.current ? 0.1 : 8);
        const doorPolygon = createRectPolygon(
          { x: sourceNode.x, y: sourceNode.y },
          { x: targetNode.x, y: targetNode.y },
          thickness
        );

        drawG.append('polygon')
          .attr('class', selectedEdgeIdsRef.current.has(edge.id) ? 'door selected' : 'door')
          .attr('data-edge-id', edge.id)
          .attr('data-base-class', 'door')
          .attr('data-default-fill', '#D2691E')
          .attr('points', doorPolygon.map(p => `${p.x},${p.y}`).join(' '))
          .attr('fill', selectedEdgeIdsRef.current.has(edge.id) ? '#2196F3' : '#D2691E')
          .attr('cursor', 'pointer')
          .on('click', function(event) {
            event.stopPropagation();
            if (isShiftPressed && onSelectedEdgesChange) {
              const newSelection = new Set(selectedEdgeIdsRef.current);
              if (newSelection.has(edge.id)) {
                newSelection.delete(edge.id);
              } else {
                newSelection.add(edge.id);
              }
              onSelectedEdgesChange(Array.from(newSelection));
            } else {
              onSelectedEdgesChange?.([edge.id]);
            }
          })
          .on('contextmenu', function(event) {
            event.preventDefault();
            event.stopPropagation();
            if (onEdgeDelete) {
              setContextMenu({
                x: event.pageX,
                y: event.pageY,
                edgeId: edge.id
              });
            }
          });

        // Add door swing arc
        const doorLength = Math.sqrt(
          Math.pow(targetNode.x - sourceNode.x, 2) + 
          Math.pow(targetNode.y - sourceNode.y, 2)
        );
        
        drawG.append('path')
          .attr('class', 'door-arc')
          .attr('d', createDoorArc(sourceNode.x, sourceNode.y, targetNode.x, targetNode.y, doorLength * 0.4))
          .attr('fill', 'none')
          .attr('stroke', '#8B4513')
          .attr('stroke-width', 0.5 * dataUnit)
          .attr('stroke-dasharray', `${2 * dataUnit},${2 * dataUnit}`);
      }
    });

    // Render windows with geometries
    windows.forEach((edge: Edge) => {
      if (edge.geometries && edge.geometries.length > 0) {
        // Render using polygon geometries from backend
        edge.geometries.forEach((geom) => {
          drawG.append('polygon')
            .attr('class', selectedEdgeIdsRef.current.has(edge.id) ? 'window selected' : 'window')
            .attr('data-edge-id', edge.id)
            .attr('data-base-class', 'window')
            .attr('data-default-fill', '#87CEEB')
            .attr('points', geom.polygon_coords.map(([x, y]) => `${x},${y}`).join(' '))
            .attr('fill', selectedEdgeIdsRef.current.has(edge.id) ? '#2196F3' : '#87CEEB')
            .attr('cursor', 'pointer')
            .on('click', function(event) {
              event.stopPropagation();
              if (isShiftPressed && onSelectedEdgesChange) {
                const newSelection = new Set(selectedEdgeIdsRef.current);
                if (newSelection.has(edge.id)) {
                  newSelection.delete(edge.id);
                } else {
                  newSelection.add(edge.id);
                }
                onSelectedEdgesChange(Array.from(newSelection));
              } else {
                onSelectedEdgesChange?.([edge.id]);
              }
            })
            .on('contextmenu', function(event) {
              event.preventDefault();
              event.stopPropagation();
              if (onEdgeDelete) {
                setContextMenu({
                  x: event.pageX,
                  y: event.pageY,
                  edgeId: edge.id
                });
              }
            });
        });
      } else {
        // Render window as a polygon with proper thickness
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        
        if (!sourceNode || !targetNode) return;

        const thickness = edge.thickness || (isCalibratedRef.current ? 0.1 : 8);
        const windowPolygon = createRectPolygon(
          { x: sourceNode.x, y: sourceNode.y },
          { x: targetNode.x, y: targetNode.y },
          thickness
        );

        // Window frame
        drawG.append('polygon')
          .attr('class', selectedEdgeIdsRef.current.has(edge.id) ? 'window selected' : 'window')
          .attr('data-edge-id', edge.id)
          .attr('data-base-class', 'window')
          .attr('data-default-fill', '#B0E0E6')
          .attr('points', windowPolygon.map(p => `${p.x},${p.y}`).join(' '))
          .attr('fill', selectedEdgeIdsRef.current.has(edge.id) ? '#2196F3' : '#B0E0E6')
          .attr('cursor', 'pointer')
          .on('click', function(event) {
            event.stopPropagation();
            if (isShiftPressed && onSelectedEdgesChange) {
              const newSelection = new Set(selectedEdgeIdsRef.current);
              if (newSelection.has(edge.id)) {
                newSelection.delete(edge.id);
              } else {
                newSelection.add(edge.id);
              }
              onSelectedEdgesChange(Array.from(newSelection));
            } else {
              onSelectedEdgesChange?.([edge.id]);
            }
          })
          .on('contextmenu', function(event) {
            event.preventDefault();
            event.stopPropagation();
            if (onEdgeDelete) {
              setContextMenu({
                x: event.pageX,
                y: event.pageY,
                edgeId: edge.id
              });
            }
          });

        // Add center line for window glass effect
        drawG.append('line')
          .attr('class', 'window-glass')
          .attr('x1', sourceNode.x)
          .attr('y1', sourceNode.y)
          .attr('x2', targetNode.x)
          .attr('y2', targetNode.y)
          .attr('stroke', '#87CEEB')
          .attr('stroke-width', thickness * 0.5);
      }
    });

    // Draw fixtures (if available)
    if (floorPlan.fixtures && floorPlan.fixtures.length > 0) {
      drawG.selectAll('.fixture')
        .data(floorPlan.fixtures, (d: any) => d.id)
        .enter()
        .append('polygon')
        .attr('class', (d: Fixture) => `fixture fixture-${d.fixture_type}`)
        .attr('points', (d: Fixture) => 
          d.polygon_coords.map(([x, y]) => `${x},${y}`).join(' ')
        )
        .attr('fill', (d: Fixture) => {
          // Color fixtures by type
          if (d.fixture_type === 'door') return '#8B4513';
          if (d.fixture_type === 'window') return '#87CEEB';
          return '#999';
        })
        .attr('stroke', '#000')
        .attr('stroke-width', 0.5 * dataUnit);
    }

    // Draw node points visualization
    // Radius is set to a placeholder; the zoom handler keeps it at 3 screen-pixels
    const nodeGroups = drawG.selectAll('.node-group')
      .data(floorPlan.nodes, (d: any) => d.id)
      .join('g')
      .attr('class', 'node-group')
      .attr('transform', (d: Node) => `translate(${d.x},${d.y})`);
    
    nodeGroups.each(function(d: Node) {
      const nodeGroup = d3.select(this);
      
      // Clear existing content
      nodeGroup.selectAll('*').remove();
      
      // Node circle (radius will be corrected by zoom handler)
      const radiusMultiplier = (isEditMode && !measureMode) ? 4 : 3;
      nodeGroup.append('circle')
        .attr('class', 'node-point')
        .attr('r', 0)
        .attr('fill', draggedNodeId === d.id ? '#0066cc' : '#FF6B6B')
        .attr('cursor', (isEditMode && !measureMode) ? 'move' : 'pointer');

      // Interactive hover effects
      if (!measureMode) {
        nodeGroup.on('mouseenter', function() {
          const k = d3.zoomTransform(svgRef.current!).k;
          d3.select(this).select('.node-point')
            .transition()
            .duration(200)
            .attr('r', 5 / k)
            .attr('fill', '#0066cc');
          // Show angles between all wall edges connected to this node
          if (annotationGRef.current) {
            const connEdges = wallFloorPlanEdgesRef.current.filter(
              e => e.type === 'wall' && (e.source === d.id || e.target === d.id)
            );
            if (connEdges.length >= 2) {
              const angles = connEdges.map(e => {
                const otherId = e.source === d.id ? e.target : e.source;
                const other = wallFloorPlanNodesRef.current.find(n => n.id === otherId);
                return other ? Math.atan2(other.y - d.y, other.x - d.x) : null;
              }).filter((a): a is number => a !== null);
              angles.sort((a, b) => a - b);
              const ag = d3.select(annotationGRef.current as SVGGElement);
              ag.selectAll('*').remove();
              renderAngleArcs(ag, d, angles, k);
            }
          }
        })
        .on('mouseleave', function() {
          const k = d3.zoomTransform(svgRef.current!).k;
          const isDragged = draggedNodeId === d.id;
          d3.select(this).select('.node-point')
            .transition()
            .duration(200)
            .attr('r', (isDragged ? 4 : radiusMultiplier) / k)
            .attr('fill', isDragged ? '#0066cc' : '#FF6B6B');
          clearAnnotations();
        });
      }
    });

    // ============================================
    // Ghost drag helpers — show affected edges while dragging
    // ============================================
    const renderDragGhosts = (overridePositions: Map<string, Point>, excludeEdgeIds?: Set<string>) => {
      if (!dragGhostGRef.current) return;
      const k = d3.zoomTransform(svgRef.current!).k;
      const ghostG = d3.select(dragGhostGRef.current);
      ghostG.selectAll('*').remove();

      const walls = floorPlan.edges.filter((e: Edge) => e.type === 'wall');
      for (const edge of walls) {
        if (excludeEdgeIds?.has(edge.id)) continue;
        const srcOverride = overridePositions.get(edge.source);
        const tgtOverride = overridePositions.get(edge.target);
        // Only render ghost for edges that have at least one moved endpoint
        if (!srcOverride && !tgtOverride) continue;

        const srcNode = nodeMap.get(edge.source);
        const tgtNode = nodeMap.get(edge.target);
        const srcPos = srcOverride ?? (srcNode ? { x: srcNode.x, y: srcNode.y } : null);
        const tgtPos = tgtOverride ?? (tgtNode ? { x: tgtNode.x, y: tgtNode.y } : null);
        if (!srcPos || !tgtPos) continue;

        const thick = edge.thickness || (isCalibratedRef.current ? 0.2 : 10);

        // Ghost wall body — semi-transparent fill showing thickness
        ghostG.append('line')
          .attr('x1', srcPos.x).attr('y1', srcPos.y)
          .attr('x2', tgtPos.x).attr('y2', tgtPos.y)
          .attr('stroke', '#2196F3')
          .attr('stroke-width', thick)
          .attr('stroke-opacity', 0.22)
          .attr('pointer-events', 'none');

        // Ghost centerline — dashed blue
        ghostG.append('line')
          .attr('x1', srcPos.x).attr('y1', srcPos.y)
          .attr('x2', tgtPos.x).attr('y2', tgtPos.y)
          .attr('stroke', '#2196F3')
          .attr('stroke-width', 2 / k)
          .attr('stroke-dasharray', `${6 / k},${3 / k}`)
          .attr('stroke-opacity', 0.8)
          .attr('pointer-events', 'none');
      }
    };

    const clearDragGhosts = () => {
      if (dragGhostGRef.current) {
        d3.select(dragGhostGRef.current).selectAll('*').remove();
      }
    };

    // Add drag behavior to nodes in edit mode
    if (isEditMode && !measureMode && onNodePositionsChange) {
      const drag = d3.drag<SVGGElement, Node>()
        .filter(function() {
          return activeToolRef.current !== 'wall' && activeToolRef.current !== 'assets';
        })
        .on('start', function(_event, d) {
          setDraggedNodeId(d.id);
          d3.select(this).select('.node-point')
            .attr('fill', '#0066cc');
        })
        .on('drag', function(event, d) {
          // --- Raw position tracking -----------------------------------------
          // We accumulate raw (unsnapped) deltas separately so snap release is
          // based on true cursor distance from the axis, not the snapped d.x/d.y.
          // Without this, d.x/d.y stays at the snapped value each frame, the
          // perpendicular deviation is always near-zero, and snap never releases.
          if ((this as any).__rawX === undefined) {
            (this as any).__rawX = d.x;
            (this as any).__rawY = d.y;
          }
          (this as any).__rawX += event.dx;
          (this as any).__rawY += event.dy;
          const rawX: number = (this as any).__rawX;
          const rawY: number = (this as any).__rawY;

          // Axis snap: evaluate each connected wall independently for X and Y.
          // Compare RAW position against the axis — so release fires as soon as
          // the cursor (not the snapped node) exceeds AXIS_SNAP_PX from the axis.
          const kDrag = d3.zoomTransform(svgRef.current as SVGSVGElement).k;
          const connectedEdges = wallFloorPlanEdgesRef.current.filter(
            e => e.source === d.id || e.target === d.id,
          );
          const dragGuidelines: Guideline[] = [];
          let bestXSnap: { value: number; dev: number } | null = null;
          let bestYSnap: { value: number; dev: number } | null = null;
          for (const edge of connectedEdges) {
            const otherId = edge.source === d.id ? edge.target : edge.source;
            const other = wallFloorPlanNodesRef.current.find(n => n.id === otherId);
            if (!other) continue;
            const eDx = rawX - other.x;
            const eDy = rawY - other.y;
            const eLenPx = Math.hypot(eDx, eDy) * kDrag;
            if (eLenPx < AXIS_SNAP_MIN_LEN_PX) continue;
            // Primarily vertical wall → snap X (perpendicular deviation = |eDx|)
            if (Math.abs(eDy) > Math.abs(eDx)) {
              const devPx = Math.abs(eDx) * kDrag;
              if (devPx < AXIS_SNAP_PX && (!bestXSnap || devPx < bestXSnap.dev)) {
                bestXSnap = { value: other.x, dev: devPx };
              }
            }
            // Primarily horizontal wall → snap Y (perpendicular deviation = |eDy|)
            if (Math.abs(eDx) > Math.abs(eDy)) {
              const devPx = Math.abs(eDy) * kDrag;
              if (devPx < AXIS_SNAP_PX && (!bestYSnap || devPx < bestYSnap.dev)) {
                bestYSnap = { value: other.y, dev: devPx };
              }
            }
          }
          // Apply axis snap or, if no axis snap, parallel snap
          if (bestXSnap || bestYSnap) {
            d.x = bestXSnap ? bestXSnap.value : rawX;
            d.y = bestYSnap ? bestYSnap.value : rawY;
            if (bestXSnap) dragGuidelines.push({ orientation: 'vertical',   value: bestXSnap.value });
            if (bestYSnap) dragGuidelines.push({ orientation: 'horizontal', value: bestYSnap.value });
          } else {
            // Parallel snap: for each connected edge, check if it's nearly parallel
            // to any non-connected reference edge. Use the raw position so release
            // is based on actual cursor distance from the direction line.
            let bestParallelDev = AXIS_SNAP_PX;
            let parallelPoint: Point | null = null;
            let parallelGuideline: Guideline | null = null;
            for (const edgeA of connectedEdges) {
              const otherId = edgeA.source === d.id ? edgeA.target : edgeA.source;
              const other = wallFloorPlanNodesRef.current.find(n => n.id === otherId);
              if (!other) continue;
              const aDx = rawX - other.x;
              const aDy = rawY - other.y;
              if (Math.hypot(aDx, aDy) * kDrag < AXIS_SNAP_MIN_LEN_PX) continue;
              const aLen = Math.hypot(aDx, aDy);
              const aNx = aDx / aLen;
              const aNy = aDy / aLen;
              for (const edgeB of wallFloorPlanEdgesRef.current) {
                if (edgeB.id === edgeA.id) continue;
                if (edgeB.source === d.id || edgeB.target === d.id) continue;
                const fromB = wallFloorPlanNodesRef.current.find(n => n.id === edgeB.source);
                const toB   = wallFloorPlanNodesRef.current.find(n => n.id === edgeB.target);
                if (!fromB || !toB) continue;
                const bDx = toB.x - fromB.x;
                const bDy = toB.y - fromB.y;
                const bLen = Math.hypot(bDx, bDy);
                if (bLen < 1e-6) continue;
                const bDirX = bDx / bLen;
                const bDirY = bDy / bLen;
                if (Math.abs(aNx * bDirX + aNy * bDirY) < 0.5) continue; // not parallel
                const perpPx = Math.abs(aDx * bDirY - aDy * bDirX) * kDrag;
                if (perpPx >= bestParallelDev) continue;
                bestParallelDev = perpPx;
                const t = aDx * bDirX + aDy * bDirY;
                parallelPoint = { x: other.x + t * bDirX, y: other.y + t * bDirY };
                parallelGuideline = { orientation: 'along', anchor: other, direction: { x: bDirX, y: bDirY }, color: '#FF9800' };
              }
            }
            if (parallelPoint) {
              d.x = parallelPoint.x;
              d.y = parallelPoint.y;
              dragGuidelines.push(parallelGuideline!);
            } else {
              d.x = rawX;
              d.y = rawY;
            }
          }
          renderGuidelines(dragGuidelines);

          // Update node position in DOM immediately for visual feedback
          d3.select(this).attr('transform', `translate(${d.x},${d.y})`);

          // Show ghost lines for all edges connected to this node
          const overrides = new Map<string, Point>([[d.id, { x: d.x, y: d.y }]]);
          renderDragGhosts(overrides);
          // Show length labels + angle arcs around dragged node
          if (annotationGRef.current) {
            const ag = d3.select(annotationGRef.current as SVGGElement);
            ag.selectAll('*').remove();
            const isCalibrated = isCalibratedRef.current;
            for (const edge of connectedEdges) {
              const otherId = edge.source === d.id ? edge.target : edge.source;
              const other = wallFloorPlanNodesRef.current.find(n => n.id === otherId);
              if (!other) continue;
              const segLen = vecLen(vecSub({ x: d.x, y: d.y }, other));
              if (segLen < 1e-6) continue;
              renderLengthLabel(ag, { x: d.x, y: d.y }, other, formatDataLen(segLen, isCalibrated), kDrag);
            }
            if (connectedEdges.length >= 2) {
              const angles = connectedEdges.map(e => {
                const otherId = e.source === d.id ? e.target : e.source;
                const other = wallFloorPlanNodesRef.current.find(n => n.id === otherId);
                return other ? Math.atan2(other.y - d.y, other.x - d.x) : null;
              }).filter((a): a is number => a !== null);
              angles.sort((a, b) => a - b);
              renderAngleArcs(ag, { x: d.x, y: d.y }, angles, kDrag);
            }
          }
        })
        .on('end', function(_event, d) {
          setDraggedNodeId(null);
          d3.select(this).select('.node-point')
            .attr('fill', '#FF6B6B');
          // Clean up raw position tracking
          delete (this as any).__rawX;
          delete (this as any).__rawY;
          clearDragGhosts();
          clearGuidelines();
          clearAnnotations();

          // Notify parent of node position change
          onNodePositionsChange([{ id: d.id, x: d.x, y: d.y }]);
        });
      
      nodeGroups.call(drag as any);
    }
    
    // Drag-to-select rectangle functionality
    if (isEditMode && !measureMode && onSelectedEdgesChange) {
      let selectionStart: { x: number; y: number } | null = null;
      
      const selectionDrag = d3.drag<SVGSVGElement, unknown>()
        .filter(function(event) {
          // Only start drag-to-select when Shift is pressed and clicking on background
          return isShiftPressed && event.target === svgRef.current;
        })
        .on('start', function(event) {
          const ctm = gRef.current?.getScreenCTM();
          if (!ctm) return;
          
          const point = svgRef.current!.createSVGPoint();
          point.x = event.sourceEvent.clientX;
          point.y = event.sourceEvent.clientY;
          const transformed = point.matrixTransform(ctm.inverse());
          
          selectionStart = { x: transformed.x, y: transformed.y };
          setSelectionBox({ x1: transformed.x, y1: transformed.y, x2: transformed.x, y2: transformed.y });
        })
        .on('drag', function(event) {
          if (!selectionStart) return;
          
          const ctm = gRef.current?.getScreenCTM();
          if (!ctm) return;
          
          const point = svgRef.current!.createSVGPoint();
          point.x = event.sourceEvent.clientX;
          point.y = event.sourceEvent.clientY;
          const transformed = point.matrixTransform(ctm.inverse());
          
          setSelectionBox({
            x1: selectionStart.x,
            y1: selectionStart.y,
            x2: transformed.x,
            y2: transformed.y
          });
        })
        .on('end', function() {
          if (!selectionStart || !selectionBox) {
            setSelectionBox(null);
            return;
          }
          
          // Calculate selection rectangle bounds
          const minX = Math.min(selectionBox.x1, selectionBox.x2);
          const maxX = Math.max(selectionBox.x1, selectionBox.x2);
          const minY = Math.min(selectionBox.y1, selectionBox.y2);
          const maxY = Math.max(selectionBox.y1, selectionBox.y2);
          
          // Check which edges fall within the selection box
          const selectedIds = new Set(selectedEdgeIdsRef.current);
          floorPlan.edges.forEach((edge: Edge) => {
            const sourceNode = nodeMap.get(edge.source);
            const targetNode = nodeMap.get(edge.target);
            
            if (!sourceNode || !targetNode) return;
            
            // Check if edge midpoint is inside selection box
            const midX = (sourceNode.x + targetNode.x) / 2;
            const midY = (sourceNode.y + targetNode.y) / 2;
            
            if (midX >= minX && midX <= maxX && midY >= minY && midY <= maxY) {
              selectedIds.add(edge.id);
            }
          });
          
          onSelectedEdgesChange(Array.from(selectedIds));
          setSelectionBox(null);
          selectionStart = null;
        });
      
      svg.call(selectionDrag as any);
    }

    // Reset zoom to identity when calibration changes so centerFloorPlan re-fits
    // the new coordinate space (pixels ↔ metres).
    const calibrationChanged = prevIsCalibrated.current !== undefined &&
      prevIsCalibrated.current !== floorPlan.is_calibrated;
    prevIsCalibrated.current = floorPlan.is_calibrated;
    if (calibrationChanged && svgRef.current && zoomRef.current) {
      d3.select<SVGSVGElement, unknown>(svgRef.current)
        .call(zoomRef.current.transform, d3.zoomIdentity);
    }

    // After a full redraw, nodes are created with r=0 and get their radius set by
    // the zoom handler. If the transform is already non-identity (user has zoomed
    // or panned), centerFloorPlan returns early without triggering a zoom event,
    // so we apply the current scale immediately here.
    {
      const currentK = d3.zoomTransform(svgRef.current!).k;
      if (currentK !== 1) {
        d3.select(drawGRef.current).selectAll('.node-point')
          .attr('r', 3 / currentK);
      }
    }

    // Center and fit the floor plan
    centerFloorPlan(drawG, floorPlan, width, height, zoomRef.current!, drawGRef);
  }, [floorPlan, onEdgeClick, onRoomClick, isShiftPressed, onSelectedEdgesChange, onEdgeDelete, activeTool]);

  // Lightweight effect: update edge visual styles when selection changes without rebuilding D3
  useEffect(() => {
    if (!drawGRef.current) return;
    d3.select(drawGRef.current).selectAll<Element, unknown>('[data-edge-id]').each(function() {
      const el = d3.select(this);
      const edgeId = el.attr('data-edge-id');
      if (!edgeId) return;
      const isSelected = selectedEdgeIds.has(edgeId);
      const baseClass = el.attr('data-base-class') || 'wall';
      const defaultFill = el.attr('data-default-fill') || '#333';
      el.attr('class', isSelected ? `${baseClass} selected` : baseClass)
        .attr('fill', isSelected ? '#2196F3' : defaultFill);
    });
  }, [selectedEdgeIds]);

  const isEmpty = floorPlan.nodes.length === 0 && floorPlan.edges.length === 0;

  return (
    <div className="floor-plan-canvas-container">
      {isEmpty && (
        <div className="canvas-empty-state">
          <div className="canvas-empty-state__icon">⬜</div>
          <div className="canvas-empty-state__title">Start drawing your floor plan</div>
          <div className="canvas-empty-state__hint">Select the Wall tool and click on the canvas to place your first wall</div>
        </div>
      )}
      <svg
        ref={svgRef}
        style={{ cursor: measureMode || activeTool === 'wall' ? 'crosshair' : (isShiftPressed && isEditMode ? 'crosshair' : undefined) }}
      >
        <g ref={gRef}>
          <g ref={drawGRef} />
          <g ref={dragGhostGRef} />
          <g ref={annotationGRef} />
          <g ref={guidelineGRef} />
          <g ref={wallPreviewGRef} />
          <g ref={measureGRef} />
          {selectionBox && (
            <rect
              x={Math.min(selectionBox.x1, selectionBox.x2)}
              y={Math.min(selectionBox.y1, selectionBox.y2)}
              width={Math.abs(selectionBox.x2 - selectionBox.x1)}
              height={Math.abs(selectionBox.y2 - selectionBox.y1)}
              fill="rgba(33, 150, 243, 0.1)"
              stroke="#2196F3"
              strokeWidth="2"
              strokeDasharray="5,5"
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            backgroundColor: '#fff',
            border: '1px solid #ccc',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 10000,
            minWidth: '120px'
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdgeDelete?.(contextMenu.edgeId);
              setContextMenu(null);
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 16px',
              border: 'none',
              backgroundColor: 'transparent',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '14px',
              color: '#d32f2f'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f5f5f5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            🗑️ Delete Edge
          </button>
        </div>
      )}
    </div>
  );
};

function centerFloorPlan(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  floorPlan: FloorPlan,
  width: number,
  height: number,
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
  drawGRef: React.RefObject<SVGGElement | null>
) {
  // Get bounds from nodes, rooms, and fixtures
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  // Check nodes
  if (floorPlan.nodes.length > 0) {
    const xs = floorPlan.nodes.map((n: Node) => n.x);
    const ys = floorPlan.nodes.map((n: Node) => n.y);
    minX = Math.min(minX, ...xs);
    maxX = Math.max(maxX, ...xs);
    minY = Math.min(minY, ...ys);
    maxY = Math.max(maxY, ...ys);
  }

  // Check rooms
  if (floorPlan.rooms && floorPlan.rooms.length > 0) {
    floorPlan.rooms.forEach((room: Room) => {
      room.polygon_coords.forEach(([x, y]) => {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      });
    });
  }

  // Check fixtures
  if (floorPlan.fixtures && floorPlan.fixtures.length > 0) {
    floorPlan.fixtures.forEach((fixture: Fixture) => {
      fixture.polygon_coords.forEach(([x, y]) => {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      });
    });
  }

  if (!isFinite(minX)) {
    // Empty plan — for calibrated plans set a sensible initial zoom once:
    // 50 screen-pixels per metre, centred at 0,0. Only applies when the zoom
    // is still at identity (user hasn't panned/zoomed yet).
    if (floorPlan.is_calibrated) {
      const gElement = g.node()?.parentElement;
      const svgElement = gElement?.parentElement as SVGSVGElement | null;
      if (svgElement) {
        const t = d3.zoomTransform(svgElement);
        if (t.k === 1 && t.x === 0 && t.y === 0) {
          const defaultScale = 50; // px per metre
          const transform = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(defaultScale);
          d3.select<SVGSVGElement, unknown>(svgElement)
            .call(zoom.transform, transform);
          d3.select(drawGRef.current).selectAll('.node-point')
            .attr('r', 3 / defaultScale);
        }
      }
    }
    return;
  }

  const planWidth = maxX - minX;
  const planHeight = maxY - minY;
  const planCenterX = (minX + maxX) / 2;
  const planCenterY = (minY + maxY) / 2;

  const padding = 100;
  const scaleX = (width - padding * 2) / planWidth;
  const scaleY = (height - padding * 2) / planHeight;
  const scale = Math.min(scaleX, scaleY);

  const translateX = width / 2 - planCenterX * scale;
  const translateY = height / 2 - planCenterY * scale;

  const transform = d3.zoomIdentity
    .translate(translateX, translateY)
    .scale(scale);

  // Navigate up from drawG -> gRef -> svg
  const gElement = g.node()?.parentElement;
  const svgElement = gElement?.parentElement as SVGSVGElement | null;
  if (svgElement) {
    // Only auto-fit on the very first load (identity transform).
    // Once the user has zoomed/panned — or we've already fitted once — preserve
    // their viewport so that adding walls or other edits don't jump the view.
    const currentTransform = d3.zoomTransform(svgElement);
    if (currentTransform.k !== 1 || currentTransform.x !== 0 || currentTransform.y !== 0) {
      return;
    }
    // Set node radii immediately for the target scale
    d3.select(drawGRef.current).selectAll('.node-point')
      .attr('r', 3 / scale);

    d3.select<SVGSVGElement, unknown>(svgElement)
      .transition()
      .duration(750)
      .call(zoom.transform as any, transform);
  }
}
