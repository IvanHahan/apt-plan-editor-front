import React from 'react';
import './GeneratedImagePreview.css';

interface GeneratedImagePreviewProps {
  imageBase64: string;
  onClose: () => void;
  onRegenerate: () => void;
  isGenerating?: boolean;
}

export const GeneratedImagePreview: React.FC<GeneratedImagePreviewProps> = ({
  imageBase64,
  onClose,
  onRegenerate,
  isGenerating = false,
}) => {
  const handleDownload = () => {
    // Convert base64 to blob and download
    const byteCharacters = atob(imageBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });
    
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `redesigned-floor-plan-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="generated-image-overlay">
      <div className="generated-image-modal">
        <div className="generated-image-header">
          <h3>Generated Floor Plan</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="generated-image-container">
          <img 
            src={`data:image/png;base64,${imageBase64}`} 
            alt="Generated floor plan"
            className="generated-image"
          />
        </div>
        
        <div className="generated-image-actions">
          <button 
            className="action-button download-button"
            onClick={handleDownload}
          >
            Download
          </button>
          <button 
            className="action-button regenerate-button"
            onClick={onRegenerate}
            disabled={isGenerating}
          >
            {isGenerating ? 'Generating...' : 'Regenerate'}
          </button>
          <button 
            className="action-button close-action-button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
