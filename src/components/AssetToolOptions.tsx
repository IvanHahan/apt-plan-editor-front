import React from 'react';
import type { AssetToolOptionsProps, AssetType } from '../types';
import './AssetToolOptions.css';

const DOOR_PRESETS_M: { label: string; m: number }[] = [
  { label: '0.70 m', m: 0.70 },
  { label: '0.80 m', m: 0.80 },
  { label: '0.90 m', m: 0.90 },
  { label: '1.00 m', m: 1.00 },
];

const WINDOW_PRESETS_M: { label: string; m: number }[] = [
  { label: '0.60 m', m: 0.60 },
  { label: '0.90 m', m: 0.90 },
  { label: '1.20 m', m: 1.20 },
  { label: '1.50 m', m: 1.50 },
];

const formatWidth = (m: number, calibrated: boolean): string =>
  calibrated ? `${m.toFixed(2)} m` : `${Math.round(m)} px`;

export const AssetToolOptions: React.FC<AssetToolOptionsProps> = ({
  assetType,
  widthM,
  onAssetTypeChange,
  onWidthChange,
  isCalibrated,
}) => {
  const calibrated = isCalibrated;
  const presets = assetType === 'door' ? DOOR_PRESETS_M : WINDOW_PRESETS_M;
  const matchedPreset = calibrated
    ? presets.find((p) => Math.abs(p.m - widthM) < 0.001)
    : null;

  const handleTypeChange = (type: AssetType) => {
    onAssetTypeChange(type);
    const newPresets = type === 'door' ? DOOR_PRESETS_M : WINDOW_PRESETS_M;
    onWidthChange(newPresets[1].m);
  };

  const handlePresetClick = (m: number) => {
    onWidthChange(m);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) {
      onWidthChange(val);
    }
  };

  const displayLabel = formatWidth(widthM, calibrated);

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

      {/* Preset chips (calibrated plans only) */}
      {calibrated && (
        <div className="asset-preset-chips">
          {presets.map((p) => (
            <button
              key={p.m}
              className={`asset-preset-chip${matchedPreset?.m === p.m ? ' active' : ''}`}
              onClick={() => handlePresetClick(p.m)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Custom input */}
      <div className="asset-custom-input-group">
        <label className="asset-custom-label">Custom:</label>
        <input
          type="number"
          className="asset-custom-input"
          min={calibrated ? 0.1 : 10}
          max={calibrated ? 5 : 5000}
          step={calibrated ? 0.05 : 5}
          value={matchedPreset ? '' : widthM}
          placeholder={matchedPreset ? widthM.toString() : ''}
          onChange={handleCustomChange}
        />
        <span className="asset-custom-unit">{calibrated ? 'm' : 'px'}</span>
      </div>

      {/* Current readout */}
      <span className="asset-width-readout">{displayLabel}</span>

      {/* Hint */}
      <span className="asset-hint">Hover over a wall to snap • Click to place</span>
    </div>
  );
};
