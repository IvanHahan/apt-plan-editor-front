import React from 'react';
import type { WallToolOptionsProps } from '../types';
import './WallToolOptions.css';

const PRESETS: { label: string; cm: number }[] = [
  { label: '10 cm', cm: 10 },
  { label: '15 cm', cm: 15 },
  { label: '20 cm', cm: 20 },
  { label: '30 cm', cm: 30 },
];

const dataToCm = (v: number, unitScale: number) =>
  Math.round((v / unitScale) * 100);

const cmToData = (cm: number, unitScale: number) =>
  (cm / 100) * unitScale;

export const WallToolOptions: React.FC<WallToolOptionsProps> = ({
  thickness,
  onThicknessChange,
  unitScale,
}) => {
  const currentCm = dataToCm(thickness, unitScale);
  const matchedPreset = PRESETS.find((p) => p.cm === currentCm);

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'custom') return;
    onThicknessChange(cmToData(parseInt(val, 10), unitScale));
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onThicknessChange(cmToData(parseInt(e.target.value, 10), unitScale));
  };

  return (
    <div className="wall-tool-options">
      <span className="wall-tool-label">Wall Width</span>

      <select
        className="wall-preset-select"
        value={matchedPreset ? matchedPreset.cm.toString() : 'custom'}
        onChange={handlePresetChange}
      >
        {PRESETS.map((p) => (
          <option key={p.cm} value={p.cm.toString()}>
            {p.label}
          </option>
        ))}
        {!matchedPreset && (
          <option value="custom">Custom ({currentCm} cm)</option>
        )}
      </select>

      <input
        type="range"
        className="wall-thickness-slider"
        min={5}
        max={50}
        step={1}
        value={currentCm}
        onChange={handleSliderChange}
      />

      <span className="wall-thickness-readout">{currentCm} cm</span>
    </div>
  );
};
