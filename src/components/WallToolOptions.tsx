import React from 'react';
import type { WallToolOptionsProps } from '../types';
import './WallToolOptions.css';

/**
 * Metre-based presets (used when isCalibrated = true).
 * 1 data-unit == 1 metre when calibrated, so thickness IS already in metres.
 */
const PRESETS_M: { label: string; m: number }[] = [
  { label: '0.10 m', m: 0.10 },
  { label: '0.15 m', m: 0.15 },
  { label: '0.20 m', m: 0.20 },
  { label: '0.30 m', m: 0.30 },
];

/** Human-readable label for the current thickness. */
const displayLabel = (thickness: number, isCalibrated: boolean): string =>
  isCalibrated ? `${thickness.toFixed(2)} m` : `${Math.round(thickness)} px`;

export const WallToolOptions: React.FC<WallToolOptionsProps> = ({
  thickness,
  onThicknessChange,
  isCalibrated,
}) => {
  const matchedPreset = isCalibrated
    ? PRESETS_M.find((p) => Math.abs(p.m - thickness) < 0.001)
    : null;

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!isCalibrated) return;
    const val = e.target.value;
    if (val === 'custom') return;
    onThicknessChange(parseFloat(val));
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parseFloat(e.target.value);
    if (isCalibrated) {
      // Slider operates in mm for finer control; convert mm → m.
      onThicknessChange(raw / 1000);
    } else {
      onThicknessChange(raw);
    }
  };

  // Slider value: mm when calibrated, raw px when not.
  const sliderValue = isCalibrated
    ? Math.round(thickness * 1000)
    : Math.round(thickness);

  return (
    <div className="wall-tool-options">
      <span className="wall-tool-label">Wall Width</span>

      {isCalibrated && (
        <select
          className="wall-preset-select"
          value={matchedPreset ? matchedPreset.m.toString() : 'custom'}
          onChange={handlePresetChange}
        >
          {PRESETS_M.map((p) => (
            <option key={p.m} value={p.m.toString()}>
              {p.label}
            </option>
          ))}
          {!matchedPreset && (
            <option value="custom">Custom ({displayLabel(thickness, isCalibrated)})</option>
          )}
        </select>
      )}

      <input
        type="range"
        className="wall-thickness-slider"
        min={isCalibrated ? 50 : 1}
        max={isCalibrated ? 500 : 200}
        step={isCalibrated ? 10 : 1}
        value={sliderValue}
        onChange={handleSliderChange}
      />

      <span className="wall-thickness-readout">{displayLabel(thickness, isCalibrated)}</span>
    </div>
  );
};
