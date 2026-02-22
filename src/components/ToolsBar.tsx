import React from 'react';
import type { EditorTool, ToolDefinition } from '../types';
import './ToolsBar.css';

interface ToolsBarProps {
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
}

const TOOLS: ToolDefinition[] = [
  {
    id: 'cursor',
    label: 'Cursor',
    icon: '🖱️',
    description: 'Select and move elements'
  },
  {
    id: 'selection',
    label: 'Selection',
    icon: '⬚',
    description: 'Drag to select multiple elements'
  },
  {
    id: 'wall',
    label: 'Wall',
    icon: '🧱',
    description: 'Draw new walls'
  },
  {
    id: 'assets',
    label: 'Assets',
    icon: '🚪',
    description: 'Place doors and windows on walls'
  }
];

export const ToolsBar: React.FC<ToolsBarProps> = ({ activeTool, onToolChange }) => {
  return (
    <div className="tools-bar">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={activeTool === tool.id ? 'active' : ''}
          onClick={() => onToolChange(tool.id)}
          title={tool.description}
        >
          <span className="tool-icon">{tool.icon}</span>
          <span className="tool-label">{tool.label}</span>
        </button>
      ))}
    </div>
  );
};
