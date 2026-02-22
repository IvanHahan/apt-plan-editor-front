/**
 * Convert backend API data to frontend FloorPlan format
 */

import type { FloorPlan, Node, Edge, EdgeType, Room, Fixture } from '../types';
import type { FloorPlanDetail } from '../api/client';

/**
 * Map API edge type to frontend EdgeType
 */
function mapEdgeType(apiType: string): EdgeType {
  const normalized = apiType.toLowerCase();
  if (normalized === 'door') return 'door';
  if (normalized === 'window') return 'window';
  return 'wall';
}

/**
 * Convert API floor plan to frontend format
 */
export function convertApiToFloorPlan(apiPlan: FloorPlanDetail): FloorPlan {
  // Convert nodes
  const nodes: Node[] = apiPlan.nodes.map(node => ({
    id: node.id,
    x: node.x,
    y: node.y,
  }));

  // Convert edges with thickness, shift, properties, and geometries
  const edges: Edge[] = apiPlan.edges.map(edge => ({
    id: edge.id,
    source: edge.from_node,
    target: edge.to_node,
    type: mapEdgeType(edge.edge_type),
    thickness: edge.thickness,
    shift: edge.shift ?? 0,
    is_inner: edge.is_inner,
    properties: edge.properties,
    geometries: edge.geometries,
  }));

  // Convert rooms
  const rooms: Room[] = apiPlan.rooms.map(room => ({
    id: room.id,
    polygon_coords: room.polygon_coords,
    tags: room.tags,
  }));

  // Convert fixtures
  const fixtures: Fixture[] = apiPlan.fixtures.map(fixture => ({
    id: fixture.id,
    polygon_coords: fixture.polygon_coords,
    fixture_type: fixture.fixture_type,
    properties: fixture.properties,
  }));

  return { nodes, edges, rooms, fixtures, unit_scale: apiPlan.unit_scale };
}
