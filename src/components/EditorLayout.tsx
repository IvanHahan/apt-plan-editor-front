import React, { useRef, useState } from 'react';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import { GeneratedImagePreview } from './GeneratedImagePreview';
import { ToolsBar } from './ToolsBar';
import { WallToolOptions } from './WallToolOptions';
import { AssetToolOptions } from './AssetToolOptions';
import { processFloorPlanImage, listUserFloorPlans, deleteFloorPlan, createEmptyFloorPlan, redesignFloorPlan, normalizeScale, getFloorPlan, updateFloorPlanNodes, createEdges, deleteEdges, mergeEdges, updateEdges, updateFloorPlan, type FloorPlanSummary, type NodePositionUpdate, type NewEdgeData, type EdgePropertyUpdate } from '../api/client';
import { convertApiToFloorPlan } from '../utils/converter';
import type { FloorPlan, Node, Edge, EditorTool, AssetType, AssetPlacement } from '../types';
import './EditorLayout.css';

// Get user ID from env (in production, get from auth)
const USER_ID = import.meta.env.VITE_USER_ID || '550e8400-e29b-41d4-a716-446655440000';

export const EditorLayout: React.FC = () => {
  const [leftPanelWidth, setLeftPanelWidth] = useState(200);
  const [rightPanelWidth, setRightPanelWidth] = useState(280);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [floorPlan, setFloorPlan] = useState<FloorPlan>({ nodes: [], edges: [], is_calibrated: true });
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const currentPlanIdRef = useRef<string | null>(null);
  const [userPlans, setUserPlans] = useState<FloorPlanSummary[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const autoSaveTimerRef = useRef<number | null>(null);

  // Pending wall creations awaiting debounced persist
  const wallSaveTimerRef = useRef<number | null>(null);
  const pendingWallsRef = useRef<NewEdgeData[]>([]);
  // Accumulates nodes created optimistically so chained wall calls resolve source nodes
  // even when the React state hasn't re-rendered yet.
  const accumulatedNewNodesRef = useRef<Node[]>([]);
  
  // Redesign mode state
  const [isRedesignMode, setIsRedesignMode] = useState(false);
  const [redesignDesires, setRedesignDesires] = useState('');
  const [isRedesigning, setIsRedesigning] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);

  // Measurement / scale normalization state
  const [isMeasureMode, setIsMeasureMode] = useState(false);
  const [measuredPixelDistance, setMeasuredPixelDistance] = useState<number | null>(null);
  const [metersInput, setMetersInput] = useState('');
  const [isNormalizingScale, setIsNormalizingScale] = useState(false);

  // Rename state
  const [renamingPlanId, setRenamingPlanId] = useState<string | null>(null);
  const [renameInputValue, setRenameInputValue] = useState('');

  // Edge selection state
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set());

  // Active tool state
  const [activeTool, setActiveTool] = useState<EditorTool>('cursor');

  // Wall tool state
  const [wallThickness, setWallThickness] = useState(0.2); // 0.2 m default (metres when calibrated)

  // Reset wall thickness default when calibration status changes
  React.useEffect(() => {
    setWallThickness(floorPlan.is_calibrated ? 0.2 : 20);
  }, [floorPlan.is_calibrated]);

  // Asset tool state
  const [assetType, setAssetType] = useState<AssetType>('door');
  const [assetWidthM, setAssetWidthM] = useState(0.8);

  const handleWallAdd = (newEdge: Edge, newNodes: Node[], splits?: { [nodeId: string]: string }) => {
    // Resolve node coordinates first — before any state mutation.
    // accumulatedNewNodesRef holds nodes added in previous chained calls that may not
    // yet be reflected in the floorPlan state (React hasn't re-rendered).
    // Deduplicate: prefer the latest occurrence of any given id.
    const nodeMap = new Map<string, Node>();
    for (const n of floorPlan.nodes) nodeMap.set(n.id, n);
    for (const n of accumulatedNewNodesRef.current) nodeMap.set(n.id, n);
    for (const n of newNodes) nodeMap.set(n.id, n);
    const fromNode = nodeMap.get(newEdge.source);
    const toNode = nodeMap.get(newEdge.target);
    if (!fromNode || !toNode) {
      console.error('handleWallAdd: could not resolve node coordinates', { source: newEdge.source, target: newEdge.target, nodeIds: [...nodeMap.keys()] });
      return;
    }

    // Persist new nodes into the accumulator for subsequent chained calls
    for (const n of newNodes) {
      accumulatedNewNodesRef.current = [...accumulatedNewNodesRef.current.filter(x => x.id !== n.id), n];
    }

    // Optimistic local update — only after resolution succeeds to avoid orphaned edges
    setFloorPlan((prev) => ({
      ...prev,
      nodes: [...prev.nodes, ...newNodes],
      edges: [...prev.edges, newEdge],
    }));

    pendingWallsRef.current.push({
      from_node: {
        id: fromNode.id,
        x: fromNode.x,
        y: fromNode.y,
        split_edge_id: splits?.[fromNode.id],
      },
      to_node: {
        id: toNode.id,
        x: toNode.x,
        y: toNode.y,
        split_edge_id: splits?.[toNode.id],
      },
      edge_type: newEdge.type,
      thickness: newEdge.thickness,
      is_inner: newEdge.is_inner ?? true,
    });
    setHasUnsavedChanges(true);

    // Reset the debounce timer
    if (wallSaveTimerRef.current !== null) {
      window.clearTimeout(wallSaveTimerRef.current);
    }

    wallSaveTimerRef.current = window.setTimeout(async () => {
      const batch = pendingWallsRef.current.splice(0);
      if (batch.length === 0) return;

      setIsSaving(true);
      setError(null);

      try {
        // Lazily create a backend plan on first draw if none exists yet
        let planId = currentPlanIdRef.current;
        if (!planId) {
          const newPlan = await createEmptyFloorPlan(USER_ID);
          setCurrentPlanId(newPlan.id);
          currentPlanIdRef.current = newPlan.id;
          planId = newPlan.id;
          loadUserPlans(); // refresh sidebar (non-blocking)
        }
        const result = await createEdges(planId, batch);
        const convertedPlan = convertApiToFloorPlan(result);
        setFloorPlan(convertedPlan);
        // Backend response is ground truth — clear the optimistic accumulator
        accumulatedNewNodesRef.current = [];
        setHasUnsavedChanges(false);
      } catch (err) {
        console.error('Failed to save new walls:', err);
        setError(err instanceof Error ? err.message : 'Failed to save walls');
      } finally {
        setIsSaving(false);
        wallSaveTimerRef.current = null;
      }
    }, 300);
  };

  // Keep ref in sync with state so debounced callbacks see the latest plan ID
  React.useEffect(() => {
    currentPlanIdRef.current = currentPlanId;
  }, [currentPlanId]);

  // Load user's plans on mount
  React.useEffect(() => {
    loadUserPlans();
  }, []);

  const loadUserPlans = async () => {
    setIsLoadingPlans(true);
    setError(null);
    try {
      const plans = await listUserFloorPlans(USER_ID);
      setUserPlans(plans);
    } catch (err) {
      console.error('Failed to load plans:', err);
      setError(err instanceof Error ? err.message : 'Failed to load plans');
    } finally {
      setIsLoadingPlans(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const planName = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
      const result = await processFloorPlanImage(file, USER_ID, planName);
      
      const convertedPlan = convertApiToFloorPlan(result);
      setFloorPlan(convertedPlan);
      setCurrentPlanId(result.id);
      
      // Reload plans list
      await loadUserPlans();
    } catch (err) {
      console.error('Upload failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to process image');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleLoadPlan = async (planId: string) => {
    setError(null);
    try {
      const apiPlan = await getFloorPlan(planId);
      const convertedPlan = convertApiToFloorPlan(apiPlan);
      setFloorPlan(convertedPlan);
      setCurrentPlanId(planId);
    } catch (err) {
      console.error('Failed to load plan:', err);
      setError(err instanceof Error ? err.message : 'Failed to load plan');
    }
  };

  const handleNewPlan = () => {
    setFloorPlan({ nodes: [], edges: [] });
    setCurrentPlanId(null);
    currentPlanIdRef.current = null;
    setSelectedEdgeIds(new Set());
    setError(null);
  };

  const handleMouseDown = (
    e: React.MouseEvent,
    side: 'left' | 'right'
  ) => {
    e.preventDefault();
    const startX = e.clientX;
    const startLeftWidth = leftPanelWidth;
    const startRightWidth = rightPanelWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;

      if (side === 'left') {
        const newWidth = Math.max(150, Math.min(400, startLeftWidth + deltaX));
        setLeftPanelWidth(newWidth);
      } else {
        const newWidth = Math.max(150, Math.min(400, startRightWidth - deltaX));
        setRightPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleResetZoom = () => {
    // Reset zoom functionality
    const svg = document.querySelector('svg') as SVGSVGElement;
    if (svg) {
      svg.dispatchEvent(new CustomEvent('resetZoom'));
    }
  };

  const handleStartRename = (plan: FloorPlanSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingPlanId(plan.id);
    setRenameInputValue(plan.name || '');
  };

  const handleSubmitRename = async (planId: string) => {
    const name = renameInputValue.trim();
    setRenamingPlanId(null);
    if (!name) return;
    try {
      await updateFloorPlan(planId, name);
      setUserPlans(prev => prev.map(p => p.id === planId ? { ...p, name } : p));
    } catch (err) {
      console.error('Failed to rename plan:', err);
      setError(err instanceof Error ? err.message : 'Failed to rename plan');
    }
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, planId: string) => {
    if (e.key === 'Enter') handleSubmitRename(planId);
    if (e.key === 'Escape') setRenamingPlanId(null);
  };

  const handleDeletePlan = async () => {
    if (!currentPlanId) return;
    
    const confirmDelete = window.confirm(
      'Are you sure you want to delete this floor plan? This action cannot be undone.'
    );
    
    if (!confirmDelete) return;

    try {
      setError(null);
      await deleteFloorPlan(currentPlanId);
      
      // Reset to empty canvas and clear selection
      setFloorPlan({ nodes: [], edges: [] });
      setCurrentPlanId(null);
      currentPlanIdRef.current = null;
      setSelectedEdgeIds(new Set());

      // Reload plans list
      await loadUserPlans();
    } catch (err) {
      console.error('Failed to delete plan:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete plan');
    }
  };

  const handleToggleRedesignMode = () => {
    setIsRedesignMode(!isRedesignMode);
    if (isRedesignMode) {
      // Exiting redesign mode - clear state
      setRedesignDesires('');
      // Unlock all rooms
      if (floorPlan.rooms) {
        setFloorPlan({
          ...floorPlan,
          rooms: floorPlan.rooms.map(room => ({ ...room, locked: false }))
        });
      }
    }
  };

  const handleToggleRoomLock = (roomId: string) => {
    if (!floorPlan.rooms) return;
    setFloorPlan({
      ...floorPlan,
      rooms: floorPlan.rooms.map(room => 
        room.id === roomId ? { ...room, locked: !room.locked } : room
      )
    });
  };

  const handleRedesignSubmit = async () => {
    if (!currentPlanId) {
      alert('Please save the floor plan before redesigning.');
      return;
    }

    const lockedRooms = floorPlan.rooms?.filter(r => r.locked) || [];

    setIsRedesigning(true);
    setError(null);

    try {
      const response = await redesignFloorPlan(currentPlanId, {
        desires: redesignDesires,
        locked_room_ids: lockedRooms.map(r => r.id),
      });

      // Show the generated image in the preview modal
      setGeneratedImage(response.image_base64);
    } catch (err) {
      console.error('Redesign failed:', err);
      setError(err instanceof Error ? err.message : 'Redesign failed');
    } finally {
      setIsRedesigning(false);
    }
  };

  const handleCloseGeneratedImage = () => {
    setGeneratedImage(null);
  };

  const handleRegenerateImage = () => {
    handleRedesignSubmit();
  };

  const handleToggleMeasureMode = () => {
    if (isMeasureMode) {
      // Exit measure mode
      setIsMeasureMode(false);
      setMeasuredPixelDistance(null);
      setMetersInput('');
    } else {
      // Enter measure mode (exit redesign mode if active)
      setIsRedesignMode(false);
      setIsMeasureMode(true);
      setMeasuredPixelDistance(null);
      setMetersInput('');
    }
  };

  const handleMeasure = (pixelDistance: number) => {
    setMeasuredPixelDistance(pixelDistance);
  };

  const handleRemeasure = () => {
    setMeasuredPixelDistance(null);
    setMetersInput('');
  };

  // Escape key resets measurement (or exits measure mode if no measurement yet)
  React.useEffect(() => {
    if (!isMeasureMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (measuredPixelDistance) {
          handleRemeasure();
        } else {
          setIsMeasureMode(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMeasureMode, measuredPixelDistance]);

  const handleApplyScale = async () => {
    const meters = parseFloat(metersInput);
    if (!meters || meters <= 0 || !measuredPixelDistance || !currentPlanId) return;

    const pixelsPerMeter = measuredPixelDistance / meters;

    setIsNormalizingScale(true);
    setError(null);

    try {
      await normalizeScale(currentPlanId, pixelsPerMeter);

      // Reload the floor plan with new coordinates
      const apiPlan = await getFloorPlan(currentPlanId);
      const converted = convertApiToFloorPlan(apiPlan);
      setFloorPlan(converted);

      // Exit measure mode
      setIsMeasureMode(false);
      setMeasuredPixelDistance(null);
      setMetersInput('');
    } catch (err) {
      console.error('Scale normalization failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to normalize scale');
    } finally {
      setIsNormalizingScale(false);
    }
  };

  // Handle node position changes with auto-save
  const handleNodePositionsChange = (updatedNodes: Node[]) => {
    if (!currentPlanId) return; // Only save if we have a plan ID

    // Update local state optimistically
    setFloorPlan(prevPlan => ({
      ...prevPlan,
      nodes: prevPlan.nodes.map(node => {
        const updated = updatedNodes.find(n => n.id === node.id);
        return updated || node;
      })
    }));

    setHasUnsavedChanges(true);

    // Clear existing timer
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    // Start new 300ms debounced auto-save timer
    autoSaveTimerRef.current = window.setTimeout(async () => {
      setIsSaving(true);
      setError(null);

      try {
        const nodeUpdates: NodePositionUpdate[] = updatedNodes.map(node => ({
          id: node.id,
          x: node.x,
          y: node.y,
        }));

        const result = await updateFloorPlanNodes(currentPlanId, nodeUpdates);
        const convertedPlan = convertApiToFloorPlan(result);
        
        // Update with server response (includes recalculated edge geometries)
        setFloorPlan(convertedPlan);
        setHasUnsavedChanges(false);
      } catch (err) {
        console.error('Failed to save node positions:', err);
        setError(err instanceof Error ? err.message : 'Failed to save changes');
        
        // Optionally revert optimistic update on error
        // (for now, we keep the local change and show an error)
      } finally {
        setIsSaving(false);
        autoSaveTimerRef.current = null;
      }
    }, 300); // 300ms delay
  };

  // Cleanup auto-save timers on unmount
  React.useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
      if (wallSaveTimerRef.current !== null) {
        window.clearTimeout(wallSaveTimerRef.current);
      }
    };
  }, []);

  // Keyboard shortcuts for edge selection
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete key: delete selected edges
      if (e.key === 'Delete' && selectedEdgeIds.size > 0 && isEditMode && !isRedesignMode && !isMeasureMode) {
        e.preventDefault();
        handleDeleteSelected();
      }
      // Escape key: clear selection
      if (e.key === 'Escape' && selectedEdgeIds.size > 0 && isEditMode && !isRedesignMode && !isMeasureMode) {
        e.preventDefault();
        handleClearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEdgeIds, isEditMode, isRedesignMode, isMeasureMode]);

  // Edge selection handlers
  const handleSelectedEdgesChange = (edgeIds: string[]) => {
    setSelectedEdgeIds(new Set(edgeIds));
  };

  const handleClearSelection = () => {
    setSelectedEdgeIds(new Set());
  };

  const handleDeleteSelected = async () => {
    if (selectedEdgeIds.size === 0 || !currentPlanId) return;

    try {
      const updatedPlan = await deleteEdges(currentPlanId, Array.from(selectedEdgeIds));
      const convertedPlan = convertApiToFloorPlan(updatedPlan);
      setFloorPlan(convertedPlan);
      setSelectedEdgeIds(new Set());
      setError(null);
    } catch (err) {
      console.error('Failed to delete edges:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete edges');
    }
  };

  const handleMergeSelected = async () => {
    if (selectedEdgeIds.size < 2 || !currentPlanId) return;

    try {
      const updatedPlan = await mergeEdges(currentPlanId, Array.from(selectedEdgeIds));
      const convertedPlan = convertApiToFloorPlan(updatedPlan);
      setFloorPlan(convertedPlan);
      setSelectedEdgeIds(new Set());
      setError(null);
    } catch (err) {
      console.error('Failed to merge edges:', err);
      setError(err instanceof Error ? err.message : 'Failed to merge edges');
    }
  };

  const handleEdgeThicknessSet = async (value: number) => {
    if (!currentPlanId || selectedEdgeIds.size === 0) return;
    const selectedEdges = floorPlan.edges.filter(e => selectedEdgeIds.has(e.id));
    if (selectedEdges.length === 0) return;
    const minThick = floorPlan.is_calibrated ? 0.01 : 1;
    const clamped = Math.max(minThick, value);
    const updates: EdgePropertyUpdate[] = selectedEdges.map(edge => ({ id: edge.id, thickness: clamped }));
    setFloorPlan(prev => ({
      ...prev,
      edges: prev.edges.map(edge => {
        const u = updates.find(u => u.id === edge.id);
        return u ? { ...edge, thickness: clamped } : edge;
      }),
    }));
    try {
      const updatedPlan = await updateEdges(currentPlanId, updates);
      setFloorPlan(convertApiToFloorPlan(updatedPlan));
      setError(null);
    } catch (err) {
      console.error('Failed to update edge thickness:', err);
      setError(err instanceof Error ? err.message : 'Failed to update edge thickness');
    }
  };

  const handleEdgeShiftSet = async (value: number) => {
    if (!currentPlanId || selectedEdgeIds.size === 0) return;
    const selectedEdges = floorPlan.edges.filter(e => selectedEdgeIds.has(e.id));
    if (selectedEdges.length === 0) return;
    const updates: EdgePropertyUpdate[] = selectedEdges.map(edge => ({ id: edge.id, shift: value }));
    setFloorPlan(prev => ({
      ...prev,
      edges: prev.edges.map(edge => {
        const u = updates.find(u => u.id === edge.id);
        return u ? { ...edge, shift: value } : edge;
      }),
    }));
    try {
      const updatedPlan = await updateEdges(currentPlanId, updates);
      setFloorPlan(convertApiToFloorPlan(updatedPlan));
      setError(null);
    } catch (err) {
      console.error('Failed to update edge shift:', err);
      setError(err instanceof Error ? err.message : 'Failed to update edge shift');
    }
  };

  const handleEdgePropertyUpdate = async (delta: { thickness?: number; shift?: number }) => {
    if (!currentPlanId || selectedEdgeIds.size === 0) return;

    const selectedEdges = floorPlan.edges.filter(e => selectedEdgeIds.has(e.id));
    if (selectedEdges.length === 0) return;

    const minThick = floorPlan.is_calibrated ? 0.01 : 1;
    const defaultThick = floorPlan.is_calibrated ? 0.2 : 16;
    const updates: EdgePropertyUpdate[] = selectedEdges.map(edge => ({
      id: edge.id,
      ...(delta.thickness !== undefined
        ? { thickness: Math.max(minThick, (edge.thickness ?? defaultThick) + delta.thickness) }
        : {}),
      ...(delta.shift !== undefined
        ? { shift: (edge.shift ?? 0) + delta.shift }
        : {}),
    }));

    // Optimistic update
    setFloorPlan(prev => ({
      ...prev,
      edges: prev.edges.map(edge => {
        const update = updates.find(u => u.id === edge.id);
        if (!update) return edge;
        return {
          ...edge,
          ...(update.thickness !== undefined ? { thickness: update.thickness } : {}),
          ...(update.shift !== undefined ? { shift: update.shift } : {}),
        };
      }),
    }));

    try {
      const updatedPlan = await updateEdges(currentPlanId, updates);
      const convertedPlan = convertApiToFloorPlan(updatedPlan);
      setFloorPlan(convertedPlan);
      setError(null);
    } catch (err) {
      console.error('Failed to update edges:', err);
      setError(err instanceof Error ? err.message : 'Failed to update edges');
    }
  };

  const handleAssetPlace = async (placement: AssetPlacement) => {
    const { wallEdge, wallSourceNode, wallTargetNode, assetStartPt, assetEndPt } = placement;

    const MIN_SEG = 0.001; // data units — skip only truly zero-length wall stubs
    const dx1 = assetStartPt.x - wallSourceNode.x;
    const dy1 = assetStartPt.y - wallSourceNode.y;
    const dx2 = wallTargetNode.x - assetEndPt.x;
    const dy2 = wallTargetNode.y - assetEndPt.y;
    const seg1Len = Math.hypot(dx1, dy1);
    const seg2Len = Math.hypot(dx2, dy2);

    // If the asset is flush with a wall endpoint, reuse that node instead of
    // creating a duplicate disconnected node at the same position.
    const assetStartId = seg1Len < MIN_SEG ? wallSourceNode.id : crypto.randomUUID();
    const assetEndId   = seg2Len < MIN_SEG ? wallTargetNode.id : crypto.randomUUID();
    const assetStartNode: Node = { id: assetStartId, x: assetStartPt.x, y: assetStartPt.y };
    const assetEndNode: Node   = { id: assetEndId,   x: assetEndPt.x,   y: assetEndPt.y   };

    const newEdgesData: NewEdgeData[] = [];
    if (seg1Len >= MIN_SEG) {
      newEdgesData.push({
        from_node: { id: wallSourceNode.id, x: wallSourceNode.x, y: wallSourceNode.y },
        to_node: { id: assetStartId, x: assetStartPt.x, y: assetStartPt.y },
        edge_type: 'wall',
        thickness: wallEdge.thickness,
        is_inner: wallEdge.is_inner ?? true,
      });
    }
    newEdgesData.push({
      from_node: { id: assetStartId, x: assetStartPt.x, y: assetStartPt.y },
      to_node: { id: assetEndId, x: assetEndPt.x, y: assetEndPt.y },
      edge_type: assetType,
      // Doors and windows have a fixed depth of 0.1 m, independent of the host wall thickness
      thickness: floorPlan.is_calibrated ? 0.1 : 8,
      is_inner: wallEdge.is_inner ?? true,
    });
    if (seg2Len >= MIN_SEG) {
      newEdgesData.push({
        from_node: { id: assetEndId, x: assetEndPt.x, y: assetEndPt.y },
        to_node: { id: wallTargetNode.id, x: wallTargetNode.x, y: wallTargetNode.y },
        edge_type: 'wall',
        thickness: wallEdge.thickness,
        is_inner: wallEdge.is_inner ?? true,
      });
    }

    // Optimistic update — only add nodes that are genuinely new (not reusing existing endpoints)
    const newNodes: Node[] = [];
    if (seg1Len >= MIN_SEG) newNodes.push(assetStartNode);
    if (seg2Len >= MIN_SEG) newNodes.push(assetEndNode);
    setFloorPlan((prev) => ({
      ...prev,
      nodes: [...prev.nodes, ...newNodes],
      edges: prev.edges.filter((e) => e.id !== wallEdge.id).concat(
        newEdgesData.map((ed, i) => ({
          id: `optimistic-asset-${i}-${Date.now()}`,
          source: ed.from_node.id,
          target: ed.to_node.id,
          type: ed.edge_type as Edge['type'],
          thickness: ed.thickness,
          is_inner: ed.is_inner,
        } as Edge))
      ),
    }));

    if (!currentPlanId) return;
    setIsSaving(true);
    setError(null);
    try {
      await deleteEdges(currentPlanId, [wallEdge.id]);
      const result = await createEdges(currentPlanId, newEdgesData);
      const convertedPlan = convertApiToFloorPlan(result);
      setFloorPlan(convertedPlan);
      setHasUnsavedChanges(false);
    } catch (err) {
      console.error('Failed to place asset:', err);
      setError(err instanceof Error ? err.message : 'Failed to place asset');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdgeDelete = async (edgeId: string) => {
    if (!currentPlanId) return;

    try {
      const updatedPlan = await deleteEdges(currentPlanId, [edgeId]);
      const convertedPlan = convertApiToFloorPlan(updatedPlan);
      setFloorPlan(convertedPlan);
      // Remove from selection if it was selected
      if (selectedEdgeIds.has(edgeId)) {
        const newSelection = new Set(selectedEdgeIds);
        newSelection.delete(edgeId);
        setSelectedEdgeIds(newSelection);
      }
      setError(null);
    } catch (err) {
      console.error('Failed to delete edge:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete edge');
    }
  };

  const canSetScale = !!currentPlanId;

  return (
    <div className="app-container">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* Top Header Bar */}
      <div className="canvas-header">
        <h2>
          Floor Plan Editor
          {hasUnsavedChanges && <span style={{ color: '#ff9800', marginLeft: '10px', fontSize: '14px' }}>● Unsaved</span>}
          {isSaving && <span style={{ color: '#4CAF50', marginLeft: '10px', fontSize: '14px' }}>💾 Saving...</span>}
        </h2>
        <div className="canvas-controls">
          <button onClick={handleUploadClick} disabled={isUploading}>
            {isUploading ? 'Uploading...' : 'Upload Image'}
          </button>
          <button onClick={handleResetZoom}>Reset Zoom</button>
          <button 
            onClick={handleToggleRedesignMode}
            style={{
              backgroundColor: isRedesignMode ? '#4CAF50' : '#fff',
              color: isRedesignMode ? '#fff' : '#000',
              fontWeight: isRedesignMode ? 'bold' : 'normal'
            }}
          >
            {isRedesignMode ? '✓ Redesign Mode' : 'Redesign Mode'}
          </button>
          {canSetScale && (
            <button
              onClick={handleToggleMeasureMode}
              style={{
                backgroundColor: isMeasureMode ? '#e53935' : '#fff',
                color: isMeasureMode ? '#fff' : '#e53935',
                fontWeight: isMeasureMode ? 'bold' : 'normal',
                borderColor: '#e53935'
              }}
            >
              {isMeasureMode ? '✕ Cancel Measure' : '📏 Set Scale'}
            </button>
          )}
          <button 
            onClick={handleDeletePlan} 
            disabled={!currentPlanId}
            style={{ 
              color: currentPlanId ? '#d32f2f' : '#ccc',
              borderColor: currentPlanId ? '#d32f2f' : '#ccc'
            }}
          >
            Delete Plan
          </button>
          {error && <span style={{ color: '#ff4444', marginLeft: '10px' }}>{error}</span>}
        </div>
      </div>

      {/* Content Area */}
      <div className="content-area" ref={contentAreaRef}>
        {/* Left Panel: Project Selector */}
        <div className="panel panel-left" style={{ width: `${leftPanelWidth}px` }}>
          <h2>Projects</h2>
          <div className="project-list">
            <div 
              className="project-item" 
              onClick={handleNewPlan}
              style={{ cursor: 'pointer', fontWeight: currentPlanId === null ? 'bold' : 'normal' }}
            >
              New project
            </div>
            <div 
              className="project-item" 
              onClick={handleUploadClick}
              style={{ cursor: 'pointer' }}
            >
              {isUploading ? '⏳ Uploading...' : '📁 Upload Image'}
            </div>
            <div style={{ marginTop: '10px', padding: '5px', fontSize: '12px', color: '#666' }}>
              Your projects {isLoadingPlans && '(loading...)'}
            </div>
            {userPlans.length === 0 && !isLoadingPlans && (
              <div style={{ padding: '5px', fontSize: '12px', color: '#999' }}>
                No plans yet
              </div>
            )}
            {userPlans.map(plan => (
              <div 
                key={plan.id}
                className={`project-item${currentPlanId === plan.id ? ' active' : ''}`}
                onClick={() => renamingPlanId === plan.id ? undefined : handleLoadPlan(plan.id)}
                style={{ 
                  cursor: renamingPlanId === plan.id ? 'default' : 'pointer',
                  fontSize: '12px'
                }}
              >
                {renamingPlanId === plan.id ? (
                  <input
                    autoFocus
                    value={renameInputValue}
                    onChange={e => setRenameInputValue(e.target.value)}
                    onBlur={() => handleSubmitRename(plan.id)}
                    onKeyDown={e => handleRenameKeyDown(e, plan.id)}
                    onClick={e => e.stopPropagation()}
                    style={{
                      width: '100%',
                      fontSize: '12px',
                      padding: '2px 4px',
                      border: '1px solid #aaa',
                      borderRadius: '3px',
                      boxSizing: 'border-box',
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={e => handleStartRename(plan, e)}
                    title="Double-click to rename"
                    style={{ fontWeight: currentPlanId === plan.id ? 'bold' : 'normal' }}
                  >
                    📐 {plan.name || 'Untitled'}
                  </span>
                )}
                <br />
                <span style={{ color: '#666' }}>
                  {plan.rooms_count} rooms
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Left Divider */}
        <div
          className="panel-divider"
          onMouseDown={(e) => handleMouseDown(e, 'left')}
        />

        {/* Middle Panel: Canvas */}
        <div className="panel panel-middle">
          {/* Tools Bar */}
          <ToolsBar 
            activeTool={activeTool}
            onToolChange={setActiveTool}
          />
          {activeTool === 'wall' && (
            <WallToolOptions
              thickness={wallThickness}
              onThicknessChange={setWallThickness}
              isCalibrated={floorPlan.is_calibrated ?? false}
            />
          )}
          {activeTool === 'assets' && (
            <AssetToolOptions
              assetType={assetType}
              widthM={assetWidthM}
              onAssetTypeChange={setAssetType}
              onWidthChange={setAssetWidthM}
              isCalibrated={floorPlan.is_calibrated ?? false}
            />
          )}
          
          <div id="canvas-container" style={{ 
            position: 'relative',
            border: isRedesignMode ? '3px solid #4CAF50' : isMeasureMode ? '3px solid #e53935' : 'none',
            borderRadius: (isRedesignMode || isMeasureMode) ? '8px' : '0'
          }}>
            {isRedesignMode && (
              <div style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                backgroundColor: '#4CAF50',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: 'bold',
                zIndex: 1000,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
              }}>
                🎨 Redesign Mode Active - Click rooms to lock/unlock
              </div>
            )}
            {isMeasureMode && (
              <div className="measure-overlay">
                <div className="measure-banner">
                  {!measuredPixelDistance
                    ? '📏 Click two points on a wall to measure it'
                    : '📏 Measurement complete — enter the real length below'}
                </div>
                {measuredPixelDistance && (
                  <div className="measure-input-panel">
                    <span className="measure-distance">
                      Measured: {measuredPixelDistance.toFixed(1)} px
                    </span>
                    <div className="measure-input-row">
                      <label>Real length (m):</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={metersInput}
                        onChange={(e) => setMetersInput(e.target.value)}
                        placeholder="e.g. 3.5"
                        className="measure-input"
                        autoFocus
                      />
                      <button
                        onClick={handleApplyScale}
                        disabled={!metersInput || parseFloat(metersInput) <= 0 || isNormalizingScale}
                        className="measure-apply-btn"
                      >
                        {isNormalizingScale ? 'Applying...' : 'Apply Scale'}
                      </button>
                      <button
                        onClick={handleRemeasure}
                        className="measure-remeasure-btn"
                        title="Remeasure (Esc)"
                      >
                        Remeasure
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Edge Selection Controls */}
            {selectedEdgeIds.size > 0 && isEditMode && !isRedesignMode && !isMeasureMode && (() => {
              const selectedEdges = floorPlan.edges.filter(e => selectedEdgeIds.has(e.id));
              const isCalibrated = floorPlan.is_calibrated ?? false;
              const defaultThick = isCalibrated ? 0.2 : 16;
              const thicknessValues = [...new Set(selectedEdges.map(e => e.thickness ?? defaultThick))];
              const shiftValues = [...new Set(selectedEdges.map(e => e.shift ?? 0))];
              const thicknessRaw = thicknessValues.length === 1 ? thicknessValues[0] : null;
              const thicknessDisplay = thicknessRaw !== null
                ? (isCalibrated ? thicknessRaw.toFixed(2) : Math.round(thicknessRaw).toString())
                : '–';
              const thicknessUnit = isCalibrated ? ' m' : ' px';
              const thicknessStep = isCalibrated ? 0.1 : 1;
              const shiftRaw = shiftValues.length === 1 ? shiftValues[0] : null;
              const shiftDisplay = shiftRaw !== null
                ? (isCalibrated ? shiftRaw.toFixed(2) : Math.round(shiftRaw).toString())
                : '–';
              const shiftUnit = isCalibrated ? ' m' : ' px';
              const shiftStep = isCalibrated ? 0.1 : 1;
              const stepperBtn: React.CSSProperties = {
                backgroundColor: '#e3f2fd',
                color: '#1565c0',
                border: '1px solid #90caf9',
                borderRadius: '4px',
                width: '24px',
                height: '24px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '12px',
                lineHeight: '1',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              };
              return (
                <div style={{
                  position: 'absolute',
                  top: '20px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: '#fff',
                  border: '2px solid #2196F3',
                  borderRadius: '8px',
                  padding: '12px 20px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '10px',
                  zIndex: 1000
                }}>
                  {/* Row 1: selection label + action buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontWeight: 'bold', color: '#2196F3' }}>
                      {selectedEdgeIds.size} edge{selectedEdgeIds.size > 1 ? 's' : ''} selected
                    </span>
                    <button
                      onClick={handleDeleteSelected}
                      style={{
                        backgroundColor: '#f44336',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '6px 16px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '14px'
                      }}
                      title="Delete selected edges (Delete key)"
                    >
                      🗑️ Delete
                    </button>
                    <button
                      onClick={handleMergeSelected}
                      disabled={selectedEdgeIds.size < 2}
                      style={{
                        backgroundColor: selectedEdgeIds.size < 2 ? '#ccc' : '#2196F3',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '6px 16px',
                        cursor: selectedEdgeIds.size < 2 ? 'not-allowed' : 'pointer',
                        fontWeight: 'bold',
                        fontSize: '14px',
                        opacity: selectedEdgeIds.size < 2 ? 0.6 : 1
                      }}
                      title={selectedEdgeIds.size < 2 ? 'Select at least 2 edges to merge' : 'Merge selected edges into one'}
                    >
                      🔗 Merge
                    </button>
                    <button
                      onClick={handleClearSelection}
                      style={{
                        backgroundColor: '#fff',
                        color: '#666',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        padding: '6px 16px',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                      title="Clear selection (Esc)"
                    >
                      ✕ Clear
                    </button>
                  </div>
                  {/* Row 2: thickness + shift steppers */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '20px',
                    borderTop: '1px solid #e3f2fd',
                    paddingTop: '8px',
                    width: '100%',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '13px', color: '#555', fontWeight: 500 }}>Thickness:</span>
                      <button style={stepperBtn} onClick={() => handleEdgePropertyUpdate({ thickness: -thicknessStep })} title="Decrease thickness">▼</button>
                      <input
                        key={`${Array.from(selectedEdgeIds).sort().join(',')}_${thicknessDisplay}`}
                        type="number"
                        defaultValue={thicknessDisplay}
                        step={thicknessStep}
                        min={isCalibrated ? 0.01 : 1}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const v = parseFloat((e.target as HTMLInputElement).value);
                            if (!isNaN(v)) handleEdgeThicknessSet(v);
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) handleEdgeThicknessSet(v);
                        }}
                        style={{
                          width: '60px',
                          textAlign: 'center',
                          fontSize: '13px',
                          fontWeight: 'bold',
                          color: '#1565c0',
                          border: '1px solid #90caf9',
                          borderRadius: '4px',
                          padding: '2px 4px',
                          backgroundColor: '#e3f2fd',
                        }}
                      />
                      <span style={{ fontSize: '12px', color: '#888' }}>{thicknessUnit}</span>
                      <button style={stepperBtn} onClick={() => handleEdgePropertyUpdate({ thickness: thicknessStep })} title="Increase thickness">▲</button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '13px', color: '#555', fontWeight: 500 }}>Shift:</span>
                      <button style={stepperBtn} onClick={() => handleEdgePropertyUpdate({ shift: -shiftStep })} title="Shift wall left/down">▼</button>
                      <input
                        key={`${Array.from(selectedEdgeIds).sort().join(',')}_shift_${shiftDisplay}`}
                        type="number"
                        defaultValue={shiftDisplay}
                        step={shiftStep}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const v = parseFloat((e.target as HTMLInputElement).value);
                            if (!isNaN(v)) handleEdgeShiftSet(v);
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) handleEdgeShiftSet(v);
                        }}
                        style={{
                          width: '60px',
                          textAlign: 'center',
                          fontSize: '13px',
                          fontWeight: 'bold',
                          color: '#1565c0',
                          border: '1px solid #90caf9',
                          borderRadius: '4px',
                          padding: '2px 4px',
                          backgroundColor: '#e3f2fd',
                        }}
                      />
                      <span style={{ fontSize: '12px', color: '#888' }}>{shiftUnit}</span>
                      <button style={stepperBtn} onClick={() => handleEdgePropertyUpdate({ shift: shiftStep })} title="Shift wall right/up">▲</button>
                    </div>
                  </div>
                </div>
              );
            })()}

            <FloorPlanCanvas
              floorPlan={floorPlan}
              activeTool={activeTool}
              wallThickness={wallThickness}
              onWallAdd={handleWallAdd}
              assetType={assetType}
              assetWidthM={assetWidthM}
              onAssetPlace={handleAssetPlace}
              onEdgeClick={() => {}}
              onRoomClick={isRedesignMode ? handleToggleRoomLock : undefined}
              measureMode={isMeasureMode}
              onMeasure={handleMeasure}
              isEditMode={isEditMode && !isRedesignMode && !isMeasureMode}
              onNodePositionsChange={handleNodePositionsChange}
              selectedEdgeIds={selectedEdgeIds}
              onSelectedEdgesChange={handleSelectedEdgesChange}
              onEdgeDelete={handleEdgeDelete}
            />
          </div>
        </div>

        {/* Right Divider */}
        <div
          className="panel-divider"
          onMouseDown={(e) => handleMouseDown(e, 'right')}
        />

        {/* Right Panel: Roomly Live Assistant / Redesign Panel */}
        <div className="panel panel-right" style={{ width: `${rightPanelWidth}px` }}>
          {isRedesignMode ? (
            // Redesign Panel
            <>
              <h2>🎨 Redesign Configuration</h2>
              <div className="redesign-panel">
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                    Describe your design desires:
                  </label>
                  <textarea
                    value={redesignDesires}
                    onChange={(e) => setRedesignDesires(e.target.value)}
                    placeholder="e.g., I want a more open kitchen connected to living room, larger master bedroom..."
                    style={{
                      width: '100%',
                      minHeight: '120px',
                      padding: '10px',
                      fontSize: '14px',
                      borderRadius: '4px',
                      border: '1px solid #ddd',
                      resize: 'vertical'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>
                    Lock Rooms (keep unchanged)
                  </h3>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
                    Click rooms on canvas or use checkboxes below
                  </div>
                  {!floorPlan.rooms || floorPlan.rooms.length === 0 ? (
                    <div style={{ color: '#999', fontStyle: 'italic' }}>No rooms detected</div>
                  ) : (
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                      {floorPlan.rooms.map((room, index) => (
                        <div 
                          key={room.id}
                          style={{
                            padding: '8px',
                            marginBottom: '4px',
                            backgroundColor: room.locked ? '#e8f5e9' : '#fff3e0',
                            border: `1px solid ${room.locked ? '#4CAF50' : '#ff9800'}`,
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                          }}
                          onClick={() => handleToggleRoomLock(room.id)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                              type="checkbox"
                              checked={room.locked || false}
                              onChange={() => handleToggleRoomLock(room.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span>
                              Room {index + 1}
                              {room.tags && room.tags.length > 0 && (
                                <span style={{ color: '#666', fontSize: '11px' }}>
                                  {' '}({room.tags.join(', ')})
                                </span>
                              )}
                            </span>
                          </div>
                          <span style={{ fontSize: '16px' }}>
                            {room.locked ? '🔒' : '🔓'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleRedesignSubmit}
                  disabled={isRedesigning}
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    backgroundColor: isRedesigning ? '#ccc' : '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: isRedesigning ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isRedesigning ? 'Generating...' : 'Generate Redesign'}
                </button>
              </div>
            </>
          ) : (
            // Original Assistant Panel
            <>
              <h2>Roomly Live Assistant</h2>
              <div className="assistant-section">
                <div className="assistant-card">
                  <h3 className="assistant-title">Roomly.Agent</h3>
                  <p className="assistant-message">How many rooms does your apartment have?</p>
                </div>
                <div className="assistant-card">
                  <p className="assistant-response">
                    <strong>Ronald</strong><br />
                    5
                  </p>
                </div>
                <div className="assistant-footer">
                  <button className="assistant-button">let us know more</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Generated Image Preview Modal */}
      {generatedImage && (
        <GeneratedImagePreview
          imageBase64={generatedImage}
          onClose={handleCloseGeneratedImage}
          onRegenerate={handleRegenerateImage}
          isGenerating={isRedesigning}
        />
      )}
    </div>
  );
};
