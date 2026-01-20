import React, { useRef, useState } from 'react';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import { sampleFloorPlan } from '../data';
import { processFloorPlanImage, listUserFloorPlans, deleteFloorPlan, type FloorPlanSummary } from '../api/client';
import { convertApiToFloorPlan } from '../utils/converter';
import type { FloorPlan } from '../types';
import './EditorLayout.css';

// Get user ID from env (in production, get from auth)
const USER_ID = import.meta.env.VITE_USER_ID || '550e8400-e29b-41d4-a716-446655440000';

export const EditorLayout: React.FC = () => {
  const [leftPanelWidth, setLeftPanelWidth] = useState(200);
  const [rightPanelWidth, setRightPanelWidth] = useState(280);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [floorPlan, setFloorPlan] = useState<FloorPlan>(sampleFloorPlan);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [userPlans, setUserPlans] = useState<FloorPlanSummary[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const { getFloorPlan } = await import('../api/client');
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
    setFloorPlan(sampleFloorPlan);
    setCurrentPlanId(null);
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

  const handleDeletePlan = async () => {
    if (!currentPlanId) return;
    
    const confirmDelete = window.confirm(
      'Are you sure you want to delete this floor plan? This action cannot be undone.'
    );
    
    if (!confirmDelete) return;

    try {
      setError(null);
      await deleteFloorPlan(currentPlanId);
      
      // Reset to sample plan and clear selection
      setFloorPlan(sampleFloorPlan);
      setCurrentPlanId(null);
      
      // Reload plans list
      await loadUserPlans();
    } catch (err) {
      console.error('Failed to delete plan:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete plan');
    }
  };

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
        <h2>Floor Plan Editor</h2>
        <div className="canvas-controls">
          <button onClick={handleUploadClick} disabled={isUploading}>
            {isUploading ? 'Uploading...' : 'Upload Image'}
          </button>
          <button onClick={handleResetZoom}>Reset Zoom</button>
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
                className="project-item"
                onClick={() => handleLoadPlan(plan.id)}
                style={{ 
                  cursor: 'pointer',
                  fontWeight: currentPlanId === plan.id ? 'bold' : 'normal',
                  fontSize: '12px'
                }}
              >
                📐 {plan.name || 'Untitled'} 
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
          <div id="canvas-container">
            <FloorPlanCanvas
              floorPlan={floorPlan}
              onEdgeClick={() => {}}
            />
          </div>
        </div>

        {/* Right Divider */}
        <div
          className="panel-divider"
          onMouseDown={(e) => handleMouseDown(e, 'right')}
        />

        {/* Right Panel: Roomly Live Assistant */}
        <div className="panel panel-right" style={{ width: `${rightPanelWidth}px` }}>
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
        </div>
      </div>
    </div>
  );
};
