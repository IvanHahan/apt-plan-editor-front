/**
 * API client for Floor Plan Editor backend
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export interface ApiNode {
  id: string;
  x: number;
  y: number;
  plan_id: string;
}

export interface ApiEdgeGeometry {
  id: string;
  polygon_coords: [number, number][];
}

export interface ApiEdge {
  id: string;
  plan_id: string;
  from_node: string;
  to_node: string;
  edge_type: string;
  is_inner: boolean;
  thickness: number;
  properties: Record<string, any>;
  geometries?: ApiEdgeGeometry[];
}

export interface ApiRoom {
  id: string;
  plan_id: string;
  polygon_coords: [number, number][];
  tags: string[];
}

export interface ApiFixture {
  id: string;
  plan_id: string;
  polygon_coords: [number, number][];
  fixture_type: string;
  properties: Record<string, any>;
}

export interface FloorPlanDetail {
  id: string;
  user_id: string;
  name: string | null;
  unit_scale: number;
  created_at: string;
  updated_at: string;
  nodes: ApiNode[];
  edges: ApiEdge[];
  rooms: ApiRoom[];
  fixtures: ApiFixture[];
}

export interface FloorPlanSummary {
  id: string;
  user_id: string;
  name: string | null;
  unit_scale: number;
  created_at: string;
  updated_at: string;
  nodes_count: number;
  edges_count: number;
  rooms_count: number;
  fixtures_count: number;
}

export interface User {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Process floor plan image and create new floor plan
 */
export async function processFloorPlanImage(
  file: File,
  userId: string,
  name?: string,
  scaleFactor?: number
): Promise<FloorPlanDetail> {
  const formData = new FormData();
  formData.append('file', file);

  const params = new URLSearchParams({ user_id: userId });
  if (name) params.append('name', name);
  if (scaleFactor) params.append('scale_factor', scaleFactor.toString());

  const response = await fetch(`${API_BASE_URL}/floor-plans/process-image?${params}`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Get floor plan details by ID
 */
export async function getFloorPlan(planId: string): Promise<FloorPlanDetail> {
  const response = await fetch(`${API_BASE_URL}/floor-plans/${planId}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Floor plan not found' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * List all floor plans for a user
 */
export async function listUserFloorPlans(
  userId: string,
  skip = 0,
  limit = 100
): Promise<FloorPlanSummary[]> {
  const params = new URLSearchParams({
    skip: skip.toString(),
    limit: limit.toString(),
  });

  const response = await fetch(`${API_BASE_URL}/floor-plans/user/${userId}?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'User not found' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Update floor plan name
 */
export async function updateFloorPlan(
  planId: string,
  name: string
): Promise<FloorPlanSummary> {
  const params = new URLSearchParams({ name });

  const response = await fetch(`${API_BASE_URL}/floor-plans/${planId}?${params}`, {
    method: 'PUT',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Floor plan not found' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Delete floor plan
 */
export async function deleteFloorPlan(planId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/floor-plans/${planId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Floor plan not found' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
}

/**
 * Node position update type
 */
export interface NodePositionUpdate {
  id: string;
  x: number;
  y: number;
}

/**
 * Update node positions in a floor plan
 */
export async function updateFloorPlanNodes(
  planId: string,
  nodes: NodePositionUpdate[]
): Promise<FloorPlanDetail> {
  const response = await fetch(`${API_BASE_URL}/floor-plans/${planId}/nodes`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to update nodes' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * New node data as part of an edge creation request
 */
export interface NewNodeData {
  id: string;
  x: number;
  y: number;
  /** If set, the backend will split this edge at this node's coordinates */
  split_edge_id?: string;
}

/**
 * New edge data for createEdges
 */
export interface NewEdgeData {
  from_node: NewNodeData;
  to_node: NewNodeData;
  edge_type: string;
  thickness?: number;
  is_inner?: boolean;
}

/**
 * Create one or more new edges (walls) in a floor plan.
 * Nodes are resolved server-side: existing node IDs are reused (snap), new IDs cause node creation.
 */
export async function createEdges(
  planId: string,
  edges: NewEdgeData[]
): Promise<FloorPlanDetail> {
  const response = await fetch(`${API_BASE_URL}/floor-plans/${planId}/edges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edges }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to create edges' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Delete multiple edges from a floor plan
 */
export async function deleteEdges(
  planId: string,
  edgeIds: string[]
): Promise<FloorPlanDetail> {
  const response = await fetch(`${API_BASE_URL}/floor-plans/${planId}/edges`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edge_ids: edgeIds }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to delete edges' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Merge multiple adjacent edges into a single edge
 */
export async function mergeEdges(
  planId: string,
  edgeIds: string[]
): Promise<FloorPlanDetail> {
  const response = await fetch(`${API_BASE_URL}/floor-plans/${planId}/edges/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edge_ids: edgeIds }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to merge edges' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Create a new user
 */
export async function createUser(
  email: string,
  username: string,
  password: string,
  fullName?: string
): Promise<User> {
  const response = await fetch(`${API_BASE_URL}/users/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      username,
      password,
      full_name: fullName,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to create user' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Redesign request types
 */
export interface RedesignRequest {
  desires?: string;
  locked_room_ids?: string[];
}

export interface RedesignResponse {
  image_base64: string;
  message: string;
}

/**
 * Redesign a floor plan using Gemini AI image generation
 */
export async function redesignFloorPlan(
  planId: string,
  request: RedesignRequest
): Promise<RedesignResponse> {
  const response = await fetch(`${API_BASE_URL}/floor-plans/${planId}/redesign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Redesign failed' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Normalize scale response
 */
export interface NormalizeScaleResponse {
  id: string;
  previous_unit_scale: number;
  new_unit_scale: number;
  scale_factor: number;
  message: string;
}

/**
 * Normalize floor plan scale from pixels to meters
 */
export async function normalizeScale(
  planId: string,
  pixelsPerMeter: number
): Promise<NormalizeScaleResponse> {
  const response = await fetch(`${API_BASE_URL}/floor-plans/${planId}/normalize-scale`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pixels_per_meter: pixelsPerMeter }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to normalize scale' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Health check
 */
export async function healthCheck(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/health`);
  return response.json();
}
