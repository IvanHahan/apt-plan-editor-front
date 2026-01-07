import type { FloorPlan } from "./types.js";

/**
 * Sample apartment floor plan with 4 rooms:
 * - Living Room (left)
 * - Kitchen (top-right)
 * - Bedroom (bottom-right)
 * - Bathroom (small, center-right)
 * 
 * Coordinates are scaled larger for better visibility
 */
export const sampleFloorPlan: FloorPlan = {
  nodes: [
    // Outer boundary nodes (scaled up 2x)
    { id: "n1", x: 200, y: 100 },   // Top-left corner
    { id: "n2", x: 600, y: 100 },   // Top-middle
    { id: "n3", x: 1000, y: 100 },  // Top-right corner
    { id: "n4", x: 1000, y: 400 },  // Right-middle
    { id: "n5", x: 1000, y: 700 },  // Bottom-right corner
    { id: "n6", x: 600, y: 700 },   // Bottom-middle
    { id: "n7", x: 200, y: 700 },   // Bottom-left corner
    { id: "n8", x: 200, y: 400 },   // Left-middle

    // Interior division nodes
    { id: "n9", x: 600, y: 400 },   // Center junction (hallway)
    { id: "n10", x: 600, y: 550 },  // Bathroom bottom junction
    { id: "n11", x: 800, y: 400 },  // Kitchen/Bedroom divider
    { id: "n12", x: 800, y: 550 },  // Bedroom entrance
  ],
  edges: [
    // Outer boundary walls
    { id: "e1", source: "n1", target: "n2", type: "wall" },
    { id: "e2", source: "n2", target: "n3", type: "wall" },
    { id: "e3", source: "n3", target: "n4", type: "wall" },
    { id: "e4", source: "n4", target: "n5", type: "wall" },
    { id: "e5", source: "n5", target: "n6", type: "wall" },
    { id: "e6", source: "n6", target: "n7", type: "wall" },
    { id: "e7", source: "n7", target: "n8", type: "wall" },
    { id: "e8", source: "n8", target: "n1", type: "wall" },

    // Living room division
    { id: "e9", source: "n2", target: "n9", type: "wall" },
    { id: "e10", source: "n8", target: "n9", type: "door" },  // Door to hallway

    // Kitchen walls (top-right)
    { id: "e11", source: "n9", target: "n11", type: "wall" },
    { id: "e12", source: "n4", target: "n11", type: "door" }, // Kitchen door

    // Bathroom (small center room)
    { id: "e13", source: "n9", target: "n10", type: "wall" },
    { id: "e14", source: "n10", target: "n12", type: "door" }, // Bathroom door
    { id: "e15", source: "n11", target: "n12", type: "wall" },

    // Bedroom walls (bottom-right)
    { id: "e16", source: "n12", target: "n5", type: "window" }, // Bedroom window
    { id: "e17", source: "n10", target: "n6", type: "wall" },

    // Windows
    { id: "e18", source: "n1", target: "n8", type: "window" },  // Living room window
    { id: "e19", source: "n2", target: "n3", type: "window" },  // Kitchen window
  ],
};
