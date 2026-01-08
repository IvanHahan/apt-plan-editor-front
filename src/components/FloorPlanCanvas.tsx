import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { FloorPlan, Node, Edge } from '../types';
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

    // Draw walls
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

    // Draw doors
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

    // Draw windows
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

    // Draw nodes
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

function centerFloorPlan(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  floorPlan: FloorPlan,
  width: number,
  height: number
) {
  const xs = floorPlan.nodes.map((n: Node) => n.x);
  const ys = floorPlan.nodes.map((n: Node) => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

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
