import React, { useState } from 'react';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import { sampleFloorPlan } from '../data';
import './EditorLayout.css';

export const EditorLayout: React.FC = () => {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const selectedEdge = sampleFloorPlan.edges.find((e) => e.id === selectedEdgeId);
  const sourceNode = selectedEdge
    ? sampleFloorPlan.nodes.find((n) => n.id === selectedEdge.source)
    : null;
  const targetNode = selectedEdge
    ? sampleFloorPlan.nodes.find((n) => n.id === selectedEdge.target)
    : null;

  const handleResetZoom = () => {
    // Reset zoom functionality
    const svg = document.querySelector('svg') as SVGSVGElement;
    if (svg) {
      svg.dispatchEvent(new CustomEvent('resetZoom'));
    }
  };

  return (
    <div className="app-container">
      {/* Left Panel: Project Selector */}
      <div className="panel panel-left">
        <h2>Projects</h2>
        <div className="project-list">
          <div className="project-item active">Sample Apartment</div>
          <div className="project-item">New Project</div>
        </div>
      </div>

      {/* Middle Panel: Canvas */}
      <div className="panel panel-middle">
        <div className="canvas-header">
          <h2>Floor Plan Editor</h2>
          <div className="canvas-controls">
            <button onClick={handleResetZoom}>Reset Zoom</button>
          </div>
        </div>
        <div id="canvas-container">
          <FloorPlanCanvas
            floorPlan={sampleFloorPlan}
            onEdgeClick={setSelectedEdgeId}
          />
        </div>
      </div>

      {/* Right Panel: Properties */}
      <div className="panel panel-right">
        <h2>Properties</h2>
        <div className="properties-container">
          {selectedEdge ? (
            <>
              <div className="property-section">
                <h3>Selected Element</h3>
                <div className="property-item">
                  <label>Type:</label>
                  <span className="property-value">{selectedEdge.type}</span>
                </div>
                <div className="property-item">
                  <label>ID:</label>
                  <span className="property-value">{selectedEdge.id}</span>
                </div>
                <div className="property-item">
                  <label>Source:</label>
                  <span className="property-value">{sourceNode?.id}</span>
                </div>
                <div className="property-item">
                  <label>Target:</label>
                  <span className="property-value">{targetNode?.id}</span>
                </div>
              </div>
              <button
                className="clear-selection-btn"
                onClick={() => setSelectedEdgeId(null)}
              >
                Clear Selection
              </button>
            </>
          ) : (
            <div className="properties-placeholder">
              Click on an element to view its properties
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
