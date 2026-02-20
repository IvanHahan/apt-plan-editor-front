import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { FloorPlan, Node, Edge, Room, Fixture } from '../types';
import './FloorPlanCanvas.css';

interface FloorPlanCanvasProps {
  floorPlan: FloorPlan;
  onEdgeClick?: (edgeId: string) => void;
  onRoomClick?: (roomId: string) => void;
  measureMode?: boolean;
  onMeasure?: (pixelDistance: number) => void;
  isEditMode?: boolean;
  onNodePositionsChange?: (nodes: Node[]) => void;
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

function vecSub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
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
    const prevHalf = (prev.edge.thickness || 0.2) / 2;
    
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
    const nextHalf = (next.edge.thickness || 0.2) / 2;
    
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
function computeWallPolygons(walls: Edge[], nodeMap: Map<string, Node>): WallPolygon[] {
  const adj = buildWallAdjacency(walls);
  const result: WallPolygon[] = [];
  
  for (const wall of walls) {
    const srcNode = nodeMap.get(wall.source);
    const tgtNode = nodeMap.get(wall.target);
    if (!srcNode || !tgtNode) continue;
    
    const thick = wall.thickness || 0.2;
    const half = thick / 2;
    
    const srcPos: Point = { x: srcNode.x, y: srcNode.y };
    const tgtPos: Point = { x: tgtNode.x, y: tgtNode.y };
    
    const srcAdj = adj.get(wall.source) || [wall];
    const tgtAdj = adj.get(wall.target) || [wall];
    
    const srcCorners = computeJunctionCorners(wall.source, srcPos, wall, srcAdj, nodeMap, half);
    const tgtCorners = computeJunctionCorners(wall.target, tgtPos, wall, tgtAdj, nodeMap, half);
    
    // Note: target corners are computed with reversed direction, so swap left/right
    result.push({
      edge: wall,
      polygon: [srcCorners.left, tgtCorners.right, tgtCorners.left, srcCorners.right]
    });
  }
  
  return result;
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

export const FloorPlanCanvas: React.FC<FloorPlanCanvasProps> = ({
  floorPlan,
  onEdgeClick,
  onRoomClick,
  measureMode,
  onMeasure,
  isEditMode,
  onNodePositionsChange,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const drawGRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const measureGRef = useRef<SVGGElement>(null);

  const [measurePoint1, setMeasurePoint1] = useState<Point | null>(null);
  const [measurePoint2, setMeasurePoint2] = useState<Point | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [draggedEdge, setDraggedEdge] = useState<Edge | null>(null);

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
      dataExtent = Math.max(dx, dy, 1);
    }
    const dataUnit = dataExtent / 500;

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
          onRoomClick?.(d.id);
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
        
        // Convert area to square meters if unit_scale is available
        // Default unit scale is 80 units/meter, so 1 unit² = (1/80)² m²
        const unitScale = floorPlan.unit_scale || 80;
        const areaInSquareMeters = area / (unitScale * unitScale);
        
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
          .text(`${areaInSquareMeters.toFixed(1)} m²`);
        
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
    const wallPolygons = computeWallPolygons(walls, nodeMap);

    // Render walls with computed geometries
    wallPolygons.forEach((wallPoly: WallPolygon) => {
      const edge = wallPoly.edge;
      // Use computed polygon with proper corners
      const pointsStr = wallPoly.polygon
        .map(p => `${p.x},${p.y}`)
        .join(' ');

      const wallElement = drawG.append('polygon')
        .attr('class', 'wall')
        .attr('points', pointsStr)
        .attr('fill', draggedEdge?.id === edge.id ? '#0066cc' : '#333')
        .attr('cursor', (isEditMode && !measureMode) ? 'move' : 'default')
        .on('mouseenter', function() {
          d3.select(this)
            .transition()
            .duration(150)
            .attr('fill', '#0066cc')
            .attr('opacity', 0.9);
        })
        .on('mouseleave', function() {
          const isDragged = draggedEdge?.id === edge.id;
          d3.select(this)
            .transition()
            .duration(150)
            .attr('fill', isDragged ? '#0066cc' : '#333')
            .attr('opacity', 1);
        })
        .on('click', function(event) {
          event.stopPropagation();
          onEdgeClick?.(edge.id);
        });

      // Add drag behavior to walls in edit mode
      if (isEditMode && !measureMode && onNodePositionsChange) {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        
        if (sourceNode && targetNode) {
          let dragStartX = 0, dragStartY = 0;
          let startSourceX = 0, startSourceY = 0;
          let startTargetX = 0, startTargetY = 0;

          const wallDrag = d3.drag<SVGPolygonElement, WallPolygon>()
            .on('start', function(_event) {
              setDraggedEdge(edge);
              d3.select(this).attr('fill', '#0066cc');
              
              // Store initial positions
              startSourceX = sourceNode.x;
              startSourceY = sourceNode.y;
              startTargetX = targetNode.x;
              startTargetY = targetNode.y;
              dragStartX = 0;
              dragStartY = 0;
            })
            .on('drag', function(event) {
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
              const updatedWallPolygons = computeWallPolygons([edge], nodeMap);
              if (updatedWallPolygons.length > 0) {
                const newPointsStr = updatedWallPolygons[0].polygon
                  .map(p => `${p.x},${p.y}`)
                  .join(' ');
                d3.select(this).attr('points', newPointsStr);
              }
            })
            .on('end', function() {
              setDraggedEdge(null);
              d3.select(this).attr('fill', '#333');
              
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
            .attr('class', 'door')
            .attr('points', geom.polygon_coords.map(([x, y]) => `${x},${y}`).join(' '))
            .attr('fill', '#8B4513')
            .attr('stroke', '#5C3317')
            .attr('stroke-width', 0.5 * dataUnit)
            .attr('cursor', 'pointer')
            .on('click', function(event) {
              event.stopPropagation();
              onEdgeClick?.(edge.id);
            });
        });
      } else {
        // Render door as a polygon with proper thickness
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        
        if (!sourceNode || !targetNode) return;

        const thickness = edge.thickness || 0.1;
        const doorPolygon = createRectPolygon(
          { x: sourceNode.x, y: sourceNode.y },
          { x: targetNode.x, y: targetNode.y },
          thickness
        );

        drawG.append('polygon')
          .attr('class', 'door')
          .attr('points', doorPolygon.map(p => `${p.x},${p.y}`).join(' '))
          .attr('fill', '#D2691E')
          .attr('stroke', '#8B4513')
          .attr('stroke-width', 0.5 * dataUnit)
          .attr('cursor', 'pointer')
          .on('click', function(event) {
            event.stopPropagation();
            onEdgeClick?.(edge.id);
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
            .attr('class', 'window')
            .attr('points', geom.polygon_coords.map(([x, y]) => `${x},${y}`).join(' '))
            .attr('fill', '#87CEEB')
            .attr('stroke', '#4682B4')
            .attr('stroke-width', 0.5 * dataUnit)
            .attr('cursor', 'pointer')
            .on('click', function(event) {
              event.stopPropagation();
              onEdgeClick?.(edge.id);
            });
        });
      } else {
        // Render window as a polygon with proper thickness
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        
        if (!sourceNode || !targetNode) return;

        const thickness = edge.thickness || 0.1;
        const windowPolygon = createRectPolygon(
          { x: sourceNode.x, y: sourceNode.y },
          { x: targetNode.x, y: targetNode.y },
          thickness
        );

        // Window frame
        drawG.append('polygon')
          .attr('class', 'window')
          .attr('points', windowPolygon.map(p => `${p.x},${p.y}`).join(' '))
          .attr('fill', '#B0E0E6')
          .attr('stroke', '#4682B4')
          .attr('stroke-width', 0.5 * dataUnit)
          .attr('cursor', 'pointer')
          .on('click', function(event) {
            event.stopPropagation();
            onEdgeClick?.(edge.id);
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
        })
        .on('mouseleave', function() {
          const k = d3.zoomTransform(svgRef.current!).k;
          const isDragged = draggedNodeId === d.id;
          d3.select(this).select('.node-point')
            .transition()
            .duration(200)
            .attr('r', (isDragged ? 4 : radiusMultiplier) / k)
            .attr('fill', isDragged ? '#0066cc' : '#FF6B6B');
        });
      }
    });

    // Add drag behavior to nodes in edit mode
    if (isEditMode && !measureMode && onNodePositionsChange) {
      const drag = d3.drag<SVGGElement, Node>()
        .on('start', function(_event, d) {
          setDraggedNodeId(d.id);
          d3.select(this).select('.node-point')
            .attr('fill', '#0066cc');
        })
        .on('drag', function(event, d) {
          // event.dx and event.dy are the drag deltas in the parent's coordinate system
          // Since nodes are inside drawG (which is in data space), we just add the deltas
          d.x += event.dx;
          d.y += event.dy;
          
          // Update node position in DOM immediately for visual feedback
          d3.select(this).attr('transform', `translate(${d.x},${d.y})`);
        })
        .on('end', function(_event, d) {
          setDraggedNodeId(null);
          d3.select(this).select('.node-point')
            .attr('fill', '#FF6B6B');
          
          // Notify parent of node position change
          onNodePositionsChange([{ id: d.id, x: d.x, y: d.y }]);
        });
      
      nodeGroups.call(drag as any);
    }
    

    // Center and fit the floor plan
    centerFloorPlan(drawG, floorPlan, width, height, zoomRef.current!, drawGRef);
  }, [floorPlan, onEdgeClick, onRoomClick]);

  return (
    <div className="floor-plan-canvas-container">
      <svg
        ref={svgRef}
        style={{ cursor: measureMode ? 'crosshair' : undefined }}
      >
        <g ref={gRef}>
          <g ref={drawGRef} />
          <g ref={measureGRef} />
        </g>
      </svg>
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

  if (!isFinite(minX)) return; // No data to center

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
    // Set node radii immediately for the target scale
    d3.select(drawGRef.current).selectAll('.node-point')
      .attr('r', 3 / scale);

    d3.select<SVGSVGElement, unknown>(svgElement)
      .transition()
      .duration(750)
      .call(zoom.transform as any, transform);
  }
}
