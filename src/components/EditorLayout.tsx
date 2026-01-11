import React, { useRef, useState } from 'react';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import { sampleFloorPlan } from '../data';
import './EditorLayout.css';

export const EditorLayout: React.FC = () => {
  const [leftPanelWidth, setLeftPanelWidth] = useState(200);
  const [rightPanelWidth, setRightPanelWidth] = useState(280);
  const contentAreaRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="app-container">
      {/* Top Header Bar */}
      <div className="canvas-header">
        <h2>Floor Plan Editor</h2>
        <div className="canvas-controls">
          <button onClick={handleResetZoom}>Reset Zoom</button>
        </div>
      </div>

      {/* Content Area */}
      <div className="content-area" ref={contentAreaRef}>
        {/* Left Panel: Project Selector */}
        <div className="panel panel-left" style={{ width: `${leftPanelWidth}px` }}>
          <h2>Projects</h2>
          <div className="project-list">
            <div className="project-item">New project</div>
            <div className="project-item">Your projects</div>
            <div className="project-item">Search</div>
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
              floorPlan={sampleFloorPlan}
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
