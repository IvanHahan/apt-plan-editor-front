import React from 'react';
import type { AssetToolOptionsProps, AssetType } from '../types';
import './AssetToolOptions.css';

const DOOR_PRESETS: { label: string; cm: number }[] = [
  { label: '70 cm', cm: 70 },
  { label: '80 cm', cm: 80 },
  { label: '90 cm', cm: 90 },
  { label: '100 cm', cm: 100 },
];

const WINDOW_PRESETS: { label: string; cm: number }[] = [
  { label: '60 cm', cm: 60 },
  { label: '90 cm', cm: 90 },
  { label: '120 cm', cm: 120 },
  { label: '150 cm', cm: 150 },
];

export const AssetToolOptions: React.FC<AssetToolOptionsProps> = ({
  assetType,
  widthCm,
  onAssetTypeChange,
  onWidthChange,
  unitScale,
}) => {
  const presets = assetType === 'door' ? DOOR_PRESETS : WINDOW_PRESETS;
  const matchedPreset = presets.find((p) => p.cm === widthCm);

  const handleTypeChange = (type: AssetType) => {
    onAssetTypeChange(type);
    // Switch to the first preset of the new type
    const newPresets = type === 'door' ? DOOR_PRESETS : WINDOW_PRESETS;
    onWidthChange(newPresets[1].cm); // default to second preset
  };

  const handlePresetClick = (cm: number) => {
    onWidthChange(cm);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val > 0 && val <= 500) {
      onWidthChange(val);
    }
  };

  // Compute data-space width for display
  const dataWidth = ((widthCm / 100) * unitScale).toFixed(1);

  return (
    <div className="asset-tool-options">
      {/* Type tabs */}
      <div className="asset-type-tabs">
        <button
          className={`asset-type-tab${assetType === 'door' ? ' active' : ''}`}
          onClick={() => handleTypeChange('door')}
          title="Place a door"
        >
          🚪 Door
        </button>
        <button
          className={`asset-type-tab${assetType === 'window' ? ' active' : ''}`}
          onClick={() => handleTypeChange('window')}
          title="Place a window"
        >
          🪟 Window
        </button>
      </div>

      {/* Width label */}
      <span className="asset-tool-label">Width</span>

      {/* Preset chips */}
      <div className="asset-preset-chips">
        {presets.map((p) => (
          <button
            key={p.cm}
            className={`asset-preset-chip${widthCm === p.cm ? ' active' : ''}`}
            onClick={() => handlePresetClick(p.cm)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom input */}
      <div className="asset-custom-input-group">
        <label className="asset-custom-label">Custom:</label>
        <input
          type="number"
          className="asset-custom-input"
          min={10}
          max={500}
          step={5}
          value={matchedPreset ? '' : widthCm}
          placeholder={matchedPreset ? widthCm.toString() : ''}
          onChange={handleCustomChange}
        />
        <span className="asset-custom-unit">cm</span>
      </div>

      {/* Current readout */}
      <span className="asset-width-readout" title={`${dataWidth} data units`}>{widthCm} cm</span>

      {/* Hint */}
      <span className="asset-hint">Hover over a wall to snap • Click to place</span>
    </div>
  );
};
