import * as d3 from "d3";
import type { Node, Edge, FloorPlan } from "./types.js";
import { sampleFloorPlan } from "./data.js";

/**
 * Main FloorPlanEditor class
 * Handles rendering and interaction with the floor plan using D3
 */
class FloorPlanEditor {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private g: d3.Selection<SVGGElement, unknown, null, undefined>;
  private zoom!: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private floorPlan: FloorPlan;
  private width: number = 0;
  private height: number = 0;

  constructor(containerId: string, floorPlan: FloorPlan) {
    this.floorPlan = floorPlan;

    // Get container dimensions
    const containerNode = document.getElementById(containerId);
    if (!containerNode || !(containerNode instanceof SVGSVGElement)) {
      throw new Error(`Container ${containerId} not found or is not an SVG element`);
    }
    
    const rect = containerNode.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;

    // Initialize SVG with zoom behavior
    this.svg = d3.select<SVGSVGElement, unknown>(containerNode)
      .attr("width", this.width)
      .attr("height", this.height);

    // Create main group for zoom/pan
    this.g = this.svg.append("g");

    // Set up zoom behavior
    this.setupZoom();

    // Initial render
    this.render();

    // Center the floor plan on initial load
    this.centerFloorPlan();

    // Handle window resize
    window.addEventListener("resize", () => this.handleResize());
  }

  /**
   * Center the floor plan in the viewport
   */
  private centerFloorPlan(): void {
    // Calculate bounds of the floor plan
    const xs = this.floorPlan.nodes.map(n => n.x);
    const ys = this.floorPlan.nodes.map(n => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const planWidth = maxX - minX;
    const planHeight = maxY - minY;
    const planCenterX = (minX + maxX) / 2;
    const planCenterY = (minY + maxY) / 2;

    // Calculate scale to fit with padding
    const padding = 100;
    const scaleX = (this.width - padding * 2) / planWidth;
    const scaleY = (this.height - padding * 2) / planHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down if needed

    // Calculate translation to center
    const translateX = this.width / 2 - planCenterX * scale;
    const translateY = this.height / 2 - planCenterY * scale;

    // Apply initial transform
    const transform = d3.zoomIdentity
      .translate(translateX, translateY)
      .scale(scale);

    this.svg
      .transition()
      .duration(750)
      .call(this.zoom.transform as any, transform);
  }

  /**
   * Set up zoom and pan behavior
   */
  private setupZoom(): void {
    this.zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 5])
      .on("zoom", (event) => {
        this.g.attr("transform", event.transform.toString());
      });

    this.svg.call(this.zoom);

    // Reset zoom button
    d3.select("#resetZoom").on("click", () => {
      this.centerFloorPlan();
    });
  }

  /**
   * Main render method - draws the floor plan
   */
  private render(): void {
    // Clear previous content
    this.g.selectAll("*").remove();

    // Create lookup map for nodes
    const nodeMap = new Map<string, Node>();
    this.floorPlan.nodes.forEach((node) => nodeMap.set(node.id, node));

    // Render edges (walls, doors, windows)
    this.renderEdges(nodeMap);

    // Render nodes (junction points)
    this.renderNodes();
  }

  /**
   * Render all edges with proper styling and interactivity
   */
  private renderEdges(nodeMap: Map<string, Node>): void {
    const edgeGroup = this.g.append("g").attr("class", "edges");

    const edges = edgeGroup
      .selectAll<SVGLineElement, Edge>("line")
      .data(this.floorPlan.edges)
      .join("line")
      .attr("class", (d) => `edge ${d.type}`)
      .attr("x1", (d) => nodeMap.get(d.source)?.x ?? 0)
      .attr("y1", (d) => nodeMap.get(d.source)?.y ?? 0)
      .attr("x2", (d) => nodeMap.get(d.target)?.x ?? 0)
      .attr("y2", (d) => nodeMap.get(d.target)?.y ?? 0);

    // Hover effect
    edges.on("mouseenter", function () {
      d3.select(this).classed("hovered", true);
    });

    edges.on("mouseleave", function () {
      d3.select(this).classed("hovered", false);
    });

    // Click handler - log edge info
    edges.on("click", (event, d) => {
      event.stopPropagation();
      console.log("Edge clicked:", {
        id: d.id,
        type: d.type,
        source: d.source,
        target: d.target,
        sourceCoords: nodeMap.get(d.source),
        targetCoords: nodeMap.get(d.target),
      });

      // Optional: Add visual feedback
      this.logToChat(
        `Selected ${d.type}: ${d.id} (${d.source} → ${d.target})`
      );
    });
  }

  /**
   * Render all nodes with drag behavior
   */
  private renderNodes(): void {
    const nodeGroup = this.g.append("g").attr("class", "nodes");

    const nodes = nodeGroup
      .selectAll<SVGCircleElement, Node>("circle")
      .data(this.floorPlan.nodes)
      .join("circle")
      .attr("class", "node")
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("r", 5)
      .attr("fill", "#aaaaaa")
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 1);

    // Add drag behavior
    const drag = d3.drag<SVGCircleElement, Node>()
      .on("start", (event) => {
        d3.select(event.sourceEvent.target).attr("r", 8);
      })
      .on("drag", (event, d) => {
        // Update node position
        d.x = event.x;
        d.y = event.y;

        // Re-render to update edges
        this.render();
      })
      .on("end", (_event, d) => {
        console.log("Node moved:", d);
      });

    nodes.call(drag);

    // Click handler for nodes
    nodes.on("click", (event, d) => {
      event.stopPropagation();
      console.log("Node clicked:", d);
    });
  }

  /**
   * Handle window resize
   */
  private handleResize(): void {
    const containerNode = this.svg.node() as SVGSVGElement;
    const rect = containerNode.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;

    this.svg.attr("width", this.width).attr("height", this.height);
  }

  /**
   * Helper method to log messages to the chat panel
   */
  private logToChat(message: string): void {
    const chatMessages = d3.select(".chat-messages");
    chatMessages
      .append("div")
      .attr("class", "chat-message")
      .text(message);

    // Auto-scroll to bottom
    const messagesNode = chatMessages.node() as HTMLElement;
    messagesNode.scrollTop = messagesNode.scrollHeight;
  }
}

/**
 * Initialize the application
 */
function init(): void {
  console.log("Initializing Floor Plan Editor...");
  console.log("Sample floor plan:", sampleFloorPlan);

  // Create editor instance
  new FloorPlanEditor("floor-plan-canvas", sampleFloorPlan);

  console.log("Floor Plan Editor initialized!");
}

// Start the app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
