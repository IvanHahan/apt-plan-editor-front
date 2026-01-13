import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { FloorPlan, Node, Edge, Room, Fixture } from '../types';
import './FloorPlanCanvas.css';

interface FloorPlanCanvasProps {
  floorPlan: FloorPlan;
  onEdgeClick?: (edgeId: string) => void;
}

export const FloorPlanCanvas: React.FC<FloorPlanCanvasProps> = ({
  floorPlan,
  onEdgeClick,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;

    const container = svgRef.current.parentElement;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear previous content
    d3.select(gRef.current).selectAll('*').remove();

    // Setup SVG
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const g = d3.select(gRef.current);

    // Setup zoom
    if (!zoomRef.current) {
      zoomRef.current = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 5])
        .on('zoom', (event) => {
          g.attr('transform', event.transform.toString());
        });

      svg.call(zoomRef.current);
    }

    // Draw rooms (if available)
    if (floorPlan.rooms && floorPlan.rooms.length > 0) {
      g.selectAll('.room')
        .data(floorPlan.rooms, (d: any) => d.id)
        .enter()
        .append('polygon')
        .attr('class', 'room')
        .attr('points', (d: Room) => 
          d.polygon_coords.map(([x, y]) => `${x},${y}`).join(' ')
        )
        .attr('fill', (d: Room) => {
          // Color rooms based on tags
          if (d.tags.includes('bedroom')) return 'rgba(173, 216, 230, 0.3)';
          if (d.tags.includes('bathroom')) return 'rgba(255, 182, 193, 0.3)';
          if (d.tags.includes('kitchen')) return 'rgba(255, 228, 196, 0.3)';
          if (d.tags.includes('living')) return 'rgba(144, 238, 144, 0.3)';
          return 'rgba(240, 240, 240, 0.3)';
        })
        .attr('stroke', '#ccc')
        .attr('stroke-width', 1);
    }

    // Render edges based on whether we have thickness data
    const hasThickness = floorPlan.edges.some(e => e.thickness !== undefined);

    if (hasThickness) {
      // Render walls as thick polygons
      const walls = floorPlan.edges.filter((e: Edge) => e.type === 'wall');
      
      walls.forEach((edge: Edge) => {
        const sourceNode = floorPlan.nodes.find((n: Node) => n.id === edge.source);
        const targetNode = floorPlan.nodes.find((n: Node) => n.id === edge.target);
        
        if (!sourceNode || !targetNode) return;

        const thickness = edge.thickness || 0.2;
        const wallPolygon = createWallPolygon(
          sourceNode.x, sourceNode.y,
          targetNode.x, targetNode.y,
          thickness
        );

        g.append('polygon')
          .attr('class', 'wall')
          .attr('points', wallPolygon.map(([x, y]) => `${x},${y}`).join(' '))
          .attr('fill', edge.is_inner ? '#666' : '#333')
          .attr('stroke', '#000')
          .attr('stroke-width', 0.5)
          .attr('cursor', 'pointer')
          .on('click', function(event) {
            event.stopPropagation();
            onEdgeClick?.(edge.id);
          });
      });
    } else {
      // Fallback: render as lines (for sample data)
      const walls = floorPlan.edges.filter((e: Edge) => e.type === 'wall');
      g.selectAll('.wall')
        .data(walls, (d: any) => d.id)
        .enter()
        .append('line')
        .attr('class', 'wall')
        .attr('x1', (d: Edge) => {
          const node = floorPlan.nodes.find((n: Node) => n.id === d.source);
          return node?.x ?? 0;
        })
        .attr('y1', (d: Edge) => {
          const node = floorPlan.nodes.find((n: Node) => n.id === d.source);
          return node?.y ?? 0;
        })
        .attr('x2', (d: Edge) => {
          const node = floorPlan.nodes.find((n: Node) => n.id === d.target);
          return node?.x ?? 0;
        })
        .attr('y2', (d: Edge) => {
          const node = floorPlan.nodes.find((n: Node) => n.id === d.target);
          return node?.y ?? 0;
        })
        .attr('stroke', '#333')
        .attr('stroke-width', 4)
        .attr('cursor', 'pointer')
        .on('click', (event, d: Edge) => {
          event.stopPropagation();
          onEdgeClick?.(d.id);
        });
    }

    // Draw fixtures (if available)
    if (floorPlan.fixtures && floorPlan.fixtures.length > 0) {
      g.selectAll('.fixture')
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
        .attr('stroke-width', 0.5);
    } else {
      // Fallback: render doors as dashed lines
      const doors = floorPlan.edges.filter((e: Edge) => e.type === 'door');
      g.selectAll('.door')
        .data(doors, (d: any) => d.id)
        .enter()
        .append('line')
        .attr('class', 'door')
        .attr('x1', (d: Edge) => {
          const node = floorPlan.nodes.find((n: Node) => n.id === d.source);
          return node?.x ?? 0;
        })
        .attr('y1', (d: Edge) => {
          const node = floorPlan.nodes.find((n: Node) => n.id === d.source);
          return node?.y ?? 0;
        })
        .attr('x2', (d: Edge) => {
          const node = floorPlan.nodes.find((n: Node) => n.id === d.target);
          return node?.x ?? 0;
        })
        .attr('y2', (d: Edge) => {
          const node = floorPlan.nodes.find((n: Node) => n.id === d.target);
          return node?.y ?? 0;
        })
        .attr('stroke', '#8B4513')
        .attr('stroke-width', 3)
        .attr('stroke-dasharray', '5,5')
        .attr('cursor', 'pointer')
        .on('click', (event, d: Edge) => {
          event.stopPropagation();
          onEdgeClick?.(d.id);
        });

      // Fallback: render windows as lines
      const windows = floorPlan.edges.filter((e: Edge) => e.type === 'window');
      g.selectAll('.window')
        .data(windows, (d: any) => d.id)
        .enter()
        .append('line')
        .attr('class', 'window')
        .attr('x1', (d: Edge) => {
          const node = floorPlan.nodes.find((n: Node) => n.id === d.source);
          return node?.x ?? 0;
        })
        .attr('y1', (d: Edge) => {
          const node = floorPlan.nodes.find((n: Node) => n.id === d.source);
          return node?.y ?? 0;
        })
        .attr('x2', (d: Edge) => {
          const node = floorPlan.nodes.find((n: Node) => n.id === d.target);
          return node?.x ?? 0;
        })
        .attr('y2', (d: Edge) => {
          const node = floorPlan.nodes.find((n: Node) => n.id === d.target);
          return node?.y ?? 0;
        })
        .attr('stroke', '#87CEEB')
        .attr('stroke-width', 2)
        .attr('cursor', 'pointer')
        .on('click', (event, d: Edge) => {
          event.stopPropagation();
          onEdgeClick?.(d.id);
        });
    }

    // Draw nodes (optional, useful for debugging)
    if (!hasThickness || floorPlan.nodes.length < 50) {
      g.selectAll('.node')
        .data(floorPlan.nodes, (d: any) => d.id)
        .enter()
        .append('circle')
        .attr('class', 'node')
        .attr('cx', (d: Node) => d.x)
        .attr('cy', (d: Node) => d.y)
        .attr('r', 5)
        .attr('fill', '#333')
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);
    }

    // Center and fit the floor plan
    centerFloorPlan(g, floorPlan, width, height);
  }, [floorPlan, onEdgeClick]);

  return (
    <div className="floor-plan-canvas-container">
      <svg ref={svgRef}>
        <g ref={gRef} />
      </svg>
    </div>
  );
};

/**
 * Create a polygon representing a wall with thickness
 */
function createWallPolygon(
  x1: number, y1: number,
  x2: number, y2: number,
  thickness: number
): [number, number][] {
  // Calculate perpendicular vector
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length === 0) return [[x1, y1]]; // Degenerate case
  
  // Normalized perpendicular vector
  const perpX = -dy / length * (thickness / 2);
  const perpY = dx / length * (thickness / 2);
  
  // Four corners of the wall rectangle
  return [
    [x1 + perpX, y1 + perpY],
    [x2 + perpX, y2 + perpY],
    [x2 - perpX, y2 - perpY],
    [x1 - perpX, y1 - perpY],
  ];
}

function centerFloorPlan(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  floorPlan: FloorPlan,
  width: number,
  height: number
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
  const scale = Math.min(scaleX, scaleY, 1);

  const translateX = width / 2 - planCenterX * scale;
  const translateY = height / 2 - planCenterY * scale;

  const transform = d3.zoomIdentity
    .translate(translateX, translateY)
    .scale(scale);

  const svgElement = g.node()?.parentElement as SVGSVGElement | null;
  if (svgElement) {
    d3.select(svgElement)
      .transition()
      .duration(750)
      .call(d3.zoom<SVGSVGElement, unknown>().transform as any, transform);
  }
}
