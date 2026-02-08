import React, { useRef, useState } from 'react';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import { sampleFloorPlan } from '../data';
import { processFloorPlanImage, listUserFloorPlans, deleteFloorPlan, redesignFloorPlan, type FloorPlanSummary } from '../api/client';
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
  
  // Redesign mode state
  const [isRedesignMode, setIsRedesignMode] = useState(false);
  const [redesignDesires, setRedesignDesires] = useState('');

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

  const [isRedesigning, setIsRedesigning] = useState(false);

  const handleRedesignSubmit = async () => {
    if (!redesignDesires.trim()) {
      alert('Please describe your design desires before submitting.');
      return;
    }
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
        num_alternatives: 3,
      });

      if (response.alternatives.length > 0) {
        // Load the first alternative as the current plan
        const firstAlt = response.alternatives[0];
        const converted = convertApiToFloorPlan(firstAlt.floor_plan);
        setFloorPlan(converted);
        setCurrentPlanId(firstAlt.floor_plan.id);

        // Exit redesign mode
        setIsRedesignMode(false);
        setRedesignDesires('');

        // Reload plans list to show new alternatives
        await loadUserPlans();

        alert(`Redesign complete! Generated ${response.total} alternative(s).`);
      } else {
        setError('No valid alternatives were generated. Try different desires.');
      }
    } catch (err) {
      console.error('Redesign failed:', err);
      setError(err instanceof Error ? err.message : 'Redesign failed');
    } finally {
      setIsRedesigning(false);
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
            onClick={handleToggleRedesignMode}
            style={{
              backgroundColor: isRedesignMode ? '#4CAF50' : '#fff',
              color: isRedesignMode ? '#fff' : '#000',
              fontWeight: isRedesignMode ? 'bold' : 'normal'
            }}
          >
            {isRedesignMode ? '✓ Redesign Mode' : 'Redesign Mode'}
          </button>
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
          <div id="canvas-container" style={{ 
            position: 'relative',
            border: isRedesignMode ? '3px solid #4CAF50' : 'none',
            borderRadius: isRedesignMode ? '8px' : '0'
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
            <FloorPlanCanvas
              floorPlan={floorPlan}
              onEdgeClick={() => {}}
              onRoomClick={isRedesignMode ? handleToggleRoomLock : undefined}
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
                  disabled={!redesignDesires.trim() || isRedesigning}
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    backgroundColor: (!redesignDesires.trim() || isRedesigning) ? '#ccc' : '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: (!redesignDesires.trim() || isRedesigning) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isRedesigning ? 'Redesigning...' : 'Submit Redesign Request'}
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
    </div>
  );
};
